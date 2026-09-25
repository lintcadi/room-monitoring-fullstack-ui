import asyncio
import json
import os
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI
from fastapi.sse import ServerSentEvent
from psycopg import OperationalError

with patch.dict(os.environ, {
    "POSTGRES_HOST": "postgres.test",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "test",
    "POSTGRES_USER": "test",
    "POSTGRES_PASSWORD": "test",
}):
    from backend import main, telemetry_stream
    from backend.routers import telemetry as router
    from backend.telemetry import LatestTelemetryResponse, TelemetryValue


def reading(reading_id, tag_id=1):
    observed = datetime(2026, 9, 25, 10, tzinfo=ZoneInfo("Asia/Taipei"))
    return TelemetryValue(
        id=reading_id, tag_id=tag_id, tag_key=f"tag-{tag_id}", value=24.6,
        quality=192, observed_at=observed, ingested_at=observed,
    )


class TelemetryStreamTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stream = telemetry_stream.TelemetryStream()
        self.addAsyncCleanup(self.stream.stop)
        self.fetch = AsyncMock(return_value=LatestTelemetryResponse(readings=[]))
        replacement = patch.object(telemetry_stream, "fetch_latest_telemetry", self.fetch)
        replacement.start()
        self.addCleanup(replacement.stop)

    def subscribe(self, **filters):
        events = self.stream.events(**filters)

        async def close_events():
            await events.aclose()

        self.addAsyncCleanup(close_events)
        return events

    async def refresh(self, *readings):
        self.fetch.return_value = LatestTelemetryResponse(readings=list(readings))
        await self.stream.refresh()

    async def next_event(self, events):
        return await asyncio.wait_for(anext(events), timeout=1)

    async def test_two_clients_share_one_database_read(self):
        first = self.subscribe()
        second = self.subscribe(tag_ids=[2])
        await self.refresh(reading(10), reading(20, 2))
        event = await self.next_event(first)
        self.assertEqual(event.event, "snapshot")
        self.assertEqual([r.id for r in event.data.readings], [10, 20])
        event = await self.next_event(second)
        self.assertEqual(event.event, "snapshot")
        self.assertEqual([r.id for r in event.data.readings], [20])
        self.fetch.assert_awaited_once_with()

    async def test_initial_empty_snapshot_waits_for_successful_read(self):
        events = self.subscribe()
        pending = asyncio.create_task(anext(events))
        await asyncio.sleep(0)
        self.assertFalse(pending.done())
        await self.refresh()
        event = await asyncio.wait_for(pending, timeout=1)
        self.assertEqual(event.event, "snapshot")
        self.assertEqual(event.data.readings, [])

    async def test_filters_use_intersection_and_unknown_tags_return_empty_snapshot(self):
        await self.refresh(reading(10), reading(20, 2))
        events = self.subscribe(tag_name=["tag-1", "tag-2"], tag_ids=[2])
        event = await self.next_event(events)
        self.assertEqual([r.tag_id for r in event.data.readings], [2])
        events = self.subscribe(tag_name=["missing"])
        self.assertEqual((await self.next_event(events)).data.readings, [])

    async def test_unchanged_and_unselected_readings_do_not_emit_updates(self):
        events = self.subscribe(tag_ids=[1])
        await self.refresh(reading(10), reading(20, 2))
        await self.next_event(events)
        pending = asyncio.create_task(anext(events))
        await self.refresh(reading(10), reading(20, 2))
        await asyncio.sleep(0)
        self.assertFalse(pending.done())
        await self.refresh(reading(10), reading(21, 2))
        await asyncio.sleep(0)
        self.assertFalse(pending.done())
        await self.refresh(reading(11), reading(21, 2))
        event = await asyncio.wait_for(pending, timeout=1)
        self.assertEqual(event.event, "update")
        self.assertEqual([r.id for r in event.data.readings], [11])

    async def test_slow_client_receives_changes_to_all_tags_since_its_last_event(self):
        fast = self.subscribe()
        slow = self.subscribe()
        await self.refresh(reading(10), reading(20, 2))
        await self.next_event(fast)
        await self.next_event(slow)
        await self.refresh(reading(11), reading(20, 2))
        self.assertEqual([r.id for r in (await self.next_event(fast)).data.readings], [11])
        await self.refresh(reading(11), reading(21, 2))
        self.assertEqual([r.id for r in (await self.next_event(fast)).data.readings], [21])
        event = await self.next_event(slow)
        self.assertEqual(event.event, "update")
        self.assertEqual([r.id for r in event.data.readings], [11, 21])

    async def test_removed_tag_sends_replacement_snapshot(self):
        events = self.subscribe()
        await self.refresh(reading(10), reading(20, 2))
        await self.next_event(events)
        await self.refresh(reading(10))
        event = await self.next_event(events)
        self.assertEqual(event.event, "snapshot")
        self.assertEqual([r.tag_id for r in event.data.readings], [1])

    async def test_database_failure_sends_status_and_recovery_sends_snapshot(self):
        events = self.subscribe()
        await self.refresh(reading(10))
        await self.next_event(events)
        self.fetch.side_effect = OperationalError("Database unavailable")
        with self.assertLogs(telemetry_stream.logger, level="WARNING"):
            await self.stream.refresh()
        event = await self.next_event(events)
        self.assertEqual(event.event, "status")
        self.assertEqual(event.data, {"status": "unavailable"})
        pending = asyncio.create_task(anext(events))
        await self.stream.refresh()
        await asyncio.sleep(0)
        self.assertFalse(pending.done())
        self.fetch.side_effect = None
        await self.refresh(reading(10))
        event = await asyncio.wait_for(pending, timeout=1)
        self.assertEqual(event.event, "snapshot")
        self.assertEqual([r.id for r in event.data.readings], [10])

    async def test_reconnect_gets_current_snapshot(self):
        events = self.subscribe()
        await self.refresh(reading(10))
        await self.next_event(events)
        await events.aclose()
        await self.refresh(reading(11))
        event = await self.next_event(self.subscribe())
        self.assertEqual(event.event, "snapshot")
        self.assertEqual([r.id for r in event.data.readings], [11])

    async def test_stop_ends_waiting_stream(self):
        events = self.subscribe()
        pending = asyncio.create_task(anext(events))
        await asyncio.sleep(0)
        await self.stream.stop()
        with self.assertRaises(StopAsyncIteration):
            await asyncio.wait_for(pending, timeout=1)

    async def test_start_is_single_task_and_stop_cancels_database_read(self):
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def blocked_read():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        self.fetch.side_effect = blocked_read
        self.stream.start()
        self.stream.start()
        await asyncio.wait_for(entered.wait(), timeout=1)
        await self.stream.stop()
        self.assertTrue(cancelled.is_set())
        self.fetch.assert_awaited_once()


class StreamEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_sse_wire_format_headers_and_filter_validation(self):
        async def finite_events(**filters):
            self.assertEqual(filters, {"tag_name": ["tag-1"], "tag_ids": [1, 2]})
            yield ServerSentEvent(event="snapshot", data=LatestTelemetryResponse(readings=[reading(10)]))
            yield ServerSentEvent(event="update", data=LatestTelemetryResponse(readings=[reading(11)]))

        app = FastAPI()
        service = MagicMock(events=finite_events)
        app.state.telemetry_stream = service
        app.include_router(router.router, prefix="/api")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/telemetry/stream?tag_name=tag-1&tag_ids=1&tag_ids=2")
            self.assertEqual(response.status_code, 200)
            self.assertIn("text/event-stream", response.headers["content-type"])
            self.assertEqual(response.headers["cache-control"], "no-cache")
            events = response.text.strip().split("\n\n")
            self.assertEqual(len(events), 2)
            self.assertTrue(events[0].startswith("event: snapshot\n"))
            self.assertTrue(events[1].startswith("event: update\n"))
            data = json.loads(events[0].split("data: ", 1)[1])
            self.assertEqual(data, {"readings": [reading(10).model_dump(mode="json")]})
            self.assertEqual((await client.get("/api/telemetry/stream?tag_ids=invalid")).status_code, 422)

    async def test_disconnect_closes_stream_generator(self):
        closed = asyncio.Event()
        disconnect = asyncio.Event()

        async def events(**filters):
            try:
                yield ServerSentEvent(event="snapshot", data={"readings": []})
                await asyncio.Event().wait()
            finally:
                closed.set()

        app = FastAPI()
        app.state.telemetry_stream = MagicMock(events=events)
        app.include_router(router.router, prefix="/api")
        scope = {
            "type": "http", "asgi": {"version": "3.0", "spec_version": "2.0"},
            "http_version": "1.1", "method": "GET", "scheme": "http",
            "path": "/api/telemetry/stream", "raw_path": b"/api/telemetry/stream",
            "query_string": b"", "root_path": "", "headers": [],
            "server": ("test", 80), "client": ("test", 1234),
        }

        async def receive():
            await disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.body" and b"event: snapshot" in message.get("body", b""):
                disconnect.set()

        await asyncio.wait_for(app(scope, receive, send), timeout=1)
        self.assertTrue(closed.is_set())

    async def test_lifespan_stops_stream_before_closing_database(self):
        order = []
        service = MagicMock()
        service.stop = AsyncMock(side_effect=lambda: order.append("stream"))
        with (
            patch.object(main, "connect_db", new_callable=AsyncMock),
            patch.object(main, "disconnect_db", new=AsyncMock(side_effect=lambda: order.append("database"))),
            patch.object(main, "TelemetryStream", return_value=service),
        ):
            async with main.lifespan(main.app):
                service.start.assert_called_once()
                self.assertIs(main.app.state.telemetry_stream, service)
        self.assertEqual(order, ["stream", "database"])


if __name__ == "__main__":
    unittest.main()

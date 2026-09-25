import json
import os
import unittest
from base64 import urlsafe_b64encode
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI

# Import the router without requiring local credentials or opening a database.
with patch.dict(os.environ, {
    "POSTGRES_HOST": "localhost",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "test",
    "POSTGRES_USER": "test",
    "POSTGRES_PASSWORD": "test",
    "TIMEZONE": "Asia/Taipei",
}):
    from backend.routers import telemetry


START = "2026-09-25T00:00:00Z"
END = "2026-09-26T00:00:00Z"
OBSERVED = datetime(2026, 9, 25, 10, tzinfo=UTC)


def reading(reading_id):
    return (reading_id, 1, "temperature", OBSERVED, OBSERVED, 24.6, 192)


def encode_cursor(payload):
    return urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")


class TelemetryHistoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db_cursor = AsyncMock()
        self.db_cursor.fetchall.return_value = []
        conn = MagicMock()
        conn.cursor.return_value.__aenter__.return_value = self.db_cursor
        pool = MagicMock()
        pool.connection.return_value.__aenter__.return_value = conn
        self.pool_patch = patch.object(telemetry, "pool", pool)
        self.pool_patch.start()
        self.addCleanup(self.pool_patch.stop)
        app = FastAPI()
        app.include_router(telemetry.router, prefix="/api")
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def get_history(self, **params):
        return await self.client.get(
            "/api/telemetry/history", params={"start": START, "end": END, **params}
        )

    async def test_empty_history(self):
        response = await self.get_history()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"readings": [], "next_cursor": None})

    async def test_local_dates_use_taipei_without_requiring_an_offset(self):
        response = await self.get_history(
            start="2026-09-25T00:00:00", end="2026-09-26T00:00:00"
        )
        self.assertEqual(response.status_code, 200)
        _, params = self.db_cursor.execute.call_args.args
        self.assertEqual(params[:2], [
            datetime(2026, 9, 24, 16, tzinfo=UTC),
            datetime(2026, 9, 25, 16, tzinfo=UTC),
        ])
        self.assertEqual(params[0].tzinfo, ZoneInfo("Asia/Taipei"))
        self.assertEqual(params[1].tzinfo, ZoneInfo("Asia/Taipei"))

    async def test_local_dates_work_with_pagination(self):
        self.db_cursor.fetchall.return_value = [reading(10), reading(11)]
        params = {"start": "2026-09-25T00:00:00", "end": "2026-09-26T00:00:00", "limit": 1}
        response = await self.get_history(**params)
        self.assertEqual(response.status_code, 200)
        cursor = response.json()["next_cursor"]
        self.assertIsNotNone(cursor)
        self.db_cursor.fetchall.return_value = [reading(11)]
        response = await self.get_history(**params, cursor=cursor)
        self.assertEqual(response.status_code, 200)
        _, bound = self.db_cursor.execute.call_args.args
        self.assertEqual(bound[-3:], [OBSERVED, 10, 2])
        self.assertEqual(response.json()["readings"][0]["id"], 11)
        self.assertIsNone(response.json()["next_cursor"])

    async def test_filters_time_bounds_and_limit(self):
        cases = [
            ({}, []),
            ({"tag_name": ["temperature", "humidity"]}, [["temperature", "humidity"]]),
            ({"tag_ids": [1, 2]}, [[1, 2]]),
            ({"tag_name": ["temperature"], "tag_ids": [1]}, [["temperature"], [1]]),
        ]
        for filters, expected_filters in cases:
            with self.subTest(filters=filters):
                response = await self.get_history(
                    start="2026-09-25T08:00:00+08:00", limit=10, **filters
                )
                self.assertEqual(response.status_code, 200)
                query, params = self.db_cursor.execute.call_args.args
                self.assertIn("tr.observed_at >= %s AND tr.observed_at < %s", query)
                self.assertEqual("t.tag_key = ANY(%s)" in query, "tag_name" in filters)
                self.assertEqual("t.id = ANY(%s)" in query, "tag_ids" in filters)
                self.assertTrue(query.endswith("ORDER BY tr.observed_at ASC, tr.id ASC LIMIT %s"))
                self.assertEqual(params, [
                    datetime(2026, 9, 25, tzinfo=UTC),
                    datetime(2026, 9, 26, tzinfo=UTC),
                    *expected_filters, 11,
                ])

    async def test_pagination_uses_last_returned_reading_with_timestamp_ties(self):
        self.db_cursor.fetchall.return_value = [reading(10), reading(11), reading(12)]
        response = await self.get_history(limit=2)
        self.assertEqual(response.status_code, 200)
        page = response.json()
        self.assertEqual([r["id"] for r in page["readings"]], [10, 11])
        self.assertEqual(page["readings"][0], {
            "id": 10, "tag_id": 1, "tag_key": "temperature",
            "observed_at": "2026-09-25T10:00:00Z",
            "ingested_at": "2026-09-25T10:00:00Z", "value": 24.6, "quality": 192,
        })
        self.assertIsInstance(page["next_cursor"], str)

        self.db_cursor.fetchall.return_value = [reading(12)]
        response = await self.get_history(limit=2, cursor=page["next_cursor"])
        self.assertEqual(response.status_code, 200)
        query, params = self.db_cursor.execute.call_args.args
        self.assertIn("(tr.observed_at, tr.id) > (%s, %s)", query)
        self.assertEqual(params[-3:], [OBSERVED, 11, 3])
        self.assertEqual([r["id"] for r in response.json()["readings"]], [12])
        self.assertIsNone(response.json()["next_cursor"])

    async def test_exact_page_size_has_no_next_cursor(self):
        self.db_cursor.fetchall.return_value = [reading(10), reading(11)]
        response = await self.get_history(limit=2)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["next_cursor"])

    async def test_invalid_query_parameters_do_not_query_database(self):
        for params in [
            {"start": "invalid"}, {"limit": 0}, {"limit": 1001},
            {"tag_ids": "invalid"}, {"cursor": ""}, {"cursor": "x" * 1025},
        ]:
            with self.subTest(params=params):
                self.assertEqual((await self.get_history(**params)).status_code, 422)
        self.assertEqual((await self.client.get("/api/telemetry/history")).status_code, 422)
        self.db_cursor.execute.assert_not_called()

    async def test_reversed_or_equal_range(self):
        for start in [END, "2026-09-27T00:00:00Z"]:
            self.assertEqual((await self.get_history(start=start)).status_code, 400)
        self.db_cursor.execute.assert_not_called()

    async def test_invalid_cursors_do_not_query_database(self):
        cursors = ["%%%", "a", "非ASCII", encode_cursor({}), encode_cursor([])]
        for payload in [
            {"observed_at": "invalid", "id": 1},
            {"observed_at": START, "id": "1"},
            {"observed_at": START, "id": True},
            {"observed_at": START, "id": 2 ** 63},
            {"observed_at": END, "id": 1},
            {"observed_at": "2026-09-24T00:00:00Z", "id": 1},
        ]:
            cursors.append(encode_cursor(payload))
        for cursor in cursors:
            with self.subTest(cursor=cursor):
                self.assertEqual((await self.get_history(cursor=cursor)).status_code, 400)
        self.db_cursor.execute.assert_not_called()

    async def test_database_errors_are_not_empty_results(self):
        self.db_cursor.execute.side_effect = RuntimeError("Database unavailable")
        with self.assertRaisesRegex(RuntimeError, "Database unavailable"):
            await self.get_history()


if __name__ == "__main__":
    unittest.main()

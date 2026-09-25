"""Share one PostgreSQL polling loop across live telemetry connections."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import suppress

from fastapi.sse import ServerSentEvent
from psycopg import OperationalError
from psycopg_pool import PoolTimeout

from backend.telemetry import LatestTelemetryResponse, TelemetryValue, fetch_latest_telemetry

logger = logging.getLogger(__name__)


class TelemetryStream:
    def __init__(self, poll_interval: float = 5) -> None:
        self._poll_interval = poll_interval
        self._condition = asyncio.Condition()
        self._readings: dict[int, TelemetryValue] | None = None
        self._version = 0
        self._unavailable = False
        self._closed = False
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="telemetry-stream")

    async def stop(self) -> None:
        try:
            if self._task is not None:
                self._task.cancel()
                with suppress(asyncio.CancelledError):
                    await self._task
        finally:
            async with self._condition:
                self._closed = True
                self._condition.notify_all()

    async def _run(self) -> None:
        try:
            while True:
                await self.refresh()
                await asyncio.sleep(self._poll_interval)
        finally:
            async with self._condition:
                self._closed = True
                self._condition.notify_all()

    async def refresh(self) -> None:
        try:
            snapshot = await fetch_latest_telemetry()
        except (OperationalError, PoolTimeout) as exc:
            async with self._condition:
                if not self._unavailable:
                    logger.warning("Live telemetry temporarily unavailable (%s)", type(exc).__name__)
                    self._unavailable = True
                    self._version += 1
                    self._condition.notify_all()
            return

        current = {reading.tag_id: reading for reading in snapshot.readings}
        async with self._condition:
            if current != self._readings or self._unavailable:
                # Replace the map rather than mutating snapshots held by clients.
                self._readings = current
                self._unavailable = False
                self._version += 1
                self._condition.notify_all()

    async def events(
        self,
        tag_name: list[str] | None = None,
        tag_ids: list[int] | None = None,
    ) -> AsyncIterator[ServerSentEvent]:
        names = set(tag_name) if tag_name is not None else None
        ids = set(tag_ids) if tag_ids is not None else None
        version = -1
        previous: dict[int, TelemetryValue] | None = None

        while True:
            async with self._condition:
                await self._condition.wait_for(lambda: self._closed or version != self._version)
                if self._closed:
                    return
                version = self._version
                readings = self._readings
                unavailable = self._unavailable

            if unavailable:
                previous = None  # Recovery must replace the client's stale state.
                yield ServerSentEvent(event="status", data={"status": "unavailable"})
                continue
            if readings is None:
                continue  # Wait for the first database read, including an empty result.

            current = {
                tag_id: reading for tag_id, reading in readings.items()
                if (names is None or reading.tag_key in names)
                and (ids is None or tag_id in ids)
            }
            if previous is None or previous.keys() - current.keys():
                event = ServerSentEvent(
                    event="snapshot", data=LatestTelemetryResponse(readings=list(current.values())),
                )
            else:
                changed = [
                    reading for tag_id, reading in current.items()
                    if previous.get(tag_id) != reading
                ]
                if not changed:
                    continue
                event = ServerSentEvent(event="update", data=LatestTelemetryResponse(readings=changed))

            # Each client compares against its own last event. A slow client skips
            # intermediate states without losing changes to independently updated tags.
            previous = current
            yield event

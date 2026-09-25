from base64 import b64decode, urlsafe_b64encode
from collections.abc import AsyncIterator
from contextlib import aclosing
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field

from backend.config import settings
from backend.database import pool
from backend.telemetry import LatestTelemetryResponse, TelemetryValue, fetch_latest_telemetry
from backend.telemetry_stream import TelemetryStream

router = APIRouter(
    prefix="/telemetry",
    tags=["telemetry"],
)

class TelemetryTagResponse(BaseModel):
    id: int
    tag_key: str
    name: str
    unit: str | None

class HistoricalTelemetryResponse(BaseModel):
    readings: list[TelemetryValue]
    next_cursor: str | None = None


class _HistoryCursor(BaseModel):
    observed_at: datetime
    id: Annotated[int, Field(strict=True, ge=0, le=9223372036854775807)]


def _as_local_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=settings.timezone_info)
    return value.astimezone(settings.timezone_info)


def _decode_history_cursor(cursor: str) -> _HistoryCursor:
    try:
        payload = b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        return _HistoryCursor.model_validate_json(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid history cursor",
        ) from exc

@router.get("/tags", response_model=list[TelemetryTagResponse])
async def get_telemetry_tag_metadata(
        tag_name: Annotated[list[str] | None, Query(description="Filter tags by tag key")] = None
) -> list[TelemetryTagResponse]:
    """Get telemetry tags metadata."""
    query = """
        SELECT t.tag_key, t.name, t.unit, t.id
        FROM tags t
    """

    params: list[list[str]] = []

    if tag_name is not None:
        query += " WHERE t.tag_key = ANY(%s)"
        params.append(tag_name)

    query += " ORDER BY id"

    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, params)
            rows = await cursor.fetchall()

    return [
        TelemetryTagResponse(
            id=row[3],
            tag_key=row[0],
            name=row[1],
            unit=row[2]
        )
        for row in rows
    ]


@router.get("/tags/{tag_key}", response_model=TelemetryTagResponse)
async def get_telemetry_tag_metadata_by_key(tag_key: str) -> TelemetryTagResponse:
    """Get metadata for a single telemetry tag."""
    query = """
        SELECT t.tag_key, t.name, t.unit, t.id
        FROM tags t
        WHERE t.tag_key = %s
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, (tag_key,))
            row = await cursor.fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Telemetry tag not found")

    return TelemetryTagResponse(
        id=row[3],
        tag_key=row[0],
        name=row[1],
        unit=row[2],
    )

@router.get("/latest", response_model=LatestTelemetryResponse)
async def get_latest_telemetry_tags(
        tag_name: Annotated[list[str] | None, Query(description="Filter tags by tag key")] = None,
        tag_ids: Annotated[list[int] | None, Query(description="Filter tags by id")] = None
) -> LatestTelemetryResponse:
    """Get the latest observation per tag, matching both filters when supplied."""
    return await fetch_latest_telemetry(tag_name=tag_name, tag_ids=tag_ids)


@router.get("/stream", response_class=EventSourceResponse)
async def stream_telemetry(
        request: Request,
        tag_name: Annotated[list[str] | None, Query(description="Filter tags by tag key")] = None,
        tag_ids: Annotated[list[int] | None, Query(description="Filter tags by id")] = None,
) -> AsyncIterator[ServerSentEvent]:
    """Stream an initial snapshot and changes to the latest reading of each tag.

    Both filters must match when supplied. Reconnection starts a new snapshot;
    intermediate measurements are available through history, not replayed here.
    """
    stream: TelemetryStream = request.app.state.telemetry_stream
    async with aclosing(stream.events(tag_name=tag_name, tag_ids=tag_ids)) as events:
        async for event in events:
            yield event


@router.get("/history", response_model=HistoricalTelemetryResponse)
async def get_telemetry_history(
        start: Annotated[datetime, Query(description=f"Inclusive observation time; defaults to {settings.timezone}")],
        end: Annotated[datetime, Query(description=f"Exclusive observation time; defaults to {settings.timezone}")],
        tag_name: Annotated[list[str] | None, Query(description="Filter tags by tag key")] = None,
        tag_ids: Annotated[list[int] | None, Query(description="Filter tags by id")] = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        cursor: Annotated[str | None, Query(min_length=1, max_length=1024)] = None,
) -> HistoricalTelemetryResponse:
    """Read observations oldest first, matching both tag filters when supplied.

    Timestamps without an offset use the configured local timezone.
    Pass the next_cursor with the same time range and tag filters to continue.
    Pages reflect current data; late inserts before the cursor require a new query.
    """
    start = _as_local_time(start)
    end = _as_local_time(end)
    if start >= end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start datetime must be before end datetime",
        )

    conditions = ["tr.observed_at >= %s", "tr.observed_at < %s"]
    params: list[datetime | int | list[str] | list[int]] = [start, end]

    if tag_name is not None:
        conditions.append("t.tag_key = ANY(%s)")
        params.append(tag_name)

    if tag_ids is not None:
        conditions.append("t.id = ANY(%s)")
        params.append(tag_ids)

    if cursor is not None:
        position = _decode_history_cursor(cursor)
        observed_at = _as_local_time(position.observed_at)
        if not start <= observed_at < end:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="History cursor is outside the requested time range",
            )
        conditions.append("(tr.observed_at, tr.id) > (%s, %s)")
        params.extend([observed_at, position.id])

    query = """
        SELECT
            tr.id,
            t.id AS tag_id,
            t.tag_key,
            tr.observed_at,
            tr.ingested_at,
            tr.value,
            tr.quality
        FROM telemetry_readings AS tr
        JOIN tags AS t ON t.id = tr.tag_id
        WHERE
    """ + " AND ".join(conditions)
    query += " ORDER BY tr.observed_at ASC, tr.id ASC LIMIT %s"
    # Fetch one extra row to determine whether another page exists.
    params.append(limit + 1)

    async with pool.connection() as conn:
        async with conn.cursor() as db_cursor:
            await db_cursor.execute(query, params)
            rows = await db_cursor.fetchall()

    readings = [
        TelemetryValue(
            id=row[0],
            tag_id=row[1],
            tag_key=row[2],
            observed_at=row[3],
            ingested_at=row[4],
            value=row[5],
            quality=row[6],
        )
        for row in rows[:limit]
    ]
    next_cursor = None
    if len(rows) > limit:
        last = readings[-1]
        position = _HistoryCursor(observed_at=last.observed_at, id=last.id)
        next_cursor = urlsafe_b64encode(position.model_dump_json().encode()).decode().rstrip("=")

    return HistoricalTelemetryResponse(readings=readings, next_cursor=next_cursor)

from collections.abc import AsyncIterator
from contextlib import aclosing
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

from backend.config import settings
from backend.database import pool
from backend.telemetry import LatestTelemetryResponse, fetch_latest_telemetry
from backend.telemetry_stream import TelemetryStream
from backend.telemetry_history import Aggregation, HistoryResponse, read_history

router = APIRouter(
    prefix="/telemetry",
    tags=["telemetry"],
)

class TelemetryTagResponse(BaseModel):
    id: int
    tag_key: str
    name: str
    unit: str | None

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


@router.get("/history", response_model=HistoryResponse)
async def get_telemetry_history(
        start: Annotated[datetime, Query(description=f"Inclusive observation time; defaults to {settings.timezone}")],
        end: Annotated[datetime, Query(description=f"Exclusive observation time; defaults to {settings.timezone}")],
        tag_name: Annotated[list[str] | None, Query(description="Filter tags by tag key")] = None,
        tag_ids: Annotated[list[int] | None, Query(description="Filter tags by id")] = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        cursor: Annotated[str | None, Query(min_length=1, max_length=1024)] = None,
        aggregation: Annotated[Aggregation, Query(description="Raw observations or Taipei calendar buckets")] = "raw",
) -> HistoryResponse:
    """Read observations or complete buckets oldest first.

    Reuse the cursor only with the same range, tag filters, and aggregation.
    Late inserts can change previous results; refresh starts a new query.
    """
    return await read_history(pool, start, end, tag_name, tag_ids, limit, cursor, aggregation)

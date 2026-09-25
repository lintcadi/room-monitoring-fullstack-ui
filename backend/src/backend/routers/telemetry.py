import asyncio
from collections.abc import AsyncIterable
from datetime import datetime, UTC
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.sse import EventSourceResponse
from pydantic import BaseModel

from backend.database import pool

router = APIRouter(
    prefix="/telemetry",
    tags=["telemetry"],
)

class TelemetryTagResponse(BaseModel):
    id: int
    tag_key: str
    name: str
    unit: str | None

class TelemetryValue(BaseModel):
    id: int
    tag_id: int
    tag_key: str
    value: float
    quality: int
    observed_at: datetime
    ingested_at: datetime

class LatestTelemetryResponse(BaseModel):
    readings: list[TelemetryValue]

class HistoricalTelemetryResponse(BaseModel):
    observed_at: datetime
    tag_key: str
    name: str
    unit: str | None
    value: float
    quality: int

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
    conditions: list[str] = []
    params: list[list[str] | list[int]] = []

    if tag_name is not None:
        conditions.append("t.tag_key = ANY(%s)")
        params.append(tag_name)

    if tag_ids is not None:
        conditions.append("t.id = ANY(%s)")
        params.append(tag_ids)

    query = """
        SELECT DISTINCT ON (t.id)
            tr.id,
            t.id AS tag_id,
            t.tag_key,
            tr.observed_at,
            tr.ingested_at,
            tr.value,
            tr.quality
        FROM telemetry_readings AS tr
        JOIN tags AS t ON t.id = tr.tag_id
    """

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += """
        ORDER BY t.id, tr.observed_at DESC, tr.ingested_at DESC, tr.id DESC
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, params)
            rows = await cursor.fetchall()

    return LatestTelemetryResponse(
        readings=[
            TelemetryValue(
                id=row[0],
                tag_id=row[1],
                tag_key=row[2],
                observed_at=row[3],
                ingested_at=row[4],
                value=row[5],
                quality=row[6],
            )
            for row in rows
        ]
    )

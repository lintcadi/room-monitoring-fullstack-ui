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
    tag_key: str
    name: str
    unit: str | None

class TelemetryValue(BaseModel):
    tag_key: str
    name: str
    unit: str | None
    value: float
    quality: int
    observed_at: datetime

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
        filter_tag: Annotated[list[str] | None, Query(description="Filter tags by name")] = None
) -> list[TelemetryTagResponse]:
    """Get telemetry tags metadata."""
    query = """
        SELECT t.tag_key, t.name, t.unit
        FROM tags t
    """

    params: list[list[str]] = []

    if filter_tag is not None:
        query += " WHERE t.tag_key = ANY(%s)"
        params.append(filter_tag)

    query += " ORDER BY id"

    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, params)
            rows = await cursor.fetchall()

    if rows is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Telemetry tag not found")

    return [
        TelemetryTagResponse(
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
        SELECT t.tag_key, t.name, t.unit
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
        tag_key=row[0],
        name=row[1],
        unit=row[2],
    )

from datetime import datetime, UTC
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.database import pool

router = APIRouter(
    prefix="/telemetry",
    tags=["telemetry"],
)

class TelemetryValue(BaseModel):
    tag_key: str
    name: str
    unit: str | None
    value: float
    quality: int

class LatestTelemetryResponse(BaseModel):
    observed_at: datetime
    readings: list[TelemetryValue]

class HistoricalTelemetryResponse(BaseModel):
    observed_at: datetime
    tag_key: str
    name: str
    unit: str | None
    value: float
    quality: int

@router.get("/latest", response_model=LatestTelemetryResponse)
async def get_latest_telemetry() -> LatestTelemetryResponse:
    query = """
    SELECT
        t.tag_key,
        t.name,
        t.unit,
        tr.value,
        tr.quality,
        tr.observed_at
    FROM telemetry_readings AS tr
    JOIN tags as t 
        ON t.id = tr.tag_id
    WHERE tr.observed_at = (
        SELECT MAX(observed_at)/*Get the latest telemetry reading*/
        FROM telemetry_readings
    )
    ORDER BY t.id
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query)
            rows = await cursor.fetchall()

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No telemetry readings available",
        )

    observed_at = rows[0][5]

    readings = [
        TelemetryValue(
            tag_key=row[0],
            name=row[1],
            unit=row[2],
            value=row[3],
            quality=row[4],
        )
        for row in rows
    ]

    return LatestTelemetryResponse(
        observed_at=observed_at,
        readings=readings
    )

@router.get("/history", response_model=list[HistoricalTelemetryResponse])
async def get_telemetry_history(
        start: datetime,
        end: datetime,
        tags: Annotated[list[str] | None, Query()] = None
) -> list[HistoricalTelemetryResponse]:
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(
            status_code=400,
            detail="Both start and end datetimes are null",
        )

    start = start.astimezone(UTC)
    end = end.astimezone(UTC)

    if start > end:
        raise HTTPException(
            status_code=400,
            detail="Start datetime must be less than end datetime",
        )

    query = """
        SELECT
            tr.observed_at,
            t.tag_key,
            t.name,
            t.unit,
            tr.value,
            tr.quality
        FROM telemetry_readings AS tr
        JOIN tags as t 
            ON t.id = tr.tag_id
        WHERE tr.observed_at >= %s
            AND tr.observed_at <= %s
    """

    params: list[datetime | list[str]] = [start, end]

    if tags:
        query += """
            AND t.tag_key = ANY(%s)
        """
        params.append(tags) # no

    query += """
        ORDER BY tr.observed_at, t.id
    """

    async with pool.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, params)
            rows = await cursor.fetchall()

    return [
        HistoricalTelemetryResponse(
            observed_at=row[0],
            tag_key=row[1],
            name=row[2],
            unit=row[3],
            value=row[4],
            quality=row[5],
        )
        for row in rows
    ]
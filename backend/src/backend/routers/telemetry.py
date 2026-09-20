from datetime import datetime

from fastapi import APIRouter, HTTPException
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
"""Telemetry reading models and reusable PostgreSQL queries."""

from datetime import datetime

from pydantic import BaseModel

from backend.database import pool


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


async def fetch_latest_telemetry(
    tag_name: list[str] | None = None,
    tag_ids: list[int] | None = None,
) -> LatestTelemetryResponse:
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

    return LatestTelemetryResponse(readings=[
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
    ])

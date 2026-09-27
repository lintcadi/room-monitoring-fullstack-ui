"""Read tag metadata from PostgreSQL."""

from backend.database import pool
from backend.telemetry.schemas import TelemetryTagResponse


async def fetch_tags(tag_name: list[str] | None = None) -> list[TelemetryTagResponse]:
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
            unit=row[2],
        )
        for row in rows
    ]


async def fetch_tag(tag_key: str) -> TelemetryTagResponse | None:
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
        return None

    return TelemetryTagResponse(
        id=row[3],
        tag_key=row[0],
        name=row[1],
        unit=row[2],
    )

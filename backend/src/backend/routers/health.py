from fastapi import APIRouter, HTTPException, status
from psycopg import OperationalError
from pydantic import BaseModel
from redis.exceptions import RedisError

from backend.cache import redis_client
from backend.database import pool
router = APIRouter()

class HealthResponse(BaseModel):
    status: str
    database: str
    redis: str

@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    try:
        async with pool.connection() as conn:
            await conn.execute("SELECT 1;")
    except OperationalError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    try:
        await redis_client.ping()
    except RedisError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis is unavailable",
        ) from exc

    return HealthResponse(
        status="ok",
        database="connected",
        redis="connected",
    )

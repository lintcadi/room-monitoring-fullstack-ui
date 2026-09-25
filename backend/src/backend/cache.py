import logging

from redis.asyncio import Redis
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff
from redis.exceptions import RedisError

from backend.config import settings

logger = logging.getLogger(__name__)

redis_client = Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_connect_timeout=2,
    socket_timeout=2,
    # Keep failed cache checks short; subsequent requests can reconnect.
    retry=Retry(NoBackoff(), 0),
)


async def connect_redis() -> None:
    try:
        await redis_client.ping()
    except RedisError:
        logger.warning("Redis is unavailable; PostgreSQL endpoints remain available")


async def disconnect_redis() -> None:
    await redis_client.aclose()

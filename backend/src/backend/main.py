from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI

from backend.config import settings
from backend.cache import connect_redis, disconnect_redis
from backend.routers import health, telemetry
from backend.database import connect_db, disconnect_db

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    async with AsyncExitStack() as stack:
        stack.push_async_callback(disconnect_db)
        await connect_db()
        stack.push_async_callback(disconnect_redis)
        await connect_redis()
        yield

app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
)

app.include_router(
    health.router,
    prefix="/api",
)
app.include_router(
    telemetry.router,
    prefix="/api"
)

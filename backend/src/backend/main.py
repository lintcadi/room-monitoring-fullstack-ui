from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.config import settings
from backend.routers import health
from backend.database import connect_db, disconnect_db

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await connect_db()
    yield
    await disconnect_db()

app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
)

app.include_router(
    health.router,
    prefix="/api",
)
from psycopg_pool import AsyncConnectionPool

from backend.config import settings

pool = AsyncConnectionPool(
    conninfo="",
    kwargs={
        "host": settings.postgres_host,
        "port": settings.postgres_port,
        "dbname": settings.postgres_db,
        "user": settings.postgres_user,
        "password": settings.postgres_password,
    },
    min_size=1,
    max_size=10,
    open=False,
)

async def connect_db():
    await pool.open(wait=True)

async def disconnect_db():
    await pool.close()
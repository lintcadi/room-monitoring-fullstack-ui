import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import FastAPI
from psycopg import OperationalError

with patch.dict(os.environ, {
    "POSTGRES_HOST": "postgres.test",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "test",
    "POSTGRES_USER": "test",
    "POSTGRES_PASSWORD": "test",
}):
    from backend import main
    from backend.routers import health


class AppTests(unittest.IsolatedAsyncioTestCase):
    async def test_lifespan_connects_and_closes_database(self):
        with (
            patch.object(main, "connect_db", new_callable=AsyncMock) as connect,
            patch.object(main, "disconnect_db", new_callable=AsyncMock) as close,
        ):
            async with main.lifespan(main.app):
                connect.assert_awaited_once()
                close.assert_not_awaited()
            close.assert_awaited_once()

    async def test_lifespan_closes_pool_on_application_error(self):
        with (
            patch.object(main, "connect_db", new_callable=AsyncMock),
            patch.object(main, "disconnect_db", new_callable=AsyncMock) as close,
        ):
            with self.assertRaisesRegex(RuntimeError, "Application error"):
                async with main.lifespan(main.app):
                    raise RuntimeError("Application error")
            close.assert_awaited_once()

    async def test_lifespan_closes_pool_when_database_startup_fails(self):
        with (
            patch.object(main, "connect_db", side_effect=OperationalError("Database unavailable")),
            patch.object(main, "disconnect_db", new_callable=AsyncMock) as close,
        ):
            with self.assertRaises(OperationalError):
                async with main.lifespan(main.app):
                    self.fail("Startup should fail")
            close.assert_awaited_once()

    async def test_health_checks_database_and_recovers_after_outage(self):
        conn = AsyncMock()
        conn.execute.side_effect = [None, OperationalError("Database unavailable"), None]
        pool = MagicMock()
        pool.connection.return_value.__aenter__.return_value = conn
        app = FastAPI()
        app.include_router(health.router, prefix="/api")
        with patch.object(health, "pool", pool):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                for status_code in [200, 503, 200]:
                    response = await client.get("/api/health")
                    self.assertEqual(response.status_code, status_code)
                    if status_code == 200:
                        self.assertEqual(response.json(), {"status": "ok", "database": "connected"})
        self.assertEqual(conn.execute.await_count, 3)


if __name__ == "__main__":
    unittest.main()

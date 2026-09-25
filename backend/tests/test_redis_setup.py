import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import FastAPI
from redis.exceptions import ConnectionError

with patch.dict(os.environ, {
    "POSTGRES_HOST": "postgres.test",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "test",
    "POSTGRES_USER": "test",
    "POSTGRES_PASSWORD": "test",
    "REDIS_URL": "redis://redis:6379/0",
}):
    from backend import cache, main
    from backend.routers import health


class RedisSetupTests(unittest.IsolatedAsyncioTestCase):
    async def test_lifespan_keeps_api_available_when_redis_is_down(self):
        client = AsyncMock()
        client.ping.side_effect = ConnectionError("Redis is down")
        with (
            patch.object(cache, "redis_client", client),
            patch.object(main, "connect_db", new_callable=AsyncMock),
            patch.object(main, "disconnect_db", new_callable=AsyncMock) as close_db,
            self.assertLogs("backend.cache", level="WARNING") as logs,
        ):
            async with main.lifespan(main.app):
                client.ping.assert_awaited_once()
                client.aclose.assert_not_awaited()
                close_db.assert_not_awaited()
            client.aclose.assert_awaited_once()
            close_db.assert_awaited_once()
        self.assertIn("Redis is unavailable", logs.output[0])

    async def test_lifespan_closes_connections_on_application_error(self):
        client = AsyncMock()
        with (
            patch.object(cache, "redis_client", client),
            patch.object(main, "connect_db", new_callable=AsyncMock),
            patch.object(main, "disconnect_db", new_callable=AsyncMock) as close_db,
        ):
            with self.assertRaisesRegex(RuntimeError, "Application error"):
                async with main.lifespan(main.app):
                    raise RuntimeError("Application error")
            client.aclose.assert_awaited_once()
            close_db.assert_awaited_once()

    async def test_lifespan_closes_connections_on_redis_startup_error(self):
        with (
            patch.object(main, "connect_db", new_callable=AsyncMock),
            patch.object(main, "disconnect_db", new_callable=AsyncMock) as close_db,
            patch.object(main, "connect_redis", side_effect=RuntimeError("Invalid Redis configuration")),
            patch.object(main, "disconnect_redis", new_callable=AsyncMock) as close_redis,
        ):
            with self.assertRaisesRegex(RuntimeError, "Invalid Redis configuration"):
                async with main.lifespan(main.app):
                    self.fail("Startup should fail")
            close_redis.assert_awaited_once()
            close_db.assert_awaited_once()

    async def test_lifespan_closes_pool_when_database_startup_fails(self):
        with (
            patch.object(main, "connect_db", side_effect=RuntimeError("Database unavailable")),
            patch.object(main, "disconnect_db", new_callable=AsyncMock) as close_db,
            patch.object(main, "connect_redis", new_callable=AsyncMock) as connect_redis,
        ):
            with self.assertRaisesRegex(RuntimeError, "Database unavailable"):
                async with main.lifespan(main.app):
                    self.fail("Startup should fail")
            close_db.assert_awaited_once()
            connect_redis.assert_not_awaited()

    async def test_health_checks_redis_and_recovers_after_outage(self):
        redis_client = AsyncMock()
        redis_client.ping.side_effect = [True, ConnectionError("private server address"), True]
        pool = MagicMock()
        pool.connection.return_value.__aenter__.return_value = AsyncMock()
        app = FastAPI()
        app.include_router(health.router, prefix="/api")
        with (
            patch.object(health, "pool", pool),
            patch.object(health, "redis_client", redis_client),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                for status_code in [200, 503, 200]:
                    response = await client.get("/api/health")
                    self.assertEqual(response.status_code, status_code)
                    if status_code == 200:
                        self.assertEqual(response.json(), {
                            "status": "ok", "database": "connected", "redis": "connected",
                        })
                    else:
                        self.assertEqual(response.json(), {"detail": "Redis is unavailable"})
        self.assertEqual(redis_client.ping.await_count, 3)


if __name__ == "__main__":
    unittest.main()

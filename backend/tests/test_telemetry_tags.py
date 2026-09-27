"""Tag endpoint contracts through the extracted PostgreSQL query module."""

import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import FastAPI

with patch.dict(os.environ, {
    "POSTGRES_HOST": "postgres.test",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "test",
    "POSTGRES_USER": "test",
    "POSTGRES_PASSWORD": "test",
}):
    from backend.telemetry import router, tags


class TelemetryTagTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cursor = AsyncMock()
        conn = MagicMock()
        conn.cursor.return_value.__aenter__.return_value = self.cursor
        pool = MagicMock()
        pool.connection.return_value.__aenter__.return_value = conn
        replacement = patch.object(tags, "pool", pool)
        replacement.start()
        self.addCleanup(replacement.stop)
        app = FastAPI()
        app.include_router(router.router, prefix="/api")
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test",
        )
        self.addAsyncCleanup(self.client.aclose)

    async def test_list_metadata_and_filter_by_multiple_keys(self):
        self.cursor.fetchall.return_value = [
            ("temperature_c", "Temperature", "°C", 1),
            ("sensor_status", "Sensor status", None, 2),
        ]
        expected = [
            {"id": 1, "tag_key": "temperature_c", "name": "Temperature", "unit": "°C"},
            {"id": 2, "tag_key": "sensor_status", "name": "Sensor status", "unit": None},
        ]
        for filters in [{}, {"tag_name": ["temperature_c", "sensor_status"]}]:
            with self.subTest(filters=filters):
                response = await self.client.get("/api/telemetry/tags", params=filters)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), expected)
                query, params = self.cursor.execute.call_args.args
                self.assertTrue(query.endswith("ORDER BY id"))
                self.assertEqual("WHERE t.tag_key = ANY(%s)" in query, bool(filters))
                self.assertEqual(params, [filters["tag_name"]] if filters else [])

    async def test_empty_list_is_successful(self):
        self.cursor.fetchall.return_value = []
        response = await self.client.get("/api/telemetry/tags?tag_name=missing")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    async def test_single_tag_and_missing_tag(self):
        self.cursor.fetchone.return_value = ("temperature_c", "Temperature", "°C", 1)
        response = await self.client.get("/api/telemetry/tags/temperature_c")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "id": 1, "tag_key": "temperature_c", "name": "Temperature", "unit": "°C",
        })
        query, params = self.cursor.execute.call_args.args
        self.assertIn("WHERE t.tag_key = %s", query)
        self.assertEqual(params, ("temperature_c",))
        self.cursor.fetchone.return_value = None
        response = await self.client.get("/api/telemetry/tags/missing")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Telemetry tag not found"})

    async def test_database_errors_are_not_empty_results(self):
        self.cursor.execute.side_effect = RuntimeError("Database unavailable")
        for path in ["/api/telemetry/tags", "/api/telemetry/tags/temperature_c"]:
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, "Database unavailable"):
                await self.client.get(path)

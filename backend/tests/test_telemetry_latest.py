import os
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI

with patch.dict(os.environ, {
    "POSTGRES_HOST": "postgres.test",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "test",
    "POSTGRES_USER": "test",
    "POSTGRES_PASSWORD": "test",
}):
    from backend import telemetry
    from backend.routers import telemetry as router


class LatestTelemetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_latest_endpoint_preserves_filters_and_reading_response(self):
        observed = datetime(2026, 9, 25, 10, tzinfo=ZoneInfo("Asia/Taipei"))
        reading = telemetry.TelemetryValue(
            id=10, tag_id=1, tag_key="tag-1", value=24.6, quality=192,
            observed_at=observed, ingested_at=observed,
        )
        cursor = AsyncMock()
        cursor.fetchall.return_value = [(10, 1, "tag-1", observed, observed, 24.6, 192)]
        conn = MagicMock()
        conn.cursor.return_value.__aenter__.return_value = cursor
        pool = MagicMock()
        pool.connection.return_value.__aenter__.return_value = conn
        app = FastAPI()
        app.include_router(router.router, prefix="/api")
        with patch.object(telemetry, "pool", pool):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get(
                    "/api/telemetry/latest?tag_name=tag-1&tag_name=tag-2&tag_ids=1&tag_ids=2"
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"readings": [reading.model_dump(mode="json")]})
                query, params = cursor.execute.call_args.args
                self.assertEqual(params, [["tag-1", "tag-2"], [1, 2]])
                self.assertIn("WHERE t.tag_key = ANY(%s) AND t.id = ANY(%s)", query)
                self.assertIn("ORDER BY t.id, tr.observed_at DESC, tr.ingested_at DESC, tr.id DESC", query)
                cursor.fetchall.return_value = []
                response = await client.get("/api/telemetry/latest")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"readings": []})
                query, params = cursor.execute.call_args.args
                self.assertNotIn("WHERE", query)
                self.assertEqual(params, [])


if __name__ == "__main__":
    unittest.main()

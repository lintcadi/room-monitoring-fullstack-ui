"""Opt-in SQL integration tests using connection-local temporary tables only.

HISTORY_TEST_DATABASE=1 runs against backend/.env; tables are dropped on disconnect.
"""
import os
import unittest
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from dotenv import dotenv_values
from psycopg import AsyncConnection

with patch.dict(os.environ, {
    'POSTGRES_HOST': 'postgres.test', 'POSTGRES_PORT': '5432', 'POSTGRES_DB': 'test',
    'POSTGRES_USER': 'test', 'POSTGRES_PASSWORD': 'test', 'TIMEZONE': 'Asia/Taipei',
}):
    from backend.telemetry_history import read_history


@unittest.skipUnless(os.environ.get('HISTORY_TEST_DATABASE') == '1', 'Opt-in PostgreSQL integration')
class HistoryAggregationPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        config = dotenv_values(Path(__file__).parents[1] / '.env')
        self.conn = await AsyncConnection.connect(
            host=config['POSTGRES_HOST'], port=config['POSTGRES_PORT'], dbname=config['POSTGRES_DB'],
            user=config['POSTGRES_USER'], password=config['POSTGRES_PASSWORD'], connect_timeout=5,
        )
        self.addAsyncCleanup(self.conn.close)
        # SET LOCAL in read_history must handle a connection initially using UTC.
        await self.conn.execute("SET TIME ZONE 'UTC'")
        await self.conn.execute('CREATE TEMP TABLE tags (id bigint PRIMARY KEY, tag_key text) ON COMMIT DROP')
        await self.conn.execute('''CREATE TEMP TABLE telemetry_readings (
            id bigint PRIMARY KEY, tag_id bigint, observed_at timestamptz,
            ingested_at timestamptz, value double precision, quality integer
        ) ON COMMIT DROP''')
        await self.conn.execute("INSERT INTO pg_temp.tags VALUES (1, 'temperature_c'), (2, 'sensor_status')")
        self.sequence = 0
        test = self
        class TempPool:
            @asynccontextmanager
            async def connection(self):
                yield test.conn
        self.pool = TempPool()

    async def seed(self, time, value, quality=0, tag=1, ingested=None):
        self.sequence += 1
        await self.conn.execute('INSERT INTO pg_temp.telemetry_readings VALUES (%s,%s,%s,%s,%s,%s)',
            [self.sequence, tag, time, ingested or time, value, quality])

    async def read(self, start='2026-09-25T00:00:00+08:00', end='2026-09-26T00:00:00+08:00', mode='hourly', limit=100, cursor=None, ids=None):
        return await read_history(self.pool, datetime.fromisoformat(start), datetime.fromisoformat(end), None, ids, limit, cursor, mode)

    async def test_quality_partial_buckets_and_status_last(self):
        await self.seed('2026-09-25T08:00:00+08:00', 999)  # outside the requested range
        await self.seed('2026-09-25T08:15:00+08:00', 20)
        await self.seed('2026-09-25T08:30:00+08:00', 30)
        await self.seed('2026-09-25T08:40:00+08:00', 90, 1)
        await self.seed('2026-09-25T08:50:00+08:00', 99, 2)
        await self.seed('2026-09-25T08:55:00+08:00', 88, 99)
        await self.seed('2026-09-25T08:20:00+08:00', 0, tag=2)
        await self.seed('2026-09-25T08:50:00+08:00', 3, 2, tag=2)
        result = await self.read(start='2026-09-25T08:15:00+08:00', end='2026-09-25T09:00:00+08:00')
        numeric, state = result.buckets
        self.assertEqual((numeric.value, numeric.minimum, numeric.maximum), (25, 20, 30))
        self.assertEqual((numeric.sample_count, numeric.good_count, numeric.uncertain_count, numeric.bad_count, numeric.unknown_count), (5, 2, 1, 1, 1))
        self.assertTrue(numeric.partial)
        self.assertEqual(numeric.bucket_start.hour, 8)
        self.assertEqual(numeric.coverage_start.minute, 15)
        self.assertEqual((state.method, state.value, state.last_quality), ('last', 3, 2))
        self.assertIsNone(state.minimum)

    async def test_paging_never_splits_a_bucket_and_handles_timestamp_ties(self):
        async with self.conn.cursor() as cursor:
            await cursor.executemany('INSERT INTO pg_temp.telemetry_readings VALUES (%s,1,%s,%s,%s,0)', [
                (i + 1, '2026-09-25T08:10:00+08:00', '2026-09-25T08:10:00+08:00', i) for i in range(1200)
            ])
        self.sequence = 1200
        await self.seed('2026-09-25T08:10:00+08:00', 1, tag=2)
        await self.seed('2026-09-25T09:10:00+08:00', 42)
        first = await self.read(limit=1)
        self.assertEqual((first.buckets[0].sample_count, first.buckets[0].value), (1200, 599.5))
        second = await self.read(limit=1, cursor=first.next_cursor)
        self.assertEqual(second.buckets[0].tag_id, 2)
        third = await self.read(limit=1, cursor=second.next_cursor)
        self.assertEqual(third.buckets[0].value, 42)
        self.assertIsNone(third.next_cursor)

    async def test_calendar_boundaries_empty_and_unusable_buckets(self):
        await self.seed('2026-09-27T23:59:59+08:00', 20)
        await self.seed('2026-09-28T00:00:00+08:00', 30)
        for mode, expected in [('5min', '2026-09-27T23:55:00+08:00'), ('hourly', '2026-09-27T23:00:00+08:00'), ('daily', '2026-09-27T00:00:00+08:00'), ('weekly', '2026-09-21T00:00:00+08:00'), ('monthly', '2026-09-01T00:00:00+08:00')]:
            result = await self.read(start='2026-09-27T23:00:00+08:00', end='2026-10-01T00:00:00+08:00', mode=mode)
            self.assertEqual(result.buckets[0].bucket_start.isoformat(), expected)
            self.assertEqual(len(result.buckets), 1 if mode == 'monthly' else 2)
        await self.seed('2026-09-25T08:00:00+08:00', 30, 2)
        await self.seed('2026-09-25T10:00:00+08:00', float('nan'))
        result = await self.read()
        self.assertEqual(len(result.buckets), 2)  # No invented bucket at 09:00.
        self.assertTrue(all(b.value is None and b.usable_count == 0 for b in result.buckets))
        self.assertEqual((await self.read(ids=[999])).buckets, [])

    async def test_month_end_and_last_reading_tie_breaks(self):
        await self.seed('2026-12-31T23:59:59+08:00', 20)
        await self.seed('2027-01-01T00:00:00+08:00', 30)
        result = await self.read(start='2026-12-01T00:00:00+08:00', end='2027-02-01T00:00:00+08:00', mode='monthly')
        self.assertEqual([b.value for b in result.buckets], [20, 30])
        self.assertEqual(result.buckets[0].bucket_end, result.buckets[1].bucket_start)
        for value, ingested in [(1, '2026-09-25T08:10:01+08:00'), (2, '2026-09-25T08:10:02+08:00'), (3, '2026-09-25T08:10:02+08:00')]:
            await self.seed('2026-09-25T08:10:00+08:00', value, tag=2, ingested=ingested)
        result = await self.read()
        self.assertEqual(result.buckets[0].value, 3)

    async def test_naive_columns_and_naive_request_dates_use_taipei(self):
        await self.conn.execute("ALTER TABLE pg_temp.telemetry_readings ALTER COLUMN observed_at TYPE timestamp USING observed_at AT TIME ZONE 'Asia/Taipei'")
        await self.seed('2026-09-25T08:15:00', 24)
        result = await self.read(start='2026-09-25T08:00:00', end='2026-09-25T09:00:00')
        self.assertEqual(result.buckets[0].value, 24)
        self.assertEqual(result.buckets[0].bucket_start.isoformat(), '2026-09-25T08:00:00+08:00')

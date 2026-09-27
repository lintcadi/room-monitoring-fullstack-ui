"""Read raw observations or aggregated history from PostgreSQL."""

from datetime import datetime, timedelta

from psycopg_pool import AsyncConnectionPool

from backend.config import settings
from backend.telemetry.errors import InvalidHistoryQuery
from backend.telemetry.pagination import decode_cursor, encode_cursor, query_scope
from backend.telemetry.schemas import (
    Aggregation,
    AggregatedTelemetryResponse,
    BucketAggregation,
    HistoricalTelemetryResponse,
    HistoryBucket,
    TelemetryValue,
)


# Unknown/device-specific tags use the last value rather than averaging codes.
NUMERIC_TAGS = {
    'temperature_c', 'humidity_percent', 'pressure_hpa', 'gas_resistance_ohm',
    'iaq', 'static_iaq', 'co2_equivalent_ppm', 'breath_voc_equivalent_ppm', 'gas_percentage',
}
INTERVALS = {'5min': '5 minutes', 'hourly': '1 hour', 'daily': '1 day', 'weekly': '1 week', 'monthly': '1 month'}
TRUNCATIONS = {'hourly': 'hour', 'daily': 'day', 'weekly': 'week', 'monthly': 'month'}


def local_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=settings.timezone_info)
    return value.astimezone(settings.timezone_info)


def bucket_start(value: datetime, aggregation: BucketAggregation) -> datetime:
    value = local_time(value).replace(second=0, microsecond=0)
    if aggregation == '5min':
        return value.replace(minute=value.minute // 5 * 5)
    value = value.replace(minute=0)
    if aggregation == 'hourly':
        return value
    value = value.replace(hour=0)
    if aggregation == 'weekly':
        return value - timedelta(days=value.weekday())
    if aggregation == 'monthly':
        return value.replace(day=1)
    return value


async def read_history(
    pool: AsyncConnectionPool, start: datetime, end: datetime,
    tag_name: list[str] | None, tag_ids: list[int] | None,
    limit: int, cursor: str | None, aggregation: Aggregation,
) -> HistoricalTelemetryResponse | AggregatedTelemetryResponse:
    start, end = local_time(start), local_time(end)
    if start >= end:
        raise InvalidHistoryQuery('Start datetime must be before end datetime')
    scope = query_scope(start, end, tag_name, tag_ids, aggregation)
    position = decode_cursor(cursor, scope) if cursor else None
    if position:
        time = local_time(position.observed_at)
        lower = start if aggregation == 'raw' else bucket_start(start, aggregation)
        if not lower <= time < end or (aggregation != 'raw' and time != bucket_start(time, aggregation)):
            raise InvalidHistoryQuery('History cursor is outside the requested buckets or time range')

    conditions = ['tr.observed_at >= %s', 'tr.observed_at < %s']
    params: list = [start, end]
    if tag_name is not None:
        conditions.append('t.tag_key = ANY(%s)')
        params.append(tag_name)
    if tag_ids is not None:
        conditions.append('t.id = ANY(%s)')
        params.append(tag_ids)
    where = ' AND '.join(conditions)

    if aggregation == 'raw':
        if position:
            where += ' AND (tr.observed_at, tr.id) > (%s, %s)'
            params.extend([local_time(position.observed_at), position.id])
        query = '''SELECT tr.id, t.id, t.tag_key, tr.observed_at, tr.ingested_at, tr.value, tr.quality
                   FROM telemetry_readings AS tr JOIN tags AS t ON t.id = tr.tag_id WHERE ''' + where
        query += ' ORDER BY tr.observed_at ASC, tr.id ASC LIMIT %s'
        params.append(limit + 1)
    else:
        # A transaction-local timezone makes both existing timestamp columns and
        # timestamptz columns group by Taipei calendar boundaries, without a migration.
        expression = (
            "date_bin('5 minutes', tr.observed_at::timestamp, timestamp '2000-01-03')"
            if aggregation == '5min' else
            f"date_trunc('{TRUNCATIONS[aggregation]}', tr.observed_at::timestamp)"
        )
        after = ''
        if position:
            after = ' WHERE (bucket_start, tag_id) > (%s, %s)'
            params.extend([local_time(position.observed_at).replace(tzinfo=None), position.id])
        params.append(limit + 1)
        # The cursor and limit apply to grouped results, never to source observations.
        query = f'''
            WITH source AS MATERIALIZED (
                SELECT tr.*, t.tag_key, {expression} AS bucket_start,
                    (tr.quality = 0 AND tr.value > '-Infinity'::float8 AND tr.value < 'Infinity'::float8) AS usable
                FROM telemetry_readings AS tr JOIN tags AS t ON t.id = tr.tag_id
                WHERE {where}
            ), grouped AS (
                SELECT bucket_start, tag_id, tag_key,
                    avg(value) FILTER (WHERE usable) AS average,
                    min(value) FILTER (WHERE usable) AS minimum,
                    max(value) FILTER (WHERE usable) AS maximum,
                    count(*) AS sample_count,
                    count(*) FILTER (WHERE quality = 0) AS good_count,
                    count(*) FILTER (WHERE quality = 1) AS uncertain_count,
                    count(*) FILTER (WHERE quality = 2) AS bad_count,
                    count(*) FILTER (WHERE quality NOT IN (0, 1, 2) OR quality IS NULL) AS unknown_count,
                    count(*) FILTER (WHERE usable) AS usable_count
                FROM source GROUP BY bucket_start, tag_id, tag_key
            ), page AS (
                SELECT * FROM grouped{after} ORDER BY bucket_start, tag_id LIMIT %s
            ), last_readings AS (
                SELECT DISTINCT ON (s.bucket_start, s.tag_id)
                    s.bucket_start, s.tag_id,
                    CASE WHEN s.value > '-Infinity'::float8 AND s.value < 'Infinity'::float8 THEN s.value END AS last_value,
                    s.quality AS last_quality, s.observed_at AS last_observed_at
                FROM source s JOIN page p USING (bucket_start, tag_id)
                ORDER BY s.bucket_start, s.tag_id, s.observed_at DESC, s.ingested_at DESC, s.id DESC
            )
            SELECT p.*, l.last_value, l.last_quality, l.last_observed_at,
                p.bucket_start + interval '{INTERVALS[aggregation]}' AS bucket_end
            FROM page p JOIN last_readings l USING (bucket_start, tag_id)
            ORDER BY p.bucket_start, p.tag_id
        '''

    async with pool.connection() as conn:
        async with conn.cursor() as db_cursor:
            await db_cursor.execute("SELECT set_config('TimeZone', %s, true)", [settings.timezone])
            await db_cursor.execute(query, params)
            rows = await db_cursor.fetchall()

    if aggregation == 'raw':
        readings = [TelemetryValue(
            id=r[0], tag_id=r[1], tag_key=r[2], observed_at=r[3], ingested_at=r[4], value=r[5], quality=r[6],
        ) for r in rows[:limit]]
        next_cursor = encode_cursor(local_time(readings[-1].observed_at), readings[-1].id, scope) if len(rows) > limit else None
        return HistoricalTelemetryResponse(readings=readings, next_cursor=next_cursor)

    buckets = []
    for r in rows[:limit]:
        begin, finish = local_time(r[0]), local_time(r[15])
        numeric = r[2] in NUMERIC_TAGS
        buckets.append(HistoryBucket(
            tag_id=r[1], tag_key=r[2], bucket_start=begin, bucket_end=finish,
            coverage_start=max(begin, start), coverage_end=min(finish, end),
            partial=begin < start or finish > end,
            method='average' if numeric else 'last', value=r[3] if numeric else r[12],
            minimum=r[4] if numeric else None, maximum=r[5] if numeric else None,
            sample_count=r[6], good_count=r[7], uncertain_count=r[8], bad_count=r[9], unknown_count=r[10],
            usable_count=r[11], last_observed_at=local_time(r[14]), last_quality=r[13],
        ))
    next_cursor = encode_cursor(buckets[-1].bucket_start, buckets[-1].tag_id, scope) if len(rows) > limit else None
    return AggregatedTelemetryResponse(aggregation=aggregation, buckets=buckets, next_cursor=next_cursor)

import {
  TelemetryReading,
  TelemetryTag,
  localTimestamp,
  parseReadings,
} from '../telemetry/telemetry.models';

export interface HistoryQuery {
  tagIds: number[];
  start: string;
  end: string;
  aggregation?: Aggregation;
}
export interface HistoryPage {
  readings: HistoryRow[];
  next_cursor: string | null;
}
export const AGGREGATIONS = [
  { value: 'raw', label: 'Raw' },
  { value: '5min', label: '5 minutes' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number]['value'];
export interface HistoryBucket {
  tag_id: number;
  tag_key: string;
  bucket_start: string;
  bucket_end: string;
  coverage_start: string;
  coverage_end: string;
  partial: boolean;
  method: 'average' | 'last';
  value: number | null;
  minimum: number | null;
  maximum: number | null;
  sample_count: number;
  good_count: number;
  uncertain_count: number;
  bad_count: number;
  unknown_count: number;
  usable_count: number;
  last_observed_at: string;
  last_quality: number;
}
export type HistoryRow = TelemetryReading | HistoryBucket;
export const isBucket = (row: HistoryRow): row is HistoryBucket => 'bucket_start' in row;
export const rowKey = (row: HistoryRow): string =>
  isBucket(row) ? `${row.bucket_start}:${row.tag_id}` : String(row.id);
export const rowTimestamp = (row: HistoryRow): string =>
  isBucket(row) ? row.coverage_start : row.observed_at;
// For plotting only: averages connect usable samples, with counts shown separately.
export const rowQuality = (row: HistoryRow): number =>
  isBucket(row)
    ? row.method === 'last'
      ? row.last_quality
      : row.value === null
        ? -1
        : 0
    : row.quality;
export const bucketOf = (row: HistoryRow): HistoryBucket | null => (isBucket(row) ? row : null);
export const PAGE_SIZE = 1000;
export const MAX_READINGS = 5000;
export const STATUS_KEYS = [
  'iaq_accuracy',
  'stabilization_complete',
  'run_in_complete',
  'sensor_status',
];

export function recentRange(hours: number, now = Date.now()): { start: string; end: string } {
  return { start: new Date(now - hours * 3600000).toISOString(), end: new Date(now).toISOString() };
}

export function taipeiInput(timestamp: string): string {
  return new Date(Date.parse(localTimestamp(timestamp)) + 8 * 3600000).toISOString().slice(0, 16);
}

export function customRange(start: string, end: string): { start: string; end: string } | null {
  const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!valid.test(start) || !valid.test(end)) return null;
  const startTime = Date.parse(`${start}+08:00`);
  const endTime = Date.parse(`${end}+08:00`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) return null;
  // Reject dates that Date.parse silently normalizes, such as February 30.
  if (taipeiInput(`${start}+08:00`) !== start || taipeiInput(`${end}+08:00`) !== end) return null;
  return { start: `${start}+08:00`, end: `${end}+08:00` };
}

export function parseHistory(payload: unknown, query: HistoryQuery): HistoryPage {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('next_cursor' in payload) ||
    !(
      payload.next_cursor === null ||
      (typeof payload.next_cursor === 'string' && payload.next_cursor.length > 0)
    )
  ) {
    throw new Error('Invalid history cursor');
  }
  const mode = query.aggregation ?? 'raw';
  if (mode !== 'raw') return parseBuckets(payload as Record<string, unknown>, query);
  if ('aggregation' in payload && payload.aggregation !== 'raw')
    throw new Error('Wrong aggregation');
  const readings = parseReadings(JSON.stringify(payload));
  const start = Date.parse(localTimestamp(query.start));
  const end = Date.parse(localTimestamp(query.end));
  if (
    readings.some(
      (row) =>
        !query.tagIds.includes(row.tag_id) ||
        Date.parse(localTimestamp(row.observed_at)) < start ||
        Date.parse(localTimestamp(row.observed_at)) >= end,
    )
  )
    throw new Error('History outside requested range');
  return { readings, next_cursor: payload.next_cursor };
}

export function plotValue(tag: TelemetryTag, value: number): number {
  return tag.tag_key === 'gas_resistance_ohm' && tag.unit === 'Ω' ? value / 1000 : value;
}

function parseBuckets(payload: Record<string, unknown>, query: HistoryQuery): HistoryPage {
  if (payload['aggregation'] !== query.aggregation || !Array.isArray(payload['buckets']))
    throw new Error('Wrong aggregation payload');
  const time = (value: unknown): number =>
    typeof value === 'string' ? Date.parse(localTimestamp(value)) : NaN;
  const start = time(query.start),
    end = time(query.end);
  for (const item of payload['buckets']) {
    if (!item || typeof item !== 'object') throw new Error('Invalid bucket');
    const row = item as HistoryBucket;
    const times = [
      row.bucket_start,
      row.bucket_end,
      row.coverage_start,
      row.coverage_end,
      row.last_observed_at,
    ].map(time);
    const [begin, finish, from, to, last] = times;
    const counts = [
      row.sample_count,
      row.good_count,
      row.uncertain_count,
      row.bad_count,
      row.unknown_count,
      row.usable_count,
    ];
    if (
      !Number.isInteger(row.tag_id) ||
      !query.tagIds.includes(row.tag_id) ||
      typeof row.tag_key !== 'string' ||
      !times.every(Number.isFinite) ||
      begin >= finish ||
      from !== Math.max(begin, start) ||
      to !== Math.min(finish, end) ||
      from >= to ||
      last < from ||
      last >= to ||
      row.partial !== (begin < start || finish > end) ||
      !['average', 'last'].includes(row.method) ||
      !Number.isInteger(row.last_quality) ||
      !counts.every((n) => Number.isInteger(n) && n >= 0) ||
      row.sample_count < 1 ||
      row.sample_count !==
        row.good_count + row.uncertain_count + row.bad_count + row.unknown_count ||
      row.usable_count > row.good_count ||
      ![row.value, row.minimum, row.maximum].every(
        (v) => v === null || (typeof v === 'number' && Number.isFinite(v)),
      ) ||
      (row.method === 'average' &&
        (row.usable_count === 0
          ? row.value !== null || row.minimum !== null || row.maximum !== null
          : row.value === null ||
            row.minimum === null ||
            row.maximum === null ||
            row.minimum > row.maximum)) ||
      (row.method === 'last' && (row.minimum !== null || row.maximum !== null))
    )
      throw new Error('Invalid history bucket');
  }
  return {
    readings: payload['buckets'] as HistoryBucket[],
    next_cursor: payload['next_cursor'] as string | null,
  };
}

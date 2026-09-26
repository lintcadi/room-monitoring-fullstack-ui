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
}
export interface HistoryPage {
  readings: TelemetryReading[];
  next_cursor: string | null;
}
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

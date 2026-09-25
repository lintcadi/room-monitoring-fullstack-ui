export interface TelemetryTag {
  id: number;
  tag_key: string;
  name: string;
  unit: string | null;
}

export interface TelemetryReading {
  id: number;
  tag_id: number;
  tag_key: string;
  value: number;
  quality: number;
  observed_at: string;
  ingested_at: string;
}

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'unavailable' | 'invalid';

export interface TagView extends TelemetryTag {
  reading: TelemetryReading | undefined;
}

// Fail visibly if the stream contract changes instead of silently showing corrupt values.
export function parseReadings(data: string): TelemetryReading[] {
  const payload: unknown = JSON.parse(data);
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('readings' in payload) ||
    !Array.isArray(payload.readings)
  ) {
    throw new Error('Invalid telemetry payload');
  }
  const readings = payload.readings as unknown[];
  for (const item of readings) {
    if (!item || typeof item !== 'object') throw new Error('Invalid reading');
    const row = item as Record<string, unknown>;
    if (
      !['id', 'tag_id', 'quality'].every((key) => Number.isInteger(row[key])) ||
      typeof row['value'] !== 'number' ||
      !Number.isFinite(row['value']) ||
      typeof row['tag_key'] !== 'string' ||
      !['observed_at', 'ingested_at'].every(
        (key) =>
          typeof row[key] === 'string' && Number.isFinite(Date.parse(localTimestamp(row[key]))),
      )
    ) {
      throw new Error('Invalid reading');
    }
  }
  return readings as TelemetryReading[];
}

// The API interprets timestamps without an offset as Asia/Taipei.
export function localTimestamp(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+08:00`;
}

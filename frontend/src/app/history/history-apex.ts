import type { ApexAxisChartSeries } from 'ng-apexcharts';
import { localTimestamp, TelemetryReading, TelemetryTag } from '../telemetry/telemetry.models';
import { HistoryQuery, plotValue } from './history.models';

export interface ChartRange {
  min: number;
  max: number;
}
export const readingTime = (row: TelemetryReading) => Date.parse(localTimestamp(row.observed_at));
export const queryRange = (query: HistoryQuery): ChartRange => ({
  min: Date.parse(localTimestamp(query.start)),
  max: Date.parse(localTimestamp(query.end)),
});

export function nearestReadingIndex(
  rows: TelemetryReading[],
  time: number,
  range: ChartRange,
): number {
  const lowerBound = (target: number) => {
    let lo = 0,
      hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (readingTime(rows[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const right = lowerBound(time);
  const candidates = [right - 1, right].filter(
    (index) =>
      index >= 0 &&
      index < rows.length &&
      readingTime(rows[index]) >= range.min &&
      readingTime(rows[index]) <= range.max,
  );
  return candidates.reduce(
    (best, index) =>
      best === -1 ||
      Math.abs(readingTime(rows[index]) - time) < Math.abs(readingTime(rows[best]) - time)
        ? index
        : best,
    -1,
  );
}

export function initialRange(rows: TelemetryReading[], query: HistoryQuery): ChartRange {
  if (rows.length <= 100) return queryRange(query);
  const min = readingTime(rows[0]);
  return { min, max: Math.max(min + 1, readingTime(rows[99])) };
}

// Same indices in every series let Apex event indices map back to the original reading.
// Nulls explicitly break the good line; non-good data is rendered as markers only.
export function qualitySeries(rows: TelemetryReading[], tag: TelemetryTag): ApexAxisChartSeries {
  return ['Good', 'Uncertain', 'Bad', 'Unknown'].map((name, quality) => ({
    name,
    data: rows.map((row) => ({
      x: readingTime(row),
      y: (quality === 3 ? ![0, 1, 2].includes(row.quality) : row.quality === quality)
        ? plotValue(tag, row.value)
        : null,
    })),
  }));
}

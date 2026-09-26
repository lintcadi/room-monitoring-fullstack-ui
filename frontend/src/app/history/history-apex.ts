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

// Keep timestamps aligned across the four quality series for each measurement.
// Nulls explicitly break the good line; non-good data is rendered as markers only.
export function qualitySeries(
  rows: TelemetryReading[],
  tag: TelemetryTag,
  transform = (value: number) => value,
): ApexAxisChartSeries {
  return ['Good', 'Uncertain', 'Bad', 'Unknown'].map((name, quality) => ({
    name,
    data: rows.map((row) => ({
      x: readingTime(row),
      y: (quality === 3 ? ![0, 1, 2].includes(row.quality) : row.quality === quality)
        ? transform(plotValue(tag, row.value))
        : null,
    })),
  }));
}

// Distinct series colors identify measurements; marker shapes still identify quality.
export const MEASUREMENT_COLORS = [
  '#267653',
  '#3c69b0',
  '#a85726',
  '#8759a1',
  '#237d8b',
  '#b04b76',
  '#716d26',
  '#5468aa',
  '#9c5f51',
  '#397c6f',
  '#785bb8',
  '#976529',
  '#537caa',
  '#86547a',
];

export function measurementScale(rows: TelemetryReading[], tag: TelemetryTag) {
  const values = rows.map((row) => plotValue(tag, row.value));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return {
    min,
    max,
    // Constant series sit halfway up the comparison plot; no variation is invented.
    normalize: (value: number) => (max === min ? 50 : ((value - min) / (max - min)) * 100),
  };
}

import { TelemetryReading, TelemetryTag, localTimestamp } from '../telemetry/telemetry.models';
import { HistoryQuery, STATUS_KEYS, plotValue } from './history.models';

export function buildPlot(
  rows: TelemetryReading[],
  tag: TelemetryTag,
  query: HistoryQuery,
  width: number,
  height: number,
) {
  const left = 48,
    right = width - 16,
    top = 18,
    bottom = height - 32;
  const start = Date.parse(localTimestamp(query.start));
  const end = Date.parse(localTimestamp(query.end));
  const values = rows.map((row) => plotValue(tag, row.value));
  const min = Math.min(...values),
    max = Math.max(...values);
  const stepped = STATUS_KEYS.includes(tag.tag_key);
  const padding = min === max ? Math.max(Math.abs(min) * 0.01, 1) : (max - min) * 0.08;
  let low = min - padding,
    high = max + padding;
  let yValues: number[];
  if (['stabilization_complete', 'run_in_complete', 'iaq_accuracy'].includes(tag.tag_key)) {
    const normalMax = tag.tag_key === 'iaq_accuracy' ? 3 : 1;
    low = Math.min(0, min) - 0.15;
    high = Math.max(normalMax, max) + 0.15;
    yValues = Array.from({ length: normalMax + 1 }, (_, i) => i);
  } else {
    yValues = Array.from({ length: 5 }, (_, i) => low + ((high - low) * i) / 4);
  }
  const x = (time: number) => left + ((time - start) / (end - start)) * (right - left);
  const y = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);
  const points = rows.map((row, i) => ({
    row,
    x: x(Date.parse(localTimestamp(row.observed_at))),
    y: y(values[i]),
  }));
  const paths: string[] = [];
  let path = '';
  for (const point of points) {
    if (point.row.quality !== 0) {
      if (path) paths.push(path);
      path = '';
    } else {
      path += path
        ? stepped
          ? ` H ${point.x} V ${point.y}`
          : ` L ${point.x} ${point.y}`
        : `M ${point.x} ${point.y}`;
    }
  }
  if (path) paths.push(path);
  const markers = points.filter(
    (point, i) =>
      point.row.quality !== 0 ||
      ((!points[i - 1] || points[i - 1].row.quality !== 0) &&
        (!points[i + 1] || points[i + 1].row.quality !== 0)),
  );
  const ticks = width < 500 ? 3 : 5;
  return {
    left,
    right,
    top,
    bottom,
    points,
    paths,
    markers,
    yTicks: yValues.map((value) => ({ value, y: y(value) })),
    xTicks: Array.from({ length: ticks }, (_, i) => {
      const time = start + ((end - start) * i) / (ticks - 1);
      return { time, x: x(time) };
    }),
  };
}

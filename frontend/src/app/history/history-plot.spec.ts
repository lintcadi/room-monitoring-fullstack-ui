import { TelemetryReading, TelemetryTag } from '../telemetry/telemetry.models';
import { buildPlot } from './history-plot';

const tag: TelemetryTag = { id: 1, tag_key: 'temperature_c', name: 'Temperature', unit: '°C' };
const query = { tagId: 1, start: '2026-09-25T00:00:00Z', end: '2026-09-25T01:00:00Z' };
function row(id: number, minutes: number, quality = 0): TelemetryReading {
  return {
    id,
    tag_id: 1,
    tag_key: tag.tag_key,
    quality,
    value: 20 + id,
    observed_at: new Date(Date.parse(query.start) + minutes * 60000).toISOString(),
    ingested_at: query.end,
  };
}

describe('history chart geometry', () => {
  it('spaces observations by actual time and leaves an unloaded remainder visible', () => {
    const plot = buildPlot([row(1, 0), row(2, 10), row(3, 30)], tag, query, 1000, 300);
    const [a, b, c] = plot.points;
    expect(c.x - b.x).toBeCloseTo(2 * (b.x - a.x));
    expect(c.x).toBeCloseTo((plot.left + plot.right) / 2);
  });

  it('breaks the good-quality line around uncertain and bad readings without dropping them', () => {
    const plot = buildPlot(
      [row(1, 0), row(2, 10, 1), row(3, 20), row(4, 30, 2)],
      tag,
      query,
      1000,
      300,
    );
    expect(plot.paths).toHaveLength(2);
    expect(plot.points).toHaveLength(4);
    expect(plot.markers.map((point) => point.row.quality)).toContain(1);
    expect(plot.markers.map((point) => point.row.quality)).toContain(2);
  });

  it('uses step lines for flags and finite coordinates for constant single readings', () => {
    const statusTag = { ...tag, tag_key: 'stabilization_complete', unit: null };
    const stepped = buildPlot(
      [
        { ...row(1, 0), value: 0 },
        { ...row(2, 30), value: 1 },
      ],
      statusTag,
      query,
      500,
      200,
    );
    expect(stepped.paths[0]).toContain(' H ');
    expect(stepped.yTicks.map((tick) => tick.value)).toEqual([0, 1]);
    const single = buildPlot([{ ...row(1, 0), value: 0 }], tag, query, 500, 200);
    expect(Number.isFinite(single.points[0].y)).toBe(true);
    expect(single.markers).toHaveLength(1);
  });

  it('converts gas resistance consistently with the displayed kiloohm unit', () => {
    const gasTag = { ...tag, tag_key: 'gas_resistance_ohm', unit: 'Ω' };
    const plot = buildPlot([{ ...row(1, 0), value: 120000 }], gasTag, query, 500, 200);
    expect(plot.yTicks.some((tick) => tick.value === 120)).toBe(true);
  });
});

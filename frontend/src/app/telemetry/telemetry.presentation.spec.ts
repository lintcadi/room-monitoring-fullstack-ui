import { TagView } from './telemetry.models';
import {
  displayValue,
  displayUnit,
  observedTime,
  qualityLabel,
  readingAge,
} from './telemetry.presentation';

function tag(key: string, value: number, unit: string | null = null): TagView {
  return {
    id: 1,
    tag_key: key,
    name: key,
    unit,
    reading: {
      id: 1,
      tag_id: 1,
      tag_key: key,
      value,
      quality: 0,
      observed_at: '2026-09-25T13:53:30Z',
      ingested_at: '2026-09-25T13:53:31Z',
    },
  };
}

describe('telemetry presentation', () => {
  it('distinguishes missing data, real zero, telemetry quality, and sensor status', () => {
    expect(displayValue({ ...tag('temperature_c', 0), reading: undefined })).toBe('—');
    expect(displayValue(tag('temperature_c', 0))).toBe('0.0');
    expect([0, 1, 2].map(qualityLabel)).toEqual(['Good', 'Uncertain', 'Bad']);
    expect(displayValue(tag('sensor_status', 0))).toBe('Healthy');
    expect(displayValue(tag('sensor_status', 7))).toBe('Status code: 7');
    expect(displayValue(tag('iaq_accuracy', 3))).toBe('High');
    expect(displayValue(tag('run_in_complete', 0))).toBe('In progress');
    expect(displayValue(tag('stabilization_complete', 1))).toBe('Complete');
  });

  it('preserves VOC precision and converts resistance only when metadata says ohms', () => {
    expect(displayValue(tag('breath_voc_equivalent_ppm', 0.98, 'ppm'))).toBe('0.98');
    const resistance = tag('gas_resistance_ohm', 120313, 'Ω');
    expect(displayValue(resistance)).toBe('120.3');
    expect(displayUnit(resistance)).toBe('kΩ');
    expect(displayValue(tag('gas_resistance_ohm', 120.3, 'kΩ'))).toBe('120.3');
  });

  it('formats both offset and naive timestamps in Taipei regardless of browser timezone', () => {
    expect(observedTime('2026-09-25T13:53:30Z')).toBe('25 Sept 2026 · 21:53:30');
    expect(observedTime('2026-09-25T21:53:30')).toBe(observedTime('2026-09-25T13:53:30Z'));
    expect(readingAge('2026-09-25T13:53:30Z', Date.parse('2026-09-25T13:54:00Z'))).toBe('30s ago');
  });
});

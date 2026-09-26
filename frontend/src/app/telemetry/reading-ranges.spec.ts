import { TagView } from './telemetry.models';
import { READING_RANGES, readingAssessment } from './reading-ranges';

function tag(tag_key: string, value: number, quality = 0): TagView {
  return {
    id: 1,
    tag_key,
    name: tag_key,
    unit: null,
    reading: {
      id: 1,
      tag_id: 1,
      tag_key,
      value,
      quality,
      observed_at: '2026-09-26T12:00:00',
      ingested_at: '2026-09-26T12:00:01',
    },
  };
}

describe('telemetry value ranges', () => {
  it.each([
    ['temperature_c', -40, 'Cool'],
    ['temperature_c', 19.99, 'Cool'],
    ['temperature_c', 20, 'In target'],
    ['temperature_c', 26, 'In target'],
    ['temperature_c', 26.01, 'Warm'],
    ['temperature_c', 85, 'Warm'],
    ['temperature_c', -40.01, 'Out of range'],
    ['temperature_c', 85.01, 'Out of range'],
    ['humidity_percent', 0, 'Dry'],
    ['humidity_percent', 29.99, 'Dry'],
    ['humidity_percent', 30, 'In target'],
    ['humidity_percent', 50, 'In target'],
    ['humidity_percent', 50.01, 'Elevated'],
    ['humidity_percent', 59.99, 'Elevated'],
    ['humidity_percent', 60, 'High humidity'],
    ['humidity_percent', 100, 'High humidity'],
    ['humidity_percent', -0.01, 'Out of range'],
    ['humidity_percent', 100.01, 'Out of range'],
    ['pressure_hpa', 299.99, 'Out of range'],
    ['pressure_hpa', 300, 'In sensor range'],
    ['pressure_hpa', 1100, 'In sensor range'],
    ['pressure_hpa', 1100.01, 'Out of range'],
    ['gas_resistance_ohm', 0, 'Out of range'],
    ['gas_resistance_ohm', 1, 'Relative signal'],
    ['static_iaq', -1, 'Out of range'],
    ['static_iaq', 0, 'Unscaled index'],
    ['static_iaq', 900, 'Unscaled index'],
    ['co2_equivalent_ppm', -1, 'Out of range'],
    ['co2_equivalent_ppm', 400, 'Estimate'],
    ['co2_equivalent_ppm', 5000, 'Estimate'],
    ['breath_voc_equivalent_ppm', -1, 'Out of range'],
    ['breath_voc_equivalent_ppm', 0.3, 'Estimate'],
    ['breath_voc_equivalent_ppm', 50, 'Estimate'],
    ['gas_percentage', -1, 'Out of range'],
    ['gas_percentage', 0, 'Relative level'],
    ['gas_percentage', 100, 'Relative level'],
    ['gas_percentage', 100.01, 'Out of range'],
    ['iaq_accuracy', 0, 'Unreliable'],
    ['iaq_accuracy', 1, 'Low'],
    ['iaq_accuracy', 2, 'Medium'],
    ['iaq_accuracy', 3, 'High'],
    ['iaq_accuracy', 1.5, 'Out of range'],
    ['iaq_accuracy', 4, 'Out of range'],
    ['stabilization_complete', 0, 'In progress'],
    ['stabilization_complete', 1, 'Complete'],
    ['stabilization_complete', 0.5, 'Out of range'],
    ['stabilization_complete', 2, 'Out of range'],
    ['run_in_complete', 0, 'In progress'],
    ['run_in_complete', 1, 'Complete'],
    ['run_in_complete', -1, 'Out of range'],
    ['sensor_status', 0, 'Healthy'],
    ['sensor_status', -1, 'Check status'],
    ['sensor_status', 4, 'Check status'],
    ['sensor_status', 0.5, 'Out of range'],
    ['heartbeat', 0, 'Device reported'],
    ['heartbeat', 1234, 'Device reported'],
    ['iaq', 167.3, 'Moderately polluted'],
  ])('%s = %s has meaning %s', (key, value, label) => {
    expect(readingAssessment(tag(key, value))?.label).toBe(label);
  });

  it('never assigns a valid band to missing, nonfinite or non-good-quality data for any defined tag', () => {
    for (const key of Object.keys(READING_RANGES)) {
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(readingAssessment(tag(key, value))).toMatchObject({ range: null, color: '#657067' });
      }
      for (const quality of [1, 2, 99]) {
        expect(readingAssessment(tag(key, 0, quality))).toMatchObject({
          range: null,
          color: '#657067',
        });
      }
      expect(readingAssessment({ ...tag(key, 0), reading: undefined })?.range).toBeNull();
    }
  });

  it('keeps relative values neutral instead of borrowing scaled IAQ or direct gas thresholds', () => {
    for (const key of [
      'pressure_hpa',
      'gas_resistance_ohm',
      'static_iaq',
      'co2_equivalent_ppm',
      'breath_voc_equivalent_ppm',
      'gas_percentage',
      'heartbeat',
    ]) {
      const value = key === 'gas_percentage' ? 50 : 1000;
      expect(readingAssessment(tag(key, value))?.color).toBe('#657067');
    }
  });

  it('leaves unknown tags unclassified', () => {
    expect(readingAssessment(tag('future_tag', 1))).toBeNull();
    expect(readingAssessment(undefined)).toBeNull();
  });
});

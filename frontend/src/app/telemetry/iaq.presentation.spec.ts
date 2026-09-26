import { TagView } from './telemetry.models';
import { classifyIaq, iaqAssessment } from './iaq.presentation';

const tag: TagView = {
  id: 1,
  tag_key: 'iaq',
  name: 'IAQ',
  unit: null,
  reading: {
    id: 1,
    tag_id: 1,
    tag_key: 'iaq',
    value: 167.3,
    quality: 0,
    observed_at: '2026-09-26T00:00:00Z',
    ingested_at: '2026-09-26T00:00:01Z',
  },
};

describe('Bosch IAQ classification', () => {
  it.each([
    [0, 'Excellent'],
    [50, 'Excellent'],
    [50.01, 'Good'],
    [100, 'Good'],
    [100.01, 'Lightly polluted'],
    [150, 'Lightly polluted'],
    [150.01, 'Moderately polluted'],
    [167.3, 'Moderately polluted'],
    [200, 'Moderately polluted'],
    [200.01, 'Heavily polluted'],
    [250, 'Heavily polluted'],
    [250.01, 'Severely polluted'],
    [350, 'Severely polluted'],
    [350.01, 'Extremely polluted'],
    [351, 'Extremely polluted'],
    [500, 'Extremely polluted'],
  ])('classifies %s without rounding or leaving decimal gaps', (value, label) => {
    expect(classifyIaq(value)?.label).toBe(label);
  });

  it('separates a good-quality reading from its polluted-air classification', () => {
    expect(iaqAssessment(tag)).toMatchObject({ label: 'Moderately polluted', color: '#b45309' });
    expect(tag.reading!.quality).toBe(0);
  });

  it('does not assign a pollution band to missing, unreliable or invalid readings', () => {
    expect(iaqAssessment({ ...tag, reading: undefined })).toMatchObject({
      label: 'No IAQ reading',
      range: null,
    });
    for (const quality of [1, 2, 99]) {
      expect(
        iaqAssessment({ ...tag, reading: { ...tag.reading!, value: 0, quality } }),
      ).toMatchObject({ label: 'IAQ unavailable', range: null, color: '#657067' });
    }
    for (const value of [-1, 500.01, NaN, Infinity]) {
      expect(classifyIaq(value)).toBeUndefined();
      expect(iaqAssessment({ ...tag, reading: { ...tag.reading!, value } })).toMatchObject({
        label: 'IAQ out of range',
        range: null,
      });
    }
  });

  it('does not apply the IAQ bands to other tags or static IAQ', () => {
    for (const tag_key of ['static_iaq', 'temperature_c', 'co2_equivalent_ppm']) {
      expect(iaqAssessment({ ...tag, tag_key })).toBeNull();
    }
  });
});

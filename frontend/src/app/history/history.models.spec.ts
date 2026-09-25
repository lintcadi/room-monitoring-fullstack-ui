import { customRange, parseHistory, taipeiInput } from './history.models';

describe('history time ranges', () => {
  it('interprets custom input as Taipei independently of the browser timezone', () => {
    expect(taipeiInput('2026-09-25T13:53:30Z')).toBe('2026-09-25T21:53');
    expect(customRange('2026-09-25T21:00', '2026-09-25T22:00')).toEqual({
      start: '2026-09-25T21:00+08:00',
      end: '2026-09-25T22:00+08:00',
    });
  });

  it('rejects reversed, empty, equal, and normalized invalid dates', () => {
    expect(customRange('', '')).toBeNull();
    expect(customRange('2026-09-25T22:00', '2026-09-25T21:00')).toBeNull();
    expect(customRange('2026-09-25T21:00', '2026-09-25T21:00')).toBeNull();
    expect(customRange('2026-02-30T12:00', '2026-03-03T12:00')).toBeNull();
  });

  it('validates the half-open range and rejects an invalid cursor contract', () => {
    const query = { tagId: 1, start: '2026-09-25T21:00+08:00', end: '2026-09-25T22:00+08:00' };
    const row = {
      id: 1,
      tag_id: 1,
      tag_key: 'temperature_c',
      value: 0,
      quality: 0,
      observed_at: query.end,
      ingested_at: query.end,
    };
    expect(() => parseHistory({ readings: [row], next_cursor: null }, query)).toThrow();
    expect(() => parseHistory({ readings: [], next_cursor: 3 }, query)).toThrow();
    expect(
      parseHistory({ readings: [{ ...row, observed_at: query.start }], next_cursor: null }, query)
        .readings[0].value,
    ).toBe(0);
  });
});

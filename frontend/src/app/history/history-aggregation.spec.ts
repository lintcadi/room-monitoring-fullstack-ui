import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HistoryBucket, HistoryQuery, parseHistory, rowKey } from './history.models';
import { qualitySeries, bucketAtTime } from './history-apex';
import { HistoryService } from './history.service';
import { HistoryObservation } from './history-observation';

const query: HistoryQuery = {
  tagIds: [1, 2],
  start: '2026-09-25T08:15:00+08:00',
  end: '2026-09-25T12:00:00+08:00',
  aggregation: 'hourly',
};
const tag = { id: 1, tag_key: 'temperature_c', name: 'Temperature', unit: '°C' };
const bucket = (overrides: Partial<HistoryBucket> = {}): HistoryBucket => ({
  tag_id: 1,
  tag_key: 'temperature_c',
  bucket_start: '2026-09-25T08:00:00+08:00',
  bucket_end: '2026-09-25T09:00:00+08:00',
  coverage_start: query.start,
  coverage_end: '2026-09-25T09:00:00+08:00',
  partial: true,
  method: 'average',
  value: 25,
  minimum: 20,
  maximum: 30,
  sample_count: 4,
  good_count: 2,
  uncertain_count: 1,
  bad_count: 1,
  unknown_count: 0,
  usable_count: 2,
  last_observed_at: '2026-09-25T08:50:00+08:00',
  last_quality: 2,
  ...overrides,
});
const payload = (buckets: HistoryBucket[], next_cursor: string | null = null) => ({
  aggregation: 'hourly',
  buckets,
  next_cursor,
});

describe('history aggregation contract and presentation', () => {
  it('accepts partial buckets beginning before the range and preserves zero and quality counts', () => {
    const row = bucket({ value: 0, minimum: 0, maximum: 0 });
    expect(parseHistory(payload([row]), query).readings).toEqual([row]);
    expect(rowKey(row)).toBe('2026-09-25T08:00:00+08:00:1');
  });

  it.each([
    { tag_id: 99 },
    { partial: false },
    { sample_count: 99 },
    { usable_count: 3 },
    { value: null },
    { maximum: -1 },
    { value: Infinity },
    { last_observed_at: '2026-09-25T09:00:00+08:00' },
    { coverage_start: '2026-09-25T08:00:00+08:00' },
  ])('rejects malformed or mismatched bucket metadata: %j', (invalid) => {
    expect(() => parseHistory(payload([bucket(invalid)]), query)).toThrow();
  });

  it('rejects aggregation responses for raw queries and vice versa', () => {
    expect(() => parseHistory(payload([]), { ...query, aggregation: 'raw' })).toThrow();
    expect(() => parseHistory({ readings: [], next_cursor: null }, query)).toThrow();
    expect(() => parseHistory({ ...payload([]), aggregation: 'daily' }, query)).toThrow();
  });

  it('represents unusable buckets and empty intervals as gaps, without borrowing neighboring values', () => {
    const empty = bucket({
      value: null,
      minimum: null,
      maximum: null,
      usable_count: 0,
      good_count: 0,
      bad_count: 3,
    });
    expect(parseHistory(payload([empty]), query).readings[0].value).toBeNull();
    expect(
      qualitySeries([empty], tag).every(
        (s) => s.data[0] && (s.data[0] as { y: unknown }).y === null,
      ),
    ).toBe(true);
    const later = bucket({
      bucket_start: '2026-09-25T10:00:00+08:00',
      coverage_start: '2026-09-25T10:00:00+08:00',
      bucket_end: '2026-09-25T11:00:00+08:00',
      coverage_end: '2026-09-25T11:00:00+08:00',
      partial: false,
    });
    expect(qualitySeries([bucket(), later], tag)[0].data).toEqual([
      { x: Date.parse(query.start), y: 25 },
      { x: Date.parse('2026-09-25T09:00:00+08:00'), y: null },
      { x: Date.parse(later.bucket_start), y: 25 },
    ]);
    expect(
      bucketAtTime([bucket(), later], Date.parse('2026-09-25T09:30:00+08:00')),
    ).toBeUndefined();
    expect(bucketAtTime([bucket(), later], Date.parse('2026-09-25T08:59:59+08:00'))).toEqual(
      bucket(),
    );
  });

  it('renders summary statistics, partial periods, quality counts and last-value semantics', () => {
    const fixture = TestBed.createComponent(HistoryObservation);
    fixture.componentRef.setInput('tag', tag);
    fixture.componentRef.setInput('row', bucket());
    fixture.detectChanges();
    let text = fixture.nativeElement.textContent;
    expect(text).toContain('Partial bucket');
    expect(text).toContain('25.0');
    expect(text).toContain('Min 20.0');
    expect(text).toContain('2 good · 1 uncertain · 1 bad');
    expect(text).not.toContain('Data: Good');
    fixture.componentRef.setInput('tag', { ...tag, tag_key: 'sensor_status' });
    fixture.componentRef.setInput(
      'row',
      bucket({ method: 'last', value: 0, minimum: null, maximum: null }),
    );
    fixture.detectChanges();
    text = fixture.nativeElement.textContent;
    expect(text).toContain('Last recorded value');
    expect(text).toContain('Healthy');
    expect(text).toContain('Last: Bad');
    expect(text).not.toContain('Average');
    fixture.destroy();
  });
});

describe('aggregated history pagination', () => {
  let history: HistoryService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HistoryService],
    });
    history = TestBed.inject(HistoryService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  const request = () => http.expectOne((r) => r.url === '/api/telemetry/history');

  it('keeps the aggregation with each cursor and deduplicates by bucket and tag', () => {
    history.load(query);
    const first = request();
    expect(first.request.params.get('aggregation')).toBe('hourly');
    first.flush(payload([bucket()], 'second'));
    history.loadMore();
    const next = request();
    expect(next.request.params.get('aggregation')).toBe('hourly');
    expect(next.request.params.get('cursor')).toBe('second');
    expect(next.request.params.getAll('tag_ids')).toEqual(['1', '2']);
    next.flush(payload([bucket(), bucket({ tag_id: 2 })]));
    expect(history.readings()).toHaveLength(2);
    expect(history.nextCursor()).toBeNull();
  });

  it('cancels the old mode and starts without a cursor when aggregation changes', () => {
    history.load(query);
    const old = request();
    history.load({ ...query, aggregation: 'daily' });
    expect(old.cancelled).toBe(true);
    const next = request();
    expect(next.request.params.get('aggregation')).toBe('daily');
    expect(next.request.params.has('cursor')).toBe(false);
    next.flush({ aggregation: 'daily', buckets: [], next_cursor: null });
    expect(history.loaded()).toBe(true);
  });
});

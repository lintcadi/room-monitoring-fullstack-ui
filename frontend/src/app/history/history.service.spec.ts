import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HistoryService } from './history.service';
import { HistoryQuery } from './history.models';

const query: HistoryQuery = {
  tagIds: [1],
  start: '2026-09-25T08:00:00+08:00',
  end: '2026-09-25T09:00:00+08:00',
};
function reading(id: number, tagId = 1) {
  return {
    id,
    tag_id: tagId,
    tag_key: 'temperature_c',
    value: 26.7,
    quality: 0,
    observed_at: new Date(Date.parse(query.start) + id * 100).toISOString(),
    ingested_at: '2026-09-25T00:59:00Z',
  };
}

describe('HistoryService', () => {
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
  const nextRequest = () => http.expectOne((request) => request.url === '/api/telemetry/history');

  it('loads metadata and defaults to temperature without opening a live stream', () => {
    history.loadTags();
    http.expectOne('/api/telemetry/tags').flush([
      { id: 2, tag_key: 'humidity_percent', name: 'Humidity', unit: '%' },
      { id: 1, tag_key: 'temperature_c', name: 'Temperature', unit: '°C' },
    ]);
    const request = nextRequest();
    expect(request.request.params.get('tag_ids')).toBe('1');
    expect(request.request.params.get('limit')).toBe('1000');
    expect(request.request.params.has('cursor')).toBe(false);
    request.flush({ readings: [], next_cursor: null });
    expect(history.loaded()).toBe(true);
    expect(history.tag()?.name).toBe('Temperature');
  });

  it('keeps the same query and opaque cursor when appending a page, deduplicating IDs', () => {
    history.load(query);
    nextRequest().flush({ readings: [reading(1), reading(2)], next_cursor: 'opaque+/cursor' });
    history.loadMore();
    const next = nextRequest();
    expect(next.request.params.get('cursor')).toBe('opaque+/cursor');
    expect(next.request.params.get('start')).toBe(query.start);
    expect(next.request.params.get('end')).toBe(query.end);
    expect(next.request.params.get('tag_ids')).toBe('1');
    next.flush({ readings: [reading(2), reading(3)], next_cursor: null });
    expect(history.readings().map((row) => row.id)).toEqual([1, 2, 3]);
    expect(history.nextCursor()).toBeNull();
    history.loadMore();
    http.expectNone((request) => request.url === '/api/telemetry/history');
  });

  it('cancels an old range request when the selection changes', () => {
    history.load(query);
    const old = nextRequest();
    history.load({ ...query, tagIds: [2] });
    expect(old.cancelled).toBe(true);
    expect(history.readings()).toEqual([]);
    nextRequest().flush({ readings: [reading(2, 2)], next_cursor: null });
    expect(history.readings()[0].tag_id).toBe(2);
  });

  it('keeps loaded data and retries the same cursor after a page fails', () => {
    history.load(query);
    nextRequest().flush({ readings: [reading(1)], next_cursor: 'page-2' });
    history.loadMore();
    nextRequest().flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    expect(history.error()).toBe(true);
    expect(history.readings()).toHaveLength(1);
    expect(history.nextCursor()).toBe('page-2');
    history.retry();
    const retry = nextRequest();
    expect(retry.request.params.get('cursor')).toBe('page-2');
    retry.flush({ readings: [reading(2)], next_cursor: null });
    expect(history.error()).toBe(false);
    expect(history.readings()).toHaveLength(2);
  });

  it('bounds loaded data at 5,000 readings and does not silently mark a partial range complete', () => {
    history.load(query);
    for (let page = 0; page < 5; page++) {
      nextRequest().flush({
        readings: Array.from({ length: 1000 }, (_, i) => reading(page * 1000 + i)),
        next_cursor: `page-${page + 1}`,
      });
      history.loadMore();
    }
    expect(history.readings()).toHaveLength(5000);
    expect(history.limitReached()).toBe(true);
    expect(history.nextCursor()).toBe('page-5');
    http.expectNone((request) => request.url === '/api/telemetry/history');
  });

  it('rejects readings from a different query and permits retrying the first page', () => {
    history.load(query);
    nextRequest().flush({ readings: [reading(1, 99)], next_cursor: null });
    expect(history.error()).toBe(true);
    expect(history.readings()).toHaveLength(0);
    history.retry();
    nextRequest().flush({ readings: [], next_cursor: null });
    expect(history.error()).toBe(false);
    expect(history.loaded()).toBe(true);
  });

  it('cancels pending history work when leaving the page', () => {
    history.load(query);
    const request = nextRequest();
    TestBed.resetTestingModule();
    expect(request.cancelled).toBe(true);
  });
  it('uses repeated tag IDs on every page and validates all selected measurements', () => {
    history.load({ ...query, tagIds: [1, 2] });
    const first = nextRequest();
    expect(first.request.params.getAll('tag_ids')).toEqual(['1', '2']);
    first.flush({ readings: [reading(1), reading(2, 2)], next_cursor: 'next' });
    expect(history.error()).toBe(false);
    history.loadMore();
    const next = nextRequest();
    expect(next.request.params.getAll('tag_ids')).toEqual(['1', '2']);
    expect(next.request.params.get('cursor')).toBe('next');
    next.flush({ readings: [reading(3, 99)], next_cursor: null });
    expect(history.error()).toBe(true);
    expect(history.readings()).toHaveLength(2);
    expect(history.nextCursor()).toBe('next');
  });

  it('does not send an unfiltered history request when no measurements are selected', () => {
    history.load({ ...query, tagIds: [] });
    http.expectNone((request) => request.url === '/api/telemetry/history');
  });
});

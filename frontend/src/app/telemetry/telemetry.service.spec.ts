import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EVENT_SOURCE_FACTORY, TelemetryService } from './telemetry.service';
import { TelemetryReading } from './telemetry.models';

class FakeSource extends EventTarget {
  onerror: (() => void) | null = null;
  close = vi.fn();
  emit(event: string, payload: unknown): void {
    this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(payload) }));
  }
}

function reading(tagId: number, value: number): TelemetryReading {
  return {
    id: tagId,
    tag_id: tagId,
    tag_key: `tag_${tagId}`,
    value,
    quality: 0,
    observed_at: '2026-09-25T13:53:30Z',
    ingested_at: '2026-09-25T13:53:31Z',
  };
}

describe('TelemetryService', () => {
  let service: TelemetryService;
  let http: HttpTestingController;
  let sources: FakeSource[];
  let factory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sources = [];
    factory = vi.fn(() => {
      const source = new FakeSource();
      sources.push(source);
      return source as unknown as EventSource;
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: factory },
      ],
    });
    service = TestBed.inject(TelemetryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    service.stop();
  });

  function start(): FakeSource {
    service.start();
    http.expectOne('/api/telemetry/tags').flush([
      { id: 1, tag_key: 'tag_1', name: 'Temperature', unit: '°C' },
      { id: 2, tag_key: 'tag_2', name: 'Humidity', unit: '%' },
    ]);
    return sources[0];
  }

  it('opens one stream and merges independent updates without losing other tags', () => {
    const source = start();
    service.start();
    expect(factory).toHaveBeenCalledExactlyOnceWith('/api/telemetry/stream');
    source.emit('snapshot', { readings: [reading(1, 26.7), reading(2, 41.1)] });
    source.emit('update', { readings: [reading(1, 27)] });
    expect(service.tagViews().map((tag) => tag.reading?.value)).toEqual([27, 41.1]);
    expect(service.connection()).toBe('live');
  });

  it('retains readings during a disconnect and replaces them on the reconnect snapshot', () => {
    const source = start();
    source.emit('snapshot', { readings: [reading(1, 26.7), reading(2, 41.1)] });
    source.onerror?.();
    expect(service.connection()).toBe('reconnecting');
    expect(service.readings().size).toBe(2);
    source.emit('snapshot', { readings: [reading(2, 42)] });
    expect(service.readings().has(1)).toBe(false);
    expect(service.readings().get(2)?.value).toBe(42);
    expect(service.connection()).toBe('live');
  });

  it('distinguishes backend unavailability from a connected stream and recovers', () => {
    const source = start();
    source.emit('snapshot', { readings: [reading(1, 26.7)] });
    source.emit('status', { status: 'unavailable' });
    expect(service.connection()).toBe('unavailable');
    expect(service.readings().get(1)?.value).toBe(26.7);
    source.emit('snapshot', { readings: [reading(1, 27)] });
    expect(service.connection()).toBe('live');
  });

  it('accepts an empty snapshot without inventing zero-valued readings', () => {
    const source = start();
    source.emit('snapshot', { readings: [] });
    expect(service.hasSnapshot()).toBe(true);
    expect(service.connection()).toBe('live');
    expect(service.tagViews()[0].reading).toBeUndefined();
  });

  it('keeps the last valid readings and closes on malformed data', () => {
    const source = start();
    source.emit('snapshot', { readings: [reading(1, 26.7)] });
    source.emit('update', { readings: [{ ...reading(1, 30), value: null }] });
    expect(service.connection()).toBe('invalid');
    expect(service.readings().get(1)?.value).toBe(26.7);
    expect(source.close).toHaveBeenCalledOnce();
  });

  it('retries failed metadata independently of the stream', () => {
    service.start();
    http
      .expectOne('/api/telemetry/tags')
      .flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    expect(service.metadataError()).toBe(true);
    service.loadTags();
    http.expectOne('/api/telemetry/tags').flush([]);
    expect(service.metadataError()).toBe(false);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('closes the old stream before a manual retry and cleans up on stop', () => {
    const source = start();
    service.reconnect();
    expect(source.close).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);
    service.stop();
    expect(sources[1].close).toHaveBeenCalledOnce();
  });

  it('reports offline promptly, retains readings, and reconnects when online', () => {
    const source = start();
    source.emit('snapshot', { readings: [reading(1, 26.7)] });
    window.dispatchEvent(new Event('offline'));
    expect(service.connection()).toBe('reconnecting');
    expect(source.close).toHaveBeenCalledOnce();
    expect(service.readings().get(1)?.value).toBe(26.7);
    window.dispatchEvent(new Event('online'));
    expect(factory).toHaveBeenCalledTimes(2);
    sources[1].emit('snapshot', { readings: [reading(1, 27)] });
    expect(service.connection()).toBe('live');
  });

  it('does not reconnect an inactive page when the network returns', () => {
    start();
    service.stop();
    window.dispatchEvent(new Event('online'));
    expect(factory).toHaveBeenCalledOnce();
  });

  it('ignores late events from a replaced connection', () => {
    const old = start();
    service.reconnect();
    sources[1].emit('snapshot', { readings: [reading(1, 27)] });
    old.emit('snapshot', { readings: [reading(1, 10)] });
    old.onerror?.();
    expect(service.connection()).toBe('live');
    expect(service.readings().get(1)?.value).toBe(27);
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChartComponent } from 'ng-apexcharts';
import { HistoryChart } from './history-chart';
import { TelemetryReading } from '../telemetry/telemetry.models';
import { queryRange, qualitySeries, readingTime, nearestReadingIndex } from './history-apex';
import { HistoryBucket } from './history.models';

// SVG layout and native gestures are verified in a real browser, not jsdom.
vi.mock('apexcharts/client', () => ({
  default: class {
    render() {
      return Promise.resolve(this);
    }
    destroy() {}
    updateSeries() {
      return Promise.resolve(this);
    }
    zoomX() {}
    removeAnnotation() {}
    addXaxisAnnotation() {}
    addPointAnnotation() {}
  },
}));
const query = { tagIds: [1], start: '2026-09-26T00:00:00Z', end: '2026-09-27T00:00:00Z' };
const tag = { id: 1, tag_key: 'temperature_c', name: 'Temperature', unit: '°C' };
function rows(count: number): TelemetryReading[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    tag_id: 1,
    tag_key: tag.tag_key,
    value: i,
    quality: i % 4,
    observed_at: new Date(Date.parse(query.start) + i * i * 100).toISOString(),
    ingested_at: query.end,
  }));
}

describe('ApexCharts history integration', () => {
  let fixture: ComponentFixture<HistoryChart>;
  let el: HTMLElement;
  const options = () => fixture.componentInstance['options']();
  const chart = () =>
    fixture.debugElement.query(By.directive(ChartComponent)).componentInstance as ChartComponent;
  const setRows = (value: TelemetryReading[]) => {
    fixture.componentRef.setInput('readings', value);
    fixture.detectChanges();
  };
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    fixture = TestBed.createComponent(HistoryChart);
    el = fixture.nativeElement;
    fixture.componentRef.setInput('tags', [tag]);
    fixture.componentRef.setInput('query', query);
    setRows(rows(300));
  });
  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens the selected time range and allows navigation even with fewer than 100 readings', () => {
    expect(options().xaxis).toMatchObject(queryRange(query));
    expect(options().chart.toolbar?.autoSelected).toBe('pan');
    expect(options().chart.zoom?.enabled).toBe(true);
    expect(el.querySelector('.window-caption')?.textContent).toContain('300 / 300');
    expect(el.querySelector('.chart-toolbar')?.textContent).toContain('Reset view');
    setRows(rows(2));
    expect(options().xaxis).toMatchObject(queryRange(query));
    expect(options().chart.zoom?.enabled).toBe(true);
    expect(options().chart.toolbar?.show).toBe(true);
    setRows(rows(1));
    expect(options().chart.zoom?.enabled).toBe(false);
    expect(options().chart.toolbar?.show).toBe(false);
    expect(el.querySelector('.chart-toolbar')?.textContent).not.toContain('Reset view');
  });

  it('hides normal markers but keeps isolated good readings and quality exceptions visible', () => {
    const data = rows(5).map((row, i) => ({ ...row, quality: [0, 0, 2, 0, 1][i] }));
    setRows(data);
    const markers = fixture.componentInstance['markers']();
    expect(markers.size).toEqual([0, 5, 5, 5]);
    expect(markers.discrete).toEqual([
      { seriesIndex: 0, dataPointIndex: 3, size: 4, shape: 'circle' },
    ]);
    expect(options().series[0].data).toEqual(
      data.map((row) => ({ x: readingTime(row), y: row.quality === 0 ? row.value : null })),
    );
    setRows([{ ...data[0], value: 0 }]);
    expect(fixture.componentInstance['markers']().discrete).toEqual([
      { seriesIndex: 0, dataPointIndex: 0, size: 4, shape: 'circle' },
    ]);
  });

  it('keeps quality gaps, markers, raw timestamps, and unit conversion in the series', () => {
    const data = rows(4);
    const series = qualitySeries(data, { ...tag, tag_key: 'gas_resistance_ohm', unit: 'Ω' });
    expect(series[0].data).toEqual(
      data.map((r, i) => ({ x: readingTime(r), y: i === 0 ? 0 : null })),
    );
    expect(series[1].data[1]).toEqual({ x: readingTime(data[1]), y: 0.001 });
    expect(series[2].data[2]).toEqual({ x: readingTime(data[2]), y: 0.002 });
    expect(series[3].data[3]).toEqual({ x: readingTime(data[3]), y: 0.003 });
    expect(options().stroke.width).toEqual([1.8, 0, 0, 0]);
  });

  it('updates the caption from native zoom and preserves the range across pagination', () => {
    const data = rows(400);
    const range = { min: readingTime(data[50]), max: readingTime(data[99]) };
    const previousOptions = options();
    options().chart.events!.zoomed!(chart().chartInstance()!, { xaxis: range });
    fixture.detectChanges();
    expect(el.querySelector('.window-caption')?.textContent).toContain('50 / 300');
    expect(options()).toBe(previousOptions);
    setRows(data);
    expect(options().xaxis).toMatchObject(range);
    const changedQuery = { ...query, end: '2026-09-28T00:00:00Z' };
    fixture.componentRef.setInput('query', changedQuery);
    fixture.detectChanges();
    expect(options().xaxis).toMatchObject(queryRange(changedQuery));
  });

  it('resets a zoomed chart to the selected range and keeps that range across pagination', () => {
    const zoom = vi.spyOn(chart(), 'zoomX');
    options().chart.events!.zoomed!(chart().chartInstance()!, {
      xaxis: { min: readingTime(rows(300)[50]), max: readingTime(rows(300)[99]) },
    });
    fixture.detectChanges();
    expect(el.querySelector('.window-caption')?.textContent).toContain('50 / 300');
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Reset view')!
      .click();
    fixture.detectChanges();
    expect(zoom).toHaveBeenCalledWith(Date.parse(query.start), Date.parse(query.end));
    setRows(rows(400));
    expect(options().xaxis).toMatchObject({
      min: Date.parse(query.start),
      max: Date.parse(query.end),
    });
    expect(el.querySelector('.window-caption')?.textContent).toContain('400 / 400');
  });

  it('compares mixed units without merging timestamps, units, or quality', () => {
    const humidity = { id: 2, tag_key: 'humidity_percent', name: 'Humidity', unit: '%' };
    const temperature = rows(3).map((row, i) => ({
      ...row,
      value: 20 + i * 5,
      quality: i === 1 ? 1 : 0,
    }));
    const humidRows = rows(2).map((row, i) => ({
      ...row,
      id: row.id + 10,
      tag_id: 2,
      tag_key: humidity.tag_key,
      value: 40 + i * 20,
      observed_at: new Date(readingTime(row) + 50).toISOString(),
    }));
    fixture.componentRef.setInput('tags', [tag, humidity]);
    setRows([...temperature, ...humidRows]);
    expect(options().series).toHaveLength(8);
    expect(options().series[0].name).toBe('Temperature · Good');
    expect(options().series[0].data).toEqual([
      { x: readingTime(temperature[0]), y: 0 },
      { x: readingTime(temperature[1]), y: null },
      { x: readingTime(temperature[2]), y: 100 },
    ]);
    expect(options().series[1].data[1]).toEqual({ x: readingTime(temperature[1]), y: 50 });
    expect(options().series[4].data[0]).toEqual({ x: readingTime(humidRows[0]), y: 0 });
    expect(el.textContent).toContain('Relative range');
    fixture.componentInstance['selectedKey'].set(String(temperature[1].id));
    fixture.detectChanges();
    const inspected = fixture.componentInstance['selectedReadings']();
    expect(inspected[0].row).toEqual(temperature[1]);
    expect(inspected[0].value).toBe('25.0');
    expect(inspected[0].unit).toBe('°C');
    expect(inspected[1].row).toEqual(humidRows[0]);
    expect(inspected[1].unit).toBe('%');
  });

  it('keeps a shared raw scale for matching units and handles constant or missing series', () => {
    const second = { ...tag, id: 2, name: 'Second temperature' };
    fixture.componentRef.setInput('tags', [tag, second]);
    setRows(rows(4));
    expect(el.textContent).not.toContain('Relative range');
    expect(options().series[1].data[1]).toEqual({ x: readingTime(rows(4)[1]), y: 1 });
    expect(options().series[4].data).toEqual([]);
    expect(el.textContent).toContain('no data');
    fixture.componentRef.setInput('tags', [tag, { ...second, unit: '%' }]);
    setRows(rows(4).map((row) => ({ ...row, value: 0 })));
    expect(options().series[0].data[0]).toEqual({ x: readingTime(rows(4)[0]), y: 50 });
  });

  it('uses step lines for statuses, Taipei labels, and a finite range for duplicate timestamps', () => {
    fixture.componentRef.setInput('tags', [{ ...tag, tag_key: 'sensor_status' }]);
    fixture.detectChanges();
    expect(options().stroke.curve).toBe('stepline');
    expect(options().xaxis.labels!.formatter!('', Date.parse(query.start), {} as never)).toBe(
      '08:00:00',
    );
    setRows(rows(200).map((row) => ({ ...row, observed_at: query.start })));
    expect(options().xaxis).toMatchObject(queryRange(query));
  });

  function prepareInspection(): void {
    fixture.componentRef.setInput('query', {
      ...query,
      end: new Date(Date.parse(query.start) + 1000).toISOString(),
    });
    setRows(rows(4));
    const grid = document.createElement('div');
    grid.className = 'apexcharts-grid';
    grid.getBoundingClientRect = () => new DOMRect(100, 100, 400, 200);
    el.querySelector('.chart-canvas')!.append(grid);
  }

  function pointer(type: string, x: number, overrides: PointerEventInit = {}): PointerEvent {
    return new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: x,
      clientY: 200,
      ...overrides,
    });
  }

  it('keeps tapped details below the plot and delegates the highlight to Apex', () => {
    prepareInspection();
    const annotation = vi.spyOn(chart(), 'addPointAnnotation');
    const instance = fixture.componentInstance;
    instance['beginPointer'](pointer('pointerdown', 260));
    instance['endPointer'](pointer('pointerup', 260));
    fixture.detectChanges();
    expect(instance['selected']()).toMatchObject({ id: 3 });
    options().chart.events!.scrolled!(chart().chartInstance()!, {
      xaxis: instance['range'](),
    });
    expect(instance['selected']()).toMatchObject({ id: 3 });
    expect(el.querySelector('.inspection-panel')?.textContent).toContain('Data: Bad');
    expect(el.querySelector('.chart-canvas .inspection-panel')).toBeNull();
    expect(el.querySelector('.reading-tooltip')).toBeNull();
    expect(annotation).toHaveBeenCalledWith(
      expect.objectContaining({
        x: readingTime(rows(4)[2]),
        y: 2,
      }),
      false,
    );
    el.querySelector('.chart-canvas')!.dispatchEvent(new PointerEvent('pointerleave'));
    expect(instance['selected']()).toMatchObject({ id: 3 });
    el.querySelector<HTMLButtonElement>('[aria-label="Clear selected reading"]')!.click();
    fixture.detectChanges();
    expect(instance['selected']()).toBeNull();
  });

  it('does not treat a drag, a multi-touch gesture, or a cancelled touch as a tap', () => {
    prepareInspection();
    const instance = fixture.componentInstance;
    instance['beginPointer'](pointer('pointerdown', 140));
    instance['movePointer'](pointer('pointermove', 260));
    instance['endPointer'](pointer('pointerup', 260));
    expect(instance['selected']()).toBeNull();
    instance['beginPointer'](pointer('pointerdown', 140));
    instance['beginPointer'](pointer('pointerdown', 260, { pointerId: 2, isPrimary: false }));
    instance['endPointer'](pointer('pointerup', 140));
    expect(instance['selected']()).toBeNull();
    instance['beginPointer'](pointer('pointerdown', 140));
    instance['cancelPointer']();
    instance['endPointer'](pointer('pointerup', 140));
    expect(instance['selected']()).toBeNull();
  });

  it('selects by horizontal time on hover and leaves zoom and pan shortcuts native', () => {
    prepareInspection();
    const instance = fixture.componentInstance;
    instance['movePointer'](pointer('pointermove', 260, { pointerType: 'mouse', clientY: 110 }));
    expect(instance['selected']()).toMatchObject({ id: 3 });
    instance['movePointer'](pointer('pointermove', 260, { pointerType: 'mouse', clientY: 290 }));
    expect(instance['selected']()).toMatchObject({ id: 3 });
    instance['clearSelection']();
    const next = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    instance['inspectKey'](next);
    expect(next.defaultPrevented).toBe(true);
    expect(instance['selected']()).toMatchObject({ id: 1 });
    instance['inspectKey'](new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(instance['selected']()).toMatchObject({ id: 2 });
    const pan = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      shiftKey: true,
      cancelable: true,
    });
    instance['inspectKey'](pan);
    expect(pan.defaultPrevented).toBe(false);
    expect(instance['selected']()).toMatchObject({ id: 2 });
    instance['inspectKey'](new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(instance['selected']()).toBeNull();
  });

  it('inspects aggregate intervals without borrowing a reading across an empty interval', () => {
    prepareInspection();
    const bucket = (from: number, to: number): HistoryBucket => ({
      tag_id: 1,
      tag_key: 'temperature_c',
      bucket_start: new Date(Date.parse(query.start) + from).toISOString(),
      bucket_end: new Date(Date.parse(query.start) + to).toISOString(),
      coverage_start: new Date(Date.parse(query.start) + from).toISOString(),
      coverage_end: new Date(Date.parse(query.start) + to).toISOString(),
      partial: false,
      method: 'average',
      value: 25,
      minimum: 24,
      maximum: 26,
      sample_count: 2,
      good_count: 2,
      uncertain_count: 0,
      bad_count: 0,
      unknown_count: 0,
      usable_count: 2,
      last_observed_at: new Date(Date.parse(query.start) + to - 1).toISOString(),
      last_quality: 0,
    });
    fixture.componentRef.setInput('query', {
      ...query,
      aggregation: '5min',
      end: new Date(Date.parse(query.start) + 1000).toISOString(),
    });
    fixture.componentRef.setInput('readings', [bucket(0, 300), bucket(600, 1000)]);
    fixture.detectChanges();
    const instance = fixture.componentInstance;
    instance['beginPointer'](pointer('pointerdown', 180));
    instance['endPointer'](pointer('pointerup', 180));
    fixture.detectChanges();
    expect(instance['selected']()).toMatchObject({ coverage_start: bucket(0, 300).coverage_start });
    expect(el.querySelector('.inspection-panel')?.textContent).toContain('Average');
    instance['beginPointer'](pointer('pointerdown', 280));
    instance['endPointer'](pointer('pointerup', 280));
    expect(instance['selected']()).toBeNull();
  });
});

describe('nearest timestamp inspection', () => {
  it('selects by irregular timestamps including non-good quality and zero values', () => {
    const data = rows(4); // 0, 100, 400, 900 ms; all four quality states.
    const start = Date.parse(query.start);
    const range = { min: start, max: start + 900 };
    expect(nearestReadingIndex(data, start, range)).toBe(0);
    expect(nearestReadingIndex(data, start + 120, range)).toBe(1);
    expect(nearestReadingIndex(data, start + 380, range)).toBe(2);
    expect(nearestReadingIndex(data, start + 880, range)).toBe(3);
  });
  it('does not inspect observations outside the zoomed window or invent data in empty windows', () => {
    const data = rows(4);
    const start = Date.parse(query.start);
    expect(nearestReadingIndex(data, start + 240, { min: start + 200, max: start + 800 })).toBe(2);
    expect(nearestReadingIndex(data, start + 240, { min: start + 200, max: start + 300 })).toBe(-1);
    expect(nearestReadingIndex([], start, { min: start, max: start + 900 })).toBe(-1);
  });
});

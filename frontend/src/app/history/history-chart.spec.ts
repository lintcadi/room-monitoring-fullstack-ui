import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChartComponent } from 'ng-apexcharts';
import { HistoryChart } from './history-chart';
import { TelemetryReading } from '../telemetry/telemetry.models';
import { initialRange, qualitySeries, readingTime, nearestReadingIndex } from './history-apex';

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

  it('passes the first 100 readings as the initial datetime viewport and enables native navigation', () => {
    expect(options().xaxis.min).toBe(readingTime(rows(300)[0]));
    expect(options().xaxis.max).toBe(readingTime(rows(300)[99]));
    expect(options().chart.toolbar?.autoSelected).toBe('pan');
    expect(options().chart.zoom?.enabled).toBe(true);
    expect(el.querySelector('.window-caption')?.textContent).toContain('100 / 300');
    setRows(rows(100));
    expect(options().chart.zoom?.enabled).toBe(false);
    expect(options().chart.toolbar?.show).toBe(false);
    expect(el.querySelector('.chart-navigation')).toBeNull();
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
    fixture.componentRef.setInput('query', { ...query, end: '2026-09-28T00:00:00Z' });
    fixture.detectChanges();
    expect(options().xaxis).toMatchObject(initialRange(data, query));
  });

  it('uses the Apex API for Fit all and reset, including appended data', () => {
    const zoom = vi.spyOn(chart(), 'zoomX');
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Fit all')!
      .click();
    fixture.detectChanges();
    expect(zoom).toHaveBeenCalledWith(Date.parse(query.start), Date.parse(query.end));
    setRows(rows(400));
    expect(options().xaxis).toMatchObject({
      min: Date.parse(query.start),
      max: Date.parse(query.end),
    });
    expect(el.querySelector('.window-caption')?.textContent).toContain('400 / 400');
    el.querySelector<HTMLButtonElement>('[aria-label="Reset zoom to 100 readings"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.window-caption')?.textContent).toContain('100 / 400');
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
    fixture.componentInstance['hover'].set({
      row: temperature[1],
      x: 100,
      y: 100,
      left: 0,
      top: 0,
      width: 300,
      height: 200,
    });
    fixture.detectChanges();
    const inspected = fixture.componentInstance['hoverReadings']();
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
    const range = initialRange(
      rows(200).map((row) => ({ ...row, observed_at: query.start })),
      query,
    );
    expect(range.max - range.min).toBe(1);
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

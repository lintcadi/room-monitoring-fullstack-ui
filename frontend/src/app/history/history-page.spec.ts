import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { HarnessLoader } from '@angular/cdk/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatButtonToggleHarness } from '@angular/material/button-toggle/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { HistoryPage } from './history-page';
import { HistoryService } from './history.service';
import { HistoryRange } from './history-range';

// Rendering and gestures are covered by browser checks; these tests exercise filters.
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

const now = Date.parse('2026-09-26T04:00:00Z');

describe('History filter application', () => {
  let fixture: ComponentFixture<HistoryPage>;
  let loader: HarnessLoader;
  let http: HttpTestingController;
  let history: HistoryService;
  const request = () => http.expectOne((r) => r.url === '/api/telemetry/history');
  const button = (text: string) => loader.getHarness(MatButtonHarness.with({ text }));
  const selectTag = async (text: string) => {
    const select = await loader.getHarness(MatSelectHarness);
    await select.clickOptions({ text });
    await select.close();
  };
  const selectPreset = async (text: string) =>
    (await loader.getHarness(MatButtonToggleHarness.with({ text }))).check();

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(HistoryPage);
    history = fixture.debugElement.injector.get(HistoryService);
    http = TestBed.inject(HttpTestingController);
    loader = TestbedHarnessEnvironment.loader(fixture);
    fixture.detectChanges();
    http.expectOne('/api/telemetry/tags').flush([
      { id: 1, tag_key: 'temperature_c', name: 'Temperature', unit: '°C' },
      { id: 2, tag_key: 'humidity_percent', name: 'Humidity', unit: '%' },
    ]);
    request().flush({
      readings: [
        {
          id: 1,
          tag_id: 1,
          tag_key: 'temperature_c',
          value: 25,
          quality: 0,
          observed_at: '2026-09-26T03:30:00Z',
          ingested_at: '2026-09-26T03:30:01Z',
        },
      ],
      next_cursor: 'page-2',
    });
    await fixture.whenStable();
  });
  afterEach(() => {
    http.verify();
    fixture.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stages selections, keeps the displayed query for paging, and submits all filters together', async () => {
    const applied = history.query();
    await selectTag('Humidity · %');
    await selectPreset('6h');
    http.expectNone((r) => r.url === '/api/telemetry/history');
    expect(history.query()).toEqual(applied);
    expect(history.readings()).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('#chart-title').textContent).toContain(
      'Temperature',
    );
    expect(fixture.nativeElement.textContent).toContain('Unapplied changes');
    await (await button('Load more')).click();
    const next = request();
    expect(next.request.params.get('tag_ids')).toBe('1');
    expect(next.request.params.get('start')).toBe(applied!.start);
    expect(next.request.params.get('end')).toBe(applied!.end);
    expect(next.request.params.get('cursor')).toBe('page-2');
    next.flush({ readings: [], next_cursor: null });
    vi.spyOn(Date, 'now').mockReturnValue(now + 60000);
    await (await button('Apply')).click();
    const updated = request();
    expect(updated.request.params.getAll('tag_ids')).toEqual(['1', '2']);
    expect(updated.request.params.get('end')).toBe(new Date(now + 60000).toISOString());
    expect(
      Date.parse(updated.request.params.get('end')!) -
        Date.parse(updated.request.params.get('start')!),
    ).toBe(6 * 3600000);
    expect(updated.request.params.has('cursor')).toBe(false);
    updated.flush({ readings: [], next_cursor: null });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Unapplied changes');
  });

  it('refreshes only the applied filters without discarding pending selections', async () => {
    await selectTag('Humidity · %');
    await selectPreset('24h');
    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Refresh history"]' }))
    ).click();
    const refresh = request();
    expect(refresh.request.params.get('tag_ids')).toBe('1');
    expect(
      Date.parse(refresh.request.params.get('end')!) -
        Date.parse(refresh.request.params.get('start')!),
    ).toBe(3600000);
    refresh.flush({ readings: [], next_cursor: null });
    expect(await (await loader.getHarness(MatSelectHarness)).getValueText()).toBe('2 measurements');
    expect(
      await (await loader.getHarness(MatButtonToggleHarness.with({ text: '24h' }))).isChecked(),
    ).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Unapplied changes');
  });

  it('stages and reopens custom dates, leaves them intact on cancel, and applies them explicitly', async () => {
    const range = { start: '2026-09-20T08:00+08:00', end: '2026-09-20T09:00+08:00' };
    const dialog = TestBed.inject(MatDialog);
    const ref = {
      afterClosed: () => of(range),
      close: vi.fn(),
    } as unknown as MatDialogRef<HistoryRange>;
    const open = vi.spyOn(dialog, 'open').mockReturnValue(ref);
    await (await button('Custom')).click();
    http.expectNone((r) => r.url === '/api/telemetry/history');
    expect(history.query()!.start).not.toBe(range.start);
    open.mockReturnValue({
      afterClosed: () => of(undefined),
      close: vi.fn(),
    } as unknown as MatDialogRef<HistoryRange>);
    await (await button('Custom')).click();
    expect(open.mock.calls[1][1]?.data).toMatchObject(range);
    await (await button('Apply')).click();
    const applied = request();
    expect(applied.request.params.get('start')).toBe(range.start);
    expect(applied.request.params.get('end')).toBe(range.end);
    applied.flush({ readings: [], next_cursor: null });
    await selectPreset('6h');
    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Refresh history"]' }))
    ).click();
    const refresh = request();
    expect(refresh.request.params.get('start')).toBe(range.start);
    expect(refresh.request.params.get('end')).toBe(range.end);
    refresh.flush({ readings: [], next_cursor: null });
  });

  it('clears the pending indicator when the user restores the applied selections', async () => {
    await selectTag('Humidity · %');
    await selectPreset('6h');
    await selectTag('Humidity · %');
    await selectPreset('1h');
    http.expectNone((r) => r.url === '/api/telemetry/history');
    expect(fixture.nativeElement.textContent).not.toContain('Unapplied changes');
  });

  it('requires at least one measurement and keeps the applied chart when all choices are cleared', async () => {
    await selectTag('Temperature · °C');
    expect(await (await button('Apply')).isDisabled()).toBe(true);
    expect(history.query()?.tagIds).toEqual([1]);
    http.expectNone((r) => r.url === '/api/telemetry/history');
    await selectTag('Humidity · %');
    expect(await (await button('Apply')).isDisabled()).toBe(false);
    await (await button('Apply')).click();
    const updated = request();
    expect(updated.request.params.getAll('tag_ids')).toEqual(['2']);
    updated.flush({ readings: [], next_cursor: null });
  });

  it('shows each measurement and its own units in the combined readings table', async () => {
    await selectTag('Humidity · %');
    await (await button('Apply')).click();
    request().flush({
      readings: [
        {
          id: 1,
          tag_id: 1,
          tag_key: 'temperature_c',
          value: 25,
          quality: 0,
          observed_at: '2026-09-26T03:30:00Z',
          ingested_at: '2026-09-26T03:30:01Z',
        },
        {
          id: 2,
          tag_id: 2,
          tag_key: 'humidity_percent',
          value: 60,
          quality: 1,
          observed_at: '2026-09-26T03:31:00Z',
          ingested_at: '2026-09-26T03:31:01Z',
        },
      ],
      next_cursor: null,
    });
    await (await loader.getHarness(MatButtonToggleHarness.with({ text: 'Readings' }))).check();
    const table = fixture.nativeElement.querySelector('app-history-table').textContent;
    expect(table).toContain('Temperature');
    expect(table).toContain('Humidity');
    expect(table).toContain('25.0');
    expect(table).toContain('°C');
    expect(table).toContain('60.0');
    expect(table).toContain('%');
    expect(table).toContain('Uncertain');
    expect(fixture.nativeElement.querySelector('.summary-grid').textContent).not.toContain(
      'MINIMUM',
    );
  });
});

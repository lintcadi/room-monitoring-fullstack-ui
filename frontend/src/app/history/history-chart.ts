import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  ChartComponent,
  ApexChart,
  ApexXAxis,
  ApexYAxis,
  ApexStroke,
  ApexTooltip,
  ApexMarkers,
} from 'ng-apexcharts';
import { TelemetryReading, TelemetryTag } from '../telemetry/telemetry.models';
import {
  displayUnit,
  displayValue,
  observedTime,
  qualityLabel,
  qualityTone,
} from '../telemetry/telemetry.presentation';
import { HistoryQuery, STATUS_KEYS, plotValue } from './history.models';
import {
  ChartRange,
  initialRange,
  qualitySeries,
  queryRange,
  readingTime,
  nearestReadingIndex,
  MEASUREMENT_COLORS,
  measurementScale,
} from './history-apex';

@Component({
  selector: 'app-history-chart',
  imports: [MatButtonModule, ChartComponent],
  templateUrl: './history-chart.html',
  styleUrl: './history-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryChart {
  readonly readings = input.required<TelemetryReading[]>();
  readonly tags = input.required<TelemetryTag[]>();
  protected readonly multiple = computed(() => this.tags().length > 1);
  protected readonly relative = computed(
    () =>
      this.multiple() &&
      new Set(
        this.tags().map((tag) =>
          STATUS_KEYS.includes(tag.tag_key)
            ? tag.tag_key
            : displayUnit({ ...tag, reading: undefined }) || tag.tag_key,
        ),
      ).size > 1,
  );
  private readonly tagMap = computed(() => new Map(this.tags().map((tag) => [tag.id, tag])));
  protected readonly measurements = computed(() =>
    this.tags().map((tag, index) => {
      const rows = this.ordered().filter((row) => row.tag_id === tag.id);
      return {
        tag,
        rows,
        color: MEASUREMENT_COLORS[index % MEASUREMENT_COLORS.length],
        scale: measurementScale(rows, tag),
      };
    }),
  );
  readonly query = input.required<HistoryQuery>();
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvas = viewChild.required<ElementRef<HTMLDivElement>>('canvas');
  private readonly chart = viewChild(ChartComponent);
  private readonly size = signal({ width: 900, height: 300 });
  private readonly viewport = signal<ChartRange | null>(null);
  private fit = false;
  protected readonly hover = signal<{
    row: TelemetryReading;
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  protected readonly hoverValue = computed(() =>
    displayValue({
      ...this.tagMap().get(this.hover()?.row.tag_id ?? this.tags()[0].id)!,
      reading: this.hover()?.row,
    }),
  );
  protected readonly hoverUnit = computed(() =>
    displayUnit({
      ...this.tagMap().get(this.hover()?.row.tag_id ?? this.tags()[0].id)!,
      reading: this.hover()?.row,
    }),
  );
  protected readonly hoverReadings = computed(() => {
    const focus = this.hover();
    if (!focus) return [];
    const time = readingTime(focus.row);
    return this.measurements().map(({ tag, rows, color }) => {
      const index = nearestReadingIndex(rows, time, this.range());
      const row = index < 0 ? undefined : rows[index];
      return {
        tag,
        row,
        color,
        value: displayValue({ ...tag, reading: row }),
        unit: displayUnit({ ...tag, reading: row }),
      };
    });
  });
  protected readonly observedTime = observedTime;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly ordered = computed(() =>
    [...this.readings()].sort((a, b) => readingTime(a) - readingTime(b) || a.id - b.id),
  );
  protected readonly navigable = computed(() => this.ordered().length > 100);
  protected readonly range = computed(
    () => this.viewport() ?? initialRange(this.ordered(), this.query()),
  );
  protected readonly visible = computed(() =>
    this.ordered().filter(
      (row) => readingTime(row) >= this.range().min && readingTime(row) <= this.range().max,
    ),
  );
  protected readonly zoomLabel = computed(() =>
    this.visible().length ? Math.round(10000 / this.visible().length) + '%' : 'No readings',
  );
  protected readonly hasUnknownQuality = computed(() =>
    this.ordered().some((row) => ![0, 1, 2].includes(row.quality)),
  );
  protected readonly colors = computed(() =>
    this.multiple()
      ? this.measurements().flatMap(({ color }) => [color, color, color, color])
      : ['#267653', '#92712f', '#a74c3d', '#69776e'],
  );
  protected readonly dataLabels = { enabled: false };
  protected readonly legend = { show: false };
  protected readonly grid = {
    borderColor: '#e1e6dc',
    strokeDashArray: 4,
    padding: { left: 0, right: 12, top: 0, bottom: 0 },
  };
  protected readonly markers = computed<ApexMarkers>(() => ({
    size: this.tags().flatMap(() => [5, 6, 6, 6]),
    shape: this.tags().flatMap(() => ['circle', 'diamond', 'cross', 'square'] as const),
    strokeWidth: 1,
    hover: { sizeOffset: 3 },
    showNullDataPoints: false,
  }));
  private recordRange(range: ChartRange): void {
    this.viewport.set(range);
    this.hover.set(null);
    this.fit = false;
  }
  // Rebuild only for new data, query or layout. Native zoom/pan changes the caption,
  // not these inputs, so Angular doesn't recreate the chart during an interaction.
  protected readonly options = computed(() => {
    const rows = this.ordered();
    const tags = this.tags();
    const relative = this.relative();
    const query = this.query();
    const size = this.size();
    const bounds = queryRange(query);
    const range = untracked(() =>
      this.fit ? bounds : (this.viewport() ?? initialRange(rows, query)),
    );
    const chart: ApexChart = {
      type: 'line',
      height: size.height,
      width: '100%',
      parentHeightOffset: 0,
      fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
      foreColor: '#69776e',
      animations: { enabled: false },
      redrawOnParentResize: false,
      redrawOnWindowResize: false,
      toolbar: {
        show: rows.length > 100,
        autoSelected: 'pan',
        tools: {
          download: false,
          selection: false,
          zoom: true,
          zoomin: true,
          zoomout: true,
          pan: true,
          reset: false,
        },
      },
      zoom: {
        enabled: rows.length > 100,
        type: 'x',
        allowMouseWheelZoom: true,
        pinch: true,
        resetControl: false,
      },
      events: {
        mouseMove: (event) => this.inspect(event),
        zoomed: (_ctx, options) => {
          if (options) this.recordRange(options.xaxis);
        },
        scrolled: (_ctx, options) => {
          if (options) this.recordRange(options.xaxis);
        },
      },
      accessibility: {
        enabled: true,
        description: `${tags.map((tag) => tag.name).join(', ')} by observation time. Data quality is shown separately.`,
        keyboard: { enabled: true },
      },
    };
    const xaxis: ApexXAxis = {
      type: 'datetime',
      min: range.min,
      max: range.max,
      labels: {
        datetimeUTC: false,
        hideOverlappingLabels: true,
        style: { fontSize: '10px' },
        formatter: (_value, timestamp) =>
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Taipei',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            ...(this.range().max - this.range().min > 86400000
              ? ({ month: 'short', day: '2-digit' } as const)
              : {}),
          }).format(timestamp),
      },
      tooltip: { enabled: false },
      crosshairs: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    };
    // One shared scale includes every quality series. Keep it stable while panning.
    const values = rows.map((row) => plotValue(this.tagMap().get(row.tag_id)!, row.value));
    const min = Math.min(...values),
      max = Math.max(...values);
    const padding = min === max ? Math.max(1, Math.abs(min) * 0.01) : (max - min) * 0.08;
    const yaxis: ApexYAxis = {
      min: relative ? 0 : Number.isFinite(min) ? min - padding : 0,
      max: relative ? 100 : Number.isFinite(max) ? max + padding : 1,
      tickAmount: size.height < 180 ? 2 : 4,
      forceNiceScale: false,
      labels: {
        minWidth: 30,
        maxWidth: 52,
        style: { fontSize: '10px' },
        formatter: (value) =>
          new Intl.NumberFormat('en-US', {
            maximumFractionDigits: 2,
            notation: Math.abs(value) >= 100000 ? 'compact' : 'standard',
          }).format(value) + (relative ? '%' : ''),
      },
    };
    const stroke: ApexStroke = {
      width: tags.flatMap(() => [1.8, 0, 0, 0]),
      curve:
        tags.length === 1
          ? STATUS_KEYS.includes(tags[0].tag_key)
            ? 'stepline'
            : 'straight'
          : tags.flatMap((tag) =>
              Array(4).fill(STATUS_KEYS.includes(tag.tag_key) ? 'stepline' : 'straight'),
            ),
    };
    // App tooltip selects by time only; Apex's sparse quality-series hit testing
    // can choose a different timestamp depending on the pointer's vertical position.
    const tooltip: ApexTooltip = { enabled: false };
    const series = this.measurements().flatMap(({ tag, rows, scale }) =>
      qualitySeries(rows, tag, relative ? scale.normalize : undefined).map((series) => ({
        ...series,
        name: this.multiple() ? `${tag.name} · ${series.name}` : series.name,
      })),
    );
    return { chart, series, xaxis, yaxis, stroke, tooltip };
  });

  constructor() {
    effect(() => {
      this.query();
      this.viewport.set(null);
      this.hover.set(null);
      this.fit = false;
    });
    afterNextRender(() => {
      const observer = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        const next = { width: Math.floor(width), height: Math.floor(height) };
        if (
          width > 0 &&
          height > 0 &&
          (next.width !== this.size().width || next.height !== this.size().height)
        ) {
          this.hover.set(null);
          this.size.set(next);
        }
      });
      observer.observe(this.canvas().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected inspect(event: MouseEvent): void {
    const canvas = this.canvas().nativeElement;
    const grid = canvas.querySelector('.apexcharts-grid')?.getBoundingClientRect();
    if (
      !grid ||
      !grid.width ||
      !grid.height ||
      event.buttons ||
      event.clientX < grid.left ||
      event.clientX > grid.right ||
      event.clientY < grid.top ||
      event.clientY > grid.bottom
    ) {
      this.hover.set(null);
      return;
    }
    const range = this.range();
    const time = range.min + ((event.clientX - grid.left) / grid.width) * (range.max - range.min);
    const rows = this.ordered();
    const index = nearestReadingIndex(rows, time, range);
    const row = rows[index];
    if (!row) {
      this.hover.set(null);
      return;
    }
    this.focusReading(row, grid);
  }

  private focusReading(row: TelemetryReading, grid: DOMRect): void {
    const range = this.range();
    const box = this.canvas().nativeElement.getBoundingClientRect();
    const axis = this.options().yaxis;
    const min = axis.min as number,
      max = axis.max as number;
    const measurement = this.measurements().find(({ tag }) => tag.id === row.tag_id)!;
    const value = plotValue(measurement.tag, row.value);
    const plotted = this.relative() ? measurement.scale.normalize(value) : value;
    this.hover.set({
      row,
      x:
        grid.left -
        box.left +
        ((readingTime(row) - range.min) / (range.max - range.min)) * grid.width,
      y: grid.top - box.top + (1 - (plotted - min) / (max - min)) * grid.height,
      left: grid.left - box.left,
      top: grid.top - box.top,
      width: grid.width,
      height: grid.height,
    });
  }

  protected inspectKey(event: KeyboardEvent): void {
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      this.hover.set(null);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const rows = this.visible();
    const grid = this.canvas()
      .nativeElement.querySelector('.apexcharts-grid')
      ?.getBoundingClientRect();
    if (!rows.length || !grid?.width) return;
    event.preventDefault();
    const current = rows.findIndex((row) => row.id === this.hover()?.row.id);
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : Math.max(
              0,
              Math.min(
                rows.length - 1,
                (current < 0 ? 0 : current) + (event.key === 'ArrowRight' ? 1 : -1),
              ),
            );
    this.focusReading(rows[index], grid);
  }

  protected ready(): void {
    // Also refresh the visible count after Fit all expands to include another page.
    if (this.fit) this.viewport.set(queryRange(this.query()));
  }
  protected resetZoom(): void {
    this.hover.set(null);
    const range = initialRange(this.ordered(), this.query());
    this.recordRange(range);
    this.chart()?.zoomX(range.min, range.max);
  }
  protected fitAll(): void {
    this.hover.set(null);
    const range = queryRange(this.query());
    this.chart()?.zoomX(range.min, range.max);
    this.viewport.set(range);
    this.fit = true;
  }
}

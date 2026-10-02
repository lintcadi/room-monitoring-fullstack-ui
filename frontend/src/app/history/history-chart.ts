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
import { TelemetryTag } from '../telemetry/telemetry.models';
import { displayUnit, formatValue } from '../telemetry/telemetry.presentation';
import {
  HistoryQuery,
  HistoryRow,
  rowKey,
  rowQuality,
  STATUS_KEYS,
  plotValue,
} from './history.models';
import {
  ChartRange,
  qualitySeries,
  queryRange,
  readingTime,
  nearestReadingIndex,
  MEASUREMENT_COLORS,
  measurementScale,
  bucketAtTime,
} from './history-apex';

import { HistoryObservation } from './history-observation';

@Component({
  selector: 'app-history-chart',
  imports: [MatButtonModule, ChartComponent, HistoryObservation],
  templateUrl: './history-chart.html',
  styleUrl: './history-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryChart {
  readonly readings = input.required<HistoryRow[]>();
  readonly tags = input.required<TelemetryTag[]>();
  protected readonly aggregated = computed(() => (this.query().aggregation ?? 'raw') !== 'raw');
  protected readonly multiple = computed(() => this.tags().length > 1);
  protected readonly relative = computed(
    () =>
      this.multiple() &&
      new Set(
        this.tags().map((tag) =>
          STATUS_KEYS.includes(tag.tag_key) ? tag.tag_key : displayUnit(tag) || tag.tag_key,
        ),
      ).size > 1,
  );
  protected readonly tagMap = computed(() => new Map(this.tags().map((tag) => [tag.id, tag])));
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
  protected readonly showLegend = signal(false);
  private readonly selectedKey = signal<string | null>(null);
  protected readonly selected = computed(
    () => this.ordered().find((row) => rowKey(row) === this.selectedKey()) ?? null,
  );
  private tapStart: { id: number; x: number; y: number } | null = null;
  protected readonly selectedReadings = computed(() => {
    const focus = this.selected();
    if (!focus) return [];
    const time = readingTime(focus);
    return this.measurements().map(({ tag, rows, color }) => {
      const index = nearestReadingIndex(rows, time, this.range());
      const row = this.aggregated()
        ? bucketAtTime(rows, time)
        : index < 0
          ? undefined
          : rows[index];
      return { tag, row, color, value: formatValue(tag, row?.value), unit: displayUnit(tag) };
    });
  });
  protected readonly ordered = computed(() =>
    [...this.readings()].sort(
      (a, b) =>
        readingTime(a) - readingTime(b) ||
        rowKey(a).localeCompare(rowKey(b), undefined, { numeric: true }),
    ),
  );
  protected readonly navigable = computed(() => this.ordered().length > 1);
  protected readonly range = computed(() => this.viewport() ?? queryRange(this.query()));
  protected readonly visible = computed(() =>
    this.ordered().filter(
      (row) => readingTime(row) >= this.range().min && readingTime(row) <= this.range().max,
    ),
  );
  protected readonly hasUnknownQuality = computed(() =>
    this.ordered().some((row) => row.value !== null && ![0, 1, 2].includes(rowQuality(row))),
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
    size: this.tags().flatMap(() => [0, 5, 5, 5]),
    shape: this.tags().flatMap(() => ['circle', 'diamond', 'cross', 'square'] as const),
    strokeWidth: 1,
    hover: { sizeOffset: 3 },
    showNullDataPoints: false,
    // A good observation with no line segment would otherwise disappear.
    discrete: this.options().series.flatMap((series, seriesIndex) => {
      if (seriesIndex % 4 !== 0) return [];
      const points = series.data as { x: number; y: number | null }[];
      return points.flatMap((point, dataPointIndex) =>
        point.y !== null &&
        points[dataPointIndex - 1]?.y == null &&
        points[dataPointIndex + 1]?.y == null
          ? [{ seriesIndex, dataPointIndex, size: 4, shape: 'circle' as const }]
          : [],
      );
    }),
  }));
  private recordRange(range: ChartRange): void {
    // Apex emits a scroll event even for a stationary touch release.
    // Keep the tapped reading unless the visible time range actually changed.
    const current = this.range();
    if (range.min === current.min && range.max === current.max) return;
    this.viewport.set(range);
    this.selectedKey.set(null);
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
    const range = untracked(() => this.viewport() ?? bounds);
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
        show: rows.length > 1,
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
        enabled: rows.length > 1,
        type: 'x',
        allowMouseWheelZoom: true,
        pinch: true,
        resetControl: false,
      },
      events: {
        updated: () => this.renderSelection(),
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
    const values = rows.flatMap((row) =>
      row.value === null ? [] : [plotValue(this.tagMap().get(row.tag_id)!, row.value)],
    );
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
    // Details live below the plot. Time-based selection preserves irregular
    // timestamps and bucket gaps instead of relying on quality-series hit testing.
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
      this.selectedKey.set(null);
    });
    effect(() => {
      this.selected();
      untracked(() => this.renderSelection());
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
          this.size.set(next);
        }
      });
      const canvas = this.canvas().nativeElement;
      observer.observe(canvas);
      // Handle reading selection before Apex's SVG handler; its zoom/pan keys
      // remain native. This avoids navigating twice through the quality series.
      const keydown = (event: KeyboardEvent) => this.inspectKey(event);
      canvas.addEventListener('keydown', keydown, true);
      this.destroyRef.onDestroy(() => {
        observer.disconnect();
        canvas.removeEventListener('keydown', keydown, true);
      });
    });
  }

  protected beginPointer(event: PointerEvent): void {
    this.tapStart = event.isPrimary
      ? { id: event.pointerId, x: event.clientX, y: event.clientY }
      : null;
  }

  protected movePointer(event: PointerEvent): void {
    if (
      this.tapStart &&
      Math.hypot(event.clientX - this.tapStart.x, event.clientY - this.tapStart.y) > 8
    ) {
      this.tapStart = null;
    }
    if (event.pointerType === 'mouse' && !event.buttons) this.inspect(event);
  }

  protected endPointer(event: PointerEvent): void {
    if (this.tapStart?.id === event.pointerId) this.inspect(event);
    this.tapStart = null;
  }

  protected cancelPointer(): void {
    this.tapStart = null;
  }

  private inspect(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (target?.closest('.apexcharts-toolbar')) return;
    const grid = this.canvas()
      .nativeElement.querySelector('.apexcharts-grid')
      ?.getBoundingClientRect();
    if (
      !grid?.width ||
      !grid.height ||
      event.clientX < grid.left ||
      event.clientX > grid.right ||
      event.clientY < grid.top ||
      event.clientY > grid.bottom
    )
      return;
    const range = this.range();
    const time = range.min + ((event.clientX - grid.left) / grid.width) * (range.max - range.min);
    const rows = this.ordered();
    const row = this.aggregated()
      ? bucketAtTime(rows, time)
      : rows[nearestReadingIndex(rows, time, range)];
    this.selectedKey.set(row ? rowKey(row) : null);
  }

  protected clearSelection(): void {
    this.selectedKey.set(null);
  }

  protected renderSelection(): void {
    const chart = this.chart();
    chart?.removeAnnotation('history-selection-time');
    chart?.removeAnnotation('history-selection-point');
    const row = this.selected();
    if (!row || !chart) return;
    const x = readingTime(row);
    if (x < this.range().min || x > this.range().max) return;
    chart.addXaxisAnnotation(
      { id: 'history-selection-time', x, borderColor: '#69776e', strokeDashArray: 4 },
      false,
    );
    if (row.value === null) return;
    const measurement = this.measurements().find(({ tag }) => tag.id === row.tag_id)!;
    const value = plotValue(measurement.tag, row.value);
    chart.addPointAnnotation(
      {
        id: 'history-selection-point',
        x,
        y: this.relative() ? measurement.scale.normalize(value) : value,
        marker: { size: 4, fillColor: measurement.color, strokeColor: '#fff', strokeWidth: 2 },
      },
      false,
    );
  }

  protected inspectKey(event: KeyboardEvent): void {
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.selectedKey.set(null);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const rows = this.visible();
    if (!rows.length) return;
    event.preventDefault();
    event.stopPropagation();
    const current = rows.findIndex((row) => rowKey(row) === this.selectedKey());
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : Math.max(
              0,
              Math.min(
                rows.length - 1,
                current < 0 ? 0 : current + (event.key === 'ArrowRight' ? 1 : -1),
              ),
            );
    this.selectedKey.set(rowKey(rows[index]));
  }

  protected resetView(): void {
    this.clearSelection();
    const range = queryRange(this.query());
    this.recordRange(range);
    this.chart()?.zoomX(range.min, range.max);
  }
}

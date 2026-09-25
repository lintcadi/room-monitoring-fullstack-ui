import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TelemetryReading, TelemetryTag } from '../telemetry/telemetry.models';
import {
  displayUnit,
  displayValue,
  observedTime,
  qualityLabel,
  qualityTone,
} from '../telemetry/telemetry.presentation';
import { HistoryQuery } from './history.models';
import { buildPlot } from './history-plot';

@Component({
  selector: 'app-history-chart',
  templateUrl: './history-chart.html',
  styleUrl: './history-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryChart {
  readonly readings = input.required<TelemetryReading[]>();
  readonly tag = input.required<TelemetryTag>();
  readonly query = input.required<HistoryQuery>();
  private readonly destroyRef = inject(DestroyRef);
  protected readonly canvas = viewChild.required<ElementRef<HTMLDivElement>>('canvas');
  protected readonly size = signal({ width: 900, height: 300 });
  protected readonly plot = computed(() =>
    buildPlot(this.readings(), this.tag(), this.query(), this.size().width, this.size().height),
  );
  protected readonly activeIndex = signal<number | null>(null);
  protected readonly active = computed(
    () =>
      this.plot().points[
        Math.min(this.activeIndex() ?? this.readings().length - 1, this.readings().length - 1)
      ],
  );
  protected readonly activeValue = computed(() =>
    displayValue({ ...this.tag(), reading: this.active()?.row }),
  );
  protected readonly unit = computed(() => displayUnit({ ...this.tag(), reading: undefined }));
  protected readonly hasUnknownQuality = computed(() =>
    this.readings().some((row) => ![0, 1, 2].includes(row.quality)),
  );
  protected readonly observedTime = observedTime;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly yLabel = (value: number) =>
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 3,
      notation: Math.abs(value) >= 100000 ? 'compact' : 'standard',
    }).format(value);
  protected readonly timeLabel = (time: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(Date.parse(this.query().end) - Date.parse(this.query().start) > 86400000
        ? ({ month: 'short', day: '2-digit' } as const)
        : {}),
    }).format(time);

  constructor() {
    afterNextRender(() => {
      const observer = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0)
          this.size.set({ width: Math.floor(width), height: Math.floor(height) });
      });
      observer.observe(this.canvas().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected inspect(event: PointerEvent): void {
    const x = event.clientX - this.canvas().nativeElement.getBoundingClientRect().left;
    const points = this.plot().points;
    let lo = 0,
      hi = points.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (points[mid].x < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(points[lo - 1].x - x) < Math.abs(points[lo].x - x)) lo--;
    this.activeIndex.set(lo);
  }

  protected move(event: KeyboardEvent): void {
    const last = this.readings().length - 1;
    let next = this.activeIndex() ?? last;
    if (event.key === 'ArrowLeft') next--;
    else if (event.key === 'ArrowRight') next++;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    this.activeIndex.set(Math.min(last, Math.max(0, next)));
  }
}

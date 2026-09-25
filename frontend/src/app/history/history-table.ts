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
} from '@angular/core';
import { TelemetryReading, TelemetryTag } from '../telemetry/telemetry.models';
import {
  displayValue,
  displayUnit,
  observedTime,
  qualityLabel,
  qualityTone,
} from '../telemetry/telemetry.presentation';

@Component({
  selector: 'app-history-table',
  templateUrl: './history-table.html',
  styleUrl: './history-table.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryTable {
  readonly readings = input.required<TelemetryReading[]>();
  readonly tag = input.required<TelemetryTag>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly page = signal(0);
  protected readonly pageSize = signal(5);
  protected readonly pages = computed(() => Math.ceil(this.readings().length / this.pageSize()));
  protected readonly current = computed(() => Math.max(0, Math.min(this.page(), this.pages() - 1)));
  protected readonly rows = computed(() =>
    this.readings().slice(this.current() * this.pageSize(), (this.current() + 1) * this.pageSize()),
  );
  protected readonly unit = computed(() => displayUnit({ ...this.tag(), reading: undefined }));
  protected readonly value = (row: TelemetryReading) =>
    displayValue({ ...this.tag(), reading: row });
  protected readonly observedTime = observedTime;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;

  constructor() {
    afterNextRender(() => {
      const observer = new ResizeObserver((entries) => {
        this.pageSize.set(
          Math.max(1, Math.min(8, Math.floor((entries[0].contentRect.height - 60) / 36))),
        );
      });
      observer.observe(this.element.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, MatPaginatorIntl } from '@angular/material/paginator';
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

function historyPaginatorLabels(): MatPaginatorIntl {
  const labels = new MatPaginatorIntl();
  labels.getRangeLabel = (page, size, length) =>
    `${page * size + 1}–${Math.min((page + 1) * size, length)} of ${length} loaded`;
  return labels;
}

@Component({
  selector: 'app-history-table',
  imports: [MatTableModule, MatPaginatorModule],
  providers: [{ provide: MatPaginatorIntl, useFactory: historyPaginatorLabels }],
  templateUrl: './history-table.html',
  styleUrl: './history-table.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryTable {
  readonly readings = input.required<TelemetryReading[]>();
  readonly tag = input.required<TelemetryTag>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly columns = ['observed', 'value', 'quality'];
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
          Math.max(1, Math.min(8, Math.floor((entries[0].contentRect.height - 78) / 36))),
        );
      });
      observer.observe(this.element.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}

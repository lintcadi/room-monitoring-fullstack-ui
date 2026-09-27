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
import { TelemetryTag } from '../telemetry/telemetry.models';
import {
  formatValue,
  displayUnit,
  observedTime,
  qualityLabel,
  qualityTone,
} from '../telemetry/telemetry.presentation';

import { HistoryRow, bucketOf, rowQuality, rowTimestamp } from './history.models';

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
  readonly readings = input.required<HistoryRow[]>();
  readonly aggregated = input(false);
  protected readonly bucketOf = bucketOf;
  protected readonly rowTimestamp = rowTimestamp;
  protected readonly rowQuality = rowQuality;
  readonly tags = input.required<TelemetryTag[]>();
  protected readonly tagMap = computed(() => new Map(this.tags().map((tag) => [tag.id, tag])));
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly columns = computed(() =>
    this.tags().length > 1
      ? ['observed', 'measurement', 'value', 'quality']
      : ['observed', 'value', 'quality'],
  );
  protected readonly page = signal(0);
  protected readonly pageSize = signal(5);
  protected readonly pages = computed(() => Math.ceil(this.readings().length / this.pageSize()));
  protected readonly current = computed(() => Math.max(0, Math.min(this.page(), this.pages() - 1)));
  protected readonly rows = computed(() =>
    this.readings().slice(this.current() * this.pageSize(), (this.current() + 1) * this.pageSize()),
  );
  protected readonly unit = (row: HistoryRow) => displayUnit(this.tagMap().get(row.tag_id)!);
  protected readonly value = (row: HistoryRow) =>
    formatValue(this.tagMap().get(row.tag_id)!, row.value);
  protected readonly format = (row: HistoryRow, value: number | null) =>
    formatValue(this.tagMap().get(row.tag_id)!, value);
  protected readonly observedTime = observedTime;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;

  constructor() {
    afterNextRender(() => {
      const host = this.element.nativeElement;
      let measuredRowHeight = this.aggregated() ? 80 : 36;
      let previousWidth = 0;
      const observer = new ResizeObserver(() => {
        const { width, height } = host.getBoundingClientRect();
        if (width !== previousWidth) {
          measuredRowHeight = this.aggregated() ? 80 : 36;
          previousWidth = width;
        }
        for (const row of host.querySelectorAll('.mat-mdc-row')) {
          measuredRowHeight = Math.max(measuredRowHeight, row.getBoundingClientRect().height);
        }
        const header =
          host.querySelector('.mat-mdc-header-row')?.getBoundingClientRect().height ?? 28;
        const paginator = host.querySelector('mat-paginator')?.getBoundingClientRect().height ?? 56;
        this.pageSize.set(
          Math.max(
            1,
            Math.min(8, Math.floor((height - header - paginator - 12) / measuredRowHeight)),
          ),
        );
      });
      observer.observe(host);
      for (const child of host.querySelectorAll('table, mat-paginator')) observer.observe(child);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}

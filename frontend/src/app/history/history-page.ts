import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TelemetryReading } from '../telemetry/telemetry.models';
import { displayValue, displayUnit, observedTime } from '../telemetry/telemetry.presentation';
import { HistoryService } from './history.service';
import { MAX_READINGS, STATUS_KEYS, recentRange } from './history.models';
import { HistoryChart } from './history-chart';
import { HistoryTable } from './history-table';
import { HistoryRange } from './history-range';

@Component({
  selector: 'app-history-page',
  imports: [
    MatFormFieldModule,
    MatSelectModule,
    MatButtonToggleModule,
    MatButtonModule,
    MatCardModule,
    HistoryChart,
    HistoryTable,
    DecimalPipe,
  ],
  providers: [HistoryService],
  templateUrl: './history-page.html',
  styleUrl: './history-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage implements OnInit, OnDestroy {
  protected readonly history = inject(HistoryService);
  private readonly dialog = inject(MatDialog);
  private rangeDialog?: MatDialogRef<HistoryRange>;
  protected readonly preset = signal<number | 'custom'>(1);
  protected readonly view = signal<'chart' | 'table'>('chart');
  protected readonly maxReadings = MAX_READINGS;
  protected readonly unit = computed(() => {
    const tag = this.history.tag();
    return tag ? displayUnit({ ...tag, reading: undefined }) : '';
  });
  protected readonly isStatus = computed(() =>
    STATUS_KEYS.includes(this.history.tag()?.tag_key ?? ''),
  );
  protected readonly goodReadings = computed(() =>
    this.history.readings().filter((row) => row.quality === 0),
  );
  protected readonly min = computed(() =>
    this.goodReadings().reduce<TelemetryReading | undefined>(
      (prev, row) => (!prev || row.value < prev.value ? row : prev),
      undefined,
    ),
  );
  protected readonly max = computed(() =>
    this.goodReadings().reduce<TelemetryReading | undefined>(
      (prev, row) => (!prev || row.value > prev.value ? row : prev),
      undefined,
    ),
  );
  protected readonly states = computed(
    () => new Set(this.goodReadings().map((row) => row.value)).size,
  );
  protected readonly completeness = computed(() =>
    this.history.limitReached()
      ? 'Display limit reached'
      : this.history.nextCursor()
        ? 'Partial range'
        : this.history.loaded()
          ? 'Range loaded'
          : this.history.error()
            ? 'Range unavailable'
            : 'Loading range',
  );
  protected readonly observedTime = observedTime;
  protected readonly value = (row: TelemetryReading | undefined): string => {
    const tag = this.history.tag();
    return tag ? displayValue({ ...tag, reading: row }) : '—';
  };

  ngOnInit(): void {
    this.history.loadTags();
  }

  protected changeTag(tagId: number): void {
    const query = this.history.query();
    if (query) {
      this.history.load({ ...query, tagId });
    }
  }

  protected selectPreset(hours: number): void {
    const query = this.history.query();
    if (!query) return;
    this.preset.set(hours);
    this.history.load({ tagId: query.tagId, ...recentRange(hours) });
  }

  protected openRange(): void {
    const query = this.history.query();
    if (!query) return;
    this.rangeDialog = this.dialog.open(HistoryRange, {
      data: query,
      width: '420px',
      maxWidth: 'calc(100vw - 24px)',
    });
    this.rangeDialog
      .afterClosed()
      .subscribe((range: { start: string; end: string } | undefined) => {
        if (range) this.custom(range);
      });
  }

  ngOnDestroy(): void {
    this.rangeDialog?.close();
  }

  protected custom(range: { start: string; end: string }): void {
    const query = this.history.query();
    if (!query) return;
    this.preset.set('custom');
    this.history.load({ tagId: query.tagId, ...range });
  }

  protected refresh(): void {
    const query = this.history.query();
    const preset = this.preset();
    if (!query) return;
    if (preset === 'custom') this.history.load(query);
    else this.selectPreset(preset);
  }
}

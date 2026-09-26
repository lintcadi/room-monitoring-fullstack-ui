import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatRippleModule } from '@angular/material/core';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TelemetryService } from '../telemetry/telemetry.service';
import { TagView } from '../telemetry/telemetry.models';
import {
  DIAGNOSTICS,
  displayValue,
  observedTime,
  qualityLabel,
  qualityTone,
  readingAge,
} from '../telemetry/telemetry.presentation';
import { readingAssessment } from '../telemetry/reading-ranges';
import { ReadingCard } from './reading-card';
import { ReadingDetails } from './reading-details';

const PRIMARY_KEYS = ['iaq', 'temperature_c', 'humidity_percent'];

@Component({
  selector: 'app-live-dashboard',
  imports: [MatButtonModule, MatRippleModule, ReadingCard],
  templateUrl: './live-dashboard.html',
  styleUrl: './live-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveDashboard implements OnInit, OnDestroy {
  protected readonly telemetry = inject(TelemetryService);
  protected readonly now = signal(Date.now());
  private clock?: ReturnType<typeof setInterval>;
  private readonly dialog = inject(MatDialog);
  private details?: MatDialogRef<ReadingDetails>;
  protected readonly selectedId = signal<number | null>(null);
  protected readonly selectedTag = computed(() =>
    this.telemetry.tagViews().find((tag) => tag.id === this.selectedId()),
  );
  protected readonly primary = computed(() =>
    this.telemetry
      .tagViews()
      .filter((tag) => PRIMARY_KEYS.includes(tag.tag_key))
      .sort((a, b) => PRIMARY_KEYS.indexOf(a.tag_key) - PRIMARY_KEYS.indexOf(b.tag_key)),
  );
  protected readonly secondary = computed(() =>
    this.telemetry
      .tagViews()
      .filter((tag) => !PRIMARY_KEYS.includes(tag.tag_key) && !DIAGNOSTICS.includes(tag.tag_key)),
  );
  protected readonly diagnostics = computed(() =>
    this.telemetry.tagViews().filter((tag) => DIAGNOSTICS.includes(tag.tag_key)),
  );
  protected readonly receivedCount = computed(
    () => this.telemetry.tagViews().filter((tag) => tag.reading).length,
  );
  protected readonly clockLabel = computed(() =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(this.now()),
  );
  protected readonly notice = computed(() => {
    if (this.telemetry.metadataError()) return 'Couldn’t load tags. Retry to show your readings.';
    if (this.telemetry.connection() !== 'live')
      return this.telemetry.hasSnapshot()
        ? 'Live updates paused. Showing last received readings.'
        : 'Waiting for the first live snapshot…';
    if (this.telemetry.hasSnapshot() && !this.receivedCount())
      return 'Tags are ready. Waiting for their first readings.';
    return '';
  });
  protected readonly diagnosticLabel = (key: string, fallback: string): string =>
    (
      ({
        iaq_accuracy: 'IAQ accuracy',
        stabilization_complete: 'Stabilization',
        run_in_complete: 'Run-in',
        sensor_status: 'Sensor status',
        heartbeat: 'Heartbeat',
      }) as Record<string, string>
    )[key] ?? fallback;
  protected readonly readingAssessment = readingAssessment;
  protected readonly displayValue = displayValue;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly observedTime = observedTime;
  protected readonly readingAge = readingAge;

  protected openDetails(tag: TagView): void {
    this.selectedId.set(tag.id);
    this.details = this.dialog.open(ReadingDetails, {
      data: { tag: this.selectedTag },
      width: '440px',
      maxWidth: 'calc(100vw - 24px)',
      ariaLabelledBy: 'detail-title',
    });
    this.details.afterClosed().subscribe(() => this.selectedId.set(null));
  }

  ngOnInit(): void {
    this.telemetry.start();
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    this.details?.close();
    clearInterval(this.clock);
    this.telemetry.stop();
  }
}

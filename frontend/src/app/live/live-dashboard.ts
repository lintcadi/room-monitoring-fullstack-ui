import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
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
import { DashboardHeader } from '../shared/dashboard-header';
import { ReadingCard } from './reading-card';
import { ReadingDetails } from './reading-details';

const PRIMARY_KEYS = ['iaq', 'temperature_c', 'humidity_percent'];

@Component({
  selector: 'app-live-dashboard',
  imports: [ReadingCard, ReadingDetails, DashboardHeader],
  templateUrl: './live-dashboard.html',
  styleUrl: './live-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveDashboard implements OnInit, OnDestroy {
  protected readonly telemetry = inject(TelemetryService);
  protected readonly now = signal(Date.now());
  private clock?: ReturnType<typeof setInterval>;
  protected readonly details = viewChild.required<ReadingDetails>('details');
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
  protected readonly connectionLabel = computed(
    () =>
      ({
        connecting: 'Connecting',
        live: 'Stream connected',
        reconnecting: 'Reconnecting',
        unavailable: 'Data unavailable',
        invalid: 'Unexpected data',
      })[this.telemetry.connection()],
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
  protected readonly displayValue = displayValue;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly observedTime = observedTime;
  protected readonly readingAge = readingAge;

  protected openDetails(tag: TagView): void {
    this.selectedId.set(tag.id);
    this.details().open();
  }

  ngOnInit(): void {
    this.telemetry.start();
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    this.telemetry.stop();
  }
}

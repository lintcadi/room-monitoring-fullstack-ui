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
import {
  AIR_QUALITY,
  CONDITIONS,
  DIAGNOSTICS,
  displayValue,
  observedTime,
  qualityLabel,
  qualityTone,
  readingAge,
} from '../telemetry/telemetry.presentation';
import { ReadingCard } from './reading-card';

@Component({
  selector: 'app-live-dashboard',
  imports: [ReadingCard],
  templateUrl: './live-dashboard.html',
  styleUrl: './live-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveDashboard implements OnInit, OnDestroy {
  protected readonly telemetry = inject(TelemetryService);
  protected readonly now = signal(Date.now());
  private clock?: ReturnType<typeof setInterval>;
  protected readonly accuracy = computed(() =>
    this.telemetry.tagViews().find((tag) => tag.tag_key === 'iaq_accuracy'),
  );
  protected readonly heartbeat = computed(() =>
    this.telemetry.tagViews().find((tag) => tag.tag_key === 'heartbeat'),
  );
  protected readonly receivedCount = computed(
    () => this.telemetry.tagViews().filter((tag) => tag.reading).length,
  );
  protected readonly diagnostics = computed(() =>
    this.telemetry.tagViews().filter((tag) => DIAGNOSTICS.includes(tag.tag_key)),
  );
  protected readonly sections = computed(() => {
    const tags = this.telemetry.tagViews();
    return [
      {
        id: 'conditions',
        number: '01',
        title: 'Room conditions',
        description: 'The room, right now.',
        tags: tags.filter((tag) => CONDITIONS.includes(tag.tag_key)),
      },
      {
        id: 'air-quality',
        number: '02',
        title: 'Air quality',
        description: 'Estimates from the BME680 sensor.',
        tags: tags.filter((tag) => AIR_QUALITY.includes(tag.tag_key)),
      },
      {
        id: 'additional',
        number: '03',
        title: 'Additional readings',
        description: 'A closer look at the sensor measurements.',
        tags: tags.filter(
          (tag) => ![...CONDITIONS, ...AIR_QUALITY, ...DIAGNOSTICS].includes(tag.tag_key),
        ),
      },
    ].filter((section) => section.tags.length);
  });
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
  protected readonly displayValue = displayValue;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly observedTime = observedTime;
  protected readonly readingAge = readingAge;

  ngOnInit(): void {
    this.telemetry.start();
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    this.telemetry.stop();
  }
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TelemetryTag } from '../telemetry/telemetry.models';
import {
  displayUnit,
  formatValue,
  observedTime,
  qualityLabel,
  qualityTone,
} from '../telemetry/telemetry.presentation';
import { HistoryRow, bucketOf, rowQuality, rowTimestamp } from './history.models';

@Component({
  selector: 'app-history-observation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bucket(); as b) {
      <time>{{ observedTime(b.coverage_start) }} → {{ observedTime(b.coverage_end) }}</time>
      <small
        >{{ b.partial ? 'Partial bucket · ' : ''
        }}{{
          b.method === 'average' ? 'Average · good samples only' : 'Last recorded value'
        }}</small
      >
      <strong
        >{{ value(b.value) }} <small>{{ unit() }}</small></strong
      >
      @if (b.method === 'average') {
        <small>Min {{ value(b.minimum) }} · Max {{ value(b.maximum) }} {{ unit() }}</small>
        @if (b.value === null) {
          <small>No usable good-quality samples</small>
        }
        <small>{{ b.usable_count }} usable / {{ b.sample_count }} observations</small>
      } @else {
        <time>Observed {{ observedTime(b.last_observed_at) }}</time>
        <span class="badge" [attr.data-tone]="qualityTone(b.last_quality)"
          >Last: {{ qualityLabel(b.last_quality) }}</span
        >
      }
      <small
        >Quality counts: {{ b.good_count }} good · {{ b.uncertain_count }} uncertain ·
        {{ b.bad_count }} bad · {{ b.unknown_count }} unknown</small
      >
    } @else {
      <time>{{ observedTime(rowTimestamp(row())) }}</time>
      <strong
        >{{ value(row().value) }} <small>{{ unit() }}</small></strong
      >
      <span class="badge" [attr.data-tone]="qualityTone(rowQuality(row()))"
        >Data: {{ qualityLabel(rowQuality(row())) }}</span
      >
    }
  `,
  styles: `
    :host {
      display: grid;
      justify-items: start;
      gap: 5px;
    }
    time,
    small {
      color: var(--muted);
      font-size: 0.6rem;
      font-weight: 400;
    }
    strong {
      font-size: 1rem;
      font-weight: 500;
    }
  `,
})
export class HistoryObservation {
  readonly row = input.required<HistoryRow>();
  readonly tag = input.required<TelemetryTag>();
  protected readonly bucket = computed(() => bucketOf(this.row()));
  protected readonly unit = computed(() => displayUnit(this.tag()));
  protected readonly value = (value: number | null) => formatValue(this.tag(), value);
  protected readonly observedTime = observedTime;
  protected readonly rowTimestamp = rowTimestamp;
  protected readonly rowQuality = rowQuality;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TagView } from '../telemetry/telemetry.models';
import {
  accuracyLabel,
  displayUnit,
  displayValue,
  observedTime,
  qualityLabel,
  qualityTone,
  readingAge,
} from '../telemetry/telemetry.presentation';

@Component({
  selector: 'app-reading-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="reading-card" [class.bad-reading]="tag().reading?.quality === 2">
      <div class="card-heading">
        <h3>{{ tag().name }}</h3>
        <span
          class="badge"
          [attr.data-tone]="qualityTone(tag().reading?.quality)"
          [attr.aria-label]="'Telemetry quality: ' + qualityLabel(tag().reading?.quality)"
        >
          <span class="dot" aria-hidden="true"></span>{{ qualityLabel(tag().reading?.quality) }}
        </span>
      </div>
      <p class="measurement">
        <span>{{ displayValue(tag()) }}</span>
        @if (tag().reading && displayUnit(tag())) {
          <span class="unit">{{ displayUnit(tag()) }}</span>
        }
      </p>
      <p class="context">
        @switch (tag().tag_key) {
          @case ('iaq') {
            @if (accuracy()?.reading; as reading) {
              @if (reading.quality === 0) {
                <span [title]="'Accuracy observed ' + observedTime(reading.observed_at)"
                  >{{ accuracyLabel(reading.value) }} accuracy</span
                >
              } @else {
                <span>Accuracy telemetry: {{ qualityLabel(reading.quality) }}</span>
              }
            } @else {
              <span>Accuracy unavailable</span>
            }
            <span class="separator">·</span> Lower is cleaner
          }
          @case ('co2_equivalent_ppm') {
            VOC-based estimate of CO₂
          }
          @case ('breath_voc_equivalent_ppm') {
            Estimated breath VOC equivalent
          }
          @case ('gas_percentage') {
            Relative to this sensor’s history
          }
          @case ('gas_resistance_ohm') {
            Gas sensor resistance
          }
          @case ('static_iaq') {
            Static air-quality index
          }
          @case ('humidity_percent') {
            Relative humidity
          }
          @case ('pressure_hpa') {
            Atmospheric pressure
          }
          @case ('temperature_c') {
            Room temperature
          }
          @default {
            {{ tag().tag_key }}
          }
        }
      </p>
      <footer>
        <span>{{ readingAge(tag().reading?.observed_at, now()) }}</span>
        <time [attr.datetime]="tag().reading?.observed_at">{{
          observedTime(tag().reading?.observed_at)
        }}</time>
      </footer>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .reading-card {
      height: 100%;
      padding: 22px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .bad-reading {
      border-color: #dcb9b2;
    }
    .card-heading {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    h3 {
      font-size: 0.875rem;
      font-weight: 600;
      margin: 0;
      line-height: 1.5;
    }
    .measurement {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 24px 0 12px;
      font-size: clamp(2.3rem, 4vw, 3rem);
      letter-spacing: -0.055em;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .unit {
      font-size: 1rem;
      letter-spacing: 0;
      color: var(--muted);
      font-weight: 400;
    }
    .context {
      min-height: 2.5em;
      color: var(--muted);
      font-size: 0.75rem;
      line-height: 1.5;
      margin: 0 0 18px;
      overflow-wrap: anywhere;
    }
    .separator {
      margin: 0 5px;
    }
    footer {
      border-top: 1px solid var(--line);
      padding-top: 13px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 6px;
      font-size: 0.65rem;
      color: var(--muted);
    }
    footer > span {
      color: var(--text);
    }
    time {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ReadingCard {
  readonly tag = input.required<TagView>();
  readonly now = input.required<number>();
  readonly accuracy = input<TagView>();
  protected readonly displayValue = displayValue;
  protected readonly displayUnit = displayUnit;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly observedTime = observedTime;
  protected readonly readingAge = readingAge;
  protected readonly accuracyLabel = accuracyLabel;
}

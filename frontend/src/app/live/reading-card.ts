import { MatCardModule } from '@angular/material/card';
import { MatRippleModule } from '@angular/material/core';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TagView } from '../telemetry/telemetry.models';
import {
  displayUnit,
  displayValue,
  observedTime,
  qualityLabel,
  qualityTone,
  readingAge,
} from '../telemetry/telemetry.presentation';
import { TelemetryGauge } from './telemetry-gauge';
import { readingAssessment } from '../telemetry/reading-ranges';

@Component({
  selector: 'app-reading-card',
  imports: [TelemetryGauge, MatCardModule, MatRippleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reading-card.html',
  styleUrl: './reading-card.css',
})
export class ReadingCard {
  readonly tag = input.required<TagView>();
  readonly now = input.required<number>();
  readonly featured = input(false);
  readonly selected = output<TagView>();
  protected readonly assessment = computed(() => readingAssessment(this.tag()));
  protected readonly label = computed(
    () =>
      (
        ({
          iaq: 'Air quality',
          co2_equivalent_ppm: 'CO₂ equivalent',
          breath_voc_equivalent_ppm: 'Breath VOC eq.',
          gas_resistance_ohm: 'Gas resistance',
          gas_percentage: 'Gas percentage',
          static_iaq: 'Static IAQ',
        }) as Record<string, string>
      )[this.tag().tag_key] ?? this.tag().name,
  );
  protected readonly displayValue = displayValue;
  protected readonly displayUnit = displayUnit;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly observedTime = observedTime;
  protected readonly readingAge = readingAge;
}

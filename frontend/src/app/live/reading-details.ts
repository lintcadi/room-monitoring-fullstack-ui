import { ChangeDetectionStrategy, Component, Signal, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TagView } from '../telemetry/telemetry.models';
import { READING_RANGES, readingAssessment } from '../telemetry/reading-ranges';
import {
  displayUnit,
  displayValue,
  observedTime,
  qualityLabel,
  qualityTone,
} from '../telemetry/telemetry.presentation';

@Component({
  selector: 'app-reading-details',
  imports: [MatDialogModule, MatButtonModule],
  templateUrl: './reading-details.html',
  styleUrl: './reading-details.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadingDetails {
  protected readonly tag = inject<{ tag: Signal<TagView | undefined> }>(MAT_DIALOG_DATA).tag;
  protected readonly assessment = computed(() => readingAssessment(this.tag()));
  protected readonly definition = computed(() => READING_RANGES[this.tag()?.tag_key ?? '']);
  protected readonly displayValue = displayValue;
  protected readonly displayUnit = displayUnit;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly observedTime = observedTime;
}

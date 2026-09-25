import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TagView } from '../telemetry/telemetry.models';
import {
  displayUnit,
  displayValue,
  observedTime,
  qualityLabel,
  qualityTone,
} from '../telemetry/telemetry.presentation';

@Component({
  selector: 'app-reading-details',
  templateUrl: './reading-details.html',
  styleUrl: './reading-details.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadingDetails {
  private readonly injector = inject(Injector);
  readonly tag = input<TagView>();
  readonly closed = output<void>();
  protected readonly details = viewChild.required<ElementRef<HTMLDialogElement>>('details');
  protected readonly displayValue = displayValue;
  protected readonly displayUnit = displayUnit;
  protected readonly qualityLabel = qualityLabel;
  protected readonly qualityTone = qualityTone;
  protected readonly observedTime = observedTime;

  open(): void {
    // Render the selected reading before the native dialog assigns focus.
    afterNextRender(() => this.details().nativeElement.showModal(), { injector: this.injector });
  }
}

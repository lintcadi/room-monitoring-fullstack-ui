import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-telemetry-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 210 130" role="img" [attr.aria-label]="description()">
      <path class="track" d="M 20 105 A 85 85 0 0 1 190 105" pathLength="100" />
      @if (value() !== undefined) {
        <path
          class="fill"
          d="M 20 105 A 85 85 0 0 1 190 105"
          pathLength="100"
          [attr.stroke-dasharray]="percentage() + ' 100'"
        />
      }
      <text x="20" y="126" text-anchor="middle">0</text>
      <text x="190" y="126" text-anchor="middle">{{ max() }}</text>
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    path {
      fill: none;
      stroke-width: 9;
      stroke-linecap: round;
    }
    .track {
      stroke: var(--gauge-track, #e7eeea);
    }
    .fill {
      stroke: var(--gauge-color, #367565);
    }
    text {
      fill: var(--muted);
      font:
        8px 'Segoe UI',
        sans-serif;
    }
  `,
})
export class TelemetryGauge {
  readonly value = input<number>();
  readonly max = input.required<number>();
  readonly label = input.required<string>();
  protected readonly percentage = computed(() =>
    Math.max(0, Math.min(100, ((this.value() ?? 0) / this.max()) * 100)),
  );
  protected readonly description = computed(
    () => `${this.label()}: ${this.value() ?? 'no reading'}; scale 0 to ${this.max()}`,
  );
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HistoryQuery, customRange, taipeiInput } from './history.models';

@Component({
  selector: 'app-history-range',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog aria-labelledby="range-title">
      <form (ngSubmit)="apply()">
        <div class="heading">
          <span>CUSTOM TIME RANGE</span
          ><button type="button" (click)="dialog.close()" aria-label="Close time range">×</button>
        </div>
        <h2 id="range-title">Look a little further back.</h2>
        <p>All times are in Asia/Taipei (UTC+08:00).</p>
        <label
          >Start · inclusive<input
            type="datetime-local"
            name="start"
            required
            [ngModel]="start()"
            (ngModelChange)="start.set($event)"
        /></label>
        <label
          >End · exclusive<input
            type="datetime-local"
            name="end"
            required
            [ngModel]="end()"
            (ngModelChange)="end.set($event)"
        /></label>
        @if (invalid()) {
          <p class="error" role="alert">Enter valid dates with the start before the end.</p>
        }
        <button class="apply" type="submit">Apply range</button>
      </form>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(420px, calc(100vw - 32px));
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: var(--surface);
      color: var(--text);
    }
    dialog::backdrop {
      background: #24362d55;
      backdrop-filter: blur(5px);
    }
    .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .heading span {
      font-size: 0.6rem;
      letter-spacing: 0.1em;
      color: var(--muted);
    }
    .heading button {
      border: 0;
      padding: 0;
      border-radius: 50%;
      width: 34px;
      height: 34px;
      min-height: 34px;
      background: #eff2ec;
      font-size: 1.3rem;
    }
    h2 {
      font-size: 1.2rem;
      font-weight: 500;
      letter-spacing: -0.04em;
      margin: 16px 0 8px;
    }
    p {
      font-size: 0.75rem;
      color: var(--muted);
      line-height: 1.5;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 7px;
      font-size: 0.7rem;
      color: var(--muted);
      margin-top: 18px;
    }
    input {
      width: 100%;
      min-width: 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      font: inherit;
      color: var(--text);
      background: var(--background);
    }
    .apply {
      margin-top: 24px;
      width: 100%;
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .error {
      color: #a03729;
    }
    @media (max-height: 500px) {
      dialog {
        padding: 16px;
      }
      h2 {
        margin-top: 8px;
      }
      label {
        margin-top: 8px;
      }
      .apply {
        margin-top: 12px;
      }
    }
  `,
})
export class HistoryRange {
  readonly selected = output<{ start: string; end: string }>();
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly start = signal('');
  protected readonly end = signal('');
  protected readonly invalid = signal(false);

  open(query: HistoryQuery): void {
    this.start.set(taipeiInput(query.start));
    this.end.set(taipeiInput(query.end));
    this.invalid.set(false);
    afterNextRender(() => this.dialog().nativeElement.showModal(), { injector: this.injector });
  }

  protected apply(): void {
    const range = customRange(this.start(), this.end());
    this.invalid.set(range === null);
    if (!range) return;
    this.selected.emit(range);
    this.dialog().nativeElement.close();
  }
}

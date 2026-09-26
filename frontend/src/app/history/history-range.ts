import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { HistoryQuery, customRange, taipeiInput } from './history.models';

@Component({
  selector: 'app-history-range',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Custom time range</h2>
    <form (ngSubmit)="apply()">
      <mat-dialog-content>
        <p>All times are in Asia/Taipei (UTC+08:00).</p>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Start · inclusive</mat-label>
          <input
            matInput
            type="datetime-local"
            name="start"
            required
            [ngModel]="start()"
            (ngModelChange)="start.set($event)"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>End · exclusive</mat-label>
          <input
            matInput
            type="datetime-local"
            name="end"
            required
            [ngModel]="end()"
            (ngModelChange)="end.set($event)"
          />
        </mat-form-field>
        @if (invalid()) {
          <p class="error" role="alert">Enter valid dates with the start before the end.</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit">Use range</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    mat-form-field {
      width: 100%;
      margin-top: 16px;
    }
    p {
      font-size: 0.75rem;
      margin: 0;
    }
    .error {
      color: var(--mat-sys-error);
      margin-top: 12px;
    }
  `,
})
export class HistoryRange {
  private readonly query = inject<HistoryQuery>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<HistoryRange>);
  protected readonly start = signal(taipeiInput(this.query.start));
  protected readonly end = signal(taipeiInput(this.query.end));
  protected readonly invalid = signal(false);
  protected apply(): void {
    const range = customRange(this.start(), this.end());
    this.invalid.set(range === null);
    if (range) this.dialog.close(range);
  }
}

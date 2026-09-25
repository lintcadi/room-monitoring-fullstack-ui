import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { HistoryRange } from './history-range';

@Component({ template: '' })
class DialogHost {}

describe('Material history range dialog', () => {
  let dialog: MatDialogRef<HistoryRange>;
  let fixture: ReturnType<typeof TestBed.createComponent<DialogHost>>;
  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [DialogHost] });
    fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();
    dialog = TestBed.inject(MatDialog).open(HistoryRange, {
      data: { tagId: 1, start: '2026-09-25T00:00:00Z', end: '2026-09-25T01:00:00Z' },
      enterAnimationDuration: 0,
      exitAnimationDuration: 0,
    });
    await fixture.whenStable();
  });
  afterEach(() => dialog.close());

  it('displays and submits a fixed Taipei range through the Material dialog', async () => {
    const inputs = document.querySelectorAll<HTMLInputElement>('mat-dialog-container input');
    expect(inputs[0].value).toBe('2026-09-25T08:00');
    expect(inputs[1].value).toBe('2026-09-25T09:00');
    const close = vi.spyOn(dialog, 'close');
    document
      .querySelector('mat-dialog-container form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(close).toHaveBeenCalledWith({
      start: '2026-09-25T08:00+08:00',
      end: '2026-09-25T09:00+08:00',
    });
  });

  it('keeps an invalid range open and permits cancellation without applying it', async () => {
    const start = document.querySelector<HTMLInputElement>('mat-dialog-container input')!;
    start.value = '2026-09-25T10:00';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    const close = vi.spyOn(dialog, 'close');
    document
      .querySelector('mat-dialog-container form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('start before the end');
    expect(close).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('button[mat-dialog-close]')!.click();
    await fixture.whenStable();
    expect(close).toHaveBeenCalled();
    expect(close.mock.calls[0][0]).toBeFalsy();
  });
});

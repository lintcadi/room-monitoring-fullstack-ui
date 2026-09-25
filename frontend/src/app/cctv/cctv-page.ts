import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CctvRecognition } from './cctv-recognition';

@Component({
  selector: 'app-cctv-page',
  imports: [MatSlideToggleModule, MatButtonModule, MatCardModule, CctvRecognition],
  templateUrl: './cctv-page.html',
  styleUrl: './cctv-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CctvPage {
  protected readonly recognition = signal(true);
  protected readonly feedback = signal('Demo only · no camera connected.');

  protected connect(): void {
    this.feedback.set('Demo only · a camera feed has not been configured.');
  }

  protected toggleRecognition(): void {
    this.recognition.update((enabled) => !enabled);
    this.feedback.set(
      this.recognition()
        ? 'Demo recognition enabled · sample data only.'
        : 'Demo recognition paused · samples remain visible.',
    );
  }
}

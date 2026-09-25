import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-cctv-recognition',
  templateUrl: './cctv-recognition.html',
  styleUrl: './cctv-recognition.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CctvRecognition {
  readonly recognition = input(true);
  // Static examples for the page design. No camera, recognition, or telemetry requests.
  protected readonly people = [
    {
      name: 'Me',
      initials: 'ME',
      count: 12,
      share: 52,
      time: '14:32:08',
      detail: '98% match',
      tone: 'me',
    },
    {
      name: 'Girlfriend',
      initials: 'GF',
      count: 8,
      share: 35,
      time: '14:28:42',
      detail: '96% match',
      tone: 'girlfriend',
    },
    {
      name: 'Unknown',
      initials: '?',
      count: 3,
      share: 13,
      time: '14:15:19',
      detail: 'No identity match',
      tone: 'unknown',
    },
  ];
}

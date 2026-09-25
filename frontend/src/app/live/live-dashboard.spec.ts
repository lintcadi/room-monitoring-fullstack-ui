import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { EVENT_SOURCE_FACTORY } from '../telemetry/telemetry.service';
import { LiveDashboard } from './live-dashboard';

describe('LiveDashboard', () => {
  it('renders zero, missing and bad readings distinctly, including unknown tags', async () => {
    const source = new EventTarget();
    const close = vi.fn();
    Object.assign(source, { close });
    TestBed.configureTestingModule({
      imports: [LiveDashboard],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: () => source },
      ],
    });
    const fixture = TestBed.createComponent(LiveDashboard);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/telemetry/tags').flush([
      { id: 1, tag_key: 'temperature_c', name: 'Temperature', unit: '°C' },
      { id: 2, tag_key: 'humidity_percent', name: 'Humidity', unit: '%' },
      { id: 3, tag_key: 'custom_tag', name: 'Custom tag', unit: null },
    ]);
    source.dispatchEvent(
      new MessageEvent('snapshot', {
        data: JSON.stringify({
          readings: [
            {
              id: 1,
              tag_id: 1,
              tag_key: 'temperature_c',
              value: 0,
              quality: 2,
              observed_at: '2026-09-25T13:53:30Z',
              ingested_at: '2026-09-25T13:53:31Z',
            },
          ],
        }),
      }),
    );
    await fixture.whenStable();
    const cards = fixture.nativeElement.querySelectorAll(
      'app-reading-card',
    ) as NodeListOf<HTMLElement>;
    expect(cards).toHaveLength(3);
    expect(cards[0].querySelector('.measurement')?.textContent).toContain('0.0');
    expect(cards[0].querySelector('.quality')?.textContent).toContain('Bad');
    expect(cards[1].querySelector('.measurement')?.textContent).toContain('—');
    expect(cards[1].querySelector('.quality')?.textContent).toContain('No reading');
    expect(cards[2].textContent).toContain('Custom tag');
    http.verify();
    fixture.destroy();
    expect(close).toHaveBeenCalledOnce();
  });
});

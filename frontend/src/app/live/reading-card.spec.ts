import { TestBed } from '@angular/core/testing';
import { TagView } from '../telemetry/telemetry.models';
import { ReadingCard } from './reading-card';

it('updates humidity bands independently of data quality and preserves unreliable values', () => {
  const tag: TagView = {
    id: 2,
    tag_key: 'humidity_percent',
    name: 'Humidity',
    unit: '%',
    reading: {
      id: 2,
      tag_id: 2,
      tag_key: 'humidity_percent',
      value: 60,
      quality: 0,
      observed_at: '2026-09-26T00:00:00Z',
      ingested_at: '2026-09-26T00:00:01Z',
    },
  };
  const fixture = TestBed.createComponent(ReadingCard);
  fixture.componentRef.setInput('tag', tag);
  fixture.componentRef.setInput('now', Date.parse('2026-09-26T00:00:02Z'));
  fixture.componentRef.setInput('featured', true);
  fixture.detectChanges();
  const card: HTMLElement = fixture.nativeElement;
  expect(card.querySelector('.quality')!.textContent).toContain('Data: Good');
  expect(card.querySelector('.value-classification')!.textContent).toContain('High humidity');
  fixture.componentRef.setInput('tag', { ...tag, reading: { ...tag.reading!, value: 50 } });
  fixture.detectChanges();
  expect(card.querySelector('.value-classification')!.textContent).toContain('In target');
  expect(
    card.querySelector<HTMLElement>('app-telemetry-gauge')!.style.getPropertyValue('--gauge-color'),
  ).toBe('#237443');
  fixture.componentRef.setInput('tag', { ...tag, reading: { ...tag.reading!, quality: 1 } });
  fixture.detectChanges();
  expect(card.querySelector('.quality')!.textContent).toContain('Data: Uncertain');
  expect(card.querySelector('.value-classification')!.textContent).toContain('Unavailable');
  expect(card.querySelector('.measurement')!.textContent).toContain('60.0');
  expect(
    card.querySelector<HTMLElement>('app-telemetry-gauge')!.style.getPropertyValue('--gauge-color'),
  ).toBe('#657067');
});

it('renders data quality and IAQ classification independently, including unreliable and missing updates', () => {
  const tag: TagView = {
    id: 1,
    tag_key: 'iaq',
    name: 'IAQ',
    unit: null,
    reading: {
      id: 1,
      tag_id: 1,
      tag_key: 'iaq',
      value: 167.3,
      quality: 0,
      observed_at: '2026-09-26T00:00:00Z',
      ingested_at: '2026-09-26T00:00:01Z',
    },
  };
  const fixture = TestBed.createComponent(ReadingCard);
  fixture.componentRef.setInput('tag', tag);
  fixture.componentRef.setInput('now', Date.parse('2026-09-26T00:00:02Z'));
  fixture.componentRef.setInput('featured', true);
  fixture.detectChanges();
  const card: HTMLElement = fixture.nativeElement;
  expect(card.querySelector('.quality')!.textContent).toContain('Data: Good');
  expect(card.querySelector('.value-classification')!.textContent).toContain('Moderately polluted');
  expect(
    card.querySelector<HTMLElement>('app-telemetry-gauge')!.style.getPropertyValue('--gauge-color'),
  ).toBe('#b45309');
  expect(card.querySelector('button')!.getAttribute('aria-label')).toContain(
    'Value: Moderately polluted',
  );
  fixture.componentRef.setInput('tag', { ...tag, reading: { ...tag.reading!, quality: 2 } });
  fixture.detectChanges();
  expect(card.querySelector('.quality')!.textContent).toContain('Data: Bad');
  expect(card.querySelector('.value-classification')!.textContent).toContain('IAQ unavailable');
  expect(card.querySelector('.measurement')!.textContent).toContain('167.3');
  expect(
    card.querySelector<HTMLElement>('app-telemetry-gauge')!.style.getPropertyValue('--gauge-color'),
  ).toBe('#657067');
  fixture.componentRef.setInput('tag', { ...tag, reading: undefined });
  fixture.detectChanges();
  expect(card.querySelector('.value-classification')!.textContent).toContain('No IAQ reading');
  expect(card.querySelector('.fill')).toBeNull();
});

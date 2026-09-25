import { TestBed } from '@angular/core/testing';
import { TelemetryGauge } from './telemetry-gauge';

describe('TelemetryGauge', () => {
  function gauge(value?: number) {
    const fixture = TestBed.createComponent(TelemetryGauge);
    fixture.componentRef.setInput('max', 500);
    fixture.componentRef.setInput('label', 'IAQ');
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture;
  }

  it('distinguishes missing data from a measured zero', () => {
    const fixture = gauge();
    expect(fixture.nativeElement.querySelector('.fill')).toBeNull();
    expect(fixture.nativeElement.querySelector('svg').getAttribute('aria-label')).toContain(
      'no reading',
    );
    fixture.componentRef.setInput('value', 0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.fill').getAttribute('stroke-dasharray')).toBe(
      '0 100',
    );
    expect(fixture.nativeElement.querySelector('svg').getAttribute('aria-label')).toContain(
      'IAQ: 0',
    );
  });

  it('uses the real scale and clamps the arc while retaining the reported value', () => {
    const fixture = gauge(125);
    expect(fixture.nativeElement.querySelector('.fill').getAttribute('stroke-dasharray')).toBe(
      '25 100',
    );
    fixture.componentRef.setInput('value', 600);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.fill').getAttribute('stroke-dasharray')).toBe(
      '100 100',
    );
    expect(fixture.nativeElement.querySelector('svg').getAttribute('aria-label')).toContain('600');
    fixture.componentRef.setInput('value', -10);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.fill').getAttribute('stroke-dasharray')).toBe(
      '0 100',
    );
  });
});

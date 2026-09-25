import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConnectionState, TelemetryReading, TelemetryTag, parseReadings } from './telemetry.models';

export const EVENT_SOURCE_FACTORY = new InjectionToken<(url: string) => EventSource>(
  'EventSource factory',
  { providedIn: 'root', factory: () => (url) => new EventSource(url) },
);

@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly createSource = inject(EVENT_SOURCE_FACTORY);
  private source?: EventSource;
  private active = false;
  private receivedSnapshot = false;
  private readonly onOffline = () => {
    if (!this.active) return;
    this.closeSource();
    this.receivedSnapshot = false;
    this.connection.set('reconnecting');
  };
  private readonly onOnline = () => {
    if (this.active && !this.source) this.connect();
  };

  readonly tags = signal<TelemetryTag[]>([]);
  readonly readings = signal<ReadonlyMap<number, TelemetryReading>>(new Map());
  readonly metadataLoading = signal(false);
  readonly metadataError = signal(false);
  readonly connection = signal<ConnectionState>('connecting');
  readonly hasSnapshot = signal(false);
  readonly tagViews = computed(() =>
    this.tags().map((tag) => ({
      ...tag,
      reading: this.readings().get(tag.id),
    })),
  );

  constructor() {
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
    this.destroyRef.onDestroy(() => {
      this.stop();
      window.removeEventListener('offline', this.onOffline);
      window.removeEventListener('online', this.onOnline);
    });
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    if (!this.tags().length) this.loadTags();
    this.connect();
  }

  loadTags(): void {
    if (this.metadataLoading()) return;
    this.metadataLoading.set(true);
    this.metadataError.set(false);
    this.http
      .get<TelemetryTag[]>('/api/telemetry/tags')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => {
          this.tags.set(tags);
          this.metadataLoading.set(false);
        },
        error: () => {
          this.metadataError.set(true);
          this.metadataLoading.set(false);
        },
      });
  }

  reconnect(): void {
    this.closeSource();
    this.active = true;
    this.connect();
  }

  stop(): void {
    this.active = false;
    this.closeSource();
  }

  private closeSource(): void {
    this.source?.close();
    this.source = undefined;
  }

  private connect(): void {
    this.receivedSnapshot = false;
    if (!navigator.onLine) {
      this.connection.set('reconnecting');
      return;
    }
    this.connection.set('connecting');
    const source = this.createSource('/api/telemetry/stream');
    this.source = source;

    source.addEventListener('snapshot', (event) => {
      if (this.source === source) this.accept(event as MessageEvent, true);
    });
    source.addEventListener('update', (event) => {
      if (this.source === source) this.accept(event as MessageEvent, false);
    });
    source.addEventListener('status', (event) => {
      if (this.source !== source) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data);
        if (payload.status !== 'unavailable') throw new Error('Unknown status');
        this.receivedSnapshot = false;
        this.connection.set('unavailable');
      } catch {
        this.invalidPayload();
      }
    });
    source.onerror = () => {
      if (this.source !== source) return;
      // EventSource reconnects automatically. Keep the last readings visible.
      this.receivedSnapshot = false;
      this.connection.set('reconnecting');
    };
  }

  private accept(event: MessageEvent<string>, snapshot: boolean): void {
    try {
      const readings = parseReadings(event.data);
      if (!snapshot && !this.receivedSnapshot) throw new Error('Missing snapshot');
      const next = snapshot ? new Map<number, TelemetryReading>() : new Map(this.readings());
      for (const reading of readings) next.set(reading.tag_id, reading);
      this.readings.set(next);
      this.receivedSnapshot = true;
      this.hasSnapshot.set(true);
      this.connection.set('live');
    } catch {
      this.invalidPayload();
    }
  }

  private invalidPayload(): void {
    this.stop();
    this.connection.set('invalid');
  }
}

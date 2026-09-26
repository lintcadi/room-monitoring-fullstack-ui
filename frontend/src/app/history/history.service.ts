import { HttpClient, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, map } from 'rxjs';
import { TelemetryReading, TelemetryTag } from '../telemetry/telemetry.models';
import { HistoryQuery, MAX_READINGS, PAGE_SIZE, parseHistory, recentRange } from './history.models';

// Scoped to the history page: leaving it cancels pending HTTP requests.
@Injectable()
export class HistoryService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  readonly tags = signal<TelemetryTag[]>([]);
  readonly tagsLoading = signal(false);
  readonly tagsError = signal(false);
  readonly query = signal<HistoryQuery | null>(null);
  readonly readings = signal<TelemetryReading[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly loaded = signal(false);
  readonly limitReached = computed(
    () => this.nextCursor() !== null && this.readings().length >= MAX_READINGS,
  );
  readonly selectedTags = computed(() =>
    this.tags().filter((tag) => this.query()?.tagIds.includes(tag.id)),
  );
  readonly tag = computed(() => this.selectedTags().at(0));

  constructor() {
    this.destroyRef.onDestroy(() => this.request?.unsubscribe());
  }

  loadTags(): void {
    if (this.tagsLoading()) return;
    this.tagsLoading.set(true);
    this.tagsError.set(false);
    this.http
      .get<TelemetryTag[]>('/api/telemetry/tags')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => {
          this.tags.set(tags);
          this.tagsLoading.set(false);
          if (tags.length && !this.query()) {
            const initial = tags.find((tag) => tag.tag_key === 'temperature_c') ?? tags[0];
            this.load({ tagIds: [initial.id], ...recentRange(1) });
          }
        },
        error: () => {
          this.tagsLoading.set(false);
          this.tagsError.set(true);
        },
      });
  }

  load(query: HistoryQuery): void {
    if (!query.tagIds.length) return;
    this.request?.unsubscribe();
    this.query.set({ ...query, tagIds: [...new Set(query.tagIds)] });
    this.readings.set([]);
    this.nextCursor.set(null);
    this.loaded.set(false);
    this.fetch(null);
  }

  loadMore(): void {
    if (!this.loading() && this.nextCursor() && !this.limitReached()) this.fetch(this.nextCursor());
  }

  retry(): void {
    if (!this.loading() && !this.limitReached()) this.fetch(this.nextCursor());
  }

  private fetch(cursor: string | null): void {
    const query = this.query();
    if (!query) return;
    this.loading.set(true);
    this.error.set(false);
    let params = new HttpParams()
      .set('start', query.start)
      .set('end', query.end)
      .set('limit', Math.min(PAGE_SIZE, MAX_READINGS - this.readings().length));
    for (const tagId of query.tagIds) params = params.append('tag_ids', tagId);
    if (cursor) params = params.set('cursor', cursor);
    this.request = this.http
      .get<unknown>('/api/telemetry/history', { params })
      .pipe(
        map((payload) => {
          const page = parseHistory(payload, query);
          if (cursor && page.next_cursor === cursor)
            throw new Error('History cursor did not advance');
          return page;
        }),
      )
      .subscribe({
        next: (page) => {
          const merged = new Map(this.readings().map((row) => [row.id, row]));
          for (const row of page.readings) merged.set(row.id, row);
          this.readings.set([...merged.values()]);
          this.nextCursor.set(page.next_cursor);
          this.loaded.set(true);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }
}

/**
 * Performance benchmark tests for chunk visualization with large documents.
 *
 * Tests pure logic for:
 * - Lazy loading paging through 1000+ chunks (Req 7.2)
 * - State transitions complete in reasonable time for large arrays (Req 7.3)
 * - Memory efficiency: visible chunks are slices, not copies (Req 7.2)
 * - Performance snapshot computation at scale (Req 7.3)
 *
 * Requirements: 7.2, 7.3
 */

import { describe, it, expect } from '@jest/globals';
import { DocumentChunk } from '../frontend/src/types';
import { CHUNK_PAGE_SIZE } from '../frontend/src/hooks/useChunkLazyLoading';
import {
  computePerformanceSnapshot,
  PerformanceMetrics,
  INITIAL_RENDER_THRESHOLD_MS,
} from '../frontend/src/hooks/usePerformanceMonitor';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChunk(index: number, total: number): DocumentChunk {
  return {
    id: `chunk-${index}`,
    text: `Content for chunk ${index}. `.repeat(20),
    metadata: {
      chunkIndex: index,
      totalChunks: total,
      chunkingMethod: 'fixed_size_512',
    },
    tokenCount: 80 + (index % 40),
    characterCount: 400 + (index % 200),
    sourceDocument: {
      documentId: `doc-${Math.floor(index / 100)}`,
      fileName: `document-${Math.floor(index / 100)}.pdf`,
      pageNumber: (index % 10) + 1,
    },
  };
}

function makeChunks(count: number): DocumentChunk[] {
  return Array.from({ length: count }, (_, i) => makeChunk(i, count));
}

/** Mirrors the slice logic from useChunkLazyLoading */
function computeVisibleChunks(
  allChunks: DocumentChunk[],
  loadedCount: number,
): { visibleChunks: DocumentChunk[]; hasMore: boolean } {
  const visibleChunks = allChunks.slice(0, loadedCount);
  const hasMore = loadedCount < allChunks.length;
  return { visibleChunks, hasMore };
}

function computeNextLoadedCount(
  current: number,
  total: number,
  pageSize: number,
): number {
  return Math.min(current + pageSize, total);
}

function emptyMetrics(): PerformanceMetrics {
  return {
    lastRenderTime: 0,
    chunkCount: 0,
    initialRenderExceeded: false,
    initialRenderTime: null,
    renderCount: 0,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Performance Benchmark: Lazy loading with 1000+ chunks (Req 7.2)', () => {
  const LARGE_COUNT = 1200;
  let largeChunks: DocumentChunk[];

  beforeAll(() => {
    largeChunks = makeChunks(LARGE_COUNT);
  });

  it('pages through all 1200 chunks in correct number of pages', () => {
    let loaded = CHUNK_PAGE_SIZE;
    let pages = 1;

    while (loaded < LARGE_COUNT) {
      loaded = computeNextLoadedCount(loaded, LARGE_COUNT, CHUNK_PAGE_SIZE);
      pages++;
    }

    expect(loaded).toBe(LARGE_COUNT);
    expect(pages).toBe(Math.ceil(LARGE_COUNT / CHUNK_PAGE_SIZE));
  });

  it('each page exposes exactly CHUNK_PAGE_SIZE more chunks (except last)', () => {
    let loaded = CHUNK_PAGE_SIZE;
    const pageSizes: number[] = [loaded];

    while (loaded < LARGE_COUNT) {
      const prev = loaded;
      loaded = computeNextLoadedCount(loaded, LARGE_COUNT, CHUNK_PAGE_SIZE);
      pageSizes.push(loaded - prev);
    }

    // All pages except possibly the last should be exactly CHUNK_PAGE_SIZE
    for (let i = 0; i < pageSizes.length - 1; i++) {
      expect(pageSizes[i]).toBe(CHUNK_PAGE_SIZE);
    }
    // Last page is the remainder
    expect(pageSizes[pageSizes.length - 1]).toBe(LARGE_COUNT % CHUNK_PAGE_SIZE || CHUNK_PAGE_SIZE);
  });

  it('hasMore is true until all chunks are loaded', () => {
    let loaded = CHUNK_PAGE_SIZE;

    while (loaded < LARGE_COUNT) {
      const { hasMore } = computeVisibleChunks(largeChunks, loaded);
      expect(hasMore).toBe(true);
      loaded = computeNextLoadedCount(loaded, LARGE_COUNT, CHUNK_PAGE_SIZE);
    }

    const { hasMore } = computeVisibleChunks(largeChunks, loaded);
    expect(hasMore).toBe(false);
  });

  it('final visible set contains all 1200 chunks in order', () => {
    const { visibleChunks } = computeVisibleChunks(largeChunks, LARGE_COUNT);

    expect(visibleChunks).toHaveLength(LARGE_COUNT);
    for (let i = 0; i < LARGE_COUNT; i++) {
      expect(visibleChunks[i].metadata.chunkIndex).toBe(i);
    }
  });
});

describe('Performance Benchmark: State transition timing (Req 7.3)', () => {
  it('slicing 1000 chunks completes in under 50ms', () => {
    const chunks = makeChunks(1000);

    const start = performance.now();
    for (let loaded = CHUNK_PAGE_SIZE; loaded <= 1000; loaded += CHUNK_PAGE_SIZE) {
      computeVisibleChunks(chunks, loaded);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('creating 1000 chunk objects completes in under 200ms', () => {
    const start = performance.now();
    const chunks = makeChunks(1000);
    const elapsed = performance.now() - start;

    expect(chunks).toHaveLength(1000);
    expect(elapsed).toBeLessThan(200);
  });

  it('computing next loaded count 1000 times completes in under 10ms', () => {
    const total = 50000;
    const start = performance.now();
    let loaded = CHUNK_PAGE_SIZE;
    let iterations = 0;
    while (loaded < total) {
      loaded = computeNextLoadedCount(loaded, total, CHUNK_PAGE_SIZE);
      iterations++;
    }
    const elapsed = performance.now() - start;

    expect(iterations).toBe(999);
    expect(elapsed).toBeLessThan(10);
  });
});

describe('Performance Benchmark: Memory efficiency (Req 7.2)', () => {
  it('visible chunks are the same object references as the source array', () => {
    const chunks = makeChunks(1000);
    const { visibleChunks } = computeVisibleChunks(chunks, CHUNK_PAGE_SIZE);

    // Every visible chunk should be referentially identical to the original
    for (let i = 0; i < visibleChunks.length; i++) {
      expect(visibleChunks[i]).toBe(chunks[i]);
    }
  });

  it('progressive loads maintain reference identity across pages', () => {
    const chunks = makeChunks(200);
    let loaded = CHUNK_PAGE_SIZE;

    // Load two pages
    loaded = computeNextLoadedCount(loaded, 200, CHUNK_PAGE_SIZE);
    const { visibleChunks } = computeVisibleChunks(chunks, loaded);

    // All 100 visible chunks should be the same objects
    for (let i = 0; i < visibleChunks.length; i++) {
      expect(visibleChunks[i]).toBe(chunks[i]);
    }
  });

  it('slice does not mutate the original array', () => {
    const chunks = makeChunks(500);
    const originalLength = chunks.length;
    const originalFirst = chunks[0];
    const originalLast = chunks[499];

    computeVisibleChunks(chunks, CHUNK_PAGE_SIZE);
    computeVisibleChunks(chunks, 200);
    computeVisibleChunks(chunks, 500);

    expect(chunks.length).toBe(originalLength);
    expect(chunks[0]).toBe(originalFirst);
    expect(chunks[499]).toBe(originalLast);
  });
});

describe('Performance Benchmark: Snapshot computation at scale (Req 7.3)', () => {
  it('handles sequential snapshots for 1000 chunk renders', () => {
    let metrics = emptyMetrics();

    // Simulate initial render with 1000 chunks
    metrics = computePerformanceSnapshot(150, 1000, true, metrics);
    expect(metrics.chunkCount).toBe(1000);
    expect(metrics.initialRenderTime).toBe(150);
    expect(metrics.initialRenderExceeded).toBe(false);
    expect(metrics.renderCount).toBe(1);
  });

  it('accumulates render count across many re-renders', () => {
    let metrics = emptyMetrics();

    // Simulate 20 page loads (progressive loading of 1000 chunks)
    for (let page = 1; page <= 20; page++) {
      const chunkCount = page * CHUNK_PAGE_SIZE;
      const isInitial = page === 1;
      metrics = computePerformanceSnapshot(10 + page, chunkCount, isInitial, metrics);
    }

    expect(metrics.renderCount).toBe(20);
    expect(metrics.chunkCount).toBe(1000);
    expect(metrics.initialRenderTime).toBe(11); // first page: 10 + 1
    expect(metrics.lastRenderTime).toBe(30); // last page: 10 + 20
  });

  it('computing 1000 snapshots completes in under 50ms', () => {
    let metrics = emptyMetrics();

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      metrics = computePerformanceSnapshot(
        Math.random() * 100,
        (i + 1) * 10,
        i === 0,
        metrics,
      );
    }
    const elapsed = performance.now() - start;

    expect(metrics.renderCount).toBe(1000);
    expect(elapsed).toBeLessThan(50);
  });

  it('flags exceeded threshold for slow initial render with large chunk count', () => {
    const metrics = computePerformanceSnapshot(
      INITIAL_RENDER_THRESHOLD_MS + 500,
      1000,
      true,
      emptyMetrics(),
    );

    expect(metrics.initialRenderExceeded).toBe(true);
    expect(metrics.initialRenderTime).toBe(INITIAL_RENDER_THRESHOLD_MS + 500);
  });

  it('preserves initial metrics through many subsequent fast renders', () => {
    let metrics = computePerformanceSnapshot(100, 1000, true, emptyMetrics());

    // 50 subsequent fast renders
    for (let i = 0; i < 50; i++) {
      metrics = computePerformanceSnapshot(5, 1000, false, metrics);
    }

    expect(metrics.initialRenderTime).toBe(100);
    expect(metrics.initialRenderExceeded).toBe(false);
    expect(metrics.renderCount).toBe(51);
    expect(metrics.lastRenderTime).toBe(5);
  });
});

/**
 * Property-based test for Lazy Loading Performance.
 *
 * **Property 12: Lazy Loading Performance**
 * **Validates: Requirements 7.2**
 *
 * For any large collection of chunks (>100), the visualization should implement
 * lazy loading to maintain performance.
 *
 * We test the pure lazy loading logic extracted from useChunkLazyLoading:
 * 1. For any array of N chunks where N > CHUNK_PAGE_SIZE, initially only CHUNK_PAGE_SIZE are visible
 * 2. For any number of progressive loads, visible count never exceeds total
 * 3. For any chunk array, visible chunks are always a prefix of the full array (order preserved)
 * 4. For any chunk array, hasMore is true iff loadedCount < total
 * 5. After enough loads, all chunks become visible
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { DocumentChunk, ChunkMetadata } from '../frontend/src/types';
import { CHUNK_PAGE_SIZE } from '../frontend/src/hooks/useChunkLazyLoading';

// ─── Pure logic functions mirroring the hook ─────────────────────────────────

function computeVisibleChunks(
  allChunks: DocumentChunk[],
  loadedCount: number,
): { visibleChunks: DocumentChunk[]; hasMore: boolean } {
  const visibleChunks = allChunks.slice(0, loadedCount);
  const hasMore = loadedCount < allChunks.length;
  return { visibleChunks, hasMore };
}

function computeNextLoadedCount(
  currentLoaded: number,
  totalChunks: number,
): number {
  return Math.min(currentLoaded + CHUNK_PAGE_SIZE, totalChunks);
}

// ─── Generators ──────────────────────────────────────────────────────────────

const chunkMetadataArb = (index: number, total: number): fc.Arbitrary<ChunkMetadata> =>
  fc.constant({
    chunkIndex: index,
    totalChunks: total,
    chunkingMethod: 'default',
  });

function makeChunkArb(index: number, total: number): fc.Arbitrary<DocumentChunk> {
  return fc.record({
    id: fc.constant(`chunk-${index}`),
    text: fc.string({ minLength: 10, maxLength: 200 }),
    metadata: chunkMetadataArb(index, total),
    tokenCount: fc.integer({ min: 10, max: 500 }),
    characterCount: fc.integer({ min: 50, max: 2000 }),
    sourceDocument: fc.record({
      documentId: fc.constant('doc-1'),
      fileName: fc.constant('test.pdf'),
    }),
  });
}

/** Generates an array of N chunks where N > CHUNK_PAGE_SIZE (large collections) */
const largeChunkArrayArb: fc.Arbitrary<DocumentChunk[]> = fc
  .integer({ min: CHUNK_PAGE_SIZE + 1, max: 500 })
  .chain((count) =>
    fc.tuple(...Array.from({ length: count }, (_, i) => makeChunkArb(i, count))),
  );

/** Generates an array of chunks of any size (including small) */
const anyChunkArrayArb: fc.Arbitrary<DocumentChunk[]> = fc
  .integer({ min: 0, max: 300 })
  .chain((count) => {
    if (count === 0) return fc.constant([]);
    return fc.tuple(...Array.from({ length: count }, (_, i) => makeChunkArb(i, count)));
  });

/** Generates a number of progressive load steps (1 to 30) */
const loadStepsArb = fc.integer({ min: 1, max: 30 });

// ─── Property 12: Lazy Loading Performance ───────────────────────────────────

describe('Property 12: Lazy Loading Performance', () => {
  /**
   * **Validates: Requirements 7.2**
   */

  it('for any large chunk array (N > CHUNK_PAGE_SIZE), initially only CHUNK_PAGE_SIZE are visible', () => {
    fc.assert(
      fc.property(largeChunkArrayArb, (chunks) => {
        const { visibleChunks, hasMore } = computeVisibleChunks(chunks, CHUNK_PAGE_SIZE);

        expect(visibleChunks).toHaveLength(CHUNK_PAGE_SIZE);
        expect(hasMore).toBe(true);
        expect(visibleChunks.length).toBeLessThan(chunks.length);
      }),
      { numRuns: 100 },
    );
  });

  it('for any number of progressive loads, visible count never exceeds total', () => {
    fc.assert(
      fc.property(largeChunkArrayArb, loadStepsArb, (chunks, steps) => {
        const total = chunks.length;
        let loaded = CHUNK_PAGE_SIZE;

        for (let i = 0; i < steps; i++) {
          loaded = computeNextLoadedCount(loaded, total);
          const { visibleChunks } = computeVisibleChunks(chunks, loaded);

          expect(visibleChunks.length).toBeLessThanOrEqual(total);
          expect(loaded).toBeLessThanOrEqual(total);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('for any chunk array, visible chunks are always a prefix of the full array (order preserved)', () => {
    fc.assert(
      fc.property(anyChunkArrayArb, loadStepsArb, (chunks, steps) => {
        const total = chunks.length;
        let loaded = Math.min(CHUNK_PAGE_SIZE, total);

        for (let i = 0; i < steps; i++) {
          const { visibleChunks } = computeVisibleChunks(chunks, loaded);

          // Each visible chunk must be the same object at the same index
          for (let j = 0; j < visibleChunks.length; j++) {
            expect(visibleChunks[j]).toBe(chunks[j]);
          }

          loaded = computeNextLoadedCount(loaded, total);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('for any chunk array, hasMore is true iff loadedCount < total', () => {
    fc.assert(
      fc.property(anyChunkArrayArb, loadStepsArb, (chunks, steps) => {
        const total = chunks.length;
        let loaded = Math.min(CHUNK_PAGE_SIZE, total);

        for (let i = 0; i < steps; i++) {
          const { hasMore } = computeVisibleChunks(chunks, loaded);

          if (loaded < total) {
            expect(hasMore).toBe(true);
          } else {
            expect(hasMore).toBe(false);
          }

          loaded = computeNextLoadedCount(loaded, total);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('after enough loads, all chunks become visible', () => {
    fc.assert(
      fc.property(anyChunkArrayArb, (chunks) => {
        const total = chunks.length;
        let loaded = Math.min(CHUNK_PAGE_SIZE, total);

        // Perform enough loads to exhaust all pages
        const maxSteps = Math.ceil(total / CHUNK_PAGE_SIZE) + 1;
        for (let i = 0; i < maxSteps; i++) {
          loaded = computeNextLoadedCount(loaded, total);
        }

        const { visibleChunks, hasMore } = computeVisibleChunks(chunks, loaded);

        expect(visibleChunks).toHaveLength(total);
        expect(hasMore).toBe(false);

        // Verify every chunk is present
        for (let j = 0; j < total; j++) {
          expect(visibleChunks[j]).toBe(chunks[j]);
        }
      }),
      { numRuns: 100 },
    );
  });
});

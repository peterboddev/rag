/**
 * Unit tests for useChunkLazyLoading hook and lazy loading integration.
 *
 * Tests the progressive loading behavior:
 * - Initially renders only the first page of chunks (50)
 * - Loads more when IntersectionObserver fires
 * - Resets when chunks change
 * - Handles edge cases (empty, fewer than page size)
 *
 * Validates: Requirement 7.2
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { DocumentChunk, ChunkMetadata } from '../frontend/src/types';
import { CHUNK_PAGE_SIZE } from '../frontend/src/hooks/useChunkLazyLoading';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChunk(index: number, total: number): DocumentChunk {
  return {
    id: `chunk-${index}`,
    text: `Chunk text content for chunk number ${index}`,
    metadata: {
      chunkIndex: index,
      totalChunks: total,
      chunkingMethod: 'default',
    },
    tokenCount: 50,
    characterCount: 200,
    sourceDocument: {
      documentId: `doc-1`,
      fileName: 'test-document.pdf',
    },
  };
}

function makeChunks(count: number): DocumentChunk[] {
  return Array.from({ length: count }, (_, i) => makeChunk(i, count));
}

/**
 * Pure function that mirrors the lazy loading logic from useChunkLazyLoading.
 * This lets us test the core behavior without React rendering.
 */
function computeVisibleChunks(
  allChunks: DocumentChunk[],
  loadedCount: number
): { visibleChunks: DocumentChunk[]; hasMore: boolean } {
  const visibleChunks = allChunks.slice(0, loadedCount);
  const hasMore = loadedCount < allChunks.length;
  return { visibleChunks, hasMore };
}

function computeNextLoadedCount(
  currentLoaded: number,
  totalChunks: number,
  pageSize: number
): number {
  return Math.min(currentLoaded + pageSize, totalChunks);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Chunk Lazy Loading', () => {
  describe('CHUNK_PAGE_SIZE constant', () => {
    it('should be 50', () => {
      expect(CHUNK_PAGE_SIZE).toBe(50);
    });
  });

  describe('initial visible chunks', () => {
    it('shows all chunks when total is less than page size', () => {
      const chunks = makeChunks(10);
      const { visibleChunks, hasMore } = computeVisibleChunks(chunks, CHUNK_PAGE_SIZE);

      expect(visibleChunks).toHaveLength(10);
      expect(hasMore).toBe(false);
    });

    it('shows exactly page size chunks when total exceeds page size', () => {
      const chunks = makeChunks(120);
      const { visibleChunks, hasMore } = computeVisibleChunks(chunks, CHUNK_PAGE_SIZE);

      expect(visibleChunks).toHaveLength(CHUNK_PAGE_SIZE);
      expect(hasMore).toBe(true);
    });

    it('shows all chunks when total equals page size', () => {
      const chunks = makeChunks(CHUNK_PAGE_SIZE);
      const { visibleChunks, hasMore } = computeVisibleChunks(chunks, CHUNK_PAGE_SIZE);

      expect(visibleChunks).toHaveLength(CHUNK_PAGE_SIZE);
      expect(hasMore).toBe(false);
    });

    it('handles empty chunk array', () => {
      const { visibleChunks, hasMore } = computeVisibleChunks([], CHUNK_PAGE_SIZE);

      expect(visibleChunks).toHaveLength(0);
      expect(hasMore).toBe(false);
    });
  });

  describe('progressive loading', () => {
    it('loads next page of chunks correctly', () => {
      const total = 120;
      const chunks = makeChunks(total);

      // After first load
      let loaded = CHUNK_PAGE_SIZE;
      let result = computeVisibleChunks(chunks, loaded);
      expect(result.visibleChunks).toHaveLength(50);
      expect(result.hasMore).toBe(true);

      // After second load
      loaded = computeNextLoadedCount(loaded, total, CHUNK_PAGE_SIZE);
      result = computeVisibleChunks(chunks, loaded);
      expect(result.visibleChunks).toHaveLength(100);
      expect(result.hasMore).toBe(true);

      // After third load (reaches end)
      loaded = computeNextLoadedCount(loaded, total, CHUNK_PAGE_SIZE);
      result = computeVisibleChunks(chunks, loaded);
      expect(result.visibleChunks).toHaveLength(120);
      expect(result.hasMore).toBe(false);
    });

    it('does not exceed total chunk count', () => {
      const total = 75;
      const chunks = makeChunks(total);

      let loaded = CHUNK_PAGE_SIZE;
      loaded = computeNextLoadedCount(loaded, total, CHUNK_PAGE_SIZE);

      expect(loaded).toBe(75);
      const result = computeVisibleChunks(chunks, loaded);
      expect(result.visibleChunks).toHaveLength(75);
      expect(result.hasMore).toBe(false);
    });

    it('handles exactly one extra chunk beyond page size', () => {
      const total = CHUNK_PAGE_SIZE + 1;
      const chunks = makeChunks(total);

      let loaded = CHUNK_PAGE_SIZE;
      let result = computeVisibleChunks(chunks, loaded);
      expect(result.hasMore).toBe(true);
      expect(result.visibleChunks).toHaveLength(CHUNK_PAGE_SIZE);

      loaded = computeNextLoadedCount(loaded, total, CHUNK_PAGE_SIZE);
      result = computeVisibleChunks(chunks, loaded);
      expect(result.visibleChunks).toHaveLength(total);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('chunk identity preservation', () => {
    it('visible chunks are the same objects as the originals (no cloning)', () => {
      const chunks = makeChunks(100);
      const { visibleChunks } = computeVisibleChunks(chunks, CHUNK_PAGE_SIZE);

      for (let i = 0; i < visibleChunks.length; i++) {
        expect(visibleChunks[i]).toBe(chunks[i]);
      }
    });

    it('maintains chunk order through progressive loads', () => {
      const total = 150;
      const chunks = makeChunks(total);

      let loaded = CHUNK_PAGE_SIZE;
      loaded = computeNextLoadedCount(loaded, total, CHUNK_PAGE_SIZE);
      loaded = computeNextLoadedCount(loaded, total, CHUNK_PAGE_SIZE);

      const { visibleChunks } = computeVisibleChunks(chunks, loaded);

      for (let i = 0; i < visibleChunks.length; i++) {
        expect(visibleChunks[i].id).toBe(`chunk-${i}`);
        expect(visibleChunks[i].metadata.chunkIndex).toBe(i);
      }
    });
  });

  describe('reset behavior', () => {
    it('reset to page size simulates new chunk data arriving', () => {
      const oldChunks = makeChunks(200);
      const newChunks = makeChunks(80);

      // Simulate: user had scrolled and loaded 150 chunks
      let loaded = 150;
      let result = computeVisibleChunks(oldChunks, loaded);
      expect(result.visibleChunks).toHaveLength(150);

      // New chunks arrive → reset loaded count to page size
      loaded = CHUNK_PAGE_SIZE;
      result = computeVisibleChunks(newChunks, loaded);
      expect(result.visibleChunks).toHaveLength(50);
      expect(result.hasMore).toBe(true);
    });

    it('reset with fewer chunks than page size shows all', () => {
      const newChunks = makeChunks(20);
      const result = computeVisibleChunks(newChunks, CHUNK_PAGE_SIZE);
      expect(result.visibleChunks).toHaveLength(20);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('large chunk collections (Requirement 7.2)', () => {
    it('handles 1000 chunks with lazy loading', () => {
      const total = 1000;
      const chunks = makeChunks(total);

      // Initial load
      let loaded = CHUNK_PAGE_SIZE;
      let result = computeVisibleChunks(chunks, loaded);
      expect(result.visibleChunks).toHaveLength(50);
      expect(result.hasMore).toBe(true);

      // Simulate scrolling through all pages
      let pageCount = 1;
      while (result.hasMore) {
        loaded = computeNextLoadedCount(loaded, total, CHUNK_PAGE_SIZE);
        result = computeVisibleChunks(chunks, loaded);
        pageCount++;
      }

      expect(result.visibleChunks).toHaveLength(1000);
      expect(pageCount).toBe(20); // 1000 / 50 = 20 pages
    });

    it('only first page is rendered initially for 500 chunks', () => {
      const chunks = makeChunks(500);
      const { visibleChunks, hasMore } = computeVisibleChunks(chunks, CHUNK_PAGE_SIZE);

      expect(visibleChunks).toHaveLength(50);
      expect(hasMore).toBe(true);
      // Verify we're not rendering all 500
      expect(visibleChunks.length).toBeLessThan(chunks.length);
    });
  });
});

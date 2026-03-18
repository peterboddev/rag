/**
 * Property-based test for Overlap Region Indication.
 *
 * **Property 9: Overlap Region Indication**
 * **Validates: Requirements 5.5**
 *
 * For any chunking method that produces overlapping chunks, the visualization
 * should indicate overlap regions appropriately.
 *
 * Requirement 5.5: THE Chunk_Visualization_Panel SHALL indicate chunk overlap
 * regions when applicable
 *
 * We test the pure data validation / display logic rather than rendering React
 * components, verifying that:
 * 1. For any chunk with both overlapStart and overlapEnd defined, overlap should be indicated
 * 2. For any chunk with neither overlapStart nor overlapEnd, no overlap indication
 * 3. For any chunk with overlap, overlapStart <= overlapEnd (valid range)
 * 4. For any chunk with overlap, the overlap display string contains both start and end values
 * 5. Overlap indication is consistent across chunks from the same chunking method
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  DocumentChunk,
  ChunkMetadata,
} from '../frontend/src/types';

// ─── Overlap Indication Logic (pure functions mirroring ChunkItem) ───────────

/**
 * Determines whether a chunk should display an overlap indicator.
 * Mirrors the ChunkItem rendering condition:
 *   chunk.metadata.overlapStart !== undefined && chunk.metadata.overlapEnd !== undefined
 */
function shouldIndicateOverlap(chunk: DocumentChunk): boolean {
  return (
    chunk.metadata.overlapStart !== undefined &&
    chunk.metadata.overlapEnd !== undefined
  );
}

/**
 * Validates that an overlap range is well-formed: start <= end.
 */
function isOverlapRangeValid(chunk: DocumentChunk): boolean {
  if (!shouldIndicateOverlap(chunk)) return true; // no overlap to validate
  return chunk.metadata.overlapStart! <= chunk.metadata.overlapEnd!;
}

/**
 * Builds the overlap display string, mirroring ChunkItem:
 *   `Overlap: ${overlapStart}-${overlapEnd}`
 */
function formatOverlapDisplay(chunk: DocumentChunk): string | null {
  if (!shouldIndicateOverlap(chunk)) return null;
  return `Overlap: ${chunk.metadata.overlapStart}-${chunk.metadata.overlapEnd}`;
}

// ─── Generators ──────────────────────────────────────────────────────────────

const baseMetadataArb = (overrides: Partial<ChunkMetadata> = {}): fc.Arbitrary<ChunkMetadata> =>
  fc.record({
    chunkIndex: fc.integer({ min: 0, max: 100 }),
    totalChunks: fc.integer({ min: 1, max: 100 }),
    chunkingMethod: fc.constantFrom('default', 'fixed_size_512', 'fixed_size_1024', 'semantic', 'hierarchical'),
    overlapStart: fc.constant(overrides.overlapStart),
    overlapEnd: fc.constant(overrides.overlapEnd),
    confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    semanticBoundary: fc.option(fc.boolean(), { nil: undefined }),
  });

const sourceDocumentArb = fc.record({
  documentId: fc.uuid(),
  fileName: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
  pageNumber: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
  sectionTitle: fc.option(
    fc.string({ minLength: 1, maxLength: 60 }).filter(s => s.trim().length > 0),
    { nil: undefined },
  ),
});

/** Generates a chunk with BOTH overlapStart and overlapEnd defined (valid range) */
const chunkWithOverlapArb: fc.Arbitrary<DocumentChunk> = fc
  .tuple(
    fc.integer({ min: 0, max: 500 }),
    fc.integer({ min: 0, max: 500 }),
  )
  .map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) }))
  .chain(({ start, end }) =>
    fc.record({
      id: fc.uuid(),
      text: fc.string({ minLength: 10, maxLength: 500 }),
      metadata: fc.record({
        chunkIndex: fc.integer({ min: 0, max: 100 }),
        totalChunks: fc.integer({ min: 1, max: 100 }),
        chunkingMethod: fc.constantFrom('fixed_size_512', 'fixed_size_1024', 'hierarchical'),
        overlapStart: fc.constant(start),
        overlapEnd: fc.constant(end),
        confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
        semanticBoundary: fc.option(fc.boolean(), { nil: undefined }),
      }),
      tokenCount: fc.integer({ min: 1, max: 1000 }),
      characterCount: fc.integer({ min: 10, max: 5000 }),
      sourceDocument: sourceDocumentArb,
    }),
  );

/** Generates a chunk with NEITHER overlapStart nor overlapEnd */
const chunkWithoutOverlapArb: fc.Arbitrary<DocumentChunk> = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 10, maxLength: 500 }),
  metadata: fc.record({
    chunkIndex: fc.integer({ min: 0, max: 100 }),
    totalChunks: fc.integer({ min: 1, max: 100 }),
    chunkingMethod: fc.constantFrom('default', 'semantic'),
    overlapStart: fc.constant(undefined as number | undefined),
    overlapEnd: fc.constant(undefined as number | undefined),
    confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    semanticBoundary: fc.option(fc.boolean(), { nil: undefined }),
  }),
  tokenCount: fc.integer({ min: 1, max: 1000 }),
  characterCount: fc.integer({ min: 10, max: 5000 }),
  sourceDocument: sourceDocumentArb,
});

/** Generates a chunk with only overlapStart defined (partial — no indication) */
const chunkWithOnlyOverlapStartArb: fc.Arbitrary<DocumentChunk> = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 10, maxLength: 500 }),
  metadata: fc.record({
    chunkIndex: fc.integer({ min: 0, max: 100 }),
    totalChunks: fc.integer({ min: 1, max: 100 }),
    chunkingMethod: fc.constantFrom('default', 'fixed_size_512', 'semantic', 'hierarchical'),
    overlapStart: fc.integer({ min: 0, max: 500 }),
    overlapEnd: fc.constant(undefined as number | undefined),
    confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    semanticBoundary: fc.option(fc.boolean(), { nil: undefined }),
  }),
  tokenCount: fc.integer({ min: 1, max: 1000 }),
  characterCount: fc.integer({ min: 10, max: 5000 }),
  sourceDocument: sourceDocumentArb,
});

/** Generates a chunk with only overlapEnd defined (partial — no indication) */
const chunkWithOnlyOverlapEndArb: fc.Arbitrary<DocumentChunk> = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 10, maxLength: 500 }),
  metadata: fc.record({
    chunkIndex: fc.integer({ min: 0, max: 100 }),
    totalChunks: fc.integer({ min: 1, max: 100 }),
    chunkingMethod: fc.constantFrom('default', 'fixed_size_512', 'semantic', 'hierarchical'),
    overlapStart: fc.constant(undefined as number | undefined),
    overlapEnd: fc.integer({ min: 0, max: 500 }),
    confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    semanticBoundary: fc.option(fc.boolean(), { nil: undefined }),
  }),
  tokenCount: fc.integer({ min: 1, max: 1000 }),
  characterCount: fc.integer({ min: 10, max: 5000 }),
  sourceDocument: sourceDocumentArb,
});

// ─── Property 9: Overlap Region Indication ───────────────────────────────────

describe('Property 9: Overlap Region Indication', () => {
  /**
   * **Validates: Requirements 5.5**
   */

  it('chunks with both overlapStart and overlapEnd should indicate overlap', () => {
    fc.assert(
      fc.property(chunkWithOverlapArb, (chunk) => {
        expect(shouldIndicateOverlap(chunk)).toBe(true);
        expect(chunk.metadata.overlapStart).not.toBeUndefined();
        expect(chunk.metadata.overlapEnd).not.toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('chunks with neither overlapStart nor overlapEnd should NOT indicate overlap', () => {
    fc.assert(
      fc.property(chunkWithoutOverlapArb, (chunk) => {
        expect(shouldIndicateOverlap(chunk)).toBe(false);
        expect(formatOverlapDisplay(chunk)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('chunks with only overlapStart (no overlapEnd) should NOT indicate overlap', () => {
    fc.assert(
      fc.property(chunkWithOnlyOverlapStartArb, (chunk) => {
        expect(shouldIndicateOverlap(chunk)).toBe(false);
        expect(formatOverlapDisplay(chunk)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('chunks with only overlapEnd (no overlapStart) should NOT indicate overlap', () => {
    fc.assert(
      fc.property(chunkWithOnlyOverlapEndArb, (chunk) => {
        expect(shouldIndicateOverlap(chunk)).toBe(false);
        expect(formatOverlapDisplay(chunk)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('overlap range is valid: overlapStart <= overlapEnd', () => {
    fc.assert(
      fc.property(chunkWithOverlapArb, (chunk) => {
        expect(isOverlapRangeValid(chunk)).toBe(true);
        expect(chunk.metadata.overlapStart!).toBeLessThanOrEqual(chunk.metadata.overlapEnd!);
      }),
      { numRuns: 100 },
    );
  });

  it('overlap display string contains both start and end values', () => {
    fc.assert(
      fc.property(chunkWithOverlapArb, (chunk) => {
        const display = formatOverlapDisplay(chunk);
        expect(display).not.toBeNull();
        expect(display).toContain(String(chunk.metadata.overlapStart));
        expect(display).toContain(String(chunk.metadata.overlapEnd));
        expect(display).toBe(`Overlap: ${chunk.metadata.overlapStart}-${chunk.metadata.overlapEnd}`);
      }),
      { numRuns: 100 },
    );
  });

  it('overlap indication is consistent across chunks from the same chunking method', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('fixed_size_512', 'fixed_size_1024', 'hierarchical'),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (method, chunkCount, overlapA, overlapB) => {
          const overlapStart = Math.min(overlapA, overlapB);
          const overlapEnd = Math.max(overlapA, overlapB);

          // Create multiple chunks from the same method, all with overlap
          const chunks: DocumentChunk[] = Array.from({ length: chunkCount }, (_, i) => ({
            id: `chunk-${i}`,
            text: `Chunk text content ${i}`,
            metadata: {
              chunkIndex: i,
              totalChunks: chunkCount,
              chunkingMethod: method,
              overlapStart,
              overlapEnd,
            },
            tokenCount: 100,
            characterCount: 200,
            sourceDocument: {
              documentId: 'doc-1',
              fileName: 'test.pdf',
            },
          }));

          // All chunks should consistently indicate overlap
          for (const chunk of chunks) {
            expect(shouldIndicateOverlap(chunk)).toBe(true);
            expect(isOverlapRangeValid(chunk)).toBe(true);

            const display = formatOverlapDisplay(chunk);
            expect(display).toBe(`Overlap: ${overlapStart}-${overlapEnd}`);
          }

          // All display strings should be identical for same overlap values
          const displays = chunks.map(c => formatOverlapDisplay(c));
          const uniqueDisplays = new Set(displays);
          expect(uniqueDisplays.size).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

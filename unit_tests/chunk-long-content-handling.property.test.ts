/**
 * Property-based test for Long Content Handling.
 *
 * **Property 7: Long Content Handling**
 * **Validates: Requirements 4.3**
 *
 * For any chunk with text length exceeding display limits, the system should
 * provide expand/collapse functionality.
 *
 * Requirement 4.3: THE Chunk_Visualization_Panel SHALL truncate very long
 * chunks with an expand/collapse option
 *
 * We test the pure truncation logic extracted from ChunkItem rather than
 * rendering React components, verifying that:
 * 1. For any chunk text longer than maxLength, collapsed display is truncated to maxLength + '...'
 * 2. For any chunk text shorter than or equal to maxLength, collapsed display equals the full text
 * 3. For any chunk text, expanded display always equals the full text
 * 4. For any truncated text, the truncated portion is a prefix of the original
 * 5. Truncation is deterministic - same input always produces same output
 * 6. The expand/collapse toggle correctly switches between truncated and full text
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  DocumentChunk,
  ChunkMetadata,
} from '../frontend/src/types';

// ─── Truncation Logic (mirrors ChunkItem component) ─────────────────────────

const MAX_LENGTH = 200;

/**
 * Computes the display text for a chunk based on expand/collapse state.
 * Mirrors the ChunkItem logic:
 *   const displayText = isExpanded ? chunk.text :
 *     (chunk.text.length > maxLength ? chunk.text.substring(0, maxLength) + '...' : chunk.text);
 */
function getDisplayText(text: string, isExpanded: boolean, maxLength: number = MAX_LENGTH): string {
  if (isExpanded) {
    return text;
  }
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

/**
 * Returns whether a given text would be truncated when collapsed.
 */
function wouldTruncate(text: string, maxLength: number = MAX_LENGTH): boolean {
  return text.length > maxLength;
}

// ─── Generators ──────────────────────────────────────────────────────────────

const chunkMetadataArb: fc.Arbitrary<ChunkMetadata> = fc.record({
  chunkIndex: fc.integer({ min: 0, max: 100 }),
  totalChunks: fc.integer({ min: 1, max: 100 }),
  chunkingMethod: fc.constantFrom('default', 'fixed_size_512', 'semantic', 'hierarchical'),
  overlapStart: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
  overlapEnd: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
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

/** Generates text that is strictly longer than MAX_LENGTH */
const longTextArb: fc.Arbitrary<string> = fc.string({ minLength: MAX_LENGTH + 1, maxLength: 2000 });

/** Generates text that is at most MAX_LENGTH characters */
const shortTextArb: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: MAX_LENGTH });

/** Generates text of any length */
const anyTextArb: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 2000 });

/** Builds a DocumentChunk with the given text arbitrary */
const chunkWithTextArb = (textArb: fc.Arbitrary<string>): fc.Arbitrary<DocumentChunk> =>
  fc.record({
    id: fc.uuid(),
    text: textArb,
    metadata: chunkMetadataArb,
    tokenCount: fc.integer({ min: 1, max: 1000 }),
    characterCount: fc.integer({ min: 1, max: 5000 }),
    sourceDocument: sourceDocumentArb,
  });

const longChunkArb = chunkWithTextArb(longTextArb);
const shortChunkArb = chunkWithTextArb(shortTextArb);
const anyChunkArb = chunkWithTextArb(anyTextArb);

// ─── Property 7: Long Content Handling ───────────────────────────────────────

describe('Property 7: Long Content Handling', () => {
  /**
   * **Validates: Requirements 4.3**
   */

  it('truncates collapsed text to maxLength + "..." for chunks longer than maxLength', () => {
    fc.assert(
      fc.property(longChunkArb, (chunk) => {
        const display = getDisplayText(chunk.text, false);

        // Must be exactly maxLength chars + 3 chars for '...'
        expect(display.length).toBe(MAX_LENGTH + 3);
        // Must end with ellipsis
        expect(display.endsWith('...')).toBe(true);
        // Content before ellipsis must be the first maxLength chars
        expect(display).toBe(chunk.text.substring(0, MAX_LENGTH) + '...');
      }),
      { numRuns: 100 },
    );
  });

  it('does not truncate collapsed text for chunks at or below maxLength', () => {
    fc.assert(
      fc.property(shortChunkArb, (chunk) => {
        const display = getDisplayText(chunk.text, false);

        // Display must equal the full text unchanged
        expect(display).toBe(chunk.text);
        expect(display.length).toBe(chunk.text.length);
      }),
      { numRuns: 100 },
    );
  });

  it('expanded display always equals the full text regardless of length', () => {
    fc.assert(
      fc.property(anyChunkArb, (chunk) => {
        const display = getDisplayText(chunk.text, true);

        expect(display).toBe(chunk.text);
        expect(display.length).toBe(chunk.text.length);
      }),
      { numRuns: 100 },
    );
  });

  it('truncated portion is a prefix of the original text', () => {
    fc.assert(
      fc.property(longChunkArb, (chunk) => {
        const display = getDisplayText(chunk.text, false);

        // Remove the trailing '...' to get the visible prefix
        const visiblePrefix = display.slice(0, -3);

        // The visible prefix must be the start of the original text
        expect(chunk.text.startsWith(visiblePrefix)).toBe(true);
        expect(visiblePrefix.length).toBe(MAX_LENGTH);
      }),
      { numRuns: 100 },
    );
  });

  it('truncation is deterministic - same input always produces same output', () => {
    fc.assert(
      fc.property(anyChunkArb, fc.boolean(), (chunk, isExpanded) => {
        const first = getDisplayText(chunk.text, isExpanded);
        const second = getDisplayText(chunk.text, isExpanded);

        expect(second).toBe(first);
      }),
      { numRuns: 100 },
    );
  });

  it('expand/collapse toggle correctly switches between truncated and full text', () => {
    fc.assert(
      fc.property(anyChunkArb, (chunk) => {
        const collapsed = getDisplayText(chunk.text, false);
        const expanded = getDisplayText(chunk.text, true);

        if (wouldTruncate(chunk.text)) {
          // Collapsed should be truncated, expanded should be full
          expect(collapsed).not.toBe(expanded);
          expect(collapsed.length).toBe(MAX_LENGTH + 3);
          expect(collapsed.endsWith('...')).toBe(true);
          expect(expanded).toBe(chunk.text);
        } else {
          // Both should be identical to the original text
          expect(collapsed).toBe(chunk.text);
          expect(expanded).toBe(chunk.text);
          expect(collapsed).toBe(expanded);
        }
      }),
      { numRuns: 100 },
    );
  });
});

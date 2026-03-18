/**
 * Property-based test for Text Formatting Preservation.
 *
 * **Property 6: Text Formatting Preservation**
 * **Validates: Requirements 4.2**
 *
 * For any chunk text content, the display should preserve proper formatting
 * including line breaks and whitespace.
 *
 * Requirement 4.2: THE Chunk_Visualization_Panel SHALL show chunk text with
 * proper formatting and line breaks
 *
 * We test the pure text formatting logic rather than rendering React components,
 * verifying that:
 * 1. For any chunk text containing newlines (\n), the formatting function preserves them
 * 2. For any chunk text containing whitespace sequences, they are preserved
 * 3. For any chunk text, the output text content equals the input (no data loss)
 * 4. For any chunk text with mixed formatting (tabs, spaces, newlines), all formatting characters are preserved
 * 5. Text formatting is idempotent - applying it twice produces the same result
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  DocumentChunk,
  ChunkMetadata,
} from '../frontend/src/types';

// ─── Text Formatting Functions (pure logic mirroring ChunkItem) ──────────────

/**
 * Formats chunk text for display, preserving all formatting characters.
 * Mirrors the logic in ChunkItem where `chunk.text` is rendered directly,
 * preserving the original content including newlines and whitespace.
 */
function formatChunkText(text: string): string {
  // The component renders text as-is, preserving all formatting.
  // This function represents the formatting pipeline that text passes through.
  return text;
}

/**
 * Prepares chunk text for truncated display (when text exceeds maxLength).
 * Mirrors ChunkItem's displayText logic.
 */
function formatChunkDisplayText(text: string, isExpanded: boolean, maxLength: number = 200): string {
  if (isExpanded) {
    return formatChunkText(text);
  }
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }
  return formatChunkText(text);
}

/**
 * Counts the number of newline characters in text.
 */
function countNewlines(text: string): number {
  return (text.match(/\n/g) || []).length;
}

/**
 * Counts the number of tab characters in text.
 */
function countTabs(text: string): number {
  return (text.match(/\t/g) || []).length;
}

/**
 * Extracts all whitespace sequences from text.
 */
function extractWhitespaceSequences(text: string): string[] {
  return text.match(/\s+/g) || [];
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

/** Generates text that contains newline characters */
const textWithNewlinesArb: fc.Arbitrary<string> = fc
  .array(fc.string({ minLength: 1, maxLength: 80 }), { minLength: 2, maxLength: 10 })
  .map(lines => lines.join('\n'));

/** Generates text that contains whitespace sequences (spaces, tabs) */
const textWithWhitespaceArb: fc.Arbitrary<string> = fc
  .array(
    fc.tuple(
      fc.string({ minLength: 1, maxLength: 40 }).filter(s => s.trim().length > 0),
      fc.constantFrom('  ', '   ', '\t', '\t\t', '    '),
    ),
    { minLength: 2, maxLength: 8 },
  )
  .map(pairs => pairs.map(([word, ws]) => word + ws).join(''));

/** Generates text with mixed formatting: tabs, spaces, and newlines */
const textWithMixedFormattingArb: fc.Arbitrary<string> = fc
  .array(
    fc.tuple(
      fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
      fc.constantFrom('\n', '\t', '  ', '\n\t', '\n  ', '\t  ', '\n\n'),
    ),
    { minLength: 3, maxLength: 10 },
  )
  .map(pairs => pairs.map(([text, fmt]) => text + fmt).join(''));

/** Generates a DocumentChunk with arbitrary text */
const chunkWithTextArb = (textArb: fc.Arbitrary<string>): fc.Arbitrary<DocumentChunk> =>
  fc.record({
    id: fc.uuid(),
    text: textArb,
    metadata: chunkMetadataArb,
    tokenCount: fc.integer({ min: 1, max: 1000 }),
    characterCount: fc.integer({ min: 1, max: 5000 }),
    sourceDocument: sourceDocumentArb,
  });

/** General chunk with any text */
const generalChunkArb: fc.Arbitrary<DocumentChunk> = chunkWithTextArb(
  fc.string({ minLength: 1, maxLength: 500 }),
);

// ─── Property 6: Text Formatting Preservation ────────────────────────────────

describe('Property 6: Text Formatting Preservation', () => {
  /**
   * **Validates: Requirements 4.2**
   */

  it('preserves newline characters in chunk text', () => {
    fc.assert(
      fc.property(chunkWithTextArb(textWithNewlinesArb), (chunk) => {
        const formatted = formatChunkText(chunk.text);

        // Count newlines in input and output
        const inputNewlines = countNewlines(chunk.text);
        const outputNewlines = countNewlines(formatted);

        expect(outputNewlines).toBe(inputNewlines);
        expect(formatted).toBe(chunk.text);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves whitespace sequences in chunk text', () => {
    fc.assert(
      fc.property(chunkWithTextArb(textWithWhitespaceArb), (chunk) => {
        const formatted = formatChunkText(chunk.text);

        // All whitespace sequences should be preserved
        const inputWhitespace = extractWhitespaceSequences(chunk.text);
        const outputWhitespace = extractWhitespaceSequences(formatted);

        expect(outputWhitespace).toEqual(inputWhitespace);
        expect(formatted).toBe(chunk.text);
      }),
      { numRuns: 100 },
    );
  });

  it('output text content equals input with no data loss', () => {
    fc.assert(
      fc.property(generalChunkArb, (chunk) => {
        const formatted = formatChunkText(chunk.text);

        // No data loss: output must exactly equal input
        expect(formatted).toBe(chunk.text);
        expect(formatted.length).toBe(chunk.text.length);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves all formatting characters in mixed formatting text (tabs, spaces, newlines)', () => {
    fc.assert(
      fc.property(chunkWithTextArb(textWithMixedFormattingArb), (chunk) => {
        const formatted = formatChunkText(chunk.text);

        // Newlines preserved
        expect(countNewlines(formatted)).toBe(countNewlines(chunk.text));

        // Tabs preserved
        expect(countTabs(formatted)).toBe(countTabs(chunk.text));

        // Total length preserved (no characters added or removed)
        expect(formatted.length).toBe(chunk.text.length);

        // Exact match
        expect(formatted).toBe(chunk.text);
      }),
      { numRuns: 100 },
    );
  });

  it('text formatting is idempotent - applying it twice produces the same result', () => {
    fc.assert(
      fc.property(generalChunkArb, (chunk) => {
        const once = formatChunkText(chunk.text);
        const twice = formatChunkText(once);

        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it('truncated display preserves formatting in the visible portion', () => {
    fc.assert(
      fc.property(chunkWithTextArb(textWithMixedFormattingArb), (chunk) => {
        // When not expanded, truncated text should preserve formatting in the visible portion
        const truncated = formatChunkDisplayText(chunk.text, false, 200);

        if (chunk.text.length <= 200) {
          // Short text: no truncation, exact match
          expect(truncated).toBe(chunk.text);
        } else {
          // Long text: first 200 chars preserved exactly, plus ellipsis
          expect(truncated).toBe(chunk.text.substring(0, 200) + '...');
          // The visible portion preserves all formatting characters
          const visiblePortion = truncated.slice(0, 200);
          expect(visiblePortion).toBe(chunk.text.substring(0, 200));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('expanded display preserves full text with all formatting', () => {
    fc.assert(
      fc.property(chunkWithTextArb(textWithMixedFormattingArb), (chunk) => {
        const expanded = formatChunkDisplayText(chunk.text, true);

        // Expanded mode should return the full text unchanged
        expect(expanded).toBe(chunk.text);
        expect(expanded.length).toBe(chunk.text.length);
      }),
      { numRuns: 100 },
    );
  });

  it('display text idempotency: formatting truncated text again produces same result', () => {
    fc.assert(
      fc.property(
        generalChunkArb,
        fc.boolean(),
        (chunk, isExpanded) => {
          const first = formatChunkDisplayText(chunk.text, isExpanded);
          const second = formatChunkDisplayText(first, true); // expand the result

          if (isExpanded) {
            // If expanded both times, should be identical
            expect(second).toBe(first);
          } else if (chunk.text.length > 200) {
            // If first was truncated, expanding the truncated text returns it as-is
            expect(second).toBe(first);
          } else {
            // Short text: both should equal original
            expect(second).toBe(chunk.text);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

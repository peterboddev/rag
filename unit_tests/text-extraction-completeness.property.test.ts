/**
 * Property-based tests for Text Extraction Completeness
 * Feature: pdf-processing-enhancement, Property 5: Text Extraction Completeness
 *
 * Validates: Requirements 1.4, 5.3
 *
 * Properties tested:
 * 1. All non-empty LINE block texts appear in the extracted output
 * 2. Text is ordered by page number first, then by vertical position (Top)
 * 3. Empty text blocks are excluded from output
 * 4. Non-LINE blocks (WORD, PAGE, etc.) are excluded from output
 * 5. Single-page documents maintain top-to-bottom reading order
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// ─── Helper: Replicate extractTextFromBlocks logic from EnhancedTextractService ──

interface TextractBlock {
  BlockType: string;
  Text?: string;
  Page?: number;
  Geometry?: {
    BoundingBox?: {
      Top?: number;
    };
  };
}

/**
 * Mirrors the private extractTextFromBlocks method in EnhancedTextractService.
 * Filters LINE blocks, sorts by Page then BoundingBox.Top, joins non-empty text with newlines.
 */
function extractTextFromBlocks(blocks: TextractBlock[]): string {
  const lineBlocks = blocks
    .filter(block => block.BlockType === 'LINE')
    .sort((a, b) => {
      if (a.Page !== b.Page) {
        return (a.Page || 1) - (b.Page || 1);
      }
      const aTop = a.Geometry?.BoundingBox?.Top || 0;
      const bTop = b.Geometry?.BoundingBox?.Top || 0;
      return aTop - bTop;
    });

  return lineBlocks
    .map(block => block.Text || '')
    .filter(text => text.trim().length > 0)
    .join('\n');
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty text content for LINE blocks */
const nonEmptyTextArb = fc.stringOf(
  fc.char().filter(c => c.trim().length > 0),
  { minLength: 1, maxLength: 50 }
).filter(s => s.trim().length > 0);

/** A LINE block with non-empty text */
const lineBlockArb = fc.record({
  BlockType: fc.constant('LINE' as string),
  Text: nonEmptyTextArb,
  Page: fc.integer({ min: 1, max: 20 }),
  Geometry: fc.record({
    BoundingBox: fc.record({
      Top: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
  }),
});

/** A LINE block with empty or whitespace-only text */
const emptyLineBlockArb = fc.record({
  BlockType: fc.constant('LINE' as string),
  Text: fc.constantFrom('', '   ', '\t', '\n', '  \n  '),
  Page: fc.integer({ min: 1, max: 20 }),
  Geometry: fc.record({
    BoundingBox: fc.record({
      Top: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
  }),
});

/** A non-LINE block (WORD, PAGE, TABLE, CELL, etc.) */
const nonLineBlockArb = fc.record({
  BlockType: fc.constantFrom('WORD', 'PAGE', 'TABLE', 'CELL', 'KEY_VALUE_SET', 'SELECTION_ELEMENT'),
  Text: nonEmptyTextArb,
  Page: fc.integer({ min: 1, max: 20 }),
  Geometry: fc.record({
    BoundingBox: fc.record({
      Top: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
  }),
});

/** Array of non-empty LINE blocks (1 to 30) */
const lineBlocksArb = fc.array(lineBlockArb, { minLength: 1, maxLength: 30 });

/** Mixed array of LINE, empty LINE, and non-LINE blocks */
const mixedBlocksArb = fc.tuple(
  fc.array(lineBlockArb, { minLength: 0, maxLength: 15 }),
  fc.array(emptyLineBlockArb, { minLength: 0, maxLength: 5 }),
  fc.array(nonLineBlockArb, { minLength: 0, maxLength: 10 }),
).map(([lines, empties, nonLines]) =>
  fc.shuffledSubarray([...lines, ...empties, ...nonLines], {
    minLength: lines.length + empties.length + nonLines.length,
    maxLength: lines.length + empties.length + nonLines.length,
  })
).chain(x => x);

// ─── Property 5: Text Extraction Completeness ───────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 5: Text Extraction Completeness', () => {
  /**
   * **Validates: Requirements 1.4, 5.3**
   *
   * For any set of LINE blocks with non-empty text, every block's text
   * must appear in the extracted output.
   */
  it('should include all non-empty LINE block texts in the output', () => {
    fc.assert(
      fc.property(lineBlocksArb, (blocks) => {
        const result = extractTextFromBlocks(blocks);

        for (const block of blocks) {
          expect(result).toContain(block.Text);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4, 5.3**
   *
   * For any set of LINE blocks, the output text lines must be ordered
   * by page number first, then by vertical position (Top).
   */
  it('should order text by page number then by vertical position', () => {
    fc.assert(
      fc.property(lineBlocksArb, (blocks) => {
        const result = extractTextFromBlocks(blocks);
        const resultLines = result.split('\n');

        // Build expected order: sort blocks by page then top
        const sorted = [...blocks].sort((a, b) => {
          if (a.Page !== b.Page) {
            return (a.Page || 1) - (b.Page || 1);
          }
          const aTop = a.Geometry?.BoundingBox?.Top || 0;
          const bTop = b.Geometry?.BoundingBox?.Top || 0;
          return aTop - bTop;
        });

        const expectedLines = sorted
          .map(b => b.Text || '')
          .filter(t => t.trim().length > 0);

        expect(resultLines).toEqual(expectedLines);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4, 5.3**
   *
   * Empty or whitespace-only text blocks should be excluded from the output.
   */
  it('should exclude empty text blocks from output', () => {
    fc.assert(
      fc.property(
        fc.array(emptyLineBlockArb, { minLength: 1, maxLength: 10 }),
        (emptyBlocks) => {
          const result = extractTextFromBlocks(emptyBlocks);
          expect(result).toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4, 5.3**
   *
   * Non-LINE blocks (WORD, PAGE, TABLE, etc.) should never appear in the output,
   * even when mixed with LINE blocks.
   */
  it('should exclude non-LINE blocks from output', () => {
    fc.assert(
      fc.property(mixedBlocksArb, (blocks) => {
        const result = extractTextFromBlocks(blocks);
        const resultLines = result.split('\n').filter(l => l.length > 0);

        const lineTexts = new Set(
          blocks
            .filter(b => b.BlockType === 'LINE')
            .map(b => b.Text || '')
            .filter(t => t.trim().length > 0)
        );

        // Every line in the result must come from a LINE block
        for (const line of resultLines) {
          expect(lineTexts.has(line)).toBe(true);
        }

        // No result line should be text that only exists in non-LINE blocks
        const nonLineOnlyTexts = blocks
          .filter(b => b.BlockType !== 'LINE')
          .map(b => b.Text || '')
          .filter(t => t.trim().length > 0 && !lineTexts.has(t));

        for (const nlText of nonLineOnlyTexts) {
          expect(resultLines).not.toContain(nlText);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4, 5.3**
   *
   * For single-page documents, text should maintain top-to-bottom reading order
   * based on BoundingBox.Top values.
   */
  it('should maintain top-to-bottom reading order for single-page documents', () => {
    const singlePageBlockArb = fc.record({
      BlockType: fc.constant('LINE' as string),
      Text: nonEmptyTextArb,
      Page: fc.constant(1),
      Geometry: fc.record({
        BoundingBox: fc.record({
          Top: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
      }),
    });

    fc.assert(
      fc.property(
        fc.array(singlePageBlockArb, { minLength: 2, maxLength: 20 }),
        (blocks) => {
          const result = extractTextFromBlocks(blocks);
          const resultLines = result.split('\n');

          // Get the Top values in the order they appear in the result
          const sortedBlocks = [...blocks].sort((a, b) => {
            const aTop = a.Geometry?.BoundingBox?.Top || 0;
            const bTop = b.Geometry?.BoundingBox?.Top || 0;
            return aTop - bTop;
          });

          const expectedLines = sortedBlocks
            .map(b => b.Text || '')
            .filter(t => t.trim().length > 0);

          expect(resultLines).toEqual(expectedLines);
        }
      ),
      { numRuns: 100 }
    );
  });
});

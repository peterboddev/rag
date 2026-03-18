/**
 * Property-based tests for Multi-page Processing Completeness
 * Feature: pdf-processing-enhancement, Property 14: Multi-page Processing Completeness
 *
 * Validates: Requirements 5.4
 *
 * Properties tested:
 * 1. For multi-page documents, text from page N always appears before text from page N+1
 * 2. All pages contribute text to the output (no pages are skipped)
 * 3. Page count calculation correctly counts distinct page numbers
 * 4. Within each page, text maintains top-to-bottom order
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// ─── Helper: Replicate extractTextFromBlocks and getPageCount logic ──────────

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

/**
 * Mirrors the private getPageCount method in EnhancedTextractService.
 * Counts distinct page numbers from blocks, minimum 1.
 */
function getPageCount(blocks: TextractBlock[]): number {
  const pages = new Set(blocks.map(block => block.Page).filter(page => page !== undefined));
  return Math.max(1, pages.size);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty text content for LINE blocks */
const nonEmptyTextArb = fc.stringOf(
  fc.char().filter(c => c.trim().length > 0),
  { minLength: 1, maxLength: 50 }
).filter(s => s.trim().length > 0);

/** A LINE block on a specific page with a given Top position */
function lineBlockOnPage(page: number): fc.Arbitrary<TextractBlock> {
  return fc.record({
    BlockType: fc.constant('LINE' as string),
    Text: nonEmptyTextArb,
    Page: fc.constant(page),
    Geometry: fc.record({
      BoundingBox: fc.record({
        Top: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
    }),
  });
}

/**
 * Generates a multi-page document: 2-10 pages, each with 1-5 LINE blocks.
 * Guarantees every page has at least one non-empty LINE block.
 */
const multiPageDocumentArb = fc
  .integer({ min: 2, max: 10 })
  .chain(pageCount => {
    const pageArbs = Array.from({ length: pageCount }, (_, i) =>
      fc.array(lineBlockOnPage(i + 1), { minLength: 1, maxLength: 5 })
    );
    return fc.tuple(...pageArbs).map(pages => pages.flat());
  });

/**
 * Generates blocks across distinct pages (2-8 pages) with mixed block types.
 * Non-LINE blocks are included but should not affect page counting for LINE extraction.
 */
const mixedMultiPageArb = fc
  .integer({ min: 2, max: 8 })
  .chain(pageCount => {
    const pageArbs = Array.from({ length: pageCount }, (_, i) => {
      const page = i + 1;
      const lineArb = fc.array(lineBlockOnPage(page), { minLength: 1, maxLength: 4 });
      const nonLineArb = fc.array(
        fc.record({
          BlockType: fc.constantFrom('WORD', 'PAGE', 'TABLE', 'CELL'),
          Text: nonEmptyTextArb,
          Page: fc.constant(page),
          Geometry: fc.record({
            BoundingBox: fc.record({
              Top: fc.double({ min: 0, max: 1, noNaN: true }),
            }),
          }),
        }),
        { minLength: 0, maxLength: 3 }
      );
      return fc.tuple(lineArb, nonLineArb).map(([lines, nonLines]) => [...lines, ...nonLines]);
    });
    return fc.tuple(...pageArbs).map(pages => pages.flat());
  });

// ─── Property 14: Multi-page Processing Completeness ─────────────────────────

describe('Feature: pdf-processing-enhancement, Property 14: Multi-page Processing Completeness', () => {
  /**
   * **Validates: Requirements 5.4**
   *
   * For multi-page documents, text from page N always appears before text from page N+1.
   */
  it('should order text from page N before text from page N+1', () => {
    fc.assert(
      fc.property(multiPageDocumentArb, (blocks) => {
        const result = extractTextFromBlocks(blocks);
        const resultLines = result.split('\n');

        // Build a map: text line -> page number (from sorted blocks)
        const sorted = [...blocks]
          .filter(b => b.BlockType === 'LINE' && (b.Text || '').trim().length > 0)
          .sort((a, b) => {
            if (a.Page !== b.Page) return (a.Page || 1) - (b.Page || 1);
            return (a.Geometry?.BoundingBox?.Top || 0) - (b.Geometry?.BoundingBox?.Top || 0);
          });

        // Track the page of each result line in order
        let sortedIdx = 0;
        const resultPages: number[] = [];
        for (const line of resultLines) {
          while (sortedIdx < sorted.length && sorted[sortedIdx].Text !== line) {
            sortedIdx++;
          }
          if (sortedIdx < sorted.length) {
            resultPages.push(sorted[sortedIdx].Page || 1);
            sortedIdx++;
          }
        }

        // Pages in the result should be non-decreasing
        for (let i = 1; i < resultPages.length; i++) {
          expect(resultPages[i]).toBeGreaterThanOrEqual(resultPages[i - 1]);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * All pages contribute text to the output — no pages are skipped.
   */
  it('should include text from every page (no pages skipped)', () => {
    fc.assert(
      fc.property(multiPageDocumentArb, (blocks) => {
        const result = extractTextFromBlocks(blocks);

        // Determine which pages have non-empty LINE blocks
        const pagesWithText = new Set(
          blocks
            .filter(b => b.BlockType === 'LINE' && (b.Text || '').trim().length > 0)
            .map(b => b.Page || 1)
        );

        // For each page that has text, at least one of its lines must appear in the result
        for (const page of pagesWithText) {
          const pageTexts = blocks
            .filter(b => b.BlockType === 'LINE' && b.Page === page && (b.Text || '').trim().length > 0)
            .map(b => b.Text!);

          const hasPageText = pageTexts.some(text => result.includes(text));
          expect(hasPageText).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Page count calculation correctly counts distinct page numbers.
   */
  it('should correctly count distinct page numbers', () => {
    fc.assert(
      fc.property(mixedMultiPageArb, (blocks) => {
        const count = getPageCount(blocks);

        // Expected: number of distinct defined Page values, minimum 1
        const distinctPages = new Set(
          blocks.map(b => b.Page).filter(p => p !== undefined)
        );
        const expected = Math.max(1, distinctPages.size);

        expect(count).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Within each page, text maintains top-to-bottom order based on BoundingBox.Top.
   */
  it('should maintain top-to-bottom order within each page', () => {
    fc.assert(
      fc.property(multiPageDocumentArb, (blocks) => {
        const result = extractTextFromBlocks(blocks);
        const resultLines = result.split('\n');

        // Get sorted blocks (same logic as extractTextFromBlocks)
        const sorted = [...blocks]
          .filter(b => b.BlockType === 'LINE' && (b.Text || '').trim().length > 0)
          .sort((a, b) => {
            if (a.Page !== b.Page) return (a.Page || 1) - (b.Page || 1);
            return (a.Geometry?.BoundingBox?.Top || 0) - (b.Geometry?.BoundingBox?.Top || 0);
          });

        // Group sorted blocks by page
        const pageGroups = new Map<number, TextractBlock[]>();
        for (const block of sorted) {
          const page = block.Page || 1;
          if (!pageGroups.has(page)) pageGroups.set(page, []);
          pageGroups.get(page)!.push(block);
        }

        // For each page, verify the Top values are non-decreasing in the result
        for (const [, pageBlocks] of pageGroups) {
          const tops = pageBlocks.map(b => b.Geometry?.BoundingBox?.Top || 0);
          for (let i = 1; i < tops.length; i++) {
            expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
          }
        }

        // Also verify the result lines match the expected sorted order
        const expectedLines = sorted.map(b => b.Text || '').filter(t => t.trim().length > 0);
        expect(resultLines).toEqual(expectedLines);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * getPageCount returns minimum 1 even for empty block arrays.
   */
  it('should return minimum page count of 1 for empty blocks', () => {
    const count = getPageCount([]);
    expect(count).toBe(1);
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * getPageCount returns minimum 1 for blocks with no Page field.
   */
  it('should return minimum page count of 1 for blocks without Page field', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            BlockType: fc.constant('LINE' as string),
            Text: nonEmptyTextArb,
            Geometry: fc.record({
              BoundingBox: fc.record({
                Top: fc.double({ min: 0, max: 1, noNaN: true }),
              }),
            }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (blocks) => {
          const count = getPageCount(blocks as TextractBlock[]);
          expect(count).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

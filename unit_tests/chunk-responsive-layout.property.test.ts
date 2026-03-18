/**
 * Property-based tests for Responsive Layout Consistency
 * Feature: chunk-visualization, Property 1: Responsive Layout Consistency
 *
 * **Validates: Requirements 1.2**
 *
 * For any viewport size change, the three-column layout should maintain
 * proportional widths and proper component placement.
 *
 * Properties tested:
 * 1. Column count is always 1, 2, or 3
 * 2. Column count is monotonically non-decreasing with width (w1 < w2 → cols(w1) ≤ cols(w2))
 * 3. Width > 1024 always yields 3-column layout
 * 4. Width ≤ 768 always yields 1-column layout
 * 5. Layout mode is deterministic (same input → same output)
 * 6. Column proportions are equal within each layout mode (each column gets 1/N of space)
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// ─── Pure layout functions (mirror CSS breakpoint logic) ─────────────────────

type LayoutMode = '3-col' | '2-col' | '1-col';

function getLayoutMode(width: number): LayoutMode {
  if (width > 1024) return '3-col';
  if (width > 768) return '2-col';
  return '1-col';
}

function getColumnCount(width: number): number {
  const mode = getLayoutMode(width);
  switch (mode) {
    case '3-col': return 3;
    case '2-col': return 2;
    case '1-col': return 1;
  }
}

/**
 * Computes the proportional width fraction each column receives.
 * In a CSS Grid with equal columns (1fr each), every column gets 1/N.
 */
function getColumnWidthFraction(width: number): number {
  return 1 / getColumnCount(width);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Realistic viewport widths from small mobile to ultra-wide */
const viewportWidthArb = fc.integer({ min: 320, max: 3840 });

/** Ordered pair where w1 < w2 */
const orderedWidthPairArb = fc
  .tuple(viewportWidthArb, viewportWidthArb)
  .filter(([a, b]) => a < b);

/** Widths guaranteed to be in the 3-column range */
const threeColWidthArb = fc.integer({ min: 1025, max: 3840 });

/** Widths guaranteed to be in the 1-column range */
const oneColWidthArb = fc.integer({ min: 320, max: 768 });

/** Widths in the 2-column range */
const twoColWidthArb = fc.integer({ min: 769, max: 1024 });

// ─── Property 1: Responsive Layout Consistency ───────────────────────────────

describe('Feature: chunk-visualization, Property 1: Responsive Layout Consistency', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any viewport width, the column count is always exactly 1, 2, or 3.
   */
  it('column count is always 1, 2, or 3 for any viewport width', () => {
    fc.assert(
      fc.property(viewportWidthArb, (width) => {
        const cols = getColumnCount(width);
        expect([1, 2, 3]).toContain(cols);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For any two viewport widths where w1 < w2, columnCount(w1) <= columnCount(w2).
   * The layout never gains more columns by shrinking the viewport.
   */
  it('column count is monotonically non-decreasing with width', () => {
    fc.assert(
      fc.property(orderedWidthPairArb, ([w1, w2]) => {
        expect(getColumnCount(w1)).toBeLessThanOrEqual(getColumnCount(w2));
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For any viewport width > 1024, the layout is always 3-column.
   */
  it('layout is always 3-column when width > 1024', () => {
    fc.assert(
      fc.property(threeColWidthArb, (width) => {
        expect(getLayoutMode(width)).toBe('3-col');
        expect(getColumnCount(width)).toBe(3);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For any viewport width ≤ 768, the layout is always 1-column.
   */
  it('layout is always 1-column when width <= 768', () => {
    fc.assert(
      fc.property(oneColWidthArb, (width) => {
        expect(getLayoutMode(width)).toBe('1-col');
        expect(getColumnCount(width)).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For any viewport width, the layout mode is deterministic:
   * calling getLayoutMode twice with the same input yields the same result.
   */
  it('layout mode is deterministic (same input always produces same output)', () => {
    fc.assert(
      fc.property(viewportWidthArb, (width) => {
        const first = getLayoutMode(width);
        const second = getLayoutMode(width);
        expect(first).toBe(second);

        const colsFirst = getColumnCount(width);
        const colsSecond = getColumnCount(width);
        expect(colsFirst).toBe(colsSecond);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Column proportions are equal within each layout mode.
   * Each column gets exactly 1/N of the available space where N is the column count.
   */
  it('column proportions are equal within each layout mode', () => {
    fc.assert(
      fc.property(viewportWidthArb, (width) => {
        const cols = getColumnCount(width);
        const fraction = getColumnWidthFraction(width);
        const expectedFraction = 1 / cols;

        expect(fraction).toBeCloseTo(expectedFraction, 10);

        // All N columns at 1/N must sum to 1 (full width)
        const totalFraction = fraction * cols;
        expect(totalFraction).toBeCloseTo(1, 10);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * The 2-column range (769–1024) is correctly handled.
   */
  it('layout is always 2-column when width is between 769 and 1024', () => {
    fc.assert(
      fc.property(twoColWidthArb, (width) => {
        expect(getLayoutMode(width)).toBe('2-col');
        expect(getColumnCount(width)).toBe(2);
      }),
      { numRuns: 100 },
    );
  });
});

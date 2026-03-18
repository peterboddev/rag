/**
 * Property-based tests for Responsive Layout Integrity
 * Feature: document-selection-summary, Property 5: Responsive layout integrity
 *
 * **Validates: Requirements 2.2, 2.3, 8.1**
 *
 * Properties tested:
 * 1. For any screen width (320–2560), there is always a valid layout (3-col, 2-col, or 1-col)
 * 2. Breakpoint transitions are consistent with the CSS rules
 * 3. Touch targets are always at least 44px on mobile (width ≤ 768)
 * 4. Container padding decreases as screen width decreases
 * 5. The layout never has zero columns
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// ─── Pure layout rule functions (mirror CSS media query logic) ───────────────

type LayoutMode = '3-col' | '2-col' | '1-col';

interface LayoutConfig {
  mode: LayoutMode;
  columns: number;
  containerPadding: number;
  minButtonHeight: number;
  minDocumentItemHeight: number;
  buttonFullWidth: boolean;
  columnMinHeight: number;
}

/**
 * Determines the layout mode based on screen width.
 * Mirrors the CSS breakpoints:
 *   > 1024  → 3-col
 *   769–1024 → 2-col
 *   ≤ 768   → 1-col
 */
function getLayoutMode(width: number): LayoutMode {
  if (width > 1024) return '3-col';
  if (width > 768) return '2-col';
  return '1-col';
}

/**
 * Returns the number of grid columns for a given width.
 */
function getColumnCount(width: number): number {
  const mode = getLayoutMode(width);
  switch (mode) {
    case '3-col': return 3;
    case '2-col': return 2;
    case '1-col': return 1;
  }
}

/**
 * Returns the container padding in px for a given width.
 * CSS rules:
 *   default: 20px
 *   ≤ 1024: 16px
 *   ≤ 768:  12px
 *   ≤ 480:  8px
 */
function getContainerPadding(width: number): number {
  if (width <= 480) return 8;
  if (width <= 768) return 12;
  if (width <= 1024) return 16;
  return 20;
}

/**
 * Returns the minimum button height in px for a given width.
 * CSS rules:
 *   default: no explicit min-height (use 0 as baseline)
 *   ≤ 768: 44px (WCAG 2.5.5 touch target)
 */
function getMinButtonHeight(width: number): number {
  if (width <= 768) return 44;
  return 0;
}

/**
 * Returns the minimum document-item height for a given width.
 * CSS rules:
 *   ≤ 768: 44px
 *   default: no explicit min-height
 */
function getMinDocumentItemHeight(width: number): number {
  if (width <= 768) return 44;
  return 0;
}

/**
 * Whether buttons should be full-width at this screen width.
 * CSS rules: ≤ 480 → width: 100%
 */
function isButtonFullWidth(width: number): boolean {
  return width <= 480;
}

/**
 * Returns the minimum column height for a given width.
 * CSS rules:
 *   > 1024: derived from vh (no explicit min-height on .column)
 *   ≤ 1024: 300px
 *   ≤ 768:  200px
 */
function getColumnMinHeight(width: number): number {
  if (width <= 768) return 200;
  if (width <= 1024) return 300;
  return 0; // no explicit min-height; layout uses vh
}

/**
 * Builds the full layout configuration for a given screen width.
 */
function getLayoutConfig(width: number): LayoutConfig {
  return {
    mode: getLayoutMode(width),
    columns: getColumnCount(width),
    containerPadding: getContainerPadding(width),
    minButtonHeight: getMinButtonHeight(width),
    minDocumentItemHeight: getMinDocumentItemHeight(width),
    buttonFullWidth: isButtonFullWidth(width),
    columnMinHeight: getColumnMinHeight(width),
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const screenWidthArb = fc.integer({ min: 320, max: 2560 });

// Pair of widths where the first is strictly smaller
const orderedWidthPairArb = fc
  .tuple(screenWidthArb, screenWidthArb)
  .filter(([a, b]) => a < b);

// ─── Property 5: Responsive Layout Integrity ─────────────────────────────────

describe('Feature: document-selection-summary, Property 5: Responsive layout integrity', () => {
  /**
   * **Validates: Requirements 2.2, 2.3, 8.1**
   *
   * For any screen width in [320, 2560], the layout mode is always one of
   * the three valid modes and the column count is never zero.
   */
  it('always assigns a valid layout mode with at least 1 column', () => {
    fc.assert(
      fc.property(screenWidthArb, (width) => {
        const config = getLayoutConfig(width);

        expect(['3-col', '2-col', '1-col']).toContain(config.mode);
        expect(config.columns).toBeGreaterThanOrEqual(1);
        expect(config.columns).toBeLessThanOrEqual(3);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2, 2.3, 8.1**
   *
   * Breakpoint transitions are consistent:
   *   width > 1024  → 3-col
   *   768 < width ≤ 1024 → 2-col
   *   width ≤ 768  → 1-col
   */
  it('breakpoint transitions match the CSS media query rules', () => {
    fc.assert(
      fc.property(screenWidthArb, (width) => {
        const mode = getLayoutMode(width);

        if (width > 1024) {
          expect(mode).toBe('3-col');
        } else if (width > 768) {
          expect(mode).toBe('2-col');
        } else {
          expect(mode).toBe('1-col');
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * On mobile (width ≤ 768), touch targets are always at least 44px
   * to satisfy WCAG 2.5.5.
   */
  it('touch targets are at least 44px on mobile widths', () => {
    const mobileWidthArb = fc.integer({ min: 320, max: 768 });

    fc.assert(
      fc.property(mobileWidthArb, (width) => {
        const config = getLayoutConfig(width);

        expect(config.minButtonHeight).toBeGreaterThanOrEqual(44);
        expect(config.minDocumentItemHeight).toBeGreaterThanOrEqual(44);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2, 2.3**
   *
   * Container padding is monotonically non-increasing as screen width
   * decreases: for any pair (narrower, wider), padding(narrower) ≤ padding(wider).
   */
  it('container padding decreases (or stays equal) as screen width decreases', () => {
    fc.assert(
      fc.property(orderedWidthPairArb, ([narrower, wider]) => {
        const paddingNarrow = getContainerPadding(narrower);
        const paddingWide = getContainerPadding(wider);

        expect(paddingNarrow).toBeLessThanOrEqual(paddingWide);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2, 2.3, 8.1**
   *
   * Column count is monotonically non-increasing as screen width decreases.
   */
  it('column count never increases as screen width decreases', () => {
    fc.assert(
      fc.property(orderedWidthPairArb, ([narrower, wider]) => {
        const colsNarrow = getColumnCount(narrower);
        const colsWide = getColumnCount(wider);

        expect(colsNarrow).toBeLessThanOrEqual(colsWide);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.3, 8.1**
   *
   * At the smallest supported width (480px and below), buttons become
   * full-width to maximize tap area.
   */
  it('buttons are full-width on small mobile (≤ 480px)', () => {
    const smallMobileArb = fc.integer({ min: 320, max: 480 });

    fc.assert(
      fc.property(smallMobileArb, (width) => {
        expect(isButtonFullWidth(width)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2, 8.1**
   *
   * Buttons are NOT full-width above the 480px breakpoint.
   */
  it('buttons are not full-width above 480px', () => {
    const aboveSmallMobileArb = fc.integer({ min: 481, max: 2560 });

    fc.assert(
      fc.property(aboveSmallMobileArb, (width) => {
        expect(isButtonFullWidth(width)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * On tablet and mobile, columns always have a minimum height to
   * ensure content is usable.
   */
  it('columns have a positive minimum height on tablet and mobile', () => {
    const tabletAndMobileArb = fc.integer({ min: 320, max: 1024 });

    fc.assert(
      fc.property(tabletAndMobileArb, (width) => {
        const minHeight = getColumnMinHeight(width);
        expect(minHeight).toBeGreaterThanOrEqual(200);
      }),
      { numRuns: 100 },
    );
  });
});

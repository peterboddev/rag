/**
 * Property-based tests for Summary Length Scaling
 * Feature: token-aware-summarization, Property 10: Summary Length Scaling
 *
 * **Validates: Requirements 4.3**
 *
 * Properties tested:
 * - Low token limits (<=512) produce short summary lengths (200-300 words)
 * - Medium token limits (513-800) produce medium summary lengths (300-400 words)
 * - High token limits (>=1024) produce long summary lengths (500-700 words)
 * - Default range (801-1023) produces default summary lengths (400-600 words)
 * - maxNewTokens scales with summary length tier
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// ─── Testable Helper ─────────────────────────────────────────────────────────

/**
 * Mirrors the summary length scaling logic from document-summary Lambda.
 * Extracted as a pure function for property-based testing.
 */
function determineSummaryLength(maxTokensAllowed: number): { summaryLength: string; maxNewTokens: number } {
  let summaryLength = '400-600 words';
  let maxNewTokens = 1000;

  if (maxTokensAllowed <= 512) {
    summaryLength = '200-300 words';
    maxNewTokens = 500;
  } else if (maxTokensAllowed <= 800) {
    summaryLength = '300-400 words';
    maxNewTokens = 700;
  } else if (maxTokensAllowed >= 1024) {
    summaryLength = '500-700 words';
    maxNewTokens = 1200;
  }

  return { summaryLength, maxNewTokens };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Token limits in the low tier (<=512) */
const lowTokenLimitArb = fc.integer({ min: 1, max: 512 });

/** Token limits in the medium tier (513-800) */
const mediumTokenLimitArb = fc.integer({ min: 513, max: 800 });

/** Token limits in the default tier (801-1023) */
const defaultTokenLimitArb = fc.integer({ min: 801, max: 1023 });

/** Token limits in the high tier (>=1024) */
const highTokenLimitArb = fc.integer({ min: 1024, max: 100000 });

/** Any positive token limit */
const anyTokenLimitArb = fc.integer({ min: 1, max: 100000 });

// ─── Property 10: Summary Length Scaling ─────────────────────────────────────

describe('Feature: token-aware-summarization, Property 10: Summary Length Scaling', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any maxTokensAllowed <= 512, the summary length should be '200-300 words'
   * and maxNewTokens should be 500.
   */
  it('low token limits (<=512) produce short summary lengths', () => {
    fc.assert(
      fc.property(lowTokenLimitArb, (maxTokens) => {
        const result = determineSummaryLength(maxTokens);
        expect(result.summaryLength).toBe('200-300 words');
        expect(result.maxNewTokens).toBe(500);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any maxTokensAllowed in (513, 800], the summary length should be '300-400 words'
   * and maxNewTokens should be 700.
   */
  it('medium token limits (513-800) produce medium summary lengths', () => {
    fc.assert(
      fc.property(mediumTokenLimitArb, (maxTokens) => {
        const result = determineSummaryLength(maxTokens);
        expect(result.summaryLength).toBe('300-400 words');
        expect(result.maxNewTokens).toBe(700);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any maxTokensAllowed in (800, 1023], the summary length should be the
   * default '400-600 words' and maxNewTokens should be 1000.
   */
  it('default range (801-1023) produces default summary lengths', () => {
    fc.assert(
      fc.property(defaultTokenLimitArb, (maxTokens) => {
        const result = determineSummaryLength(maxTokens);
        expect(result.summaryLength).toBe('400-600 words');
        expect(result.maxNewTokens).toBe(1000);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any maxTokensAllowed >= 1024, the summary length should be '500-700 words'
   * and maxNewTokens should be 1200.
   */
  it('high token limits (>=1024) produce long summary lengths', () => {
    fc.assert(
      fc.property(highTokenLimitArb, (maxTokens) => {
        const result = determineSummaryLength(maxTokens);
        expect(result.summaryLength).toBe('500-700 words');
        expect(result.maxNewTokens).toBe(1200);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any positive token limit, maxNewTokens should always be one of the
   * four defined tiers (500, 700, 1000, 1200) and summaryLength should be
   * one of the four defined ranges.
   */
  it('maxNewTokens is always one of the defined tier values', () => {
    fc.assert(
      fc.property(anyTokenLimitArb, (maxTokens) => {
        const result = determineSummaryLength(maxTokens);
        expect([500, 700, 1000, 1200]).toContain(result.maxNewTokens);
        expect([
          '200-300 words',
          '300-400 words',
          '400-600 words',
          '500-700 words',
        ]).toContain(result.summaryLength);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * Higher token limits should produce maxNewTokens >= those of lower limits.
   * This ensures the scaling is monotonically non-decreasing.
   */
  it('maxNewTokens scales monotonically with token limit tiers', () => {
    fc.assert(
      fc.property(lowTokenLimitArb, highTokenLimitArb, (low, high) => {
        const lowResult = determineSummaryLength(low);
        const highResult = determineSummaryLength(high);
        expect(highResult.maxNewTokens).toBeGreaterThanOrEqual(lowResult.maxNewTokens);
      }),
      { numRuns: 100 }
    );
  });
});

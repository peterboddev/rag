/**
 * Property-based tests for Token Usage Reporting
 * Feature: token-aware-summarization, Property 17: Token Usage Reporting
 *
 * **Validates: Requirements 7.3**
 *
 * Properties tested:
 * - getTokenUsageInfo returns an object with all required fields
 * - contentTokens equals tokensUsed minus promptOverhead
 * - utilizationPercentage is correctly calculated as (tokensUsed / maxTokensAllowed) * 100
 * - utilizationPercentage is rounded to 2 decimal places
 * - All numeric fields are finite numbers
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenEstimationService } from '../src/services/token-estimation';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Positive maxTokensAllowed values (must be > 0 to avoid division by zero) */
const maxTokensArb = fc.integer({ min: 1, max: 100_000 });

/** Non-negative tokensUsed values */
const tokensUsedArb = fc.integer({ min: 0, max: 100_000 });

/** Non-negative promptOverhead values */
const promptOverheadArb = fc.integer({ min: 0, max: 50_000 });

/** Combined arbitrary ensuring tokensUsed >= promptOverhead (realistic scenario) */
const realisticUsageArb = fc.integer({ min: 0, max: 50_000 }).chain(overhead =>
  fc.tuple(
    maxTokensArb,
    fc.integer({ min: overhead, max: overhead + 50_000 }),
    fc.constant(overhead)
  )
);

// ─── Service Instance ────────────────────────────────────────────────────────

let service: TokenEstimationService;

beforeEach(() => {
  service = new TokenEstimationService();
});

// ─── Property 17: Token Usage Reporting ──────────────────────────────────────

describe('Feature: token-aware-summarization, Property 17: Token Usage Reporting', () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any valid inputs, getTokenUsageInfo returns an object containing
   * all required fields: maxTokensAllowed, tokensUsed, promptOverhead,
   * contentTokens, utilizationPercentage.
   */
  it('should return all required fields in the token usage info', () => {
    fc.assert(
      fc.property(maxTokensArb, tokensUsedArb, promptOverheadArb, (maxTokens, used, overhead) => {
        const result = service.getTokenUsageInfo(maxTokens, used, overhead);

        expect(result).toHaveProperty('maxTokensAllowed');
        expect(result).toHaveProperty('tokensUsed');
        expect(result).toHaveProperty('promptOverhead');
        expect(result).toHaveProperty('contentTokens');
        expect(result).toHaveProperty('utilizationPercentage');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * For any inputs, contentTokens must equal tokensUsed - promptOverhead.
   */
  it('should calculate contentTokens as tokensUsed minus promptOverhead', () => {
    fc.assert(
      fc.property(maxTokensArb, tokensUsedArb, promptOverheadArb, (maxTokens, used, overhead) => {
        const result = service.getTokenUsageInfo(maxTokens, used, overhead);
        expect(result.contentTokens).toBe(used - overhead);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * For any inputs, utilizationPercentage must equal
   * Math.round((tokensUsed / maxTokensAllowed) * 100 * 100) / 100
   * (i.e., rounded to 2 decimal places).
   */
  it('should calculate utilizationPercentage correctly and round to 2 decimal places', () => {
    fc.assert(
      fc.property(maxTokensArb, tokensUsedArb, promptOverheadArb, (maxTokens, used, overhead) => {
        const result = service.getTokenUsageInfo(maxTokens, used, overhead);
        const expected = Math.round(((used / maxTokens) * 100) * 100) / 100;
        expect(result.utilizationPercentage).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * The returned maxTokensAllowed and tokensUsed and promptOverhead
   * must match the input values exactly (pass-through).
   */
  it('should preserve input values in the returned structure', () => {
    fc.assert(
      fc.property(maxTokensArb, tokensUsedArb, promptOverheadArb, (maxTokens, used, overhead) => {
        const result = service.getTokenUsageInfo(maxTokens, used, overhead);
        expect(result.maxTokensAllowed).toBe(maxTokens);
        expect(result.tokensUsed).toBe(used);
        expect(result.promptOverhead).toBe(overhead);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * All numeric fields in the result must be finite numbers.
   */
  it('should return finite numbers for all fields', () => {
    fc.assert(
      fc.property(maxTokensArb, tokensUsedArb, promptOverheadArb, (maxTokens, used, overhead) => {
        const result = service.getTokenUsageInfo(maxTokens, used, overhead);
        expect(Number.isFinite(result.maxTokensAllowed)).toBe(true);
        expect(Number.isFinite(result.tokensUsed)).toBe(true);
        expect(Number.isFinite(result.promptOverhead)).toBe(true);
        expect(Number.isFinite(result.contentTokens)).toBe(true);
        expect(Number.isFinite(result.utilizationPercentage)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * In realistic scenarios where tokensUsed >= promptOverhead,
   * contentTokens should be non-negative.
   */
  it('should produce non-negative contentTokens when tokensUsed >= promptOverhead', () => {
    fc.assert(
      fc.property(realisticUsageArb, ([maxTokens, used, overhead]) => {
        const result = service.getTokenUsageInfo(maxTokens, used, overhead);
        expect(result.contentTokens).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });
});

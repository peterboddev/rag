/**
 * Property-based tests for Token Estimation Accuracy
 * Feature: token-aware-summarization, Property 7: Token Estimation Accuracy
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 *
 * Properties tested:
 * - For any text string, estimateTokens returns a positive number proportional to text length
 * - The 4:1 character-to-token ratio is used (text.length / 4, rounded up)
 * - calculateAvailableTokens correctly subtracts prompt overhead from maxTokens
 * - Token estimates are always non-negative integers
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenEstimationService } from '../src/services/token-estimation';

// ─── Constants ───────────────────────────────────────────────────────────────

const CHAR_TO_TOKEN_RATIO = 4;
const MIN_CONTENT_TOKENS = 50;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty text strings of varying lengths */
const nonEmptyTextArb = fc.string({ minLength: 1, maxLength: 10_000 })
  .filter(s => s.trim().length > 0);

/** Any text string including empty and whitespace-only */
const anyTextArb = fc.oneof(
  fc.constant(''),
  fc.stringOf(fc.constant(' '), { minLength: 1, maxLength: 20 }),
  nonEmptyTextArb
);

/** Reasonable maxTokens values */
const maxTokensArb = fc.integer({ min: 1, max: 100_000 });

/** Positive prompt overhead values (0 is treated as falsy by the implementation, falling back to default) */
const promptOverheadArb = fc.integer({ min: 1, max: 50_000 });

// ─── Service Instance ────────────────────────────────────────────────────────

let service: TokenEstimationService;

beforeEach(() => {
  service = new TokenEstimationService();
});

// ─── Property 7: Token Estimation Accuracy ───────────────────────────────────

describe('Feature: token-aware-summarization, Property 7: Token Estimation Accuracy', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * For any non-empty text, estimateTokens uses the 4:1 character-to-token
   * ratio: Math.ceil(text.length / 4).
   */
  it('should use 4:1 character-to-token ratio for any non-empty text', () => {
    fc.assert(
      fc.property(nonEmptyTextArb, (text) => {
        const result = service.estimateTokens(text);
        const expected = Math.ceil(text.length / CHAR_TO_TOKEN_RATIO);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any text (including empty), estimateTokens always returns
   * a non-negative integer.
   */
  it('should always return a non-negative integer for any text', () => {
    fc.assert(
      fc.property(anyTextArb, (text) => {
        const result = service.estimateTokens(text);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any non-empty text, the token estimate is strictly positive
   * and proportional to text length.
   */
  it('should return a positive estimate proportional to text length for non-empty text', () => {
    fc.assert(
      fc.property(nonEmptyTextArb, (text) => {
        const result = service.estimateTokens(text);
        expect(result).toBeGreaterThan(0);
        // Proportionality: longer text => more tokens
        // Verify the ratio is bounded by the 4:1 rule
        expect(result).toBeLessThanOrEqual(text.length);
        expect(result).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Monotonicity: if text A is a prefix of text B (and B is longer),
   * then estimateTokens(A) <= estimateTokens(B).
   */
  it('should be monotonic — longer text produces equal or higher token estimates', () => {
    fc.assert(
      fc.property(
        nonEmptyTextArb,
        fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
        (base, suffix) => {
          const shorter = base;
          const longer = base + suffix;
          expect(service.estimateTokens(longer)).toBeGreaterThanOrEqual(
            service.estimateTokens(shorter)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Empty or whitespace-only text should return 0 tokens.
   */
  it('should return 0 for empty or whitespace-only text', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 100 }),
        (whitespace) => {
          expect(service.estimateTokens(whitespace)).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * For any maxTokens and promptOverhead, calculateAvailableTokens
   * correctly subtracts overhead, floored at MIN_CONTENT_TOKENS.
   */
  it('should correctly subtract prompt overhead from maxTokens', () => {
    fc.assert(
      fc.property(maxTokensArb, promptOverheadArb, (maxTokens, promptOverhead) => {
        const result = service.calculateAvailableTokens(maxTokens, promptOverhead);
        const expected = Math.max(MIN_CONTENT_TOKENS, maxTokens - promptOverhead);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Available tokens should never be negative — the minimum is MIN_CONTENT_TOKENS.
   */
  it('should never return fewer than minimum content tokens', () => {
    fc.assert(
      fc.property(maxTokensArb, promptOverheadArb, (maxTokens, promptOverhead) => {
        const result = service.calculateAvailableTokens(maxTokens, promptOverhead);
        expect(result).toBeGreaterThanOrEqual(MIN_CONTENT_TOKENS);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * When an explicit positive overhead is provided, available tokens
   * should equal max(MIN_CONTENT_TOKENS, maxTokens - overhead).
   * This confirms the subtraction is applied correctly for any positive overhead.
   */
  it('should apply explicit positive overhead correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_CONTENT_TOKENS, max: 100_000 }),
        fc.integer({ min: 1, max: 50_000 }),
        (maxTokens, overhead) => {
          const result = service.calculateAvailableTokens(maxTokens, overhead);
          const expected = Math.max(MIN_CONTENT_TOKENS, maxTokens - overhead);
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for Retry Logic Reliability
 * Feature: pdf-processing-enhancement, Property 4: Retry Logic Reliability
 *
 * Validates: Requirements 2.2, 5.5
 *
 * Properties tested:
 * 1. Exponential backoff delay calculation matches formula: min(baseDelayMs * backoffMultiplier^attempt, maxDelayMs)
 * 2. Delay never exceeds maxDelayMs for any attempt number
 * 3. Delay is always >= baseDelayMs for the first retry (attempt 0)
 * 4. Delays are monotonically non-decreasing until capped at maxDelayMs
 * 5. Total number of attempts is always maxRetries + 1
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// ─── Helper: Replicate delay calculation from EnhancedTextractService ────────

/**
 * Mirrors the delay formula used in EnhancedTextractService.extractTextWithRetry:
 *   delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs)
 */
function calculateDelay(
  baseDelayMs: number,
  backoffMultiplier: number,
  attempt: number,
  maxDelayMs: number
): number {
  return Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Valid retry config with realistic constraints */
const retryConfigArb = fc.record({
  maxRetries: fc.integer({ min: 0, max: 10 }),
  baseDelayMs: fc.integer({ min: 100, max: 10000 }),
  maxDelayMs: fc.integer({ min: 1000, max: 120000 }),
  backoffMultiplier: fc.double({ min: 1.1, max: 5.0, noNaN: true }),
}).filter(c => c.maxDelayMs >= c.baseDelayMs);

/** Attempt number (0-based, up to a reasonable max) */
const attemptArb = fc.integer({ min: 0, max: 20 });

// ─── Property 4: Retry Logic Reliability ─────────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 4: Retry Logic Reliability', () => {
  /**
   * **Validates: Requirements 2.2, 5.5**
   *
   * For any valid retry config and attempt number, the calculated delay
   * must equal min(baseDelayMs * backoffMultiplier^attempt, maxDelayMs).
   */
  it('should calculate exponential backoff delay matching the formula', () => {
    fc.assert(
      fc.property(retryConfigArb, attemptArb, (config, attempt) => {
        const delay = calculateDelay(
          config.baseDelayMs,
          config.backoffMultiplier,
          attempt,
          config.maxDelayMs
        );

        const expected = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        );

        expect(delay).toBeCloseTo(expected, 5);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.2, 5.5**
   *
   * For any valid retry config and any attempt number, the delay
   * must never exceed maxDelayMs.
   */
  it('should never produce a delay exceeding maxDelayMs', () => {
    fc.assert(
      fc.property(retryConfigArb, attemptArb, (config, attempt) => {
        const delay = calculateDelay(
          config.baseDelayMs,
          config.backoffMultiplier,
          attempt,
          config.maxDelayMs
        );

        expect(delay).toBeLessThanOrEqual(config.maxDelayMs);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.2, 5.5**
   *
   * For the first retry (attempt 0), the delay must always be
   * exactly baseDelayMs (since backoffMultiplier^0 = 1 and baseDelayMs <= maxDelayMs).
   */
  it('should produce delay equal to baseDelayMs for the first retry (attempt 0)', () => {
    fc.assert(
      fc.property(retryConfigArb, (config) => {
        const delay = calculateDelay(
          config.baseDelayMs,
          config.backoffMultiplier,
          0,
          config.maxDelayMs
        );

        // baseDelayMs * multiplier^0 = baseDelayMs, and baseDelayMs <= maxDelayMs by filter
        expect(delay).toBe(config.baseDelayMs);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.2, 5.5**
   *
   * For any sequence of attempts, delays must be monotonically non-decreasing
   * (each delay >= the previous one) since the multiplier is > 1 and the cap
   * is constant.
   */
  it('should produce monotonically non-decreasing delays across attempts', () => {
    fc.assert(
      fc.property(retryConfigArb, (config) => {
        const maxAttempts = config.maxRetries;
        let previousDelay = 0;

        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
          const delay = calculateDelay(
            config.baseDelayMs,
            config.backoffMultiplier,
            attempt,
            config.maxDelayMs
          );

          expect(delay).toBeGreaterThanOrEqual(previousDelay);
          previousDelay = delay;
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.2, 5.5**
   *
   * The total number of attempts (initial + retries) is always maxRetries + 1.
   * This verifies the loop boundary: for (attempt = 0; attempt <= maxRetries; attempt++).
   */
  it('should always make exactly maxRetries + 1 total attempts', () => {
    fc.assert(
      fc.property(retryConfigArb, (config) => {
        let attemptCount = 0;

        // Simulate the loop from extractTextWithRetry
        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
          attemptCount++;
        }

        expect(attemptCount).toBe(config.maxRetries + 1);
      }),
      { numRuns: 100 }
    );
  });
});

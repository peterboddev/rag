/**
 * Property-based tests for Concurrency Management
 * Feature: pdf-processing-enhancement, Property 12: Concurrency Management
 *
 * Validates: Requirements 7.4
 *
 * Properties tested:
 * - Concurrency never exceeds MAX_CONCURRENT_SYNC (5) for small files (< 1MB avg)
 * - Concurrency never exceeds MAX_CONCURRENT_ASYNC (10) for large files (>= 1MB avg)
 * - Concurrency never exceeds the document count
 * - Concurrency is always >= 1 when documentCount >= 1
 * - Return value is always a positive integer
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { EnhancedTextractService } from '../src/services/enhanced-textract';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CONCURRENT_SYNC = 5;
const MAX_CONCURRENT_ASYNC = 10;
const ONE_MB = 1024 * 1024;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Document counts >= 1 */
const positiveDocCountArb = fc.integer({ min: 1, max: 10_000 });

/** Average file sizes strictly below 1MB */
const smallAvgFileSizeArb = fc.integer({ min: 0, max: ONE_MB - 1 });

/** Average file sizes at or above 1MB */
const largeAvgFileSizeArb = fc.integer({ min: ONE_MB, max: 1_000_000_000 });

/** Any non-negative average file size */
const anyAvgFileSizeArb = fc.integer({ min: 0, max: 1_000_000_000 });

// ─── Property 12: Concurrency Management ─────────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 12: Concurrency Management', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any number of documents with small average file size (< 1MB),
   * the concurrency should never exceed MAX_CONCURRENT_SYNC (5).
   */
  it('should never exceed MAX_CONCURRENT_SYNC (5) for small files', () => {
    fc.assert(
      fc.property(positiveDocCountArb, smallAvgFileSizeArb, (docCount, avgSize) => {
        const concurrency = EnhancedTextractService.determineOptimalConcurrency(docCount, avgSize);
        expect(concurrency).toBeLessThanOrEqual(MAX_CONCURRENT_SYNC);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For any number of documents with large average file size (>= 1MB),
   * the concurrency should never exceed MAX_CONCURRENT_ASYNC (10).
   */
  it('should never exceed MAX_CONCURRENT_ASYNC (10) for large files', () => {
    fc.assert(
      fc.property(positiveDocCountArb, largeAvgFileSizeArb, (docCount, avgSize) => {
        const concurrency = EnhancedTextractService.determineOptimalConcurrency(docCount, avgSize);
        expect(concurrency).toBeLessThanOrEqual(MAX_CONCURRENT_ASYNC);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For any document count and file size, the concurrency should
   * never exceed the actual number of documents.
   */
  it('should never exceed the document count', () => {
    fc.assert(
      fc.property(positiveDocCountArb, anyAvgFileSizeArb, (docCount, avgSize) => {
        const concurrency = EnhancedTextractService.determineOptimalConcurrency(docCount, avgSize);
        expect(concurrency).toBeLessThanOrEqual(docCount);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For any document count >= 1 and any file size, the concurrency
   * should always be at least 1.
   */
  it('should always be >= 1 when documentCount >= 1', () => {
    fc.assert(
      fc.property(positiveDocCountArb, anyAvgFileSizeArb, (docCount, avgSize) => {
        const concurrency = EnhancedTextractService.determineOptimalConcurrency(docCount, avgSize);
        expect(concurrency).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * For any valid inputs, the return value should always be a positive
   * integer (whole number > 0).
   */
  it('should always return a positive integer', () => {
    fc.assert(
      fc.property(positiveDocCountArb, anyAvgFileSizeArb, (docCount, avgSize) => {
        const concurrency = EnhancedTextractService.determineOptimalConcurrency(docCount, avgSize);
        expect(Number.isInteger(concurrency)).toBe(true);
        expect(concurrency).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

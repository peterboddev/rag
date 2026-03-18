/**
 * Property-based tests for Truncation Indicators
 * Feature: token-aware-summarization, Property 6: Truncation Indicators
 *
 * Validates: Requirements 2.4
 *
 * Properties tested:
 * - addTruncationIndicators returns content unchanged when documentsTruncated is 0
 * - addTruncationIndicators adds indicator text when documentsTruncated > 0
 * - Indicator includes original and processed token counts
 * - Indicator includes document counts
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import {
  TextTruncationService,
  TruncationStrategy,
  TruncationInfo,
} from '../src/services/text-truncation';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary non-empty content string */
const contentArb = fc.string({ minLength: 1, maxLength: 2_000 });

/** Arbitrary for a TruncationInfo where no documents were truncated */
const noTruncationInfoArb = fc.record({
  documentsProcessed: fc.integer({ min: 1, max: 20 }),
  documentsTruncated: fc.constant(0),
  totalOriginalTokens: fc.integer({ min: 1, max: 100_000 }),
  totalProcessedTokens: fc.integer({ min: 1, max: 100_000 }),
  truncationStrategy: fc.constantFrom(
    TruncationStrategy.BEGINNING_AND_END,
    TruncationStrategy.BEGINNING_ONLY,
    TruncationStrategy.SMART_EXCERPT,
    TruncationStrategy.PROPORTIONAL
  ),
  truncationDetails: fc.constant([]),
});

/** Arbitrary for a TruncationInfo where at least one document was truncated */
const truncatedInfoArb = fc
  .record({
    documentsProcessed: fc.integer({ min: 1, max: 20 }),
    documentsTruncated: fc.integer({ min: 1, max: 20 }),
    totalOriginalTokens: fc.integer({ min: 100, max: 100_000 }),
    totalProcessedTokens: fc.integer({ min: 1, max: 100_000 }),
    truncationStrategy: fc.constantFrom(
      TruncationStrategy.BEGINNING_AND_END,
      TruncationStrategy.BEGINNING_ONLY,
      TruncationStrategy.SMART_EXCERPT,
      TruncationStrategy.PROPORTIONAL
    ),
    truncationDetails: fc.constant([]),
  })
  .filter((info) => info.documentsTruncated <= info.documentsProcessed);

// ─── Service Instance ────────────────────────────────────────────────────────

let service: TextTruncationService;

beforeEach(() => {
  service = new TextTruncationService();
});

// ─── Property 6: Truncation Indicators ───────────────────────────────────────

describe('Feature: token-aware-summarization, Property 6: Truncation Indicators', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * When no documents were truncated, the content should be returned unchanged.
   */
  it('returns content unchanged when documentsTruncated is 0', () => {
    fc.assert(
      fc.property(contentArb, noTruncationInfoArb, (content, info) => {
        const result = service.addTruncationIndicators(content, info);
        expect(result).toBe(content);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * When documents were truncated, the result should differ from the original
   * content by prepending an indicator.
   */
  it('adds indicator text when documentsTruncated > 0', () => {
    fc.assert(
      fc.property(contentArb, truncatedInfoArb, (content, info) => {
        const result = service.addTruncationIndicators(content, info);
        expect(result).not.toBe(content);
        expect(result).toContain(content);
        expect(result).toContain('[IMPORTANT');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * The indicator text should include the original and processed token counts
   * so the AI model knows how much content was omitted.
   */
  it('indicator includes original and processed token counts', () => {
    fc.assert(
      fc.property(contentArb, truncatedInfoArb, (content, info) => {
        const result = service.addTruncationIndicators(content, info);
        expect(result).toContain(String(info.totalOriginalTokens));
        expect(result).toContain(String(info.totalProcessedTokens));
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * The indicator text should include the document counts (truncated and processed)
   * so the AI model understands the scope of truncation.
   */
  it('indicator includes document counts', () => {
    fc.assert(
      fc.property(contentArb, truncatedInfoArb, (content, info) => {
        const result = service.addTruncationIndicators(content, info);
        expect(result).toContain(String(info.documentsTruncated));
        expect(result).toContain(String(info.documentsProcessed));
      }),
      { numRuns: 100 }
    );
  });
});

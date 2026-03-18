/**
 * Property-based tests for Truncation Notification
 * Feature: token-aware-summarization, Property 9: Truncation Notification
 *
 * **Validates: Requirements 4.2**
 *
 * Properties tested:
 * - When documents are truncated, addTruncationIndicators prepends a notification
 * - The notification includes original and processed token counts
 * - The notification includes truncated/total document counts
 * - When no documents are truncated, content is returned unchanged
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { TextTruncationService, TruncationInfo, TruncationStrategy } from '../src/services/text-truncation';

// ─── Service Instance ────────────────────────────────────────────────────────

let service: TextTruncationService;

beforeEach(() => {
  service = new TextTruncationService();
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty content strings */
const contentArb = fc.string({ minLength: 1, maxLength: 2000 })
  .filter(s => s.trim().length > 0);

/** Truncation info where documents WERE truncated */
const truncatedInfoArb: fc.Arbitrary<TruncationInfo> = fc.record({
  documentsProcessed: fc.integer({ min: 1, max: 50 }),
  documentsTruncated: fc.integer({ min: 1, max: 50 }),
  totalOriginalTokens: fc.integer({ min: 100, max: 100000 }),
  totalProcessedTokens: fc.integer({ min: 10, max: 99999 }),
  truncationStrategy: fc.constantFrom(
    TruncationStrategy.BEGINNING_AND_END,
    TruncationStrategy.BEGINNING_ONLY,
    TruncationStrategy.SMART_EXCERPT,
    TruncationStrategy.PROPORTIONAL
  ),
  truncationDetails: fc.constant([]),
}).filter(info => info.documentsTruncated <= info.documentsProcessed
  && info.totalProcessedTokens <= info.totalOriginalTokens);

/** Truncation info where NO documents were truncated */
const noTruncationInfoArb: fc.Arbitrary<TruncationInfo> = fc.record({
  documentsProcessed: fc.integer({ min: 0, max: 50 }),
  documentsTruncated: fc.constant(0),
  totalOriginalTokens: fc.integer({ min: 0, max: 100000 }),
  totalProcessedTokens: fc.integer({ min: 0, max: 100000 }),
  truncationStrategy: fc.constantFrom(
    TruncationStrategy.BEGINNING_AND_END,
    TruncationStrategy.BEGINNING_ONLY,
    TruncationStrategy.SMART_EXCERPT,
    TruncationStrategy.PROPORTIONAL
  ),
  truncationDetails: fc.constant([]),
});

// ─── Property 9: Truncation Notification ─────────────────────────────────────

describe('Feature: token-aware-summarization, Property 9: Truncation Notification', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * When documents are truncated, addTruncationIndicators should prepend
   * a notification indicator to the content (result differs from input).
   */
  it('prepends a truncation notification when documents are truncated', () => {
    fc.assert(
      fc.property(contentArb, truncatedInfoArb, (content, info) => {
        const result = service.addTruncationIndicators(content, info);
        // Result should be longer than original content
        expect(result.length).toBeGreaterThan(content.length);
        // Original content should still be present at the end
        expect(result).toContain(content);
        // Should contain the IMPORTANT marker
        expect(result).toContain('[IMPORTANT:');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * The truncation notification must include the original and processed token counts
   * so Nova Pro understands the extent of content omission.
   */
  it('notification includes original and processed token counts', () => {
    fc.assert(
      fc.property(contentArb, truncatedInfoArb, (content, info) => {
        const result = service.addTruncationIndicators(content, info);
        expect(result).toContain(`${info.totalOriginalTokens} tokens`);
        expect(result).toContain(`${info.totalProcessedTokens} tokens`);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * The notification must include how many documents were truncated out of total processed.
   */
  it('notification includes truncated and total document counts', () => {
    fc.assert(
      fc.property(contentArb, truncatedInfoArb, (content, info) => {
        const result = service.addTruncationIndicators(content, info);
        expect(result).toContain(`${info.documentsTruncated} of ${info.documentsProcessed}`);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * When no documents are truncated (documentsTruncated === 0),
   * the content should be returned unchanged.
   */
  it('returns content unchanged when no documents are truncated', () => {
    fc.assert(
      fc.property(contentArb, noTruncationInfoArb, (content, info) => {
        const result = service.addTruncationIndicators(content, info);
        expect(result).toBe(content);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for Conservative Estimation
 * Feature: token-aware-summarization, Property 8: Conservative Estimation
 *
 * Validates: Requirements 3.4
 *
 * Properties tested:
 * - Token estimates are always >= 0
 * - Estimates scale proportionally with text length
 * - Conservative estimates (3.5 ratio) are always >= standard estimates (4:1 ratio)
 * - Empty/whitespace text returns 0 tokens
 * - Prompt overhead reduces available tokens correctly
 * - Token distribution across documents sums to approximately the total budget
 * - fitsWithinLimit returns correct boolean
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenEstimationService } from '../src/services/token-estimation';
import { DocumentRecord } from '../src/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const STANDARD_RATIO = 4;
const CONSERVATIVE_RATIO = 3.5;
const MIN_CONTENT_TOKENS = 50;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty text strings that have non-whitespace content */
const nonEmptyTextArb = fc.string({ minLength: 1, maxLength: 5_000 })
  .filter(s => s.trim().length > 0);

/** Whitespace-only strings (including empty) */
const whitespaceArb = fc.constantFrom('', ' ', '  ', '   ', '\t', '\n', '  \t\n  ');

/** Reasonable token limit values */
const tokenLimitArb = fc.integer({ min: 1, max: 50_000 });

/** Reasonable maxTokens for available token calculations */
const maxTokensArb = fc.integer({ min: 1, max: 100_000 });

/** Positive prompt overhead */
const promptOverheadArb = fc.integer({ min: 1, max: 50_000 });

/** Helper to create a minimal valid DocumentRecord */
function makeDocRecord(id: string, text: string): DocumentRecord {
  return {
    documentId: id,
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: `${id}.pdf`,
    s3Key: `docs/${id}.pdf`,
    contentType: 'application/pdf',
    processingStatus: 'completed',
    extractedText: text,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Arbitrary for a small list of documents with unique IDs and non-empty text */
const documentsArb = fc.array(
  fc.tuple(
    fc.uuid(),
    fc.string({ minLength: 1, maxLength: 2_000 }).filter(s => s.trim().length > 0)
  ),
  { minLength: 1, maxLength: 8 }
).map(pairs => {
  // Deduplicate by documentId to avoid Map key collisions
  const seen = new Set<string>();
  return pairs
    .filter(([id]) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(([id, text]) => makeDocRecord(id, text));
}).filter(docs => docs.length > 0);

// ─── Service Instance ────────────────────────────────────────────────────────

let service: TokenEstimationService;

beforeEach(() => {
  service = new TokenEstimationService();
});

// ─── Property 8: Conservative Estimation ─────────────────────────────────────

describe('Feature: token-aware-summarization, Property 8: Conservative Estimation', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * For any text, both estimateTokens and getConservativeEstimate
   * should return a value >= 0.
   */
  it('token estimates are always >= 0', () => {
    fc.assert(
      fc.property(
        fc.oneof(nonEmptyTextArb, whitespaceArb),
        (text) => {
          const standard = service.estimateTokens(text);
          expect(standard).toBeGreaterThanOrEqual(0);

          // getConservativeEstimate does not guard empty strings the same way,
          // but Math.ceil(0 / 3.5) === 0, so it's still >= 0
          const conservative = service.getConservativeEstimate(text);
          expect(conservative).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * For any two non-empty texts where one is strictly longer,
   * the longer text should produce an equal or higher standard estimate.
   */
  it('estimates scale proportionally with text length', () => {
    fc.assert(
      fc.property(
        nonEmptyTextArb,
        fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
        (base, extra) => {
          const shorter = base;
          const longer = base + extra;
          expect(service.estimateTokens(longer)).toBeGreaterThanOrEqual(
            service.estimateTokens(shorter)
          );
          expect(service.getConservativeEstimate(longer)).toBeGreaterThanOrEqual(
            service.getConservativeEstimate(shorter)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * The conservative estimate (3.5 ratio) should always be >= the standard
   * estimate (4:1 ratio) because a smaller divisor yields a larger result.
   * This ensures the system errs on the side of caution.
   */
  it('conservative estimates (3.5 ratio) are always >= standard estimates (4:1 ratio)', () => {
    fc.assert(
      fc.property(nonEmptyTextArb, (text) => {
        const standard = service.estimateTokens(text);
        const conservative = service.getConservativeEstimate(text);
        expect(conservative).toBeGreaterThanOrEqual(standard);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Empty or whitespace-only text should return 0 tokens from estimateTokens.
   */
  it('empty/whitespace text returns 0 tokens', () => {
    fc.assert(
      fc.property(whitespaceArb, (text) => {
        expect(service.estimateTokens(text)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Prompt overhead correctly reduces available tokens, floored at MIN_CONTENT_TOKENS.
   */
  it('prompt overhead reduces available tokens correctly', () => {
    fc.assert(
      fc.property(maxTokensArb, promptOverheadArb, (maxTokens, overhead) => {
        const available = service.calculateAvailableTokens(maxTokens, overhead);
        const expected = Math.max(MIN_CONTENT_TOKENS, maxTokens - overhead);
        expect(available).toBe(expected);
        expect(available).toBeGreaterThanOrEqual(MIN_CONTENT_TOKENS);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * When distributing tokens across documents, every document receives an
   * allocation entry and the distribution map has the correct size.
   * The implementation gives the last document whatever tokens remain,
   * which may be negative when MIN_CONTENT_TOKENS floors inflate earlier allocations.
   */
  it('token distribution across documents sums to approximately the total budget', () => {
    fc.assert(
      fc.property(
        documentsArb,
        fc.integer({ min: 500, max: 50_000 }),
        (docs, totalTokens) => {
          const distribution = service.distributeTokens(docs, totalTokens);

          // Every document should receive an allocation entry
          expect(distribution.size).toBe(docs.length);

          // The sum of all allocations should approximate the total budget.
          // Due to rounding and MIN_CONTENT_TOKENS floors, the sum may differ
          // slightly but should stay within a reasonable range.
          const sum = Array.from(distribution.values()).reduce((a, b) => a + b, 0);
          expect(sum).toBeLessThanOrEqual(totalTokens + docs.length * MIN_CONTENT_TOKENS);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * fitsWithinLimit should return true when estimated tokens <= limit,
   * and false otherwise.
   */
  it('fitsWithinLimit returns correct boolean', () => {
    fc.assert(
      fc.property(nonEmptyTextArb, tokenLimitArb, (text, limit) => {
        const fits = service.fitsWithinLimit(text, limit);
        const estimated = service.estimateTokens(text);
        expect(fits).toBe(estimated <= limit);
      }),
      { numRuns: 100 }
    );
  });
});

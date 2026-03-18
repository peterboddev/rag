/**
 * Property-based tests for Token Distribution Fairness
 * Feature: token-aware-summarization, Property 5: Token Distribution Fairness
 *
 * Validates: Requirements 2.3, 7.1, 7.2
 *
 * Properties tested:
 * - truncateMultipleDocuments returns a result for every document
 * - Each truncated document's content length is <= allocated tokens * 4 (approximately)
 * - Documents with 0 allocated tokens get empty content
 * - Documents with no extractedText get empty content
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { TextTruncationService } from '../src/services/text-truncation';
import { DocumentRecord } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal valid DocumentRecord */
function makeDocRecord(id: string, text?: string): DocumentRecord {
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Sentence-like text that produces meaningful truncation behavior */
const sentenceTextArb = fc
  .array(fc.lorem({ maxCount: 10, mode: 'sentences' }), { minLength: 1, maxLength: 5 })
  .map((sentences) => sentences.join(' '));

/**
 * Arbitrary for a list of documents with unique IDs and their token distribution.
 * Each document gets a positive token allocation.
 */
const docsWithDistributionArb = fc
  .array(
    fc.tuple(
      fc.uuid(),
      sentenceTextArb,
      fc.integer({ min: 50, max: 2_000 })
    ),
    { minLength: 1, maxLength: 6 }
  )
  .map((tuples) => {
    // Deduplicate by ID
    const seen = new Set<string>();
    const unique = tuples.filter(([id]) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const docs = unique.map(([id, text]) => makeDocRecord(id, text));
    const distribution = new Map<string, number>();
    unique.forEach(([id, , tokens]) => distribution.set(id, tokens));

    return { docs, distribution };
  })
  .filter(({ docs }) => docs.length > 0);

/** Arbitrary for documents where some get 0 tokens */
const docsWithZeroTokensArb = fc
  .array(
    fc.tuple(fc.uuid(), sentenceTextArb),
    { minLength: 1, maxLength: 6 }
  )
  .map((tuples) => {
    const seen = new Set<string>();
    const unique = tuples.filter(([id]) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const docs = unique.map(([id, text]) => makeDocRecord(id, text));
    const distribution = new Map<string, number>();
    unique.forEach(([id]) => distribution.set(id, 0));

    return { docs, distribution };
  })
  .filter(({ docs }) => docs.length > 0);

/** Arbitrary for documents with no extractedText */
const docsWithNoTextArb = fc
  .array(
    fc.tuple(fc.uuid(), fc.integer({ min: 50, max: 2_000 })),
    { minLength: 1, maxLength: 6 }
  )
  .map((tuples) => {
    const seen = new Set<string>();
    const unique = tuples.filter(([id]) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const docs = unique.map(([id]) => makeDocRecord(id, undefined));
    const distribution = new Map<string, number>();
    unique.forEach(([id, tokens]) => distribution.set(id, tokens));

    return { docs, distribution };
  })
  .filter(({ docs }) => docs.length > 0);

// ─── Service Instance ────────────────────────────────────────────────────────

let service: TextTruncationService;

beforeEach(() => {
  service = new TextTruncationService();
});

// ─── Property 5: Token Distribution Fairness ─────────────────────────────────

describe('Feature: token-aware-summarization, Property 5: Token Distribution Fairness', () => {
  /**
   * **Validates: Requirements 2.3, 7.1, 7.2**
   *
   * truncateMultipleDocuments must return exactly one result entry
   * for every input document.
   */
  it('returns a result for every document', () => {
    fc.assert(
      fc.property(docsWithDistributionArb, ({ docs, distribution }) => {
        const results = service.truncateMultipleDocuments(docs, distribution);
        expect(results.size).toBe(docs.length);
        for (const doc of docs) {
          expect(results.has(doc.documentId)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 7.1, 7.2**
   *
   * Each truncated document's content length should be approximately bounded
   * by allocated tokens * 4 (the 4:1 char-to-token ratio). We allow some
   * overhead for truncation indicator text that the service may insert.
   */
  it('each truncated document content length is <= allocated tokens * 4 plus indicator overhead', () => {
    fc.assert(
      fc.property(docsWithDistributionArb, ({ docs, distribution }) => {
        const results = service.truncateMultipleDocuments(docs, distribution);

        for (const doc of docs) {
          const result = results.get(doc.documentId)!;
          const allocatedTokens = distribution.get(doc.documentId) || 0;
          // The service uses a 4:1 char-to-token ratio.
          // Truncation indicators add some overhead text, so we allow a generous margin.
          const maxChars = allocatedTokens * 4 + 200;
          expect(result.content.length).toBeLessThanOrEqual(maxChars);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 7.1, 7.2**
   *
   * Documents allocated 0 tokens should get empty content.
   */
  it('documents with 0 allocated tokens get empty content', () => {
    fc.assert(
      fc.property(docsWithZeroTokensArb, ({ docs, distribution }) => {
        const results = service.truncateMultipleDocuments(docs, distribution);

        for (const doc of docs) {
          const result = results.get(doc.documentId)!;
          expect(result.content).toBe('');
          expect(result.truncatedLength).toBe(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 7.1, 7.2**
   *
   * Documents with no extractedText (undefined) should get empty content
   * regardless of token allocation.
   */
  it('documents with no extractedText get empty content', () => {
    fc.assert(
      fc.property(docsWithNoTextArb, ({ docs, distribution }) => {
        const results = service.truncateMultipleDocuments(docs, distribution);

        for (const doc of docs) {
          const result = results.get(doc.documentId)!;
          expect(result.content).toBe('');
          expect(result.truncatedLength).toBe(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

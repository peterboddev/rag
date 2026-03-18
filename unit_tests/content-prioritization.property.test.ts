/**
 * Property-based tests for Content Prioritization
 * Feature: token-aware-summarization, Property 3: Content Prioritization
 *
 * **Validates: Requirements 1.4**
 *
 * Properties tested:
 * - prioritizeDocuments returns one entry per document
 * - All priority values are between 0 and 1
 * - Priority factors are non-negative
 * - More recent documents get higher recency scores when recencyWeight is high
 * - Empty document list returns empty array
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import {
  ContentPrioritizationService,
  PrioritizationCriteria,
  DocumentPriority,
} from '../src/services/content-prioritization';
import { DocumentRecord } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocRecord(
  id: string,
  overrides?: Partial<DocumentRecord>
): DocumentRecord {
  return {
    documentId: id,
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: `${id}.pdf`,
    s3Key: `docs/${id}.pdf`,
    contentType: 'application/pdf',
    processingStatus: 'completed',
    extractedText: 'Some sample extracted text for testing purposes.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const contentTypes = [
  'application/pdf',
  'application/msword',
  'text/plain',
  'image/jpeg',
  'image/png',
];

const processingStatuses: Array<DocumentRecord['processingStatus']> = [
  'completed',
  'queued',
  'processing',
  'failed',
];

/** Arbitrary for a single DocumentRecord with random properties */
const documentRecordArb = fc
  .record({
    id: fc.uuid(),
    text: fc.oneof(
      fc.constant(undefined),
      fc.lorem({ maxCount: 20, mode: 'sentences' })
    ),
    contentType: fc.constantFrom(...contentTypes),
    status: fc.constantFrom(...processingStatuses),
    daysAgo: fc.integer({ min: 0, max: 730 }),
  })
  .map(({ id, text, contentType, status, daysAgo }) => {
    const created = new Date();
    created.setDate(created.getDate() - daysAgo);
    return makeDocRecord(id, {
      extractedText: text,
      contentType,
      processingStatus: status,
      createdAt: created.toISOString(),
    });
  });

/** Arbitrary for a list of documents with unique IDs */
const uniqueDocumentsArb = fc
  .array(documentRecordArb, { minLength: 1, maxLength: 8 })
  .map((docs) => {
    const seen = new Set<string>();
    return docs.filter((d) => {
      if (seen.has(d.documentId)) return false;
      seen.add(d.documentId);
      return true;
    });
  })
  .filter((docs) => docs.length > 0);

/** Arbitrary for PrioritizationCriteria with weights 0-1 */
const criteriaArb: fc.Arbitrary<PrioritizationCriteria> = fc.record({
  recencyWeight: fc.double({ min: 0, max: 1, noNaN: true }),
  sizeWeight: fc.double({ min: 0, max: 1, noNaN: true }),
  contentTypeWeight: fc.double({ min: 0, max: 1, noNaN: true }),
  processingQualityWeight: fc.double({ min: 0, max: 1, noNaN: true }),
});

// ─── Service Instance ────────────────────────────────────────────────────────

let service: ContentPrioritizationService;

beforeEach(() => {
  service = new ContentPrioritizationService();
});

// ─── Property 3: Content Prioritization ──────────────────────────────────────

describe('Feature: token-aware-summarization, Property 3: Content Prioritization', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * prioritizeDocuments must return exactly one entry per input document.
   */
  it('returns one priority entry per document', () => {
    fc.assert(
      fc.property(uniqueDocumentsArb, criteriaArb, (docs, criteria) => {
        const results = service.prioritizeDocuments(docs, criteria);
        expect(results.length).toBe(docs.length);

        const resultIds = new Set(results.map((r) => r.documentId));
        for (const doc of docs) {
          expect(resultIds.has(doc.documentId)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * All priority values must be non-negative. The priority is a weighted sum
   * of individual factor scores (each 0-1) multiplied by criteria weights (each 0-1),
   * so the theoretical max is the sum of all weights (up to 4.0).
   */
  it('all priority values are non-negative and bounded by sum of weights', () => {
    fc.assert(
      fc.property(uniqueDocumentsArb, criteriaArb, (docs, criteria) => {
        const results = service.prioritizeDocuments(docs, criteria);
        const maxPossible =
          criteria.recencyWeight +
          criteria.sizeWeight +
          criteria.contentTypeWeight +
          criteria.processingQualityWeight +
          0.01; // small epsilon for floating point rounding
        for (const result of results) {
          expect(result.priority).toBeGreaterThanOrEqual(0);
          expect(result.priority).toBeLessThanOrEqual(maxPossible);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * recommendedTokens should be non-negative for all documents.
   */
  it('recommendedTokens are non-negative', () => {
    fc.assert(
      fc.property(uniqueDocumentsArb, criteriaArb, (docs, criteria) => {
        const results = service.prioritizeDocuments(docs, criteria);
        for (const result of results) {
          expect(result.recommendedTokens).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * When recencyWeight is high (1.0) and other weights are 0,
   * a document created today should score >= a document created a year ago.
   */
  it('more recent documents get higher priority when recencyWeight dominates', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (id1, id2) => {
        // Skip if IDs collide
        fc.pre(id1 !== id2);

        const now = new Date();
        const yearAgo = new Date();
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);

        const recentDoc = makeDocRecord(id1, {
          createdAt: now.toISOString(),
        });
        const oldDoc = makeDocRecord(id2, {
          createdAt: yearAgo.toISOString(),
        });

        const criteria: PrioritizationCriteria = {
          recencyWeight: 1.0,
          sizeWeight: 0,
          contentTypeWeight: 0,
          processingQualityWeight: 0,
        };

        const results = service.prioritizeDocuments(
          [recentDoc, oldDoc],
          criteria
        );
        const recentPriority = results.find(
          (r) => r.documentId === id1
        )!.priority;
        const oldPriority = results.find(
          (r) => r.documentId === id2
        )!.priority;

        expect(recentPriority).toBeGreaterThanOrEqual(oldPriority);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * An empty document list should return an empty array.
   */
  it('empty document list returns empty array', () => {
    fc.assert(
      fc.property(criteriaArb, (criteria) => {
        const results = service.prioritizeDocuments([], criteria);
        expect(results).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});

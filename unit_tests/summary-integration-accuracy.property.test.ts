/**
 * Property-based tests for Summary Integration Accuracy
 * Feature: pdf-processing-enhancement, Property 9: Summary Integration Accuracy
 *
 * Validates: Requirements 8.1, 8.2
 *
 * Properties tested:
 * 1. Only completed documents with valid text appear in includedDocuments
 * 2. All non-completed documents appear in excludedDocuments with a reason
 * 3. The union of included and excluded documents equals the total input
 * 4. Every excluded document has a non-empty reason string
 * 5. No document appears in both included and excluded lists
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { filterDocumentsForSummary } from '../src/services/document-summary-filter';
import { DocumentRecord, ProcessingStatus } from '../src/types';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const processingStatusArb = fc.constantFrom<ProcessingStatus>('queued', 'processing', 'completed', 'failed');

const nonEmptyStringArb = fc.stringOf(fc.char(), { minLength: 1, maxLength: 40 })
  .filter(s => s.trim().length > 0);

/** Generates valid extracted text (>= 10 chars after trim) */
const validTextArb = fc.stringOf(fc.char(), { minLength: 10, maxLength: 200 })
  .filter(s => s.trim().length >= 10);

/** Generates short text that fails the minimum length check */
const shortTextArb = fc.stringOf(fc.char(), { minLength: 1, maxLength: 9 })
  .filter(s => s.trim().length > 0 && s.trim().length < 10);

/** Generates a confidence score: either undefined or a number 0-100 */
const confidenceArb = fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined });

/** Builds a DocumentRecord with controlled fields */
function documentRecordArb(overrides?: {
  status?: fc.Arbitrary<ProcessingStatus>;
  text?: fc.Arbitrary<string | undefined>;
  confidence?: fc.Arbitrary<number | undefined>;
}): fc.Arbitrary<DocumentRecord> {
  const statusArb = overrides?.status ?? processingStatusArb;
  const textArb = overrides?.text ?? fc.oneof(
    fc.constant(undefined),
    fc.constant(''),
    fc.constant('   '),
    shortTextArb,
    validTextArb,
  );
  const confArb = overrides?.confidence ?? confidenceArb;

  return fc.tuple(
    fc.uuid(),
    statusArb,
    textArb,
    confArb,
    nonEmptyStringArb,
  ).map(([id, status, text, confidence, fileName]) => {
    const now = new Date().toISOString();
    const doc: DocumentRecord = {
      documentId: id,
      customerUuid: 'cust-1',
      tenantId: 'tenant-1',
      fileName: fileName + '.pdf',
      s3Key: `docs/${id}.pdf`,
      contentType: 'application/pdf',
      processingStatus: status,
      extractedText: text,
      createdAt: now,
      updatedAt: now,
    };
    if (confidence !== undefined) {
      doc.processingMetadata = {
        confidence,
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync',
        retryHistory: [],
      };
    }
    return doc;
  });
}

/** Generates a list of documents with mixed statuses and text quality */
const documentListArb = fc.array(documentRecordArb(), { minLength: 0, maxLength: 20 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidForInclusion(doc: DocumentRecord): boolean {
  if (doc.processingStatus !== 'completed') return false;
  if (!doc.extractedText || doc.extractedText.trim().length === 0) return false;
  if (doc.extractedText.trim().length < 10) return false;
  const confidence = doc.processingMetadata?.confidence;
  if (confidence !== undefined && confidence !== null && confidence < 50) return false;
  return true;
}

// ─── Property 9: Summary Integration Accuracy ────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 9: Summary Integration Accuracy', () => {
  /**
   * **Validates: Requirements 8.1**
   *
   * For any mix of documents, only completed documents with valid text
   * appear in includedDocuments.
   */
  it('only completed documents with valid text are included in summaries', () => {
    fc.assert(
      fc.property(documentListArb, (docs) => {
        const result = filterDocumentsForSummary(docs);

        for (const included of result.includedDocuments) {
          // Must be completed
          expect(included.processingStatus).toBe('completed');
          // Must have valid text (non-empty, >= 10 chars)
          expect(included.extractedText).toBeDefined();
          expect(included.extractedText!.trim().length).toBeGreaterThanOrEqual(10);
          // Confidence must be >= 50 if set
          const confidence = included.processingMetadata?.confidence;
          if (confidence !== undefined && confidence !== null) {
            expect(confidence).toBeGreaterThanOrEqual(50);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * All non-completed documents appear in excludedDocuments with a reason.
   */
  it('all non-completed documents appear in excludedDocuments', () => {
    fc.assert(
      fc.property(documentListArb, (docs) => {
        const result = filterDocumentsForSummary(docs);

        const nonCompleted = docs.filter(d => d.processingStatus !== 'completed');
        const excludedIds = new Set(result.excludedDocuments.map(e => e.documentId));

        for (const doc of nonCompleted) {
          expect(excludedIds.has(doc.documentId)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * The total count of included + excluded documents equals the input count.
   * No documents are lost or duplicated.
   */
  it('union of included and excluded documents equals total input', () => {
    fc.assert(
      fc.property(documentListArb, (docs) => {
        const result = filterDocumentsForSummary(docs);

        expect(
          result.includedDocuments.length + result.excludedDocuments.length,
        ).toBe(docs.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * Every excluded document has a non-empty reason string explaining
   * why it was excluded from summary generation.
   */
  it('every excluded document has a non-empty reason', () => {
    fc.assert(
      fc.property(documentListArb, (docs) => {
        const result = filterDocumentsForSummary(docs);

        for (const excluded of result.excludedDocuments) {
          expect(typeof excluded.reason).toBe('string');
          expect(excluded.reason.trim().length).toBeGreaterThan(0);
          expect(excluded.documentId).toBeTruthy();
          expect(excluded.fileName).toBeTruthy();
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * No document appears in both included and excluded lists.
   * The two sets are disjoint.
   */
  it('no document appears in both included and excluded lists', () => {
    fc.assert(
      fc.property(documentListArb, (docs) => {
        const result = filterDocumentsForSummary(docs);

        const includedIds = new Set(result.includedDocuments.map(d => d.documentId));
        const excludedIds = new Set(result.excludedDocuments.map(e => e.documentId));

        for (const id of includedIds) {
          expect(excludedIds.has(id)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

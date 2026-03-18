/**
 * Property-based tests for Status Display Completeness
 * Feature: pdf-processing-enhancement, Property 8: Status Display Completeness
 *
 * Validates: Requirements 3.5, 6.4
 *
 * Properties tested:
 * 1. Every document always has documentId, fileName, contentType, createdAt, and processingStatus
 * 2. Completed documents should have textLength and processingDurationMs
 * 3. Failed documents should have errorMessage and errorDetails
 * 4. Documents with retries should have retryCount and maxRetries
 * 5. A display-readiness check function returns true only when all required fields for the status are present
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import type { DocumentSummaryItem, ProcessingStatus } from '../src/types/index';

// ─── Helper Function Under Test ──────────────────────────────────────────────

/**
 * Checks whether a document has all required fields for its current processing status
 * to be fully displayed in the UI.
 */
export function isDisplayReady(doc: DocumentSummaryItem): { ready: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  // Base required fields for every document
  if (!doc.documentId) missingFields.push('documentId');
  if (!doc.fileName) missingFields.push('fileName');
  if (!doc.contentType) missingFields.push('contentType');
  if (!doc.createdAt) missingFields.push('createdAt');
  if (!doc.processingStatus) missingFields.push('processingStatus');

  // Status-specific required fields
  if (doc.processingStatus === 'completed') {
    if (doc.textLength === undefined || doc.textLength === null) missingFields.push('textLength');
    if (doc.processingDurationMs === undefined || doc.processingDurationMs === null) missingFields.push('processingDurationMs');
  }

  if (doc.processingStatus === 'failed') {
    if (!doc.errorMessage) missingFields.push('errorMessage');
    if (!doc.errorDetails) missingFields.push('errorDetails');
  }

  if (doc.retryCount !== undefined && doc.retryCount > 0) {
    if (doc.maxRetries === undefined || doc.maxRetries === null) missingFields.push('maxRetries');
  }

  return { ready: missingFields.length === 0, missingFields };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const statusArb = fc.constantFrom<ProcessingStatus>('queued', 'processing', 'completed', 'failed');

const isoDateArb = fc.nat({ max: 1_700_000_000_000 }).map(ms => new Date(ms).toISOString());

const nonEmptyStringArb = fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

/** Base document fields present on every document */
const baseDocArb = fc.record({
  documentId: fc.uuid(),
  fileName: nonEmptyStringArb.map(s => s + '.pdf'),
  contentType: fc.constant('application/pdf'),
  createdAt: isoDateArb,
});

/** A fully display-ready completed document */
const completedDocArb = baseDocArb.chain(base =>
  fc.record({
    textLength: fc.integer({ min: 1, max: 100_000 }),
    processingDurationMs: fc.integer({ min: 1, max: 300_000 }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    pageCount: fc.integer({ min: 1, max: 500 }),
    textPreview: fc.string({ minLength: 1, maxLength: 200 }),
  }).map(extra => ({
    ...base,
    processingStatus: 'completed' as ProcessingStatus,
    ...extra,
  }))
);

/** A fully display-ready failed document */
const failedDocArb = baseDocArb.chain(base =>
  fc.record({
    errorMessage: nonEmptyStringArb,
    errorDetails: nonEmptyStringArb,
  }).map(extra => ({
    ...base,
    processingStatus: 'failed' as ProcessingStatus,
    ...extra,
  }))
);

/** A document with retry information */
const retryDocArb = baseDocArb.chain(base =>
  fc.record({
    retryCount: fc.integer({ min: 1, max: 5 }),
    maxRetries: fc.integer({ min: 1, max: 5 }),
    errorMessage: nonEmptyStringArb,
    errorDetails: nonEmptyStringArb,
  }).map(extra => ({
    ...base,
    processingStatus: 'failed' as ProcessingStatus,
    ...extra,
  }))
);

/** A queued or processing document (only base fields needed) */
const inProgressDocArb = baseDocArb.chain(base =>
  fc.constantFrom<ProcessingStatus>('queued', 'processing').map(status => ({
    ...base,
    processingStatus: status,
  }))
);

/** A completed document missing some required completed-status fields */
const incompleteCompletedDocArb = baseDocArb.chain(base =>
  fc.record({
    textLength: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: undefined }),
    processingDurationMs: fc.option(fc.integer({ min: 1, max: 300_000 }), { nil: undefined }),
  }).filter(extra => extra.textLength === undefined || extra.processingDurationMs === undefined)
    .map(extra => ({
      ...base,
      processingStatus: 'completed' as ProcessingStatus,
      ...extra,
    }))
);

/** A failed document missing error fields */
const incompleteFailedDocArb = baseDocArb.chain(base =>
  fc.record({
    errorMessage: fc.option(nonEmptyStringArb, { nil: undefined }),
    errorDetails: fc.option(nonEmptyStringArb, { nil: undefined }),
  }).filter(extra => extra.errorMessage === undefined || extra.errorDetails === undefined)
    .map(extra => ({
      ...base,
      processingStatus: 'failed' as ProcessingStatus,
      ...extra,
    }))
);

// ─── Property 8: Status Display Completeness ─────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 8: Status Display Completeness', () => {
  /**
   * **Validates: Requirements 3.5, 6.4**
   *
   * Property 1: Every document always has the base required fields:
   * documentId, fileName, contentType, createdAt, and processingStatus.
   */
  it('every document has base required fields (documentId, fileName, contentType, createdAt, processingStatus)', () => {
    fc.assert(
      fc.property(
        baseDocArb,
        statusArb,
        (base, status) => {
          const doc: DocumentSummaryItem = { ...base, processingStatus: status };
          expect(doc.documentId).toBeTruthy();
          expect(doc.fileName).toBeTruthy();
          expect(doc.contentType).toBeTruthy();
          expect(doc.createdAt).toBeTruthy();
          expect(doc.processingStatus).toBeTruthy();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5, 6.4**
   *
   * Property 2: Completed documents should have textLength and processingDurationMs.
   * A fully-populated completed document is display-ready.
   */
  it('completed documents with textLength and processingDurationMs are display-ready', () => {
    fc.assert(
      fc.property(completedDocArb, (doc) => {
        expect(doc.processingStatus).toBe('completed');
        expect(doc.textLength).toBeDefined();
        expect(typeof doc.textLength).toBe('number');
        expect(doc.processingDurationMs).toBeDefined();
        expect(typeof doc.processingDurationMs).toBe('number');

        const result = isDisplayReady(doc);
        expect(result.ready).toBe(true);
        expect(result.missingFields).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5, 6.4**
   *
   * Property 3: Failed documents should have errorMessage and errorDetails.
   * A fully-populated failed document is display-ready.
   */
  it('failed documents with errorMessage and errorDetails are display-ready', () => {
    fc.assert(
      fc.property(failedDocArb, (doc) => {
        expect(doc.processingStatus).toBe('failed');
        expect(doc.errorMessage).toBeTruthy();
        expect(doc.errorDetails).toBeTruthy();

        const result = isDisplayReady(doc);
        expect(result.ready).toBe(true);
        expect(result.missingFields).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5, 6.4**
   *
   * Property 4: Documents with retries should have retryCount and maxRetries.
   */
  it('documents with retries have both retryCount and maxRetries', () => {
    fc.assert(
      fc.property(retryDocArb, (doc) => {
        expect(doc.retryCount).toBeGreaterThan(0);
        expect(doc.maxRetries).toBeDefined();
        expect(typeof doc.maxRetries).toBe('number');

        const result = isDisplayReady(doc);
        expect(result.ready).toBe(true);
        expect(result.missingFields).not.toContain('maxRetries');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5, 6.4**
   *
   * Property 5: isDisplayReady returns true only when all required fields for the status are present.
   * Queued/processing documents only need base fields.
   */
  it('queued and processing documents are display-ready with only base fields', () => {
    fc.assert(
      fc.property(inProgressDocArb, (doc) => {
        expect(['queued', 'processing']).toContain(doc.processingStatus);

        const result = isDisplayReady(doc);
        expect(result.ready).toBe(true);
        expect(result.missingFields).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5, 6.4**
   *
   * Completed documents missing textLength or processingDurationMs are NOT display-ready.
   */
  it('completed documents missing required fields are not display-ready', () => {
    fc.assert(
      fc.property(incompleteCompletedDocArb, (doc) => {
        const result = isDisplayReady(doc);
        expect(result.ready).toBe(false);
        expect(result.missingFields.length).toBeGreaterThan(0);

        // At least one of the completed-specific fields should be missing
        const hasCompletedFieldMissing =
          result.missingFields.includes('textLength') ||
          result.missingFields.includes('processingDurationMs');
        expect(hasCompletedFieldMissing).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5, 6.4**
   *
   * Failed documents missing errorMessage or errorDetails are NOT display-ready.
   */
  it('failed documents missing error fields are not display-ready', () => {
    fc.assert(
      fc.property(incompleteFailedDocArb, (doc) => {
        const result = isDisplayReady(doc);
        expect(result.ready).toBe(false);
        expect(result.missingFields.length).toBeGreaterThan(0);

        const hasErrorFieldMissing =
          result.missingFields.includes('errorMessage') ||
          result.missingFields.includes('errorDetails');
        expect(hasErrorFieldMissing).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5, 6.4**
   *
   * Documents with retryCount > 0 but missing maxRetries are NOT display-ready.
   */
  it('retry documents missing maxRetries are not display-ready', () => {
    fc.assert(
      fc.property(
        baseDocArb,
        fc.integer({ min: 1, max: 5 }),
        nonEmptyStringArb,
        nonEmptyStringArb,
        (base, retryCount, errorMsg, errorDet) => {
          const doc: DocumentSummaryItem = {
            ...base,
            processingStatus: 'failed',
            retryCount,
            maxRetries: undefined,
            errorMessage: errorMsg,
            errorDetails: errorDet,
          };

          const result = isDisplayReady(doc);
          expect(result.ready).toBe(false);
          expect(result.missingFields).toContain('maxRetries');
        }
      ),
      { numRuns: 100 }
    );
  });
});

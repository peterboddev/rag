/**
 * Property-based tests for Document Exclusion Notification
 * Feature: token-aware-summarization, Property 18: Document Exclusion Notification
 *
 * **Validates: Requirements 7.5**
 *
 * Properties tested:
 * - When given a mix of completed and non-completed documents, processedDocumentCount < documentCount
 * - Documents without extractedText are excluded from processing
 * - processedDocumentCount is always <= documentCount
 * - When all documents are valid, processedDocumentCount equals documentCount
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenAwareSummarizationService } from '../src/services/token-aware-summarization';
import { DocumentRecord } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockChunkingService(service: TokenAwareSummarizationService): void {
  (service as any).chunkingService = {
    getCustomerChunkingConfig: jest.fn().mockResolvedValue({
      id: 'fixed_size_1024',
      name: 'Test',
      description: 'Test',
      parameters: { strategy: 'fixed_size', maxTokens: 1024 }
    })
  };
}

/** Build a minimal valid DocumentRecord */
function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = new Date().toISOString();
  return {
    documentId: overrides.documentId ?? 'doc-1',
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: 'file.pdf',
    s3Key: 'docs/file.pdf',
    contentType: 'application/pdf',
    processingStatus: 'completed' as any,
    extractedText: 'Some extracted text content for testing purposes.',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty text for extracted content */
const extractedTextArb = fc.string({ minLength: 10, maxLength: 500 })
  .filter(s => s.trim().length > 0);

/** A completed document with extracted text */
const completedDocArb = fc.tuple(
  fc.uuid(),
  extractedTextArb
).map(([id, text]) => makeDocument({
  documentId: id,
  processingStatus: 'completed' as any,
  extractedText: text
}));

/** A document that should be excluded: either not completed or missing extractedText */
const excludedDocArb = fc.tuple(
  fc.uuid(),
  fc.oneof(
    // Not completed status
    fc.constant('pending' as any),
    fc.constant('failed' as any),
    fc.constant('processing' as any)
  )
).map(([id, status]) => makeDocument({
  documentId: id,
  processingStatus: status,
  extractedText: 'Some text'
}));

/** A document with no extractedText (should also be excluded) */
const noTextDocArb = fc.uuid().map(id => makeDocument({
  documentId: id,
  processingStatus: 'completed' as any,
  extractedText: undefined
}));

/** A document with empty/whitespace extractedText (should also be excluded) */
const emptyTextDocArb = fc.tuple(
  fc.uuid(),
  fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('\n\t')
  )
).map(([id, text]) => makeDocument({
  documentId: id,
  processingStatus: 'completed' as any,
  extractedText: text
}));

// ─── Service Instance ────────────────────────────────────────────────────────

let service: TokenAwareSummarizationService;

beforeEach(() => {
  service = new TokenAwareSummarizationService();
  mockChunkingService(service);
});

// ─── Property 18: Document Exclusion Notification ────────────────────────────

describe('Feature: token-aware-summarization, Property 18: Document Exclusion Notification', () => {
  /**
   * **Validates: Requirements 7.5**
   *
   * When given a mix of completed (with text) and non-completed documents,
   * processedDocumentCount should be less than documentCount.
   */
  it('should report processedDocumentCount < documentCount when some documents are excluded', () => {
    const arb = fc.tuple(
      fc.array(completedDocArb, { minLength: 1, maxLength: 5 }),
      fc.array(excludedDocArb, { minLength: 1, maxLength: 5 })
    );

    return fc.assert(
      fc.asyncProperty(arb, async ([completed, excluded]) => {
        const allDocs = [...completed, ...excluded];
        const result = await service.generateSummary(allDocs, 'cust-1', 'tenant-1');

        expect(result.documentCount).toBe(allDocs.length);
        expect(result.processedDocumentCount).toBeLessThan(result.documentCount);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * Documents without extractedText should be excluded from processing,
   * resulting in processedDocumentCount < documentCount.
   */
  it('should exclude documents without extractedText from processing', () => {
    const arb = fc.tuple(
      fc.array(completedDocArb, { minLength: 1, maxLength: 5 }),
      fc.array(noTextDocArb, { minLength: 1, maxLength: 5 })
    );

    return fc.assert(
      fc.asyncProperty(arb, async ([completed, noText]) => {
        const allDocs = [...completed, ...noText];
        const result = await service.generateSummary(allDocs, 'cust-1', 'tenant-1');

        expect(result.documentCount).toBe(allDocs.length);
        expect(result.processedDocumentCount).toBeLessThan(result.documentCount);
        expect(result.processedDocumentCount).toBe(completed.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * Documents with empty or whitespace-only extractedText should be excluded.
   */
  it('should exclude documents with empty or whitespace-only extractedText', () => {
    const arb = fc.tuple(
      fc.array(completedDocArb, { minLength: 1, maxLength: 5 }),
      fc.array(emptyTextDocArb, { minLength: 1, maxLength: 5 })
    );

    return fc.assert(
      fc.asyncProperty(arb, async ([completed, emptyText]) => {
        const allDocs = [...completed, ...emptyText];
        const result = await service.generateSummary(allDocs, 'cust-1', 'tenant-1');

        expect(result.documentCount).toBe(allDocs.length);
        expect(result.processedDocumentCount).toBeLessThan(result.documentCount);
        expect(result.processedDocumentCount).toBe(completed.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * processedDocumentCount should always be <= documentCount for any input.
   */
  it('should always have processedDocumentCount <= documentCount', () => {
    const mixedDocsArb = fc.array(
      fc.oneof(completedDocArb, excludedDocArb, noTextDocArb, emptyTextDocArb),
      { minLength: 1, maxLength: 10 }
    );

    return fc.assert(
      fc.asyncProperty(mixedDocsArb, async (docs) => {
        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        expect(result.documentCount).toBe(docs.length);
        expect(result.processedDocumentCount).toBeLessThanOrEqual(result.documentCount);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * When all documents are completed with valid text,
   * processedDocumentCount should equal documentCount.
   */
  it('should process all documents when all are completed with valid text', () => {
    const allValidArb = fc.array(completedDocArb, { minLength: 1, maxLength: 10 });

    return fc.assert(
      fc.asyncProperty(allValidArb, async (docs) => {
        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        expect(result.documentCount).toBe(docs.length);
        expect(result.processedDocumentCount).toBe(docs.length);
      }),
      { numRuns: 100 }
    );
  });
});

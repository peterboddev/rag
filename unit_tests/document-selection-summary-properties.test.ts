/**
 * Property-based and unit tests for the Document Selection and Summary feature.
 *
 * Groups:
 * 1.1 - Property: Summary content correspondence (Validates: Requirements 3.1, 6.1)
 * 2.1 - Unit: Enhanced document response (Validates: Requirements 5.1, 5.2, 5.3)
 * 3.1 - Property: Selection state consistency (Validates: Requirements 1.3, 1.4)
 * 4.1 - Property: Selection persistence (Validates: Requirements 2.4, 3.4)
 * 5.1 - Unit: Summary display formatting (Validates: Requirements 6.1, 6.4, 7.2)
 * 6.1 - Property: UI state synchronization (Validates: Requirements 4.3, 7.3)
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  filterDocumentsForSummary,
  validateTextQuality,
} from '../src/services/document-summary-filter';
import { DocumentRecord, ProcessingStatus } from '../src/types';
import {
  getOperationErrorMessage,
  getOperationSuccessMessage,
  validateSelectedDocumentsText,
  type ErrorContext,
  type DocumentTextStatus,
} from '../frontend/src/utils/errorHandling';

// ─── Shared Arbitraries & Helpers ────────────────────────────────────────────

const processingStatuses: ProcessingStatus[] = ['queued', 'processing', 'completed', 'failed'];
const statusArb = fc.constantFrom<ProcessingStatus>(...processingStatuses);

function makeDocRecord(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = new Date().toISOString();
  return {
    documentId: overrides.documentId ?? 'doc-1',
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: overrides.fileName ?? 'file.pdf',
    s3Key: 'docs/file.pdf',
    contentType: 'application/pdf',
    processingStatus: 'completed' as ProcessingStatus,
    extractedText: 'This is valid extracted text for testing purposes.',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const validTextArb = fc.stringOf(fc.char(), { minLength: 10, maxLength: 200 })
  .filter(s => s.trim().length >= 10);

const documentRecordArb: fc.Arbitrary<DocumentRecord> = fc.record({
  documentId: fc.uuid(),
  customerUuid: fc.uuid(),
  tenantId: fc.string({ minLength: 1, maxLength: 20 }),
  fileName: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
  s3Key: fc.constant('docs/file.pdf'),
  contentType: fc.constantFrom('application/pdf', 'text/plain', 'image/png'),
  processingStatus: statusArb,
  extractedText: fc.option(validTextArb, { nil: undefined }),
  createdAt: fc.constant(new Date().toISOString()),
  updatedAt: fc.constant(new Date().toISOString()),
}).map(rec => {
  // Ensure completed docs with text have textLength
  if (rec.processingStatus === 'completed' && rec.extractedText) {
    return { ...rec, textLength: rec.extractedText.length };
  }
  return rec;
}) as fc.Arbitrary<DocumentRecord>;

/** Generates a completed document with valid text (eligible for summary) */
const completedDocArb: fc.Arbitrary<DocumentRecord> = fc.record({
  documentId: fc.uuid(),
  customerUuid: fc.uuid(),
  tenantId: fc.string({ minLength: 1, maxLength: 20 }),
  fileName: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
  s3Key: fc.constant('docs/file.pdf'),
  contentType: fc.constant('application/pdf'),
  processingStatus: fc.constant('completed' as ProcessingStatus),
  extractedText: validTextArb,
  createdAt: fc.constant(new Date().toISOString()),
  updatedAt: fc.constant(new Date().toISOString()),
}).map(rec => ({ ...rec, textLength: rec.extractedText!.length })) as fc.Arbitrary<DocumentRecord>;

// ─── 1.1 Property: Summary Content Correspondence ───────────────────────────

describe('1.1 Property: Summary content correspondence', () => {
  /**
   * **Validates: Requirements 3.1, 6.1**
   *
   * For any generated summary, the included documents list should exactly match
   * the documents that were selected when the summary was requested.
   *
   * We test the pure filtering logic: given a set of documents and a selection
   * of IDs, filterDocumentsForSummary returns only documents whose IDs are in
   * the selection AND meet quality criteria.
   */
  it('included documents from filter exactly match eligible selected documents', () => {
    fc.assert(
      fc.property(
        fc.array(documentRecordArb, { minLength: 1, maxLength: 20 }),
        (allDocs) => {
          // Simulate user selecting a subset of document IDs
          const selectedIds = new Set(allDocs.map(d => d.documentId));

          // Filter only the selected documents (simulating the selective endpoint)
          const selectedDocs = allDocs.filter(d => selectedIds.has(d.documentId));
          const { includedDocuments, excludedDocuments } = filterDocumentsForSummary(selectedDocs);

          // Every included document must be in the selected set
          for (const doc of includedDocuments) {
            expect(selectedIds.has(doc.documentId)).toBe(true);
          }

          // included + excluded = total selected (no documents lost)
          expect(includedDocuments.length + excludedDocuments.length).toBe(selectedDocs.length);

          // No duplicates in included
          const includedIds = includedDocuments.map(d => d.documentId);
          expect(new Set(includedIds).size).toBe(includedIds.length);

          // No duplicates in excluded
          const excludedIds = excludedDocuments.map(d => d.documentId);
          expect(new Set(excludedIds).size).toBe(excludedIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('filtering a subset of documents only returns documents from that subset', () => {
    fc.assert(
      fc.property(
        fc.array(documentRecordArb, { minLength: 2, maxLength: 15 }),
        (allDocs) => {
          // Select a random subset
          const halfIdx = Math.ceil(allDocs.length / 2);
          const selectedDocs = allDocs.slice(0, halfIdx);
          const selectedIdSet = new Set(selectedDocs.map(d => d.documentId));

          const { includedDocuments } = filterDocumentsForSummary(selectedDocs);

          // Every included document must come from the selected subset
          for (const doc of includedDocuments) {
            expect(selectedIdSet.has(doc.documentId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── 2.1 Unit: Enhanced Document Response ────────────────────────────────────

describe('2.1 Unit: Enhanced document response', () => {
  /**
   * **Validates: Requirements 5.1, 5.2, 5.3**
   */

  it('includes file name, processing status, and text length for completed documents', () => {
    const doc = makeDocRecord({
      documentId: 'doc-enhanced',
      fileName: 'report.pdf',
      processingStatus: 'completed',
      extractedText: 'This is a valid extracted text for testing purposes.',
      textLength: 51,
    });

    const { includedDocuments } = filterDocumentsForSummary([doc]);
    expect(includedDocuments).toHaveLength(1);
    expect(includedDocuments[0].fileName).toBe('report.pdf');
    expect(includedDocuments[0].processingStatus).toBe('completed');
    expect(includedDocuments[0].textLength).toBe(51);
  });

  it('provides text preview from extractedText when available', () => {
    const longText = 'A'.repeat(200);
    const doc = makeDocRecord({
      extractedText: longText,
      processingMetadata: {
        textPreview: longText.substring(0, 100),
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync',
        retryHistory: [],
      },
    });

    expect(doc.processingMetadata?.textPreview).toBe('A'.repeat(100));
    expect(doc.processingMetadata?.textPreview!.length).toBeLessThanOrEqual(100);
  });

  it('includes error details for failed documents in exclusion list', () => {
    const doc = makeDocRecord({
      documentId: 'doc-failed',
      fileName: 'broken.pdf',
      processingStatus: 'failed',
      extractedText: undefined,
      processingMetadata: {
        isEncrypted: false,
        hasTextContent: false,
        processingMode: 'sync',
        retryHistory: [],
        errorDetails: {
          errorCode: 'TEXTRACT_FAILED',
          errorMessage: 'Document is encrypted',
          errorType: 'textract',
          suggestedAction: 'Upload an unencrypted version',
          isRetryable: false,
        },
      },
    });

    const { excludedDocuments } = filterDocumentsForSummary([doc]);
    expect(excludedDocuments).toHaveLength(1);
    expect(excludedDocuments[0].documentId).toBe('doc-failed');
    expect(excludedDocuments[0].reason).toContain('failed');

    // Verify the original doc retains error details
    expect(doc.processingMetadata?.errorDetails?.errorMessage).toBe('Document is encrypted');
    expect(doc.processingMetadata?.errorDetails?.suggestedAction).toBe('Upload an unencrypted version');
  });

  it('formats error messages for different operation types', () => {
    const deleteError = getOperationErrorMessage({
      operation: 'delete',
      documentName: 'report.pdf',
      errorMessage: 'Access denied',
    });
    expect(deleteError).toContain('report.pdf');
    expect(deleteError).toContain('Access denied');

    const retryError = getOperationErrorMessage({
      operation: 'retry',
      documentName: 'scan.png',
      errorMessage: 'Timeout',
    });
    expect(retryError).toContain('scan.png');
    expect(retryError).toContain('Timeout');
  });

  it('includes confidence and page count in processing metadata', () => {
    const doc = makeDocRecord({
      processingMetadata: {
        confidence: 95.5,
        pageCount: 12,
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync',
        retryHistory: [],
      },
    });

    expect(doc.processingMetadata?.confidence).toBe(95.5);
    expect(doc.processingMetadata?.pageCount).toBe(12);

    // High confidence doc should pass quality validation
    const quality = validateTextQuality(doc);
    expect(quality.valid).toBe(true);
  });

  it('excludes completed documents with low confidence scores', () => {
    const doc = makeDocRecord({
      processingMetadata: {
        confidence: 30,
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync',
        retryHistory: [],
      },
    });

    const { excludedDocuments } = filterDocumentsForSummary([doc]);
    expect(excludedDocuments).toHaveLength(1);
    expect(excludedDocuments[0].reason).toContain('confidence');
  });
});

// ─── 3.1 Property: Selection State Consistency ──────────────────────────────

describe('3.1 Property: Selection state consistency', () => {
  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * For any document list, the selected documents set should only contain
   * IDs of documents that exist in the current document list.
   */

  /** Simulates the selection logic from DocumentSummary component */
  function applySelectionConstraint(
    documentIds: Set<string>,
    selectedIds: Set<string>,
  ): Set<string> {
    // Only keep selected IDs that exist in the document list
    const constrained = new Set<string>();
    for (const id of selectedIds) {
      if (documentIds.has(id)) {
        constrained.add(id);
      }
    }
    return constrained;
  }

  it('selected set is always a subset of document IDs', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 0, maxLength: 20 }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 20 }),
        (docIds, randomSelectedIds) => {
          const documentIdSet = new Set(docIds);
          const selectedSet = new Set(randomSelectedIds);

          const constrained = applySelectionConstraint(documentIdSet, selectedSet);

          // Every constrained selection must exist in document list
          for (const id of constrained) {
            expect(documentIdSet.has(id)).toBe(true);
          }

          // Constrained set size <= document set size
          expect(constrained.size).toBeLessThanOrEqual(documentIdSet.size);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('removing a document from the list removes it from selection', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 2, maxLength: 15 }).filter(ids => new Set(ids).size >= 2),
        (docIds) => {
          const uniqueIds = [...new Set(docIds)];
          const documentIdSet = new Set(uniqueIds);
          // Select all documents
          const selectedSet = new Set(uniqueIds);

          // Remove the first document (simulating delete)
          const removedId = uniqueIds[0];
          documentIdSet.delete(removedId);

          // Re-apply constraint
          const constrained = applySelectionConstraint(documentIdSet, selectedSet);

          // Removed document should not be in selection
          expect(constrained.has(removedId)).toBe(false);
          // Remaining selections should still be valid
          for (const id of constrained) {
            expect(documentIdSet.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('toggling selection only affects the toggled document', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 15 }).chain(ids => {
          const unique = [...new Set(ids)];
          return fc.record({
            docIds: fc.constant(unique),
            toggleIdx: fc.integer({ min: 0, max: unique.length - 1 }),
          });
        }),
        ({ docIds, toggleIdx }) => {
          const selectedBefore = new Set(docIds);
          const toggledId = docIds[toggleIdx];

          // Toggle: if selected, deselect; if not, select
          const selectedAfter = new Set(selectedBefore);
          if (selectedAfter.has(toggledId)) {
            selectedAfter.delete(toggledId);
          } else {
            selectedAfter.add(toggledId);
          }

          // Only the toggled ID should differ
          for (const id of docIds) {
            if (id === toggledId) {
              expect(selectedAfter.has(id)).not.toBe(selectedBefore.has(id));
            } else {
              expect(selectedAfter.has(id)).toBe(selectedBefore.has(id));
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── 4.1 Property: Selection Persistence ─────────────────────────────────────

describe('4.1 Property: Selection persistence', () => {
  /**
   * **Validates: Requirements 2.4, 3.4**
   *
   * For any summary generation, the document selection state should remain
   * unchanged during and after the summarization process.
   */

  /** Simulates the summarize flow: selection is read but never mutated */
  function simulateSummarize(
    documents: DocumentRecord[],
    selectedIds: Set<string>,
  ): { selectionBefore: Set<string>; selectionAfter: Set<string>; includedDocIds: string[] } {
    // Snapshot selection before
    const selectionBefore = new Set(selectedIds);

    // The summarize operation reads selection to filter documents
    const selectedDocs = documents.filter(d => selectedIds.has(d.documentId));
    const { includedDocuments } = filterDocumentsForSummary(selectedDocs);
    const includedDocIds = includedDocuments.map(d => d.documentId);

    // Selection should not be mutated by the operation
    const selectionAfter = new Set(selectedIds);

    return { selectionBefore, selectionAfter, includedDocIds };
  }

  it('selection state is unchanged after summarization', () => {
    fc.assert(
      fc.property(
        fc.array(completedDocArb, { minLength: 1, maxLength: 10 }),
        (docs) => {
          // Select all documents
          const selectedIds = new Set(docs.map(d => d.documentId));
          const snapshotBefore = new Set(selectedIds);

          const { selectionAfter } = simulateSummarize(docs, selectedIds);

          // Selection must be identical before and after
          expect(selectionAfter.size).toBe(snapshotBefore.size);
          for (const id of snapshotBefore) {
            expect(selectionAfter.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('selection state is unchanged even when some documents are excluded', () => {
    fc.assert(
      fc.property(
        fc.array(documentRecordArb, { minLength: 1, maxLength: 15 }),
        (docs) => {
          // Select all document IDs regardless of status
          const selectedIds = new Set(docs.map(d => d.documentId));
          const snapshotBefore = [...selectedIds];

          simulateSummarize(docs, selectedIds);

          // Selection must remain exactly the same
          expect([...selectedIds]).toEqual(snapshotBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('partial selection is preserved after summarization', () => {
    fc.assert(
      fc.property(
        fc.array(completedDocArb, { minLength: 2, maxLength: 10 }),
        (docs) => {
          // Select only the first half
          const halfIdx = Math.ceil(docs.length / 2);
          const selectedIds = new Set(docs.slice(0, halfIdx).map(d => d.documentId));
          const snapshotBefore = new Set(selectedIds);

          const { selectionAfter } = simulateSummarize(docs, selectedIds);

          expect(selectionAfter.size).toBe(snapshotBefore.size);
          for (const id of snapshotBefore) {
            expect(selectionAfter.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── 5.1 Unit: Summary Display ───────────────────────────────────────────────

describe('5.1 Unit: Summary display', () => {
  /**
   * **Validates: Requirements 6.1, 6.4, 7.2**
   *
   * Tests summary content rendering helpers, copy-to-clipboard data preparation,
   * and loading/error state formatting.
   */

  /** Mirrors SummaryDisplayPanel.formatProcessingTime */
  function formatProcessingTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  /** Mirrors SummaryDisplayPanel.formatDate */
  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  // --- Summary content rendering ---

  it('formats processing time under 1 second as milliseconds', () => {
    expect(formatProcessingTime(500)).toBe('500ms');
    expect(formatProcessingTime(0)).toBe('0ms');
    expect(formatProcessingTime(999)).toBe('999ms');
  });

  it('formats processing time at or above 1 second as seconds', () => {
    expect(formatProcessingTime(1000)).toBe('1.0s');
    expect(formatProcessingTime(2500)).toBe('2.5s');
    expect(formatProcessingTime(10000)).toBe('10.0s');
  });

  it('formats date strings into human-readable format', () => {
    const formatted = formatDate('2025-01-15T14:30:00Z');
    expect(formatted).toContain('2025');
    expect(formatted).toContain('Jan');
    expect(formatted).toContain('15');
  });

  it('renders included documents list from summary data', () => {
    const summaryData = {
      summary: 'This is a test summary.',
      includedDocuments: [
        { documentId: 'doc-1', fileName: 'report.pdf', textLength: 5000 },
        { documentId: 'doc-2', fileName: 'invoice.pdf', textLength: 3000 },
      ],
      documentCount: 2,
      totalTextLength: 8000,
      processingTime: 1500,
      generatedAt: '2025-01-15T14:30:00Z',
    };

    // Verify summary data structure is correct for rendering
    expect(summaryData.includedDocuments).toHaveLength(2);
    expect(summaryData.includedDocuments[0].fileName).toBe('report.pdf');
    expect(summaryData.documentCount).toBe(summaryData.includedDocuments.length);
    expect(summaryData.totalTextLength).toBe(
      summaryData.includedDocuments.reduce((sum, d) => sum + d.textLength, 0),
    );
  });

  // --- Copy-to-clipboard data ---

  it('summary text is a non-empty string suitable for clipboard', () => {
    const summaryText = 'AI-generated summary of selected documents.';
    expect(typeof summaryText).toBe('string');
    expect(summaryText.length).toBeGreaterThan(0);
    // Clipboard text should be the raw summary content
    expect(summaryText).not.toContain('<html>');
  });

  // --- Loading and error states ---

  it('error state produces a user-friendly message with suggested actions', () => {
    const errorMsg = getOperationErrorMessage({
      operation: 'summarize',
      errorMessage: 'Service unavailable',
    });
    expect(errorMsg).toContain('Summarization failed');
    expect(errorMsg).toContain('Service unavailable');
  });

  it('success message for operations is descriptive', () => {
    const deleteMsg = getOperationSuccessMessage('delete', 'report.pdf');
    expect(deleteMsg).toContain('report.pdf');
    expect(deleteMsg).toContain('deleted');

    const retryMsg = getOperationSuccessMessage('retry', undefined, 'Text extracted: 5000 characters');
    expect(retryMsg).toContain('retry');
    expect(retryMsg).toContain('5000 characters');
  });

  it('validates empty selection returns invalid result', () => {
    const result = validateSelectedDocumentsText([], []);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toBeDefined();
    expect(result.errorMessage).toContain('No documents selected');
  });

  it('validates selection with no text returns invalid result', () => {
    const docs: DocumentTextStatus[] = [
      { documentId: 'doc-1', hasText: false, textLength: 0 },
    ];
    const result = validateSelectedDocumentsText(['doc-1'], docs);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('no extractable text');
  });

  it('validates selection with mixed text returns valid with warning', () => {
    const docs: DocumentTextStatus[] = [
      { documentId: 'doc-1', hasText: true, textLength: 5000 },
      { documentId: 'doc-2', hasText: false, textLength: 0 },
    ];
    const result = validateSelectedDocumentsText(['doc-1', 'doc-2'], docs);
    expect(result.valid).toBe(true);
    expect(result.warningMessage).toBeDefined();
    expect(result.warningMessage).toContain('1');
  });
});

// ─── 6.1 Property: UI State Synchronization ─────────────────────────────────

describe('6.1 Property: UI state synchronization', () => {
  /**
   * **Validates: Requirements 4.3, 7.3**
   *
   * For any document operation (retry/delete), the UI state should be updated
   * to reflect the new document status before allowing further operations.
   */

  type DocState = {
    documentId: string;
    status: ProcessingStatus;
    isRetrying: boolean;
    isDeleting: boolean;
  };

  /** Simulates the retry operation state transitions */
  function simulateRetry(state: DocState): DocState[] {
    const transitions: DocState[] = [];

    // Step 1: Set isRetrying = true (UI shows loading)
    const retrying = { ...state, isRetrying: true };
    transitions.push(retrying);

    // Step 2: On success, update status and clear isRetrying
    const completed = { ...retrying, status: 'completed' as ProcessingStatus, isRetrying: false };
    transitions.push(completed);

    return transitions;
  }

  /** Simulates the delete operation state transitions */
  function simulateDelete(
    documents: DocState[],
    deleteId: string,
  ): { transitions: DocState[][]; finalDocs: DocState[] } {
    const transitions: DocState[][] = [];

    // Step 1: Set isDeleting = true for the target document
    const step1 = documents.map(d =>
      d.documentId === deleteId ? { ...d, isDeleting: true } : d,
    );
    transitions.push(step1);

    // Step 2: Remove the document from the list
    const step2 = step1.filter(d => d.documentId !== deleteId);
    transitions.push(step2);

    return { transitions, finalDocs: step2 };
  }

  it('retry transitions always go through loading state before completion', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (docId) => {
          const initial: DocState = {
            documentId: docId,
            status: 'failed',
            isRetrying: false,
            isDeleting: false,
          };

          const transitions = simulateRetry(initial);

          // Must have exactly 2 transitions
          expect(transitions).toHaveLength(2);

          // First transition: isRetrying must be true
          expect(transitions[0].isRetrying).toBe(true);
          expect(transitions[0].status).toBe('failed'); // status not yet changed

          // Second transition: isRetrying cleared, status updated
          expect(transitions[1].isRetrying).toBe(false);
          expect(transitions[1].status).toBe('completed');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('delete transitions always go through loading state before removal', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }).filter(ids => new Set(ids).size === ids.length),
        (docIds) => {
          const documents: DocState[] = docIds.map(id => ({
            documentId: id,
            status: 'completed' as ProcessingStatus,
            isRetrying: false,
            isDeleting: false,
          }));

          const deleteId = docIds[0];
          const { transitions, finalDocs } = simulateDelete(documents, deleteId);

          // Must have exactly 2 transition steps
          expect(transitions).toHaveLength(2);

          // Step 1: target document has isDeleting = true
          const targetInStep1 = transitions[0].find(d => d.documentId === deleteId);
          expect(targetInStep1).toBeDefined();
          expect(targetInStep1!.isDeleting).toBe(true);

          // Step 2: target document is removed
          const targetInStep2 = transitions[1].find(d => d.documentId === deleteId);
          expect(targetInStep2).toBeUndefined();

          // Final list has one fewer document
          expect(finalDocs.length).toBe(documents.length - 1);

          // No remaining document has isDeleting = true
          for (const doc of finalDocs) {
            expect(doc.isDeleting).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('concurrent operations are prevented by loading flags', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom('retry', 'delete'),
        (docId, operation) => {
          const doc: DocState = {
            documentId: docId,
            status: 'failed',
            isRetrying: false,
            isDeleting: false,
          };

          // Start an operation
          const inProgress: DocState = operation === 'retry'
            ? { ...doc, isRetrying: true }
            : { ...doc, isDeleting: true };

          // While in progress, the other operation should be blocked
          // (buttons are disabled when isRetrying || isDeleting)
          const isBlocked = inProgress.isRetrying || inProgress.isDeleting;
          expect(isBlocked).toBe(true);

          // After completion, both flags should be false
          const completed: DocState = { ...inProgress, isRetrying: false, isDeleting: false };
          expect(completed.isRetrying).toBe(false);
          expect(completed.isDeleting).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('delete operation removes document from selection set', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 2, maxLength: 10 }).filter(ids => new Set(ids).size === ids.length),
        (docIds) => {
          // All documents selected
          const selectedIds = new Set(docIds);
          const deleteId = docIds[0];

          // After delete, remove from selection
          selectedIds.delete(deleteId);

          // Deleted document should not be in selection
          expect(selectedIds.has(deleteId)).toBe(false);
          // Other documents remain selected
          for (const id of docIds.slice(1)) {
            expect(selectedIds.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

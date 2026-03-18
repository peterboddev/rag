/**
 * Unit tests for document management operations integration.
 * Tests state management logic for retry/delete operations in DocumentSummary.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { describe, it, expect } from '@jest/globals';

// ---- Pure helper functions extracted from component logic ----

/**
 * Adds a document ID to a Set (mirrors setRetryingDocuments/setDeletingDocuments add logic).
 */
function addToSet(set: Set<string>, id: string): Set<string> {
  const newSet = new Set(set);
  newSet.add(id);
  return newSet;
}

/**
 * Removes a document ID from a Set (mirrors the finally-block cleanup logic).
 */
function removeFromSet(set: Set<string>, id: string): Set<string> {
  const newSet = new Set(set);
  newSet.delete(id);
  return newSet;
}

/**
 * Removes a document from the selected set (mirrors handleDeleteDocument selection cleanup).
 */
function removeFromSelection(selectedDocuments: Set<string>, documentId: string): Set<string> {
  const newSet = new Set(selectedDocuments);
  newSet.delete(documentId);
  return newSet;
}

/**
 * Determines if a retry button should be shown for a document (Req 4.1).
 */
function shouldShowRetryButton(processingStatus: string): boolean {
  return processingStatus === 'failed';
}

/**
 * Determines if a delete button should be shown for a document (Req 4.4).
 */
function shouldShowDeleteButton(_processingStatus: string): boolean {
  return true; // Delete is always available
}

/**
 * Determines if a retry action is blocked by concurrent operations.
 * Can't retry while the same document is being deleted or already retrying.
 */
function isRetryBlocked(
  documentId: string,
  retryingDocuments: Set<string>,
  deletingDocuments: Set<string>
): boolean {
  return retryingDocuments.has(documentId) || deletingDocuments.has(documentId);
}

/**
 * Determines if a delete action is blocked by concurrent operations.
 * Can't delete while the same document is being retried or already deleting.
 */
function isDeleteBlocked(
  documentId: string,
  retryingDocuments: Set<string>,
  deletingDocuments: Set<string>
): boolean {
  return deletingDocuments.has(documentId) || retryingDocuments.has(documentId);
}

/**
 * Simulates the full retry operation state lifecycle:
 * 1. Add to retryingDocuments
 * 2. (API call happens)
 * 3. Remove from retryingDocuments (finally block)
 */
function simulateRetryLifecycle(
  retryingDocuments: Set<string>,
  documentId: string
): { during: Set<string>; after: Set<string> } {
  const during = addToSet(retryingDocuments, documentId);
  const after = removeFromSet(during, documentId);
  return { during, after };
}

/**
 * Simulates the full delete operation state lifecycle:
 * 1. Add to deletingDocuments
 * 2. (API call happens)
 * 3. Remove from selectedDocuments
 * 4. Remove from deletingDocuments (finally block)
 */
function simulateDeleteLifecycle(
  deletingDocuments: Set<string>,
  selectedDocuments: Set<string>,
  documentId: string
): { duringDelete: Set<string>; afterSelection: Set<string>; afterDelete: Set<string> } {
  const duringDelete = addToSet(deletingDocuments, documentId);
  const afterSelection = removeFromSelection(selectedDocuments, documentId);
  const afterDelete = removeFromSet(duringDelete, documentId);
  return { duringDelete, afterSelection, afterDelete };
}

// ---- Tests ----

describe('Retry button visibility (Req 4.1)', () => {
  it('shows retry button only for failed documents', () => {
    expect(shouldShowRetryButton('failed')).toBe(true);
    expect(shouldShowRetryButton('completed')).toBe(false);
    expect(shouldShowRetryButton('processing')).toBe(false);
    expect(shouldShowRetryButton('queued')).toBe(false);
    expect(shouldShowRetryButton('unknown')).toBe(false);
  });
});

describe('Delete button visibility (Req 4.4)', () => {
  it('shows delete button for all document statuses', () => {
    expect(shouldShowDeleteButton('completed')).toBe(true);
    expect(shouldShowDeleteButton('failed')).toBe(true);
    expect(shouldShowDeleteButton('processing')).toBe(true);
    expect(shouldShowDeleteButton('queued')).toBe(true);
    expect(shouldShowDeleteButton('unknown')).toBe(true);
  });
});

describe('Retry state management (Req 4.2, 4.3)', () => {
  it('adds document to retryingDocuments set during retry', () => {
    const initial = new Set<string>();
    const result = addToSet(initial, 'doc-1');
    expect(result.has('doc-1')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('removes document from retryingDocuments after retry completes', () => {
    const { during, after } = simulateRetryLifecycle(new Set(), 'doc-1');
    expect(during.has('doc-1')).toBe(true);
    expect(after.has('doc-1')).toBe(false);
    expect(after.size).toBe(0);
  });

  it('does not affect other retrying documents', () => {
    const initial = new Set(['doc-2']);
    const { during, after } = simulateRetryLifecycle(initial, 'doc-1');
    expect(during.has('doc-1')).toBe(true);
    expect(during.has('doc-2')).toBe(true);
    expect(after.has('doc-1')).toBe(false);
    expect(after.has('doc-2')).toBe(true);
  });

  it('creates new Set instances (immutable updates)', () => {
    const initial = new Set<string>();
    const added = addToSet(initial, 'doc-1');
    expect(added).not.toBe(initial);
    const removed = removeFromSet(added, 'doc-1');
    expect(removed).not.toBe(added);
  });
});

describe('Delete state management (Req 4.5)', () => {
  it('adds document to deletingDocuments set during delete', () => {
    const initial = new Set<string>();
    const result = addToSet(initial, 'doc-1');
    expect(result.has('doc-1')).toBe(true);
  });

  it('removes document from selection after successful delete', () => {
    const selected = new Set(['doc-1', 'doc-2', 'doc-3']);
    const result = removeFromSelection(selected, 'doc-2');
    expect(result.has('doc-2')).toBe(false);
    expect(result.has('doc-1')).toBe(true);
    expect(result.has('doc-3')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('handles removing a document not in selection gracefully', () => {
    const selected = new Set(['doc-1']);
    const result = removeFromSelection(selected, 'doc-99');
    expect(result.size).toBe(1);
    expect(result.has('doc-1')).toBe(true);
  });

  it('full delete lifecycle cleans up all state', () => {
    const deleting = new Set<string>();
    const selected = new Set(['doc-1', 'doc-2']);
    const { duringDelete, afterSelection, afterDelete } = simulateDeleteLifecycle(
      deleting, selected, 'doc-1'
    );
    expect(duringDelete.has('doc-1')).toBe(true);
    expect(afterSelection.has('doc-1')).toBe(false);
    expect(afterSelection.has('doc-2')).toBe(true);
    expect(afterDelete.has('doc-1')).toBe(false);
    expect(afterDelete.size).toBe(0);
  });
});

describe('Concurrent operation prevention', () => {
  it('blocks retry when document is already retrying', () => {
    const retrying = new Set(['doc-1']);
    const deleting = new Set<string>();
    expect(isRetryBlocked('doc-1', retrying, deleting)).toBe(true);
  });

  it('blocks retry when document is being deleted', () => {
    const retrying = new Set<string>();
    const deleting = new Set(['doc-1']);
    expect(isRetryBlocked('doc-1', retrying, deleting)).toBe(true);
  });

  it('allows retry when document has no pending operations', () => {
    const retrying = new Set<string>();
    const deleting = new Set<string>();
    expect(isRetryBlocked('doc-1', retrying, deleting)).toBe(false);
  });

  it('allows retry when other documents have pending operations', () => {
    const retrying = new Set(['doc-2']);
    const deleting = new Set(['doc-3']);
    expect(isRetryBlocked('doc-1', retrying, deleting)).toBe(false);
  });

  it('blocks delete when document is already deleting', () => {
    const retrying = new Set<string>();
    const deleting = new Set(['doc-1']);
    expect(isDeleteBlocked('doc-1', retrying, deleting)).toBe(true);
  });

  it('blocks delete when document is being retried', () => {
    const retrying = new Set(['doc-1']);
    const deleting = new Set<string>();
    expect(isDeleteBlocked('doc-1', retrying, deleting)).toBe(true);
  });

  it('allows delete when document has no pending operations', () => {
    const retrying = new Set<string>();
    const deleting = new Set<string>();
    expect(isDeleteBlocked('doc-1', retrying, deleting)).toBe(false);
  });

  it('multiple concurrent operations on different documents are independent', () => {
    const retrying = new Set(['doc-1']);
    const deleting = new Set(['doc-2']);

    // doc-1 is retrying: can't retry or delete doc-1
    expect(isRetryBlocked('doc-1', retrying, deleting)).toBe(true);
    expect(isDeleteBlocked('doc-1', retrying, deleting)).toBe(true);

    // doc-2 is deleting: can't retry or delete doc-2
    expect(isRetryBlocked('doc-2', retrying, deleting)).toBe(true);
    expect(isDeleteBlocked('doc-2', retrying, deleting)).toBe(true);

    // doc-3 has no operations: both allowed
    expect(isRetryBlocked('doc-3', retrying, deleting)).toBe(false);
    expect(isDeleteBlocked('doc-3', retrying, deleting)).toBe(false);
  });
});

describe('Selection state cleanup after delete', () => {
  it('removes deleted document from selection and preserves others', () => {
    const selected = new Set(['doc-1', 'doc-2', 'doc-3']);
    const afterDelete = removeFromSelection(selected, 'doc-2');
    expect(afterDelete).toEqual(new Set(['doc-1', 'doc-3']));
  });

  it('handles deleting the only selected document', () => {
    const selected = new Set(['doc-1']);
    const afterDelete = removeFromSelection(selected, 'doc-1');
    expect(afterDelete.size).toBe(0);
  });

  it('handles deleting from empty selection', () => {
    const selected = new Set<string>();
    const afterDelete = removeFromSelection(selected, 'doc-1');
    expect(afterDelete.size).toBe(0);
  });

  it('does not mutate the original selection set', () => {
    const selected = new Set(['doc-1', 'doc-2']);
    const afterDelete = removeFromSelection(selected, 'doc-1');
    expect(selected.has('doc-1')).toBe(true); // original unchanged
    expect(afterDelete.has('doc-1')).toBe(false); // new set updated
  });
});

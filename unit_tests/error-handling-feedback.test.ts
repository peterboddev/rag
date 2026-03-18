/**
 * Unit tests for enhanced error handling and user feedback.
 * Tests pure functions from errorHandling utilities and validates
 * notification/error message generation for all failure scenarios.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { describe, it, expect } from '@jest/globals';
import {
  getOperationErrorMessage,
  getSummarizationErrorActions,
  getNotificationType,
  validateSelectedDocumentsText,
  getEmptyDocumentsMessage,
  getOperationSuccessMessage,
  ErrorContext,
  DocumentTextStatus,
} from '../frontend/src/utils/errorHandling';

describe('getOperationErrorMessage', () => {
  it('generates delete error with document name', () => {
    const ctx: ErrorContext = { operation: 'delete', documentName: 'report.pdf', errorMessage: 'Not found' };
    const msg = getOperationErrorMessage(ctx);
    expect(msg).toContain('report.pdf');
    expect(msg).toContain('Not found');
    expect(msg).toContain('delete');
  });

  it('generates delete error without document name', () => {
    const ctx: ErrorContext = { operation: 'delete', errorMessage: 'Server error' };
    const msg = getOperationErrorMessage(ctx);
    expect(msg).toContain('Delete operation failed');
    expect(msg).toContain('Server error');
  });

  it('generates retry error with document name', () => {
    const ctx: ErrorContext = { operation: 'retry', documentName: 'scan.pdf', errorMessage: 'Timeout' };
    const msg = getOperationErrorMessage(ctx);
    expect(msg).toContain('scan.pdf');
    expect(msg).toContain('Timeout');
  });

  it('generates retry error without document name', () => {
    const ctx: ErrorContext = { operation: 'retry', errorMessage: 'Service unavailable' };
    const msg = getOperationErrorMessage(ctx);
    expect(msg).toContain('Retry operation failed');
  });

  it('generates summarize error message', () => {
    const ctx: ErrorContext = { operation: 'summarize', errorMessage: 'Model timeout' };
    const msg = getOperationErrorMessage(ctx);
    expect(msg).toContain('Summarization failed');
    expect(msg).toContain('Model timeout');
  });

  it('generates load error message', () => {
    const ctx: ErrorContext = { operation: 'load', errorMessage: 'Network error' };
    const msg = getOperationErrorMessage(ctx);
    expect(msg).toContain('Failed to load documents');
  });

  it('generates refresh error message', () => {
    const ctx: ErrorContext = { operation: 'refresh', errorMessage: 'Connection lost' };
    const msg = getOperationErrorMessage(ctx);
    expect(msg).toContain('Failed to refresh');
  });
});

describe('getSummarizationErrorActions (Req 7.2)', () => {
  it('returns suggested actions for summarization failure', () => {
    const actions = getSummarizationErrorActions();
    expect(actions.length).toBeGreaterThanOrEqual(3);
    expect(actions.every(a => a.label.length > 0 && a.description.length > 0)).toBe(true);
  });

  it('includes action to check documents', () => {
    const actions = getSummarizationErrorActions();
    expect(actions.some(a => a.description.toLowerCase().includes('extractable text'))).toBe(true);
  });

  it('includes action to retry failed documents', () => {
    const actions = getSummarizationErrorActions();
    expect(actions.some(a => a.description.toLowerCase().includes('retry'))).toBe(true);
  });

  it('includes action to reduce selection', () => {
    const actions = getSummarizationErrorActions();
    expect(actions.some(a => a.description.toLowerCase().includes('fewer'))).toBe(true);
  });
});

describe('getNotificationType (Req 7.3)', () => {
  it('returns success for successful operations', () => {
    expect(getNotificationType('delete', true)).toBe('success');
    expect(getNotificationType('retry', true)).toBe('success');
    expect(getNotificationType('summarize', true)).toBe('success');
  });

  it('returns error for failed operations', () => {
    expect(getNotificationType('delete', false)).toBe('error');
    expect(getNotificationType('retry', false)).toBe('error');
    expect(getNotificationType('summarize', false)).toBe('error');
  });
});

describe('validateSelectedDocumentsText (Req 7.4)', () => {
  const makeDocs = (specs: Array<{ id: string; hasText: boolean; textLength: number }>): DocumentTextStatus[] =>
    specs.map(s => ({ documentId: s.id, hasText: s.hasText, textLength: s.textLength }));

  it('returns error when no documents are selected', () => {
    const result = validateSelectedDocumentsText([], []);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('No documents selected');
  });

  it('returns error when all selected documents have no text', () => {
    const docs = makeDocs([
      { id: 'a', hasText: false, textLength: 0 },
      { id: 'b', hasText: false, textLength: 0 },
    ]);
    const result = validateSelectedDocumentsText(['a', 'b'], docs);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('no extractable text');
    expect(result.warningMessage).toBeDefined();
  });

  it('returns valid with warning when some documents have no text', () => {
    const docs = makeDocs([
      { id: 'a', hasText: true, textLength: 500 },
      { id: 'b', hasText: false, textLength: 0 },
    ]);
    const result = validateSelectedDocumentsText(['a', 'b'], docs);
    expect(result.valid).toBe(true);
    expect(result.warningMessage).toContain('1 of 2');
    expect(result.warningMessage).toContain('skipped');
  });

  it('returns valid with no warning when all selected documents have text', () => {
    const docs = makeDocs([
      { id: 'a', hasText: true, textLength: 500 },
      { id: 'b', hasText: true, textLength: 300 },
    ]);
    const result = validateSelectedDocumentsText(['a', 'b'], docs);
    expect(result.valid).toBe(true);
    expect(result.warningMessage).toBeUndefined();
  });

  it('only considers selected documents, not all documents', () => {
    const docs = makeDocs([
      { id: 'a', hasText: true, textLength: 500 },
      { id: 'b', hasText: false, textLength: 0 },
      { id: 'c', hasText: false, textLength: 0 },
    ]);
    // Only 'a' is selected, so no warning about missing text
    const result = validateSelectedDocumentsText(['a'], docs);
    expect(result.valid).toBe(true);
    expect(result.warningMessage).toBeUndefined();
  });

  it('treats hasText=true but textLength=0 as no text', () => {
    const docs = makeDocs([
      { id: 'a', hasText: true, textLength: 0 },
    ]);
    const result = validateSelectedDocumentsText(['a'], docs);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain('no extractable text');
  });
});

describe('getEmptyDocumentsMessage (Req 7.1)', () => {
  it('includes the customer email in the message', () => {
    const msg = getEmptyDocumentsMessage('user@example.com');
    expect(msg).toContain('user@example.com');
  });

  it('mentions that documents need to be uploaded', () => {
    const msg = getEmptyDocumentsMessage('test@test.com');
    expect(msg).toContain('uploaded');
  });

  it('indicates no documents were found', () => {
    const msg = getEmptyDocumentsMessage('any@email.com');
    expect(msg).toContain('No documents found');
  });
});

describe('getOperationSuccessMessage (Req 7.3)', () => {
  it('generates delete success with document name', () => {
    const msg = getOperationSuccessMessage('delete', 'report.pdf');
    expect(msg).toContain('report.pdf');
    expect(msg).toContain('deleted');
  });

  it('generates delete success without document name', () => {
    const msg = getOperationSuccessMessage('delete');
    expect(msg).toContain('deleted');
  });

  it('generates retry success with details', () => {
    const msg = getOperationSuccessMessage('retry', undefined, 'Text extracted: 1500 characters');
    expect(msg).toContain('retry successful');
    expect(msg).toContain('1500');
  });

  it('generates retry success without details', () => {
    const msg = getOperationSuccessMessage('retry');
    expect(msg).toContain('retry successful');
  });
});

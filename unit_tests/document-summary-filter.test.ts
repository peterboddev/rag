/**
 * Unit tests for document-summary-filter service.
 * Tests filterDocumentsForSummary, validateTextQuality, and isCacheStale.
 */

import { describe, it, expect } from '@jest/globals';
import {
  filterDocumentsForSummary,
  validateTextQuality,
  isCacheStale,
} from '../src/services/document-summary-filter';
import { DocumentRecord, ProcessingStatus } from '../src/types';

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = new Date().toISOString();
  return {
    documentId: overrides.documentId ?? 'doc-1',
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: overrides.fileName ?? 'file.pdf',
    s3Key: 'docs/file.pdf',
    contentType: 'application/pdf',
    processingStatus: 'completed' as ProcessingStatus,
    extractedText: 'This is valid extracted text for testing.',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('filterDocumentsForSummary', () => {
  it('includes completed documents with valid text', () => {
    const docs = [makeDoc({ documentId: 'a' }), makeDoc({ documentId: 'b' })];
    const result = filterDocumentsForSummary(docs);
    expect(result.includedDocuments).toHaveLength(2);
    expect(result.excludedDocuments).toHaveLength(0);
  });

  it('excludes documents with non-completed status', () => {
    const docs = [
      makeDoc({ documentId: 'queued', processingStatus: 'queued' }),
      makeDoc({ documentId: 'processing', processingStatus: 'processing' }),
      makeDoc({ documentId: 'failed', processingStatus: 'failed' }),
      makeDoc({ documentId: 'ok', processingStatus: 'completed' }),
    ];
    const result = filterDocumentsForSummary(docs);
    expect(result.includedDocuments).toHaveLength(1);
    expect(result.includedDocuments[0].documentId).toBe('ok');
    expect(result.excludedDocuments).toHaveLength(3);
    expect(result.excludedDocuments.map(e => e.documentId)).toEqual(['queued', 'processing', 'failed']);
  });

  it('provides correct exclusion reasons for each status', () => {
    const docs = [
      makeDoc({ documentId: 'q', processingStatus: 'queued' }),
      makeDoc({ documentId: 'p', processingStatus: 'processing' }),
      makeDoc({ documentId: 'f', processingStatus: 'failed' }),
    ];
    const result = filterDocumentsForSummary(docs);
    expect(result.excludedDocuments[0].reason).toContain('queued');
    expect(result.excludedDocuments[1].reason).toContain('processed');
    expect(result.excludedDocuments[2].reason).toContain('failed');
  });

  it('excludes completed documents with no extracted text', () => {
    const doc = makeDoc({ extractedText: undefined });
    const result = filterDocumentsForSummary([doc]);
    expect(result.includedDocuments).toHaveLength(0);
    expect(result.excludedDocuments).toHaveLength(1);
    expect(result.excludedDocuments[0].reason).toContain('No extracted text');
  });

  it('excludes completed documents with short text', () => {
    const doc = makeDoc({ extractedText: 'short' });
    const result = filterDocumentsForSummary([doc]);
    expect(result.includedDocuments).toHaveLength(0);
    expect(result.excludedDocuments[0].reason).toContain('too short');
  });

  it('excludes completed documents with low confidence', () => {
    const doc = makeDoc({
      processingMetadata: {
        confidence: 30,
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync',
        retryHistory: [],
      },
    });
    const result = filterDocumentsForSummary([doc]);
    expect(result.includedDocuments).toHaveLength(0);
    expect(result.excludedDocuments[0].reason).toContain('confidence too low');
  });

  it('includes documents with confidence above threshold', () => {
    const doc = makeDoc({
      processingMetadata: {
        confidence: 80,
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync',
        retryHistory: [],
      },
    });
    const result = filterDocumentsForSummary([doc]);
    expect(result.includedDocuments).toHaveLength(1);
  });

  it('includes documents when confidence is not set', () => {
    const doc = makeDoc({
      processingMetadata: {
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync',
        retryHistory: [],
      },
    });
    const result = filterDocumentsForSummary([doc]);
    expect(result.includedDocuments).toHaveLength(1);
  });

  it('returns empty arrays for empty input', () => {
    const result = filterDocumentsForSummary([]);
    expect(result.includedDocuments).toHaveLength(0);
    expect(result.excludedDocuments).toHaveLength(0);
  });
});

describe('validateTextQuality', () => {
  it('returns valid for good text', () => {
    const doc = makeDoc({ extractedText: 'This is a valid document text.' });
    expect(validateTextQuality(doc)).toEqual({ valid: true });
  });

  it('returns invalid for undefined text', () => {
    const doc = makeDoc({ extractedText: undefined });
    const result = validateTextQuality(doc);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('returns invalid for empty string', () => {
    const doc = makeDoc({ extractedText: '' });
    expect(validateTextQuality(doc).valid).toBe(false);
  });

  it('returns invalid for whitespace-only text', () => {
    const doc = makeDoc({ extractedText: '   \n\t  ' });
    expect(validateTextQuality(doc).valid).toBe(false);
  });

  it('returns invalid for text shorter than 10 chars after trim', () => {
    const doc = makeDoc({ extractedText: '  abc  ' });
    expect(validateTextQuality(doc).valid).toBe(false);
  });

  it('returns valid for text exactly 10 chars after trim', () => {
    const doc = makeDoc({ extractedText: '1234567890' });
    expect(validateTextQuality(doc)).toEqual({ valid: true });
  });

  it('returns invalid for low confidence score', () => {
    const doc = makeDoc({
      processingMetadata: {
        confidence: 49,
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync' as const,
        retryHistory: [],
      },
    });
    expect(validateTextQuality(doc).valid).toBe(false);
  });

  it('returns valid for confidence exactly 50', () => {
    const doc = makeDoc({
      processingMetadata: {
        confidence: 50,
        isEncrypted: false,
        hasTextContent: true,
        processingMode: 'sync' as const,
        retryHistory: [],
      },
    });
    expect(validateTextQuality(doc)).toEqual({ valid: true });
  });
});

describe('isCacheStale', () => {
  it('returns false when all documents are older than cache', () => {
    const cacheTime = new Date('2025-01-10T12:00:00Z').getTime();
    const docs = [
      makeDoc({ updatedAt: '2025-01-09T12:00:00Z' }),
      makeDoc({ updatedAt: '2025-01-08T12:00:00Z' }),
    ];
    expect(isCacheStale(docs, cacheTime)).toBe(false);
  });

  it('returns true when a document is newer than cache', () => {
    const cacheTime = new Date('2025-01-10T12:00:00Z').getTime();
    const docs = [
      makeDoc({ updatedAt: '2025-01-09T12:00:00Z' }),
      makeDoc({ updatedAt: '2025-01-11T12:00:00Z' }),
    ];
    expect(isCacheStale(docs, cacheTime)).toBe(true);
  });

  it('returns false for empty document list', () => {
    expect(isCacheStale([], Date.now())).toBe(false);
  });

  it('returns false when document updatedAt equals cache timestamp', () => {
    const cacheTime = new Date('2025-01-10T12:00:00Z').getTime();
    const docs = [makeDoc({ updatedAt: '2025-01-10T12:00:00Z' })];
    expect(isCacheStale(docs, cacheTime)).toBe(false);
  });
});

/**
 * Property-based tests for Cache Consistency
 * Feature: pdf-processing-enhancement, Property 13: Cache Consistency
 *
 * **Validates: Requirements 7.5**
 *
 * Properties tested:
 * 1. A cache lookup for a completed document always returns the same extractedText
 * 2. Cache entries are never created for failed documents
 * 3. Cache hits avoid reprocessing (if cache has entry, processing function is not called)
 * 4. Cache is invalidated when document is reprocessed (retry scenario)
 * 5. Cache entries are consistent: stored text matches the original extraction
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { ProcessingStatus } from '../src/types';

// ─── DocumentTextCache (simple cache model for property verification) ────────

interface CacheEntry {
  extractedText: string;
  textLength: number;
  cachedAt: string;
}

class DocumentTextCache {
  private cache = new Map<string, CacheEntry>();

  /**
   * Stores extracted text for a completed document.
   * Only caches documents with processingStatus === 'completed' and non-empty text.
   */
  store(documentId: string, processingStatus: ProcessingStatus, extractedText?: string): boolean {
    if (processingStatus !== 'completed' || !extractedText || extractedText.length === 0) {
      return false;
    }
    this.cache.set(documentId, {
      extractedText,
      textLength: extractedText.length,
      cachedAt: new Date().toISOString(),
    });
    return true;
  }

  /** Returns cached text if present, undefined otherwise. */
  lookup(documentId: string): string | undefined {
    return this.cache.get(documentId)?.extractedText;
  }

  /** Returns true if the cache contains an entry for the given document. */
  has(documentId: string): boolean {
    return this.cache.has(documentId);
  }

  /** Invalidates (removes) the cache entry for a document (e.g. on retry). */
  invalidate(documentId: string): void {
    this.cache.delete(documentId);
  }

  /** Returns the full cache entry for inspection. */
  getEntry(documentId: string): CacheEntry | undefined {
    return this.cache.get(documentId);
  }

  /**
   * Processes a document: returns cached text if available,
   * otherwise calls the provided processingFn and caches the result.
   */
  getOrProcess(
    documentId: string,
    processingStatus: ProcessingStatus,
    processingFn: () => string
  ): string | undefined {
    const cached = this.lookup(documentId);
    if (cached !== undefined) {
      return cached;
    }
    if (processingStatus !== 'completed') {
      return undefined;
    }
    const text = processingFn();
    this.store(documentId, processingStatus, text);
    return text;
  }
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty extracted text */
const extractedTextArb = fc.string({ minLength: 1, maxLength: 500 })
  .filter(s => s.length > 0);

/** Document IDs */
const documentIdArb = fc.stringMatching(/^doc-[a-z0-9]{4,12}$/);

/** Completed status */
const completedStatusArb: fc.Arbitrary<ProcessingStatus> = fc.constant('completed' as ProcessingStatus);

/** Non-completed statuses */
const failedStatusArb: fc.Arbitrary<ProcessingStatus> = fc.constantFrom(
  'queued' as ProcessingStatus,
  'processing' as ProcessingStatus,
  'failed' as ProcessingStatus
);

/** Any valid processing status */
const anyStatusArb: fc.Arbitrary<ProcessingStatus> = fc.constantFrom(
  'queued' as ProcessingStatus,
  'processing' as ProcessingStatus,
  'completed' as ProcessingStatus,
  'failed' as ProcessingStatus
);

// ─── Property 13: Cache Consistency ──────────────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 13: Cache Consistency', () => {
  /**
   * **Validates: Requirements 7.5**
   *
   * For any completed document with extracted text, a cache lookup
   * always returns the exact same extractedText that was stored.
   */
  it('cache lookup for a completed document always returns the same extractedText', () => {
    fc.assert(
      fc.property(documentIdArb, extractedTextArb, (docId, text) => {
        const cache = new DocumentTextCache();
        cache.store(docId, 'completed', text);

        // Multiple lookups should all return the same text
        const lookup1 = cache.lookup(docId);
        const lookup2 = cache.lookup(docId);
        const lookup3 = cache.lookup(docId);

        expect(lookup1).toBe(text);
        expect(lookup2).toBe(text);
        expect(lookup3).toBe(text);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * Cache entries are never created for documents that are not completed
   * (queued, processing, or failed).
   */
  it('cache entries are never created for non-completed documents', () => {
    fc.assert(
      fc.property(documentIdArb, failedStatusArb, extractedTextArb, (docId, status, text) => {
        const cache = new DocumentTextCache();
        const stored = cache.store(docId, status, text);

        expect(stored).toBe(false);
        expect(cache.has(docId)).toBe(false);
        expect(cache.lookup(docId)).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * When the cache has an entry for a document, the processing function
   * is never called — the cached value is returned directly.
   */
  it('cache hits avoid reprocessing', () => {
    fc.assert(
      fc.property(documentIdArb, extractedTextArb, extractedTextArb, (docId, originalText, newText) => {
        const cache = new DocumentTextCache();

        // Pre-populate cache
        cache.store(docId, 'completed', originalText);

        // processingFn should NOT be called
        const processingFn = jest.fn(() => newText);
        const result = cache.getOrProcess(docId, 'completed', processingFn);

        expect(processingFn).not.toHaveBeenCalled();
        expect(result).toBe(originalText);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * When a document is reprocessed (retry scenario), invalidating the cache
   * removes the old entry, and subsequent processing produces a fresh result.
   */
  it('cache is invalidated when document is reprocessed (retry scenario)', () => {
    fc.assert(
      fc.property(documentIdArb, extractedTextArb, extractedTextArb, (docId, oldText, newText) => {
        const cache = new DocumentTextCache();

        // Store original text
        cache.store(docId, 'completed', oldText);
        expect(cache.lookup(docId)).toBe(oldText);

        // Invalidate on retry
        cache.invalidate(docId);
        expect(cache.has(docId)).toBe(false);
        expect(cache.lookup(docId)).toBeUndefined();

        // Reprocess produces new text
        const processingFn = jest.fn(() => newText);
        const result = cache.getOrProcess(docId, 'completed', processingFn);

        expect(processingFn).toHaveBeenCalledTimes(1);
        expect(result).toBe(newText);
        expect(cache.lookup(docId)).toBe(newText);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * For any cached entry, the stored text and textLength are consistent
   * with the original extraction — textLength equals extractedText.length.
   */
  it('cache entries are consistent: stored text matches the original extraction', () => {
    fc.assert(
      fc.property(documentIdArb, extractedTextArb, (docId, text) => {
        const cache = new DocumentTextCache();
        cache.store(docId, 'completed', text);

        const entry = cache.getEntry(docId);
        expect(entry).toBeDefined();
        expect(entry!.extractedText).toBe(text);
        expect(entry!.textLength).toBe(text.length);
        expect(entry!.cachedAt).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });
});

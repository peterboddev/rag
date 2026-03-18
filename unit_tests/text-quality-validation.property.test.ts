/**
 * Property-based tests for Text Quality Validation
 * Feature: pdf-processing-enhancement, Property 15: Text Quality Validation
 *
 * Validates: Requirements 8.5
 *
 * Properties tested:
 * 1. Documents with undefined/empty/whitespace-only text are invalid
 * 2. Documents with text shorter than 10 chars (after trim) are invalid
 * 3. Documents with confidence < 50% are invalid with reason mentioning confidence
 * 4. Documents with valid text (>= 10 chars) and acceptable confidence are valid
 * 5. Invalid results always include a non-empty reason string
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { validateTextQuality } from '../src/services/document-summary-filter';
import { DocumentRecord } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = new Date().toISOString();
  return {
    documentId: 'doc-1',
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: 'test.pdf',
    s3Key: 'docs/test.pdf',
    contentType: 'application/pdf',
    processingStatus: 'completed',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generates whitespace-only strings (spaces, tabs, newlines) */
const whitespaceOnlyArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 20 });

/** Generates text that trims to 1-9 chars (below the 10-char minimum) */
const shortTextArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 9 }).filter(s => s.trim().length > 0 && s.trim().length < 10),
  whitespaceOnlyArb,
).map(([text, pad]) => pad + text.trim() + pad);

/** Generates valid text (>= 10 printable chars after trim) */
const validTextArb = fc.string({ minLength: 10, maxLength: 200 })
  .filter(s => s.trim().length >= 10);

/** Confidence below 50 */
const lowConfidenceArb = fc.double({ min: 0, max: 49.99, noNaN: true });

/** Confidence at or above 50 */
const highConfidenceArb = fc.double({ min: 50, max: 100, noNaN: true });

// ─── Property 15: Text Quality Validation ────────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 15: Text Quality Validation', () => {
  /**
   * **Validates: Requirements 8.5**
   *
   * For any document with undefined, empty, or whitespace-only text,
   * validateTextQuality returns invalid.
   */
  it('rejects documents with undefined, empty, or whitespace-only text', () => {
    const noTextArb = fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      whitespaceOnlyArb,
    );

    fc.assert(
      fc.property(noTextArb, (text) => {
        const doc = makeDocument({ extractedText: text });
        const result = validateTextQuality(doc);
        expect(result.valid).toBe(false);
        expect(result.reason).toBeDefined();
        expect(result.reason!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   *
   * For any document with text shorter than 10 characters after trimming,
   * validateTextQuality returns invalid.
   */
  it('rejects documents with text shorter than 10 chars after trim', () => {
    fc.assert(
      fc.property(shortTextArb, (text) => {
        const doc = makeDocument({ extractedText: text });
        const result = validateTextQuality(doc);
        expect(result.valid).toBe(false);
        expect(result.reason).toBeDefined();
        expect(result.reason!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   *
   * For any document with confidence below 50%, validateTextQuality
   * returns invalid with a reason mentioning confidence.
   */
  it('rejects documents with confidence below 50%', () => {
    fc.assert(
      fc.property(validTextArb, lowConfidenceArb, (text, confidence) => {
        const doc = makeDocument({
          extractedText: text,
          processingMetadata: {
            confidence,
            isEncrypted: false,
            hasTextContent: true,
            processingMode: 'sync',
            retryHistory: [],
          },
        });
        const result = validateTextQuality(doc);
        expect(result.valid).toBe(false);
        expect(result.reason).toBeDefined();
        expect(result.reason!.toLowerCase()).toContain('confidence');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   *
   * For any document with valid text (>= 10 chars) and either no confidence
   * set or confidence >= 50%, validateTextQuality returns valid.
   */
  it('accepts documents with valid text and acceptable or absent confidence', () => {
    const acceptableConfidenceArb = fc.oneof(
      fc.constant(undefined),
      highConfidenceArb,
    );

    fc.assert(
      fc.property(validTextArb, acceptableConfidenceArb, (text, confidence) => {
        const doc = makeDocument({ extractedText: text });
        if (confidence !== undefined) {
          doc.processingMetadata = {
            confidence,
            isEncrypted: false,
            hasTextContent: true,
            processingMode: 'sync',
            retryHistory: [],
          };
        }
        const result = validateTextQuality(doc);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   *
   * For any document that fails validation, the result always includes
   * a non-empty reason string.
   */
  it('invalid results always include a non-empty reason string', () => {
    const anyTextArb = fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      whitespaceOnlyArb,
      shortTextArb,
      validTextArb,
    );
    const anyConfidenceArb = fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined });

    fc.assert(
      fc.property(anyTextArb, anyConfidenceArb, (text, confidence) => {
        const doc = makeDocument({ extractedText: text });
        if (confidence !== undefined) {
          doc.processingMetadata = {
            confidence,
            isEncrypted: false,
            hasTextContent: true,
            processingMode: 'sync',
            retryHistory: [],
          };
        }
        const result = validateTextQuality(doc);
        if (!result.valid) {
          expect(typeof result.reason).toBe('string');
          expect(result.reason!.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

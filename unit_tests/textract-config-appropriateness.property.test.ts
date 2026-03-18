/**
 * Property-based tests for Textract Configuration Appropriateness
 * Feature: pdf-processing-enhancement, Property 3: Textract Configuration Appropriateness
 *
 * Validates: Requirements 5.1, 5.2
 *
 * Properties tested:
 * - Files with 'form' or 'application' in name always get 'forms' document type
 * - Files with 'table', 'data', or 'report' in name always get 'tables' document type
 * - Files without those keywords always get 'simple' document type
 * - The return value is always one of the three valid document types
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { EnhancedTextractService } from '../src/services/enhanced-textract';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Keywords that trigger 'forms' document type */
const FORMS_KEYWORDS = ['form', 'application'];

/** Keywords that trigger 'tables' document type */
const TABLES_KEYWORDS = ['table', 'data', 'report'];

/** All reserved keywords */
const ALL_KEYWORDS = [...FORMS_KEYWORDS, ...TABLES_KEYWORDS];

/** Safe base string that avoids all reserved keywords */
const safeBaseArb = fc.stringOf(
  fc.constantFrom(...'abcghijklmnopqsuvwxyz0123456789_-'.split('')),
  { minLength: 1, maxLength: 30 }
).filter(s => {
  const lower = s.toLowerCase();
  return !ALL_KEYWORDS.some(kw => lower.includes(kw));
});

/** Generates a filename containing a forms keyword */
const formsFileNameArb = fc.tuple(
  safeBaseArb,
  fc.constantFrom(...FORMS_KEYWORDS),
  safeBaseArb
).map(([prefix, keyword, suffix]) => `${prefix}${keyword}${suffix}.pdf`);

/** Generates a filename containing a tables keyword (but no forms keyword) */
const tablesFileNameArb = fc.tuple(
  safeBaseArb,
  fc.constantFrom(...TABLES_KEYWORDS),
  safeBaseArb
).map(([prefix, keyword, suffix]) => `${prefix}${keyword}${suffix}.pdf`)
  .filter(name => {
    const lower = name.toLowerCase();
    return !FORMS_KEYWORDS.some(kw => lower.includes(kw));
  });

/** Generates a filename with no reserved keywords (should yield 'simple') */
const simpleFileNameArb = safeBaseArb.map(s => `${s}.pdf`);

/** Any content type string */
const contentTypeArb = fc.constantFrom(
  'application/pdf',
  'application/octet-stream',
  'text/plain',
  'image/png'
);

// ─── Property 3: Textract Configuration Appropriateness ──────────────────────

describe('Feature: pdf-processing-enhancement, Property 3: Textract Configuration Appropriateness', () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * Files with 'form' or 'application' in the name should always
   * be classified as 'forms' document type, selecting AnalyzeDocument.
   */
  it('should classify files with forms keywords as "forms" document type', () => {
    fc.assert(
      fc.property(formsFileNameArb, contentTypeArb, (fileName, contentType) => {
        const result = EnhancedTextractService.determineDocumentType(fileName, contentType);
        expect(result).toBe('forms');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * Files with 'table', 'data', or 'report' in the name (and no forms keywords)
   * should always be classified as 'tables' document type, selecting AnalyzeDocument.
   */
  it('should classify files with tables keywords as "tables" document type', () => {
    fc.assert(
      fc.property(tablesFileNameArb, contentTypeArb, (fileName, contentType) => {
        const result = EnhancedTextractService.determineDocumentType(fileName, contentType);
        expect(result).toBe('tables');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * Files without any reserved keywords should always be classified as
   * 'simple' document type, selecting DetectDocumentText.
   */
  it('should classify files without keywords as "simple" document type', () => {
    fc.assert(
      fc.property(simpleFileNameArb, contentTypeArb, (fileName, contentType) => {
        const result = EnhancedTextractService.determineDocumentType(fileName, contentType);
        expect(result).toBe('simple');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any arbitrary filename and content type, the return value is always
   * one of the three valid document types: 'simple', 'forms', or 'tables'.
   */
  it('should always return a valid document type for any input', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        contentTypeArb,
        (fileName, contentType) => {
          const result = EnhancedTextractService.determineDocumentType(fileName, contentType);
          expect(['simple', 'forms', 'tables']).toContain(result);
        }
      ),
      { numRuns: 100 }
    );
  });
});

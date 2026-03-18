/**
 * Property-based tests for Processing Mode Selection
 * Feature: pdf-processing-enhancement, Property 7: Processing Mode Selection
 *
 * Validates: Requirements 7.2, 7.3
 *
 * Properties tested:
 * - Files under 5MB with simple/undefined type always get 'sync' mode
 * - Files >= 5MB with simple/undefined type always get 'async' mode
 * - Files under 2MB with forms/tables type always get 'sync' mode
 * - Files >= 2MB with forms/tables type always get 'async' mode
 * - Return value is always 'sync' or 'async'
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { EnhancedTextractService } from '../src/services/enhanced-textract';

// ─── Constants ───────────────────────────────────────────────────────────────

const SYNC_THRESHOLD = 5 * 1024 * 1024; // 5MB
const COMPLEX_SYNC_THRESHOLD = 2 * 1024 * 1024; // 2MB

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** File sizes strictly below 5MB (0 to 5MB - 1 byte) */
const smallSimpleFileSizeArb = fc.integer({ min: 0, max: SYNC_THRESHOLD - 1 });

/** File sizes at or above 5MB */
const largeSimpleFileSizeArb = fc.integer({ min: SYNC_THRESHOLD, max: 1_000_000_000 });

/** File sizes strictly below 2MB (0 to 2MB - 1 byte) */
const smallComplexFileSizeArb = fc.integer({ min: 0, max: COMPLEX_SYNC_THRESHOLD - 1 });

/** File sizes at or above 2MB */
const largeComplexFileSizeArb = fc.integer({ min: COMPLEX_SYNC_THRESHOLD, max: 1_000_000_000 });

/** Simple document types (undefined counts as simple) */
const simpleDocTypeArb = fc.constantFrom(undefined, 'simple' as const);

/** Complex document types */
const complexDocTypeArb = fc.constantFrom('forms' as const, 'tables' as const);

/** Any valid document type */
const anyDocTypeArb = fc.constantFrom(undefined, 'simple' as const, 'forms' as const, 'tables' as const);

/** Any non-negative file size */
const anyFileSizeArb = fc.integer({ min: 0, max: 1_000_000_000 });

// ─── Property 7: Processing Mode Selection ───────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 7: Processing Mode Selection', () => {
  /**
   * **Validates: Requirements 7.2**
   *
   * For any file under 5MB with simple or undefined document type,
   * the system should select synchronous processing.
   */
  it('should select sync mode for files under 5MB with simple type', () => {
    fc.assert(
      fc.property(smallSimpleFileSizeArb, simpleDocTypeArb, (fileSize, docType) => {
        const mode = EnhancedTextractService.determineProcessingMode(fileSize, docType);
        expect(mode).toBe('sync');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * For any file at or above 5MB with simple or undefined document type,
   * the system should select asynchronous processing.
   */
  it('should select async mode for files >= 5MB with simple type', () => {
    fc.assert(
      fc.property(largeSimpleFileSizeArb, simpleDocTypeArb, (fileSize, docType) => {
        const mode = EnhancedTextractService.determineProcessingMode(fileSize, docType);
        expect(mode).toBe('async');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * For any file under 2MB with forms or tables document type,
   * the system should select synchronous processing.
   */
  it('should select sync mode for files under 2MB with forms/tables type', () => {
    fc.assert(
      fc.property(smallComplexFileSizeArb, complexDocTypeArb, (fileSize, docType) => {
        const mode = EnhancedTextractService.determineProcessingMode(fileSize, docType);
        expect(mode).toBe('sync');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.3**
   *
   * For any file at or above 2MB with forms or tables document type,
   * the system should select asynchronous processing.
   */
  it('should select async mode for files >= 2MB with forms/tables type', () => {
    fc.assert(
      fc.property(largeComplexFileSizeArb, complexDocTypeArb, (fileSize, docType) => {
        const mode = EnhancedTextractService.determineProcessingMode(fileSize, docType);
        expect(mode).toBe('async');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.3**
   *
   * For any file size and document type, the return value is always
   * exactly 'sync' or 'async' — no other values are possible.
   */
  it('should always return either sync or async for any input', () => {
    fc.assert(
      fc.property(anyFileSizeArb, anyDocTypeArb, (fileSize, docType) => {
        const mode = EnhancedTextractService.determineProcessingMode(fileSize, docType);
        expect(['sync', 'async']).toContain(mode);
      }),
      { numRuns: 100 }
    );
  });
});

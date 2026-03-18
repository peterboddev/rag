/**
 * Property-based tests for PDF Validation Consistency
 * Feature: pdf-processing-enhancement, Property 1: PDF Validation Consistency
 *
 * Validates: Requirements 1.1, 4.1
 *
 * Properties tested:
 * - Valid PDF buffers (with proper header, trailer, startxref, %%EOF) always pass validation
 * - Non-PDF buffers (random bytes, text files) always fail validation
 * - Validation results are deterministic (same input always produces same output)
 * - The isValid field correctly reflects whether errors array is empty
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { PDFValidatorService } from '../src/services/pdf-validator';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Supported PDF versions */
const pdfVersionArb = fc.constantFrom('1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0');

/** Random file names ending in .pdf */
const pdfFileNameArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
  .map(s => `${s}.pdf`);

/** Random non-empty text content to embed in a PDF body */
const pdfTextContentArb = fc.string({ minLength: 1, maxLength: 200 })
  .filter(s => s.trim().length > 0);

/**
 * Generates a minimal valid PDF buffer with proper structure:
 * - %PDF-{version} header
 * - /Type /Page object with /Font and /Contents (text indicators)
 * - trailer, startxref, %%EOF markers
 */
const validPDFBufferArb = fc.tuple(pdfVersionArb, pdfTextContentArb).map(([version, text]) => {
  const pdfContent = [
    `%PDF-${version}`,
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /Font << /F1 4 0 R >> /Contents 5 0 R >>',
    'endobj',
    '4 0 obj',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    'endobj',
    '5 0 obj',
    `<< /Length ${text.length + 10} >>`,
    'stream',
    `BT /F1 12 Tf (${text}) Tj ET`,
    'endstream',
    'endobj',
    'xref',
    '0 6',
    'trailer',
    '<< /Size 6 /Root 1 0 R >>',
    'startxref',
    '0',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdfContent, 'binary');
});

/**
 * Generates a buffer that is clearly NOT a valid PDF:
 * random bytes that don't start with %PDF-
 */
const nonPDFRandomBytesArb = fc.uint8Array({ minLength: 10, maxLength: 500 })
  .filter(arr => {
    // Ensure it doesn't accidentally start with %PDF-
    const header = Buffer.from(arr.buffer, arr.byteOffset, Math.min(arr.length, 5)).toString('ascii');
    return !header.startsWith('%PDF-');
  })
  .map(arr => Buffer.from(arr));

/**
 * Generates a plain text file buffer (not a PDF)
 */
const plainTextBufferArb = fc.string({ minLength: 10, maxLength: 500 })
  .filter(s => !s.startsWith('%PDF-'))
  .map(s => Buffer.from(s, 'utf-8'));

/** Non-PDF buffer: either random bytes or plain text */
const nonPDFBufferArb = fc.oneof(nonPDFRandomBytesArb, plainTextBufferArb);

/** Generic file name for non-PDF files */
const anyFileNameArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => /^[a-zA-Z0-9_.-]+$/.test(s) && s.length > 0);

// ─── Property 1: PDF Validation Consistency ──────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 1: PDF Validation Consistency', () => {
  /**
   * **Validates: Requirements 1.1, 4.1**
   *
   * For any well-formed PDF buffer with proper header, trailer, startxref,
   * and %%EOF markers, validation should pass (isValid === true, no errors).
   */
  it('should always validate well-formed PDF buffers as valid', async () => {
    await fc.assert(
      fc.asyncProperty(validPDFBufferArb, pdfFileNameArb, async (buffer, fileName) => {
        const result = await PDFValidatorService.validatePDF(buffer, fileName);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.fileSizeBytes).toBe(buffer.length);
        expect(result.pdfVersion).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 4.1**
   *
   * For any buffer that is NOT a valid PDF (random bytes, plain text),
   * validation should fail (isValid === false, errors non-empty).
   */
  it('should always reject non-PDF buffers as invalid', async () => {
    await fc.assert(
      fc.asyncProperty(nonPDFBufferArb, anyFileNameArb, async (buffer, fileName) => {
        const result = await PDFValidatorService.validatePDF(buffer, fileName);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 4.1**
   *
   * Validation is deterministic: running validatePDF twice on the same
   * input always produces identical results.
   */
  it('should produce deterministic results for the same input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(validPDFBufferArb, nonPDFBufferArb),
        anyFileNameArb,
        async (buffer, fileName) => {
          const result1 = await PDFValidatorService.validatePDF(buffer, fileName);
          const result2 = await PDFValidatorService.validatePDF(buffer, fileName);

          expect(result1.isValid).toBe(result2.isValid);
          expect(result1.errors.length).toBe(result2.errors.length);
          expect(result1.warnings.length).toBe(result2.warnings.length);
          expect(result1.pdfVersion).toBe(result2.pdfVersion);
          expect(result1.isEncrypted).toBe(result2.isEncrypted);
          expect(result1.hasTextContent).toBe(result2.hasTextContent);
          expect(result1.pageCount).toBe(result2.pageCount);
          expect(result1.fileSizeBytes).toBe(result2.fileSizeBytes);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 4.1**
   *
   * The isValid field is always consistent with the errors array:
   * isValid === true if and only if errors.length === 0.
   */
  it('should have isValid consistent with errors array emptiness', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(validPDFBufferArb, nonPDFBufferArb),
        anyFileNameArb,
        async (buffer, fileName) => {
          const result = await PDFValidatorService.validatePDF(buffer, fileName);
          if (result.isValid) {
            expect(result.errors).toHaveLength(0);
          } else {
            expect(result.errors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

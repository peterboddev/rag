/**
 * Property-based tests for Error Handling Specificity
 * Feature: pdf-processing-enhancement, Property 6: Error Handling Specificity
 *
 * Validates: Requirements 2.1, 2.3, 2.4, 2.5
 *
 * Properties tested:
 * 1. For any error, createErrorDetails always returns a valid ErrorDetails with all required fields
 * 2. Validation errors (InvalidParameterException, UnsupportedDocumentException, DocumentTooLargeException) are non-retryable with errorType 'validation'
 * 3. Throttling errors are retryable with errorType 'textract'
 * 4. All error details include a non-empty suggestedAction
 * 5. PDF validation errors from PDFValidatorService always include suggestedAction
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { EnhancedTextractService } from '../src/services/enhanced-textract';
import { PDFValidatorService } from '../src/services/pdf-validator';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Known validation error names that should map to non-retryable validation errors */
const validationErrorMessageArb = fc.oneof(
  fc.constant('InvalidParameterException'),
  fc.constant('UnsupportedDocumentException'),
  fc.constant('DocumentTooLargeException')
).map(name => {
  const err = new Error(`${name}: some detail about the failure`);
  err.name = name;
  return err;
});

/** Throttling error */
const throttlingErrorArb = fc.constant((() => {
  const err = new Error('ThrottlingException: Rate exceeded');
  err.name = 'ThrottlingException';
  return err;
})());

/** Generic/unknown errors that don't match any specific pattern */
const genericErrorMessageArb = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s =>
    !s.includes('InvalidParameterException') &&
    !s.includes('UnsupportedDocumentException') &&
    !s.includes('DocumentTooLargeException') &&
    !s.includes('ThrottlingException')
  )
  .map(msg => new Error(msg));

/** Any error: validation, throttling, or generic */
const anyErrorArb = fc.oneof(
  validationErrorMessageArb,
  throttlingErrorArb,
  genericErrorMessageArb
);

const validErrorTypes = ['validation', 'textract', 'processing', 'system'] as const;

// ─── Property 6: Error Handling Specificity ──────────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 6: Error Handling Specificity', () => {
  /**
   * **Validates: Requirements 2.1, 2.5**
   *
   * For any error, createErrorDetails always returns a valid ErrorDetails
   * object with all required fields populated.
   */
  it('should always return a complete ErrorDetails with all required fields for any error', () => {
    fc.assert(
      fc.property(anyErrorArb, (error) => {
        const details = EnhancedTextractService.createErrorDetails(error);

        // All required fields must exist and be the correct type
        expect(typeof details.errorCode).toBe('string');
        expect(details.errorCode.length).toBeGreaterThan(0);
        expect(typeof details.errorMessage).toBe('string');
        expect(details.errorMessage.length).toBeGreaterThan(0);
        expect(validErrorTypes).toContain(details.errorType);
        expect(typeof details.suggestedAction).toBe('string');
        expect(typeof details.isRetryable).toBe('boolean');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.3**
   *
   * Validation errors (InvalidParameterException, UnsupportedDocumentException,
   * DocumentTooLargeException) must be classified as non-retryable with errorType 'validation'.
   */
  it('should classify validation errors as non-retryable with errorType validation', () => {
    fc.assert(
      fc.property(validationErrorMessageArb, (error) => {
        const details = EnhancedTextractService.createErrorDetails(error);

        expect(details.errorType).toBe('validation');
        expect(details.isRetryable).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.2, 2.4**
   *
   * Throttling errors must be classified as retryable with errorType 'textract'.
   */
  it('should classify throttling errors as retryable with errorType textract', () => {
    fc.assert(
      fc.property(throttlingErrorArb, () => {
        const err = new Error('ThrottlingException: Rate exceeded');
        err.name = 'ThrottlingException';
        const details = EnhancedTextractService.createErrorDetails(err);

        expect(details.errorType).toBe('textract');
        expect(details.isRetryable).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * All error details must include a non-empty suggestedAction so users
   * know what corrective steps to take.
   */
  it('should always include a non-empty suggestedAction for any error', () => {
    fc.assert(
      fc.property(anyErrorArb, (error) => {
        const details = EnhancedTextractService.createErrorDetails(error);

        expect(details.suggestedAction).toBeDefined();
        expect(details.suggestedAction.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.3**
   *
   * PDF validation errors produced by PDFValidatorService always include
   * a suggestedAction field so users can correct the issue.
   */
  it('should always include suggestedAction in PDFValidatorService validation errors', () => {
    // Generate various invalid PDF buffers to trigger different validation errors
    const invalidPdfBufferArb = fc.oneof(
      // Empty buffer - triggers invalid header
      fc.constant(Buffer.alloc(0)),
      // Too-small buffer - triggers invalid header
      fc.constant(Buffer.from('short')),
      // Random bytes - triggers invalid header
      fc.uint8Array({ minLength: 10, maxLength: 200 }).map(arr => Buffer.from(arr)),
      // Valid header but no structure - triggers corruption check
      fc.constant(Buffer.from('%PDF-1.4 some content without proper structure'))
    );

    const fileNameArb = fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s}.pdf`);

    fc.assert(
      fc.asyncProperty(invalidPdfBufferArb, fileNameArb, async (buffer, fileName) => {
        const result = await PDFValidatorService.validatePDF(buffer, fileName);

        // Every validation error should have a suggestedAction
        for (const error of result.errors) {
          expect(error.suggestedAction).toBeDefined();
          expect(typeof error.suggestedAction).toBe('string');
          expect(error.suggestedAction!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

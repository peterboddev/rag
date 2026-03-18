/**
 * Property-based tests for Error State Recovery
 * Feature: document-selection-summary, Property 6: Error state recovery
 *
 * **Validates: Requirements 7.1, 7.2, 7.3**
 *
 * Properties tested:
 * 1. For any failed operation, getOperationErrorMessage always produces a non-empty error message
 * 2. For any operation result, getNotificationType always returns a valid NotificationType
 * 3. Summarization failures always have suggested actions via getSummarizationErrorActions
 * 4. validateSelectedDocumentsText always returns a consistent valid/errorMessage pair
 * 5. Error messages always contain the original error context (operation-related text or errorMessage)
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  getOperationErrorMessage,
  getSummarizationErrorActions,
  getNotificationType,
  validateSelectedDocumentsText,
  getEmptyDocumentsMessage,
  getOperationSuccessMessage,
  type ErrorContext,
  type NotificationType,
  type DocumentTextStatus,
  type ValidationResult,
} from '../frontend/src/utils/errorHandling';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const operationArb = fc.constantFrom<ErrorContext['operation']>('delete', 'retry', 'summarize', 'load', 'refresh');

const nonEmptyStringArb = fc.stringOf(fc.char(), { minLength: 1, maxLength: 60 })
  .filter(s => s.trim().length > 0);

const errorContextArb: fc.Arbitrary<ErrorContext> = fc.record({
  operation: operationArb,
  documentName: fc.option(nonEmptyStringArb, { nil: undefined }),
  errorMessage: nonEmptyStringArb,
});

const validNotificationTypes: NotificationType[] = ['success', 'error', 'warning', 'info'];

const documentTextStatusArb: fc.Arbitrary<DocumentTextStatus> = fc.record({
  documentId: fc.uuid(),
  hasText: fc.boolean(),
  textLength: fc.integer({ min: 0, max: 100000 }),
});

/** Generate a list of document statuses and a subset of their IDs as selected */
const selectedDocsArb = fc.array(documentTextStatusArb, { minLength: 0, maxLength: 20 }).chain(docs => {
  if (docs.length === 0) {
    return fc.constant({ selectedIds: [] as string[], documents: docs });
  }
  return fc.subarray(docs.map(d => d.documentId), { minLength: 0 }).map(selectedIds => ({
    selectedIds,
    documents: docs,
  }));
});

// ─── Property 6: Error State Recovery ────────────────────────────────────────

describe('Feature: document-selection-summary, Property 6: Error state recovery', () => {
  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * For any failed operation (arbitrary operation type and error message),
   * getOperationErrorMessage always produces a non-empty string.
   */
  it('always produces a non-empty error message for any error context', () => {
    fc.assert(
      fc.property(errorContextArb, (context) => {
        const message = getOperationErrorMessage(context);

        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
        expect(message.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.3**
   *
   * For any operation and success/failure flag, getNotificationType
   * always returns one of the valid NotificationType values.
   */
  it('always returns a valid notification type for any operation result', () => {
    fc.assert(
      fc.property(operationArb, fc.boolean(), (operation, success) => {
        const notifType = getNotificationType(operation, success);

        expect(validNotificationTypes).toContain(notifType);

        // Successful operations must return 'success'
        if (success) {
          expect(notifType).toBe('success');
        }
        // Failed operations must return an error-class type (not 'success')
        if (!success) {
          expect(notifType).not.toBe('success');
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.2**
   *
   * Summarization failures always have suggested actions — the list
   * returned by getSummarizationErrorActions is never empty and every
   * action has a non-empty label and description.
   */
  it('summarization failures always provide non-empty suggested actions', () => {
    // This is deterministic, but we run it inside fc.assert to keep the
    // property-test style consistent and confirm stability across runs.
    fc.assert(
      fc.property(fc.constant(null), () => {
        const actions = getSummarizationErrorActions();

        expect(Array.isArray(actions)).toBe(true);
        expect(actions.length).toBeGreaterThan(0);

        for (const action of actions) {
          expect(typeof action.label).toBe('string');
          expect(action.label.length).toBeGreaterThan(0);
          expect(typeof action.description).toBe('string');
          expect(action.description.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.3**
   *
   * validateSelectedDocumentsText always returns a consistent pair:
   * - If valid === false, errorMessage MUST be a non-empty string
   * - warningMessage, when present, must be a non-empty string
   * - The result always has a boolean `valid` field
   */
  it('validateSelectedDocumentsText returns consistent valid/errorMessage pairs', () => {
    fc.assert(
      fc.property(selectedDocsArb, ({ selectedIds, documents }) => {
        const result: ValidationResult = validateSelectedDocumentsText(selectedIds, documents);

        // `valid` is always a boolean
        expect(typeof result.valid).toBe('boolean');

        // If invalid, errorMessage must exist and be non-empty
        if (!result.valid) {
          expect(typeof result.errorMessage).toBe('string');
          expect(result.errorMessage!.length).toBeGreaterThan(0);
        }

        // If warningMessage is present, it must be non-empty
        if (result.warningMessage !== undefined) {
          expect(typeof result.warningMessage).toBe('string');
          expect(result.warningMessage!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * Error messages always contain the original error context — the
   * errorMessage from the ErrorContext is embedded in the output.
   */
  it('error messages always contain the original error message from context', () => {
    fc.assert(
      fc.property(errorContextArb, (context) => {
        const message = getOperationErrorMessage(context);

        // The original errorMessage must appear in the generated message
        expect(message).toContain(context.errorMessage);
      }),
      { numRuns: 100 },
    );
  });
});

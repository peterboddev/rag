/**
 * Property-based tests for Notification Appropriateness
 * Feature: pdf-processing-enhancement, Property 10: Notification Appropriateness
 *
 * Validates: Requirements 6.1, 6.2, 6.5
 *
 * Properties tested:
 * 1. For any completed document, success notification content is appropriate (has status, no error)
 * 2. For any failed document, failure notification includes error details and retry option when retryable
 * 3. For any processing event, the notification type matches the processing status
 * 4. Retry actions are only available when the error is retryable and retryCount < maxRetries
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import type { ProcessingStatus } from '../src/types/index';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ErrorDetails {
  errorCode: string;
  errorMessage: string;
  errorType: 'validation' | 'textract' | 'processing' | 'system';
  suggestedAction: string;
  isRetryable: boolean;
}

interface NotificationAction {
  label: string;
  type: 'retry' | 'dismiss' | 'view-details' | 'upload-new';
}

interface ProcessingNotification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  documentId: string;
  actions: NotificationAction[];
}

interface DocumentEvent {
  documentId: string;
  fileName: string;
  processingStatus: ProcessingStatus;
  errorMessage?: string;
  errorDetails?: ErrorDetails;
  retryCount: number;
  maxRetries: number;
  processingDurationMs?: number;
  textPreview?: string;
}

// ─── Function Under Test ─────────────────────────────────────────────────────

/**
 * Generates an appropriate notification for a document processing event.
 * This is the core logic that maps processing events to user-facing notifications.
 */
export function generateNotification(event: DocumentEvent): ProcessingNotification {
  const actions: NotificationAction[] = [];

  switch (event.processingStatus) {
    case 'completed':
      return {
        id: `notif-${event.documentId}`,
        type: 'success',
        title: 'Processing Complete',
        message: event.textPreview
          ? `"${event.fileName}" processed successfully. Preview: ${event.textPreview}`
          : `"${event.fileName}" processed successfully.`,
        documentId: event.documentId,
        actions: [{ label: 'View Details', type: 'view-details' }, { label: 'Dismiss', type: 'dismiss' }],
      };

    case 'failed': {
      const canRetry = !!event.errorDetails?.isRetryable && event.retryCount < event.maxRetries;

      if (canRetry) {
        actions.push({ label: 'Retry', type: 'retry' });
      }
      if (!event.errorDetails?.isRetryable) {
        actions.push({ label: 'Upload New Version', type: 'upload-new' });
      }
      actions.push({ label: 'View Details', type: 'view-details' });
      actions.push({ label: 'Dismiss', type: 'dismiss' });

      const reason = event.errorDetails?.errorMessage || event.errorMessage || 'Unknown error';
      const suggestion = event.errorDetails?.suggestedAction || '';

      return {
        id: `notif-${event.documentId}`,
        type: 'error',
        title: 'Processing Failed',
        message: suggestion
          ? `"${event.fileName}" failed: ${reason}. ${suggestion}`
          : `"${event.fileName}" failed: ${reason}.`,
        documentId: event.documentId,
        actions,
      };
    }

    case 'processing':
      return {
        id: `notif-${event.documentId}`,
        type: 'info',
        title: 'Processing Started',
        message: `"${event.fileName}" is being processed.`,
        documentId: event.documentId,
        actions: [{ label: 'Dismiss', type: 'dismiss' }],
      };

    case 'queued':
      return {
        id: `notif-${event.documentId}`,
        type: 'info',
        title: 'Queued for Processing',
        message: `"${event.fileName}" is queued for processing.`,
        documentId: event.documentId,
        actions: [{ label: 'Dismiss', type: 'dismiss' }],
      };
  }
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const nonEmptyStringArb = fc.stringOf(fc.char(), { minLength: 1, maxLength: 40 }).filter(s => s.trim().length > 0);

const errorTypeArb = fc.constantFrom<ErrorDetails['errorType']>('validation', 'textract', 'processing', 'system');

const errorDetailsArb: fc.Arbitrary<ErrorDetails> = fc.record({
  errorCode: nonEmptyStringArb,
  errorMessage: nonEmptyStringArb,
  errorType: errorTypeArb,
  suggestedAction: nonEmptyStringArb,
  isRetryable: fc.boolean(),
});

const completedEventArb: fc.Arbitrary<DocumentEvent> = fc.record({
  documentId: fc.uuid(),
  fileName: nonEmptyStringArb.map(s => s + '.pdf'),
  processingStatus: fc.constant<ProcessingStatus>('completed'),
  retryCount: fc.constant(0),
  maxRetries: fc.integer({ min: 1, max: 5 }),
  processingDurationMs: fc.integer({ min: 100, max: 300_000 }),
  textPreview: fc.option(nonEmptyStringArb, { nil: undefined }),
});

const failedEventArb: fc.Arbitrary<DocumentEvent> = fc.record({
  documentId: fc.uuid(),
  fileName: nonEmptyStringArb.map(s => s + '.pdf'),
  processingStatus: fc.constant<ProcessingStatus>('failed'),
  errorMessage: nonEmptyStringArb,
  errorDetails: errorDetailsArb,
  retryCount: fc.integer({ min: 0, max: 5 }),
  maxRetries: fc.integer({ min: 1, max: 5 }),
});

const anyStatusArb = fc.constantFrom<ProcessingStatus>('queued', 'processing', 'completed', 'failed');

const anyEventArb: fc.Arbitrary<DocumentEvent> = anyStatusArb.chain(status => {
  const base = {
    documentId: fc.uuid(),
    fileName: nonEmptyStringArb.map(s => s + '.pdf'),
    processingStatus: fc.constant(status),
    retryCount: fc.integer({ min: 0, max: 5 }),
    maxRetries: fc.integer({ min: 1, max: 5 }),
  };

  if (status === 'completed') {
    return fc.record({
      ...base,
      processingDurationMs: fc.integer({ min: 100, max: 300_000 }),
      textPreview: fc.option(nonEmptyStringArb, { nil: undefined }),
    });
  }
  if (status === 'failed') {
    return fc.record({
      ...base,
      errorMessage: nonEmptyStringArb,
      errorDetails: errorDetailsArb,
    });
  }
  return fc.record(base);
});

// ─── Property 10: Notification Appropriateness ───────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 10: Notification Appropriateness', () => {
  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any completed document, the notification type is 'success',
   * the message references the file name, and there is no error content.
   */
  it('completed documents produce success notifications with appropriate content', () => {
    fc.assert(
      fc.property(completedEventArb, (event) => {
        const notification = generateNotification(event);

        expect(notification.type).toBe('success');
        expect(notification.title).toBe('Processing Complete');
        expect(notification.message).toContain(event.fileName);
        expect(notification.documentId).toBe(event.documentId);

        // Success notifications should not contain error language
        expect(notification.message.toLowerCase()).not.toContain('failed');
        expect(notification.message.toLowerCase()).not.toContain('error');

        // Should have view-details and dismiss actions
        const actionTypes = notification.actions.map(a => a.type);
        expect(actionTypes).toContain('view-details');
        expect(actionTypes).toContain('dismiss');

        // Should NOT have retry or upload-new actions
        expect(actionTypes).not.toContain('retry');
        expect(actionTypes).not.toContain('upload-new');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2, 6.5**
   *
   * For any failed document, the notification type is 'error',
   * includes error details, and offers retry when retryable.
   */
  it('failed documents produce error notifications with details and retry option when retryable', () => {
    fc.assert(
      fc.property(failedEventArb, (event) => {
        const notification = generateNotification(event);

        expect(notification.type).toBe('error');
        expect(notification.title).toBe('Processing Failed');
        expect(notification.message).toContain(event.fileName);
        expect(notification.documentId).toBe(event.documentId);

        // Error notification should include the error reason
        if (event.errorDetails) {
          expect(notification.message).toContain(event.errorDetails.errorMessage);
        }

        // Check retry action availability
        const actionTypes = notification.actions.map(a => a.type);
        const canRetry = event.errorDetails!.isRetryable && event.retryCount < event.maxRetries;

        if (canRetry) {
          expect(actionTypes).toContain('retry');
        } else {
          expect(actionTypes).not.toContain('retry');
        }

        // Always has view-details and dismiss
        expect(actionTypes).toContain('view-details');
        expect(actionTypes).toContain('dismiss');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any processing event, the notification type matches the processing status:
   * completed → success, failed → error, processing/queued → info
   */
  it('notification type always matches the processing status', () => {
    fc.assert(
      fc.property(anyEventArb, (event) => {
        const notification = generateNotification(event);

        const expectedTypeMap: Record<ProcessingStatus, ProcessingNotification['type']> = {
          completed: 'success',
          failed: 'error',
          processing: 'info',
          queued: 'info',
        };

        expect(notification.type).toBe(expectedTypeMap[event.processingStatus]);
        expect(notification.documentId).toBe(event.documentId);
        expect(notification.message).toContain(event.fileName);
        expect(notification.id).toBeTruthy();
        expect(notification.title).toBeTruthy();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * Retry actions are only available when the error is retryable AND retryCount < maxRetries.
   * When retries are exhausted or error is not retryable, retry action must not appear.
   */
  it('retry action is available only when error is retryable and retries remain', () => {
    // Specifically test the boundary: retryable errors with varying retry counts
    const retryBoundaryArb = fc.record({
      documentId: fc.uuid(),
      fileName: nonEmptyStringArb.map(s => s + '.pdf'),
      processingStatus: fc.constant<ProcessingStatus>('failed'),
      errorMessage: nonEmptyStringArb,
      errorDetails: fc.record({
        errorCode: nonEmptyStringArb,
        errorMessage: nonEmptyStringArb,
        errorType: errorTypeArb,
        suggestedAction: nonEmptyStringArb,
        isRetryable: fc.boolean(),
      }),
      retryCount: fc.integer({ min: 0, max: 10 }),
      maxRetries: fc.integer({ min: 1, max: 5 }),
    });

    fc.assert(
      fc.property(retryBoundaryArb, (event) => {
        const notification = generateNotification(event);
        const actionTypes = notification.actions.map(a => a.type);

        const shouldHaveRetry = event.errorDetails!.isRetryable && event.retryCount < event.maxRetries;

        if (shouldHaveRetry) {
          expect(actionTypes).toContain('retry');
        } else {
          expect(actionTypes).not.toContain('retry');
        }

        // Non-retryable errors should offer upload-new instead
        if (!event.errorDetails!.isRetryable) {
          expect(actionTypes).toContain('upload-new');
        }
      }),
      { numRuns: 100 }
    );
  });
});

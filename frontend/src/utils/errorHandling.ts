/**
 * Error handling utilities for the document selection and summary interface.
 * Pure functions for generating error messages, validating selections,
 * and determining notification types.
 */

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface ErrorContext {
  operation: 'delete' | 'retry' | 'summarize' | 'load' | 'refresh';
  documentName?: string;
  errorMessage: string;
}

export interface ValidationResult {
  valid: boolean;
  warningMessage?: string;
  errorMessage?: string;
}

export interface SuggestedAction {
  label: string;
  description: string;
}

export interface DocumentTextStatus {
  documentId: string;
  hasText: boolean;
  textLength: number;
}

/**
 * Generates a user-friendly error message for document operations.
 */
export function getOperationErrorMessage(context: ErrorContext): string {
  const { operation, documentName, errorMessage } = context;
  
  switch (operation) {
    case 'delete':
      return documentName
        ? `Failed to delete "${documentName}": ${errorMessage}`
        : `Delete operation failed: ${errorMessage}`;
    case 'retry':
      return documentName
        ? `Failed to retry "${documentName}": ${errorMessage}`
        : `Retry operation failed: ${errorMessage}`;
    case 'summarize':
      return `Summarization failed: ${errorMessage}`;
    case 'load':
      return `Failed to load documents: ${errorMessage}`;
    case 'refresh':
      return `Failed to refresh document list: ${errorMessage}`;
    default:
      return `Operation failed: ${errorMessage}`;
  }
}

/**
 * Returns suggested actions for a summarization failure.
 */
export function getSummarizationErrorActions(): SuggestedAction[] {
  return [
    { label: 'Check documents', description: 'Check that selected documents have extractable text' },
    { label: 'Retry failed', description: 'Retry any failed documents before summarizing' },
    { label: 'Reduce selection', description: 'Try selecting fewer documents' },
    { label: 'Wait and retry', description: 'If the issue persists, try again in a few moments' },
  ];
}

/**
 * Determines the notification type based on the operation result.
 */
export function getNotificationType(operation: ErrorContext['operation'], success: boolean): NotificationType {
  if (success) return 'success';
  if (operation === 'summarize') return 'error';
  return 'error';
}

/**
 * Validates whether the selected documents have extractable text.
 * Returns a validation result with appropriate warning/error messages.
 */
export function validateSelectedDocumentsText(
  selectedIds: string[],
  documents: DocumentTextStatus[]
): ValidationResult {
  if (selectedIds.length === 0) {
    return {
      valid: false,
      errorMessage: 'No documents selected for summarization',
    };
  }

  const selectedDocs = documents.filter(doc => selectedIds.includes(doc.documentId));
  const docsWithText = selectedDocs.filter(doc => doc.hasText && doc.textLength > 0);

  if (docsWithText.length === 0) {
    return {
      valid: false,
      errorMessage: 'All selected documents have no extractable text. Please select documents with available text content.',
      warningMessage: 'The selected documents have no text content that can be summarized.',
    };
  }

  const docsWithoutText = selectedDocs.length - docsWithText.length;
  if (docsWithoutText > 0) {
    return {
      valid: true,
      warningMessage: `${docsWithoutText} of ${selectedDocs.length} selected document(s) have no extractable text and will be skipped.`,
    };
  }

  return { valid: true };
}

/**
 * Generates the empty state message for when no documents are found.
 */
export function getEmptyDocumentsMessage(customerEmail: string): string {
  return `No documents found for customer "${customerEmail}". Documents need to be uploaded and processed before they can be summarized.`;
}

/**
 * Generates a success message for document operations.
 */
export function getOperationSuccessMessage(
  operation: 'delete' | 'retry',
  documentName?: string,
  details?: string
): string {
  switch (operation) {
    case 'delete':
      return documentName
        ? `Document "${documentName}" deleted successfully`
        : 'Document deleted successfully';
    case 'retry':
      return details
        ? `Document retry successful. ${details}`
        : 'Document retry successful';
    default:
      return 'Operation completed successfully';
  }
}

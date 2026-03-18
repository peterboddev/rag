/**
 * Document filtering and text quality validation for summary generation.
 * 
 * Filters documents by processing status and text quality before
 * including them in AI-powered summaries. Provides clear exclusion
 * reasons for documents that don't meet inclusion criteria.
 */

import { DocumentRecord, ProcessingStatus } from '../types';

/** Describes a document excluded from summary generation */
export interface ExcludedDocument {
  documentId: string;
  fileName: string;
  reason: string;
  processingStatus: ProcessingStatus;
}

/** Result of filtering documents for summary inclusion */
export interface DocumentFilterResult {
  /** Documents eligible for summary inclusion */
  includedDocuments: DocumentRecord[];
  /** Documents excluded with reasons */
  excludedDocuments: ExcludedDocument[];
}

/** Minimum character length for text to be considered valid */
const MIN_TEXT_LENGTH = 10;

/** Minimum confidence score (0-100) for text to be included */
const MIN_CONFIDENCE_SCORE = 50;

/**
 * Validates whether a document's extracted text meets quality thresholds.
 * 
 * Checks:
 * - Text is non-empty after trimming
 * - Text length is at least MIN_TEXT_LENGTH characters
 * - Confidence score (if available) is above MIN_CONFIDENCE_SCORE
 */
export function validateTextQuality(doc: DocumentRecord): { valid: boolean; reason?: string } {
  if (!doc.extractedText || doc.extractedText.trim().length === 0) {
    return { valid: false, reason: 'No extracted text available' };
  }

  if (doc.extractedText.trim().length < MIN_TEXT_LENGTH) {
    return { valid: false, reason: `Extracted text too short (${doc.extractedText.trim().length} chars, minimum ${MIN_TEXT_LENGTH})` };
  }

  const confidence = doc.processingMetadata?.confidence;
  if (confidence !== undefined && confidence !== null && confidence < MIN_CONFIDENCE_SCORE) {
    return { valid: false, reason: `Text confidence too low (${confidence}%, minimum ${MIN_CONFIDENCE_SCORE}%)` };
  }

  return { valid: true };
}

/**
 * Filters documents for summary generation based on processing status
 * and text quality. Only documents with status 'completed' and valid
 * text are included. All others are returned with exclusion reasons.
 */
export function filterDocumentsForSummary(documents: DocumentRecord[]): DocumentFilterResult {
  const includedDocuments: DocumentRecord[] = [];
  const excludedDocuments: ExcludedDocument[] = [];

  for (const doc of documents) {
    // Check processing status first
    if (doc.processingStatus !== 'completed') {
      const statusReasons: Record<string, string> = {
        queued: 'Document is queued for processing',
        processing: 'Document is still being processed',
        failed: 'Document processing failed',
      };
      excludedDocuments.push({
        documentId: doc.documentId,
        fileName: doc.fileName,
        reason: statusReasons[doc.processingStatus] || `Unexpected status: ${doc.processingStatus}`,
        processingStatus: doc.processingStatus,
      });
      continue;
    }

    // Validate text quality
    const quality = validateTextQuality(doc);
    if (!quality.valid) {
      excludedDocuments.push({
        documentId: doc.documentId,
        fileName: doc.fileName,
        reason: quality.reason!,
        processingStatus: doc.processingStatus,
      });
      continue;
    }

    includedDocuments.push(doc);
  }

  return { includedDocuments, excludedDocuments };
}

/**
 * Checks whether the summary cache should be invalidated based on
 * document update timestamps. If any document's updatedAt is newer
 * than the cache timestamp, the cache is stale.
 */
export function isCacheStale(documents: DocumentRecord[], cacheTimestamp: number): boolean {
  return documents.some(doc => {
    const docUpdatedAt = new Date(doc.updatedAt).getTime();
    return docUpdatedAt > cacheTimestamp;
  });
}

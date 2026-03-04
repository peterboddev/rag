import { DocumentRecord } from '../types';
import { TokenEstimationService } from './token-estimation';

/**
 * Service for prioritizing documents and extracting key content
 * Handles document ranking and token allocation based on importance
 */
export class ContentPrioritizationService {
  private tokenEstimator: TokenEstimationService;

  constructor() {
    this.tokenEstimator = new TokenEstimationService();
  }

  /**
   * Prioritize documents based on various criteria
   */
  prioritizeDocuments(
    documents: DocumentRecord[],
    criteria: PrioritizationCriteria
  ): DocumentPriority[] {
    const priorities: DocumentPriority[] = [];
    
    // Calculate scores for each document
    for (const doc of documents) {
      const priority = this.calculateDocumentPriority(doc, criteria);
      priorities.push(priority);
    }
    
    // Sort by priority (higher scores first), with document ID as tiebreaker
    priorities.sort((a, b) => {
      if (Math.abs(a.priority - b.priority) < 0.001) {
        // If priorities are essentially equal, use document ID as tiebreaker
        return a.documentId.localeCompare(b.documentId);
      }
      return b.priority - a.priority;
    });
    
    console.log('Document prioritization completed', {
      documentCount: documents.length,
      criteria,
      topDocument: priorities[0]?.documentId,
      topPriority: priorities[0]?.priority
    });
    
    return priorities;
  }

  /**
   * Extract key content from a document within token limits
   */
  extractKeyContent(
    document: DocumentRecord,
    tokenLimit: number
  ): KeyContentExtract {
    const text = document.extractedText || '';
    
    if (!text || text.trim().length === 0) {
      return {
        documentId: document.id,
        fileName: document.fileName,
        keyContent: '',
        metadata: this.extractDocumentMetadata(document),
        contentSummary: 'No text content available',
        tokenUsage: 0
      };
    }
    
    const estimatedTokens = this.tokenEstimator.estimateTokens(text);
    
    // If document fits within limit, return full content
    if (estimatedTokens <= tokenLimit) {
      return {
        documentId: document.id,
        fileName: document.fileName,
        keyContent: text,
        metadata: this.extractDocumentMetadata(document),
        contentSummary: this.generateContentSummary(text),
        tokenUsage: estimatedTokens
      };
    }
    
    // Extract key sections for restrictive limits
    if (tokenLimit < 200) {
      return this.extractMetadataOnly(document, tokenLimit);
    }
    
    // Extract beginning and key excerpts
    const keyContent = this.extractKeyExcerpts(text, tokenLimit);
    
    return {
      documentId: document.id,
      fileName: document.fileName,
      keyContent,
      metadata: this.extractDocumentMetadata(document),
      contentSummary: this.generateContentSummary(keyContent),
      tokenUsage: this.tokenEstimator.estimateTokens(keyContent)
    };
  }

  /**
   * Calculate priority score for a document
   */
  private calculateDocumentPriority(
    document: DocumentRecord,
    criteria: PrioritizationCriteria
  ): DocumentPriority {
    let score = 0;
    const reasoning: string[] = [];
    
    // Recency score (newer documents get higher scores)
    const recencyScore = this.calculateRecencyScore(document.createdAt);
    score += recencyScore * criteria.recencyWeight;
    if (recencyScore > 0.7) {
      reasoning.push('recent document');
    }
    
    // Size score (moderate size documents often contain more useful content)
    const sizeScore = this.calculateSizeScore(document.extractedText?.length || 0);
    score += sizeScore * criteria.sizeWeight;
    if (sizeScore > 0.8) {
      reasoning.push('optimal content length');
    }
    
    // Content type score (some types may be more important)
    const contentTypeScore = this.calculateContentTypeScore(document.contentType);
    score += contentTypeScore * criteria.contentTypeWeight;
    if (contentTypeScore > 0.8) {
      reasoning.push('high-value content type');
    }
    
    // Processing quality score (well-processed documents are more reliable)
    const qualityScore = this.calculateProcessingQualityScore(document);
    score += qualityScore * criteria.processingQualityWeight;
    if (qualityScore > 0.8) {
      reasoning.push('high processing quality');
    }
    
    // Calculate recommended tokens based on priority
    const baseTokens = 200;
    const priorityMultiplier = Math.max(0.5, Math.min(2.0, score));
    const recommendedTokens = Math.floor(baseTokens * priorityMultiplier);
    
    return {
      documentId: document.id,
      priority: Math.round(score * 1000) / 1000, // Use 3 decimal places for better precision
      reasoning: reasoning.join(', ') || 'standard priority',
      recommendedTokens
    };
  }

  /**
   * Calculate recency score (0-1) based on document creation date
   */
  private calculateRecencyScore(createdAt: string): number {
    const now = new Date();
    const created = new Date(createdAt);
    const daysDiff = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    
    // Score decreases over time, with 1.0 for today, 0.5 for 30 days ago
    if (daysDiff <= 1) return 1.0;
    if (daysDiff <= 7) return 0.9;
    if (daysDiff <= 30) return 0.7;
    if (daysDiff <= 90) return 0.5;
    if (daysDiff <= 365) return 0.3;
    return 0.1;
  }

  /**
   * Calculate size score (0-1) based on content length
   */
  private calculateSizeScore(textLength: number): number {
    if (textLength === 0) return 0;
    
    // Optimal range is 1000-5000 characters
    if (textLength >= 1000 && textLength <= 5000) return 1.0;
    if (textLength >= 500 && textLength <= 10000) return 0.8;
    if (textLength >= 100 && textLength <= 20000) return 0.6;
    if (textLength < 100) return 0.2;
    return 0.4; // Very large documents
  }

  /**
   * Calculate content type score (0-1) based on file type
   */
  private calculateContentTypeScore(contentType: string): number {
    switch (contentType) {
      case 'application/pdf':
        return 0.9; // PDFs often contain structured, important content
      case 'application/msword':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return 0.8; // Word documents are typically well-structured
      case 'text/plain':
        return 0.7; // Plain text is reliable but may lack structure
      case 'image/jpeg':
      case 'image/png':
      case 'image/tiff':
        return 0.6; // Images depend on OCR quality
      default:
        return 0.5;
    }
  }

  /**
   * Calculate processing quality score (0-1) based on processing metadata
   */
  private calculateProcessingQualityScore(document: DocumentRecord): number {
    if (document.processingStatus !== 'completed') {
      return 0;
    }
    
    let score = 0.5; // Base score for completed processing
    
    // Confidence score
    const confidence = document.processingMetadata?.confidence || 0;
    score += (confidence / 100) * 0.3;
    
    // Text content availability
    if (document.extractedText && document.extractedText.length > 0) {
      score += 0.2;
    }
    
    // No errors
    if (!document.errorMessage && !document.processingMetadata?.errorDetails) {
      score += 0.1;
    }
    
    // Processing duration (faster processing often indicates simpler, cleaner documents)
    const processingTime = document.processingMetadata?.processingDurationMs || 0;
    if (processingTime > 0 && processingTime < 30000) { // Less than 30 seconds
      score += 0.1;
    }
    
    return Math.min(1.0, score);
  }

  /**
   * Extract document metadata for restrictive token limits
   */
  private extractMetadataOnly(document: DocumentRecord, tokenLimit: number): KeyContentExtract {
    const metadata = this.extractDocumentMetadata(document);
    const metadataText = `Document: ${document.fileName}\nType: ${document.contentType}\nCreated: ${document.createdAt}\nStatus: ${document.processingStatus}`;
    
    // Add brief text preview if tokens allow
    let content = metadataText;
    const metadataTokens = this.tokenEstimator.estimateTokens(metadataText);
    const remainingTokens = tokenLimit - metadataTokens;
    
    if (remainingTokens > 20 && document.extractedText) {
      const preview = document.extractedText.substring(0, remainingTokens * 3); // Rough character estimate
      content += `\nPreview: ${preview}...`;
    }
    
    return {
      documentId: document.id,
      fileName: document.fileName,
      keyContent: content,
      metadata,
      contentSummary: 'Metadata only due to token constraints',
      tokenUsage: this.tokenEstimator.estimateTokens(content)
    };
  }

  /**
   * Extract key excerpts from text within token limits
   */
  private extractKeyExcerpts(text: string, tokenLimit: number): string {
    // Simple approach: take beginning and end portions
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    
    // If very few sentences, truncate by character count
    if (sentences.length <= 2) {
      const maxChars = tokenLimit * 4; // Rough character limit
      if (text.length <= maxChars) {
        return text;
      }
      return text.substring(0, maxChars) + '...';
    }
    
    // Reserve tokens for truncation marker
    const truncationMarker = '\n[...content truncated...]\n';
    const truncationTokens = this.tokenEstimator.estimateTokens(truncationMarker);
    const availableTokens = tokenLimit - truncationTokens;
    
    const beginningTokens = Math.floor(availableTokens * 0.7);
    const endTokens = availableTokens - beginningTokens;
    
    let beginning = '';
    let beginningCurrentTokens = 0;
    
    for (const sentence of sentences) {
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      if (beginningCurrentTokens + sentenceTokens <= beginningTokens) {
        beginning += sentence + ' ';
        beginningCurrentTokens += sentenceTokens;
      } else {
        break;
      }
    }
    
    let ending = '';
    let endingCurrentTokens = 0;
    
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentence = sentences[i];
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      if (endingCurrentTokens + sentenceTokens <= endTokens) {
        ending = sentence + ' ' + ending;
        endingCurrentTokens += sentenceTokens;
      } else {
        break;
      }
    }
    
    // If we extracted content from both beginning and end, add truncation marker
    if (beginning.trim() && ending.trim()) {
      return beginning.trim() + truncationMarker + ending.trim();
    }
    
    // If only beginning was extracted, return it
    return beginning.trim() || ending.trim();
  }

  /**
   * Extract document metadata
   */
  private extractDocumentMetadata(document: DocumentRecord): Record<string, any> {
    return {
      fileName: document.fileName,
      contentType: document.contentType,
      createdAt: document.createdAt,
      processingStatus: document.processingStatus,
      textLength: document.textLength || 0,
      pageCount: document.processingMetadata?.pageCount || 1,
      confidence: document.processingMetadata?.confidence || 0,
      hasErrors: !!(document.errorMessage || document.processingMetadata?.errorDetails)
    };
  }

  /**
   * Generate a brief content summary
   */
  private generateContentSummary(text: string): string {
    if (!text || text.length === 0) {
      return 'No content';
    }
    
    const words = text.split(/\s+/).length;
    const sentences = text.split(/[.!?]+/).length;
    
    return `${words} words, ${sentences} sentences`;
  }
}

export interface PrioritizationCriteria {
  recencyWeight: number;
  sizeWeight: number;
  contentTypeWeight: number;
  processingQualityWeight: number;
}

export interface DocumentPriority {
  documentId: string;
  priority: number;
  reasoning: string;
  recommendedTokens: number;
}

export interface KeyContentExtract {
  documentId: string;
  fileName: string;
  keyContent: string;
  metadata: Record<string, any>;
  contentSummary: string;
  tokenUsage: number;
}
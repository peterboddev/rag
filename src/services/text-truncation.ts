import { DocumentRecord } from '../types';
import { TokenEstimationService } from './token-estimation';

/**
 * Service for intelligently truncating text content to fit within token limits
 * Preserves sentence boundaries and provides truncation indicators
 */
export class TextTruncationService {
  private tokenEstimator: TokenEstimationService;

  constructor() {
    this.tokenEstimator = new TokenEstimationService();
  }

  /**
   * Truncate text to fit within token limit using specified strategy
   */
  truncateToTokenLimit(
    text: string, 
    tokenLimit: number,
    strategy: TruncationStrategy = TruncationStrategy.BEGINNING_AND_END
  ): TruncatedText {
    if (!text || text.trim().length === 0) {
      return {
        content: '',
        originalLength: 0,
        truncatedLength: 0,
        truncationPoints: [],
        preservedSentences: 0
      };
    }

    const originalLength = text.length;
    const estimatedTokens = this.tokenEstimator.estimateTokens(text);
    
    // If text already fits, return as-is
    if (estimatedTokens <= tokenLimit) {
      return {
        content: text,
        originalLength,
        truncatedLength: originalLength,
        truncationPoints: [],
        preservedSentences: this.countSentences(text)
      };
    }

    console.log('Truncating text', {
      originalLength,
      estimatedTokens,
      tokenLimit,
      strategy
    });

    let truncatedContent: string;
    let truncationPoints: TruncationPoint[] = [];

    switch (strategy) {
      case TruncationStrategy.BEGINNING_ONLY:
        ({ content: truncatedContent, truncationPoints } = this.truncateFromBeginning(text, tokenLimit));
        break;
      case TruncationStrategy.BEGINNING_AND_END:
        ({ content: truncatedContent, truncationPoints } = this.truncateBeginningAndEnd(text, tokenLimit));
        break;
      case TruncationStrategy.SMART_EXCERPT:
        ({ content: truncatedContent, truncationPoints } = this.extractSmartExcerpt(text, tokenLimit));
        break;
      case TruncationStrategy.PROPORTIONAL:
        ({ content: truncatedContent, truncationPoints } = this.truncateProportionally(text, tokenLimit));
        break;
      default:
        ({ content: truncatedContent, truncationPoints } = this.truncateBeginningAndEnd(text, tokenLimit));
    }

    return {
      content: truncatedContent,
      originalLength,
      truncatedLength: truncatedContent.length,
      truncationPoints,
      preservedSentences: this.countSentences(truncatedContent)
    };
  }

  /**
   * Truncate multiple documents according to token distribution
   */
  truncateMultipleDocuments(
    documents: DocumentRecord[],
    tokenDistribution: Map<string, number>
  ): Map<string, TruncatedText> {
    const results = new Map<string, TruncatedText>();
    
    for (const doc of documents) {
      const allocatedTokens = tokenDistribution.get(doc.id) || 0;
      const text = doc.extractedText || '';
      
      if (allocatedTokens > 0 && text.length > 0) {
        const truncated = this.truncateToTokenLimit(
          text, 
          allocatedTokens, 
          TruncationStrategy.BEGINNING_AND_END
        );
        results.set(doc.id, truncated);
      } else {
        // Document gets no tokens or has no content
        results.set(doc.id, {
          content: '',
          originalLength: text.length,
          truncatedLength: 0,
          truncationPoints: [],
          preservedSentences: 0
        });
      }
    }
    
    console.log('Multi-document truncation completed', {
      documentCount: documents.length,
      totalAllocatedTokens: Array.from(tokenDistribution.values()).reduce((sum, tokens) => sum + tokens, 0),
      documentsWithContent: Array.from(results.values()).filter(r => r.content.length > 0).length
    });
    
    return results;
  }

  /**
   * Truncate from beginning only, preserving sentence boundaries
   */
  private truncateFromBeginning(text: string, tokenLimit: number): { content: string; truncationPoints: TruncationPoint[] } {
    const sentences = this.splitIntoSentences(text);
    let content = '';
    let currentTokens = 0;
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      
      if (currentTokens + sentenceTokens <= tokenLimit) {
        content += sentence;
        currentTokens += sentenceTokens;
      } else {
        // Add truncation indicator
        if (i < sentences.length - 1) {
          content += '\n\n[Content truncated - additional text omitted]';
        }
        break;
      }
    }
    
    const truncationPoints: TruncationPoint[] = content.includes('[Content truncated') ? 
      [{ position: content.indexOf('[Content truncated'), type: 'end_truncation' }] : [];
    
    return { content, truncationPoints };
  }

  /**
   * Truncate from beginning and end, preserving most important content
   */
  private truncateBeginningAndEnd(text: string, tokenLimit: number): { content: string; truncationPoints: TruncationPoint[] } {
    const sentences = this.splitIntoSentences(text);
    
    if (sentences.length <= 2) {
      return this.truncateFromBeginning(text, tokenLimit);
    }
    
    // Reserve tokens for beginning and end
    const beginningTokens = Math.floor(tokenLimit * 0.6);
    const endTokens = Math.floor(tokenLimit * 0.3);
    const indicatorTokens = tokenLimit - beginningTokens - endTokens;
    
    // Get beginning content
    let beginningContent = '';
    let beginningCurrentTokens = 0;
    let beginningEndIndex = 0;
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      
      if (beginningCurrentTokens + sentenceTokens <= beginningTokens) {
        beginningContent += sentence;
        beginningCurrentTokens += sentenceTokens;
        beginningEndIndex = i;
      } else {
        break;
      }
    }
    
    // Get ending content
    let endingContent = '';
    let endingCurrentTokens = 0;
    let endingStartIndex = sentences.length;
    
    for (let i = sentences.length - 1; i > beginningEndIndex; i--) {
      const sentence = sentences[i];
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      
      if (endingCurrentTokens + sentenceTokens <= endTokens) {
        endingContent = sentence + endingContent;
        endingCurrentTokens += sentenceTokens;
        endingStartIndex = i;
      } else {
        break;
      }
    }
    
    // Combine with truncation indicator
    const truncationIndicator = '\n\n[Content truncated - middle section omitted]\n\n';
    const content = beginningContent + truncationIndicator + endingContent;
    
    const truncationPoints: TruncationPoint[] = [{
      position: beginningContent.length,
      type: 'middle_truncation'
    }];
    
    return { content, truncationPoints };
  }

  /**
   * Extract smart excerpt focusing on most relevant content
   */
  private extractSmartExcerpt(text: string, tokenLimit: number): { content: string; truncationPoints: TruncationPoint[] } {
    // For now, use beginning and end strategy
    // TODO: Implement more sophisticated content analysis
    return this.truncateBeginningAndEnd(text, tokenLimit);
  }

  /**
   * Truncate proportionally across the document
   */
  private truncateProportionally(text: string, tokenLimit: number): { content: string; truncationPoints: TruncationPoint[] } {
    const sentences = this.splitIntoSentences(text);
    const totalSentences = sentences.length;
    
    if (totalSentences <= 3) {
      return this.truncateFromBeginning(text, tokenLimit);
    }
    
    // Calculate how many sentences we can keep
    const avgTokensPerSentence = this.tokenEstimator.estimateTokens(text) / totalSentences;
    const maxSentences = Math.floor(tokenLimit / avgTokensPerSentence);
    
    if (maxSentences >= totalSentences) {
      return { content: text, truncationPoints: [] };
    }
    
    // Select sentences proportionally across the document
    const step = totalSentences / maxSentences;
    let content = '';
    const truncationPoints: TruncationPoint[] = [];
    
    for (let i = 0; i < maxSentences; i++) {
      const sentenceIndex = Math.floor(i * step);
      if (sentenceIndex < sentences.length) {
        if (i > 0 && sentenceIndex > Math.floor((i - 1) * step) + 1) {
          content += '\n[...]\n';
          truncationPoints.push({
            position: content.length - 6,
            type: 'section_skip'
          });
        }
        content += sentences[sentenceIndex];
      }
    }
    
    return { content, truncationPoints };
  }

  /**
   * Split text into sentences while preserving boundaries
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting - can be enhanced with more sophisticated NLP
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .filter(sentence => sentence.trim().length > 0)
      .map(sentence => sentence.trim() + (sentence.endsWith('.') || sentence.endsWith('!') || sentence.endsWith('?') ? '' : '.') + ' ');
    
    return sentences;
  }

  /**
   * Count sentences in text
   */
  private countSentences(text: string): number {
    return this.splitIntoSentences(text).length;
  }

  /**
   * Add truncation indicators to inform AI model
   */
  addTruncationIndicators(content: string, truncationInfo: TruncationInfo): string {
    if (truncationInfo.documentsTruncated === 0) {
      return content;
    }
    
    const indicator = `\n\n[IMPORTANT: This content has been truncated. Original content was ${truncationInfo.totalOriginalTokens} tokens, processed to ${truncationInfo.totalProcessedTokens} tokens. ${truncationInfo.documentsTruncated} of ${truncationInfo.documentsProcessed} documents were truncated to fit within token limits.]\n\n`;
    
    return indicator + content;
  }
}

export enum TruncationStrategy {
  BEGINNING_AND_END = 'beginning_and_end',
  BEGINNING_ONLY = 'beginning_only',
  SMART_EXCERPT = 'smart_excerpt',
  PROPORTIONAL = 'proportional'
}

export interface TruncatedText {
  content: string;
  originalLength: number;
  truncatedLength: number;
  truncationPoints: TruncationPoint[];
  preservedSentences: number;
}

export interface TruncationPoint {
  position: number;
  type: 'beginning_truncation' | 'middle_truncation' | 'end_truncation' | 'section_skip';
}

export interface TruncationInfo {
  documentsProcessed: number;
  documentsTruncated: number;
  totalOriginalTokens: number;
  totalProcessedTokens: number;
  truncationStrategy: TruncationStrategy;
  truncationDetails: DocumentTruncationDetail[];
}

export interface DocumentTruncationDetail {
  documentId: string;
  fileName: string;
  originalTokens: number;
  processedTokens: number;
  truncationPercentage: number;
  contentPreserved: string[];
}
import { DocumentRecord } from '../types';

/**
 * Service for estimating token counts and managing token distribution
 * Uses conservative 4:1 character-to-token ratio as specified in requirements
 */
export class TokenEstimationService {
  private readonly DEFAULT_CHAR_TO_TOKEN_RATIO = 4;
  private readonly PROMPT_OVERHEAD_TOKENS = 150; // Conservative estimate for system prompts
  private readonly MIN_CONTENT_TOKENS = 50; // Minimum tokens to reserve for content

  /**
   * Estimate token count for text content using conservative ratio
   */
  estimateTokens(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }
    
    // Use conservative 4:1 character-to-token ratio
    const estimatedTokens = Math.ceil(text.length / this.DEFAULT_CHAR_TO_TOKEN_RATIO);
    
    console.log('Token estimation', {
      textLength: text.length,
      estimatedTokens,
      ratio: this.DEFAULT_CHAR_TO_TOKEN_RATIO
    });
    
    return estimatedTokens;
  }

  /**
   * Calculate available tokens for content after accounting for prompt overhead
   */
  calculateAvailableTokens(maxTokens: number, promptOverhead?: number): number {
    const overhead = promptOverhead || this.PROMPT_OVERHEAD_TOKENS;
    const availableTokens = Math.max(this.MIN_CONTENT_TOKENS, maxTokens - overhead);
    
    console.log('Available tokens calculation', {
      maxTokens,
      promptOverhead: overhead,
      availableTokens,
      utilizationPercentage: (availableTokens / maxTokens) * 100
    });
    
    return availableTokens;
  }

  /**
   * Distribute tokens across multiple documents based on length and optional weights
   */
  distributeTokens(
    documents: DocumentRecord[], 
    totalTokens: number,
    weights?: Map<string, number>
  ): Map<string, number> {
    if (documents.length === 0) {
      return new Map();
    }

    const distribution = new Map<string, number>();
    
    // Calculate base weights from document text lengths
    const documentLengths = new Map<string, number>();
    let totalLength = 0;
    
    for (const doc of documents) {
      const textLength = doc.extractedText?.length || 0;
      documentLengths.set(doc.id, textLength);
      totalLength += textLength;
    }
    
    // If no text content, distribute equally
    if (totalLength === 0) {
      const tokensPerDoc = Math.floor(totalTokens / documents.length);
      for (const doc of documents) {
        distribution.set(doc.id, tokensPerDoc);
      }
      return distribution;
    }
    
    // Calculate weighted distribution
    let remainingTokens = totalTokens;
    const processedDocs = new Set<string>();
    
    for (const doc of documents) {
      if (processedDocs.size === documents.length - 1) {
        // Give remaining tokens to last document
        distribution.set(doc.id, remainingTokens);
        break;
      }
      
      const baseWeight = documentLengths.get(doc.id)! / totalLength;
      const customWeight = weights?.get(doc.id) || 1.0;
      const finalWeight = baseWeight * customWeight;
      
      const allocatedTokens = Math.max(
        this.MIN_CONTENT_TOKENS, 
        Math.floor(totalTokens * finalWeight)
      );
      
      distribution.set(doc.id, allocatedTokens);
      remainingTokens -= allocatedTokens;
      processedDocs.add(doc.id);
    }
    
    console.log('Token distribution completed', {
      totalTokens,
      documentCount: documents.length,
      distribution: Array.from(distribution.entries()),
      hasCustomWeights: weights !== undefined
    });
    
    return distribution;
  }

  /**
   * Get token usage information for monitoring and reporting
   */
  getTokenUsageInfo(
    maxTokensAllowed: number,
    tokensUsed: number,
    promptOverhead: number
  ): TokenUsageInfo {
    const contentTokens = tokensUsed - promptOverhead;
    const utilizationPercentage = (tokensUsed / maxTokensAllowed) * 100;
    
    return {
      maxTokensAllowed,
      tokensUsed,
      promptOverhead,
      contentTokens,
      utilizationPercentage: Math.round(utilizationPercentage * 100) / 100
    };
  }

  /**
   * Check if content fits within token limit
   */
  fitsWithinLimit(text: string, tokenLimit: number): boolean {
    const estimatedTokens = this.estimateTokens(text);
    return estimatedTokens <= tokenLimit;
  }

  /**
   * Get conservative token estimate (err on the side of caution)
   */
  getConservativeEstimate(text: string): number {
    // Use slightly more conservative ratio for uncertain scenarios
    const conservativeRatio = 3.5;
    return Math.ceil(text.length / conservativeRatio);
  }
}

export interface TokenUsageInfo {
  maxTokensAllowed: number;
  tokensUsed: number;
  promptOverhead: number;
  contentTokens: number;
  utilizationPercentage: number;
}
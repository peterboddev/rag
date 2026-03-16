/**
 * Claim Summary Types
 *
 * Type definitions for the AI-powered claim summarization feature.
 * Supports three summarization strategies: Full Context, RAG, and Graph RAG.
 *
 * @module claim-summary
 */

/**
 * Valid summarization strategies for claim summary generation.
 * - `full-context`: Passes all document text directly to the LLM
 * - `rag`: Uses Knowledge Base retrieval with configurable chunking
 * - `graph-rag`: Uses knowledge graph for entity-relationship-aware retrieval
 */
export type SummaryStrategy = 'full-context' | 'rag' | 'graph-rag';

/**
 * Valid chunking methods for RAG-based summarization.
 * - `full-document`: Treats each document as a single chunk
 * - `semantic`: Splits documents into semantically coherent segments
 */
export type ChunkingMethod = 'full-document' | 'semantic';

/**
 * Severity levels for detected data anomalies.
 * - `critical`: Severe issues requiring immediate attention (e.g., impossible dates)
 * - `warning`: Potential issues that should be reviewed (e.g., unusual patterns)
 * - `info`: Informational findings that may be worth noting
 */
export type AnomalySeverity = 'critical' | 'warning' | 'info';

/**
 * Request payload for generating a claim summary.
 *
 * @example
 * ```typescript
 * const request: ClaimSummaryRequest = {
 *   strategy: 'rag',
 *   chunkingMethod: 'semantic',
 *   forceRegenerate: false,
 *   includeEvaluation: true
 * };
 * ```
 */
export interface ClaimSummaryRequest {
  /**
   * The summarization strategy to use.
   * Determines how documents are processed before being sent to the LLM.
   */
  strategy: SummaryStrategy;

  /**
   * The chunking method to use when strategy is 'rag'.
   * Only applicable when strategy is 'rag'.
   */
  chunkingMethod?: ChunkingMethod;

  /**
   * Whether to bypass the cache and generate a fresh summary.
   * When true, a new summary is generated even if a cached version exists.
   * @default false
   */
  forceRegenerate?: boolean;

  /**
   * Whether to include evaluation scores in the response.
   * When true, the response will include helpfulness, faithfulness,
   * and completeness scores from AgentCore Evaluations.
   * @default false
   */
  includeEvaluation?: boolean;
}

/**
 * Response payload containing the generated claim summary.
 *
 * @example
 * ```typescript
 * const response: ClaimSummaryResponse = {
 *   summary: "This claim contains 4 documents for patient John Doe...",
 *   anomalies: [],
 *   strategy: "rag",
 *   chunkingMethod: "semantic",
 *   documentCount: 4,
 *   processingTime: 2345,
 *   generatedAt: "2024-01-15T10:30:00Z",
 *   cached: false
 * };
 * ```
 */
export interface ClaimSummaryResponse {
  /**
   * The AI-generated summary text describing the claim contents.
   */
  summary: string;

  /**
   * Array of detected data anomalies in the claim documents.
   * Anomalies are placed before the summary to emphasize their importance.
   */
  anomalies: DataAnomaly[];

  /**
   * The summarization strategy that was used.
   */
  strategy: string;

  /**
   * The chunking method that was used (only present for RAG strategy).
   */
  chunkingMethod?: string;

  /**
   * The number of documents that were included in the summary.
   */
  documentCount: number;

  /**
   * The time taken to generate the summary in milliseconds.
   */
  processingTime: number;

  /**
   * ISO 8601 timestamp of when the summary was originally generated.
   */
  generatedAt: string;

  /**
   * Whether this response was served from cache.
   */
  cached: boolean;

  /**
   * ISO 8601 timestamp of when the cached summary was retrieved.
   * Only present when `cached` is true.
   */
  cachedAt?: string;

  /**
   * Evaluation scores for the summary quality.
   * Only present when `includeEvaluation` was true in the request.
   */
  evaluation?: EvaluationScores;
}

/**
 * Represents a data anomaly detected in claim documents.
 * Anomalies include chronological impossibilities, contradictory information,
 * and unrealistic data patterns.
 *
 * @example
 * ```typescript
 * const anomaly: DataAnomaly = {
 *   description: "Service date precedes patient birth date",
 *   severity: "critical",
 *   sourceDocument: "CMS1500_claim_001.pdf",
 *   dataValues: {
 *     serviceDate: "2024-01-15",
 *     birthDate: "2024-06-01"
 *   }
 * };
 * ```
 */
export interface DataAnomaly {
  /**
   * Human-readable description of the anomaly.
   */
  description: string;

  /**
   * Severity level of the anomaly.
   * - `critical`: Severe issues (e.g., impossible dates)
   * - `warning`: Potential issues to review
   * - `info`: Informational findings
   */
  severity: AnomalySeverity;

  /**
   * The name of the source document where the anomaly was detected.
   */
  sourceDocument: string;

  /**
   * Key-value pairs of the specific data values involved in the anomaly.
   * Contains the actual values that caused the anomaly to be flagged.
   */
  dataValues: Record<string, string>;
}

/**
 * Evaluation scores for summary quality assessment.
 * Scores are computed by AgentCore Evaluations using LLM-as-a-Judge.
 * All scores are on a 0-1 scale where higher is better.
 *
 * @example
 * ```typescript
 * const scores: EvaluationScores = {
 *   helpfulness: 0.92,
 *   faithfulness: 0.95,
 *   completeness: 0.87,
 *   anomalyAccuracy: 1.0,
 *   evaluatedAt: "2024-01-15T10:30:05Z"
 * };
 * ```
 */
export interface EvaluationScores {
  /**
   * Score measuring how helpful the summary is for claims review.
   * Computed by the built-in Helpfulness evaluator.
   * Range: 0-1 (higher is better)
   */
  helpfulness: number;

  /**
   * Score measuring how accurately the summary reflects source documents.
   * Penalizes hallucinations and unsupported claims.
   * Range: 0-1 (higher is better)
   */
  faithfulness: number;

  /**
   * Score measuring coverage of key claim elements.
   * Checks for patient info, diagnosis, procedures, dates, provider, amounts.
   * Range: 0-1 (higher is better)
   */
  completeness: number;

  /**
   * Score measuring accuracy of detected anomalies.
   * Only present when anomalies were detected in the documents.
   * Range: 0-1 (higher is better)
   */
  anomalyAccuracy?: number;

  /**
   * ISO 8601 timestamp of when the evaluation was performed.
   */
  evaluatedAt: string;
}

/**
 * Cached summary metadata stored in the Summary_Cache_Table.
 * The actual summary content is stored in S3 at the path specified by `s3Key`.
 *
 * @example
 * ```typescript
 * const cached: CachedSummary = {
 *   cacheKey: "claim-001#rag#semantic",
 *   s3Key: "summaries/claim-001/rag/semantic.json",
 *   strategy: "rag",
 *   chunkingMethod: "semantic",
 *   documentCount: 4,
 *   documentIds: ["doc-1", "doc-2", "doc-3", "doc-4"],
 *   processingTime: 2345,
 *   generatedAt: "2024-01-15T10:30:00Z",
 *   ttl: 1705488600
 * };
 * ```
 */
export interface CachedSummary {
  /**
   * Composite cache key in format: `{claimId}#{strategy}#{chunkingMethod}`.
   * Used as the partition key in Summary_Cache_Table.
   */
  cacheKey: string;

  /**
   * S3 object key where the full summary content is stored.
   * Format: `summaries/{claimId}/{strategy}/{chunkingMethod}.json`
   */
  s3Key: string;

  /**
   * The summarization strategy that was used.
   */
  strategy: string;

  /**
   * The chunking method that was used (only present for RAG strategy).
   */
  chunkingMethod?: string;

  /**
   * The number of documents that were included in the summary.
   */
  documentCount: number;

  /**
   * Array of document IDs that were included in the summary.
   * Used to detect when documents have changed and cache should be invalidated.
   */
  documentIds: string[];

  /**
   * The time taken to generate the summary in milliseconds.
   */
  processingTime: number;

  /**
   * ISO 8601 timestamp of when the summary was generated.
   */
  generatedAt: string;

  /**
   * Cached evaluation scores for the summary.
   * Only present if evaluation was performed.
   */
  evaluation?: EvaluationScores;

  /**
   * DynamoDB TTL value as Unix timestamp (seconds since epoch).
   * The cache entry will be automatically deleted after this time.
   */
  ttl: number;
}

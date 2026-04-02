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
 * - `enriched`: Combines Full Context, RAG, and Graph RAG sources into a single deduplicated context
 */
export type SummaryStrategy = 'full-context' | 'rag' | 'graph-rag' | 'enriched';

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
 * Prompt metadata for transparency into LLM invocations.
 * Contains the prompt template (with documents replaced by a placeholder),
 * the strategy label, and the optional retrieval query.
 */
export interface PromptInfo {
  /** The full prompt template with "[DOCUMENTS]" placeholder instead of actual document text */
  promptTemplate: string;
  /** The strategy label string embedded in the prompt */
  strategyLabel: string;
  /** The retrieval query sent to KB Retrieve API (rag and graph-rag only) */
  retrievalQuery?: string;
}

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

  /**
   * When true and strategy is 'rag' or 'graph-rag', enables Cohere Rerank 3.5 on retrieval results.
   * @default false
   */
  useReranker?: boolean;

  /**
   * The Bedrock model ID to use for summarization.
   * @default 'amazon.nova-pro-v1:0'
   */
  modelId?: string;

  /**
   * Custom prompt template to use instead of the default.
   * Must contain {documentsText} placeholder for document content.
   */
  customPrompt?: string;
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
 *   cached: false,
 *   financialSummary: {
 *     minPayment: 25.00,
 *     maxPayment: 1250.75,
 *     totalValue: 2437.50,
 *     payments: []
 *   },
 *   timeline: {
 *     startYear: 2020,
 *     endYear: 2024,
 *     durationYears: 4
 *   }
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

  /**
   * Whether reranking was enabled for this summary (rag and graph-rag strategies).
   */
  useReranker?: boolean;

  /**
   * Prompt metadata for transparency. Present on all successful summaries.
   */
  promptInfo?: PromptInfo;

  /**
   * Financial analysis summary extracted from claim documents.
   * Only present for full-context strategy with enhanced agent.
   */
  financialSummary?: FinancialSummary;

  /**
   * Timeline analysis showing duration of patient care history.
   * Only present for full-context strategy with enhanced agent.
   */
  timeline?: TimelineData;

  /**
   * Agent-predicted financial summary from the Financial Timeline Agent (LLM).
   * Only present for full-context strategy when the Financial Timeline Agent is configured.
   */
  agentFinancialSummary?: FinancialSummary | null;

  /**
   * Agent-predicted timeline from the Financial Timeline Agent (LLM).
   * Only present for full-context strategy when the Financial Timeline Agent is configured.
   */
  agentTimeline?: TimelineData | null;

  /**
   * Confidence score (0-1) from the Financial Timeline Agent.
   * Only present for full-context strategy when the Financial Timeline Agent is configured.
   */
  agentConfidence?: number | null;

  /**
   * Reasoning explanation from the Financial Timeline Agent.
   * Only present for full-context strategy when the Financial Timeline Agent is configured.
   */
  agentReasoning?: string | null;
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

/**
 * Financial analysis summary extracted from claim documents.
 * Provides payment amount ranges and total values across all documents.
 *
 * @example
 * ```typescript
 * const financial: FinancialSummary = {
 *   minPayment: 25.00,
 *   maxPayment: 1250.75,
 *   totalValue: 2437.50,
 *   payments: [
 *     { amount: 250.00, sourceDocument: "EOB_001.pdf", rawText: "250.00" },
 *     { amount: 1250.75, sourceDocument: "Invoice_002.pdf", rawText: "1,250.75" }
 *   ]
 * };
 * ```
 */
export interface FinancialSummary {
  /**
   * The minimum payment amount found across all documents.
   */
  minPayment: number;

  /**
   * The maximum payment amount found across all documents.
   */
  maxPayment: number;

  /**
   * The total sum of all payment amounts found.
   */
  totalValue: number;

  /**
   * Array of individual payment entries with source tracking.
   */
  payments: PaymentEntry[];
}

/**
 * Individual payment entry extracted from documents.
 */
export interface PaymentEntry {
  /**
   * The monetary amount as a number.
   */
  amount: number;

  /**
   * The document where this payment amount was found.
   */
  sourceDocument: string;

  /**
   * The original text string that was matched and parsed.
   */
  rawText: string;
}

/**
 * Timeline analysis showing the span of patient care history.
 * Calculated from the earliest to latest dates found in claim documents.
 *
 * @example
 * ```typescript
 * const timeline: TimelineData = {
 *   startYear: 2020,
 *   endYear: 2024,
 *   durationYears: 4
 * };
 * ```
 */
export interface TimelineData {
  /**
   * The earliest year found in any document date (e.g., birth date, first service).
   * Null if no valid dates were found.
   */
  startYear: number | null;

  /**
   * The latest year found in any document date (e.g., recent service, payment).
   * Null if no valid dates were found.
   */
  endYear: number | null;

  /**
   * The calculated duration in years from startYear to endYear.
   * Null if startYear or endYear are null.
   */
  durationYears: number | null;
}

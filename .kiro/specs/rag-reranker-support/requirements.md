# Requirements Document

## Introduction

The Claim Summary Orchestrator currently supports Cohere Rerank 3.5 reranking only for the `graph-rag` strategy via the `useReranker` boolean flag. This feature extends reranker support to the `rag` strategy, allowing Knowledge Base retrieval results to be reranked using the same Cohere Rerank 3.5 model. This improves retrieval quality for the standard RAG pipeline by surfacing the most relevant chunks before summarization.

## Glossary

- **Claim_Summary_API**: The Lambda-backed API endpoint that orchestrates claim summarization via POST /claims/{claimId}/summary
- **Orchestrator**: The claim-summary-orchestrator Lambda function that routes requests to the appropriate summarization strategy
- **RAG_Strategy**: The retrieval-augmented generation strategy that queries a Bedrock Knowledge Base with vector search and uses retrieved chunks as context for summarization
- **GraphRAG_Strategy**: The graph-based RAG strategy that queries a Neptune Analytics-backed Knowledge Base for entity-relationship-aware retrieval
- **Reranker**: The Cohere Rerank 3.5 foundation model accessed via Bedrock that reorders retrieval results by relevance before they are used for summarization
- **Reranking_Configuration**: The `rerankingConfiguration` block added to the Bedrock Knowledge Base RetrieveCommand that specifies the reranking model ARN and type
- **Cache_Key**: A composite string used to uniquely identify cached summaries, formatted as `{claimId}#{strategy}#{chunkingMethod}` with an optional `#reranker` suffix
- **Knowledge_Base**: The AWS Bedrock Knowledge Base service used for document retrieval in both RAG and GraphRAG strategies

## Requirements

### Requirement 1: Pass useReranker to RAG Strategy Execution

**User Story:** As a claims analyst, I want the RAG strategy to support reranking of retrieval results, so that I get higher-quality summaries from better-ranked document chunks.

#### Acceptance Criteria

1. WHEN a summary request is received with `strategy` set to "rag" and `useReranker` set to true, THE Orchestrator SHALL pass the `useReranker` parameter to the RAG_Strategy execution function.
2. WHEN a summary request is received with `strategy` set to "rag" and `useReranker` is absent or false, THE Orchestrator SHALL pass `useReranker` as false to the RAG_Strategy execution function.
3. THE Orchestrator SHALL continue to pass `useReranker` to the GraphRAG_Strategy execution function as it does today.

### Requirement 2: Apply Reranking Configuration in RAG Strategy

**User Story:** As a claims analyst, I want the RAG Knowledge Base query to use Cohere Rerank 3.5 when reranking is enabled, so that the most relevant chunks are prioritized for summarization.

#### Acceptance Criteria

1. WHEN `useReranker` is true, THE RAG_Strategy SHALL include a Reranking_Configuration in the Bedrock Knowledge Base RetrieveCommand specifying the Cohere Rerank 3.5 model ARN.
2. WHEN `useReranker` is false or absent, THE RAG_Strategy SHALL send the RetrieveCommand without a Reranking_Configuration.
3. THE RAG_Strategy SHALL use the same Reranking_Configuration structure as the GraphRAG_Strategy, with type "BEDROCK_RERANKING_MODEL" and the model ARN `arn:aws:bedrock:{region}::foundation-model/cohere.rerank-v3-5:0`.

### Requirement 3: Update Cache Key for RAG Reranker

**User Story:** As a system operator, I want cached summaries to differentiate between RAG results with and without reranking, so that users receive the correct cached summary for their configuration.

#### Acceptance Criteria

1. WHEN `useReranker` is true and `strategy` is "rag", THE Cache_Key builder SHALL append a "#reranker" suffix to the cache key.
2. WHEN `useReranker` is false or absent and `strategy` is "rag", THE Cache_Key builder SHALL produce a cache key without the "#reranker" suffix.
3. THE Cache_Key builder SHALL continue to append "#reranker" for the "graph-rag" strategy when `useReranker` is true.

### Requirement 4: Update Type Documentation

**User Story:** As a developer, I want the type definitions to accurately reflect that `useReranker` works for both `rag` and `graph-rag` strategies, so that API consumers understand the supported configurations.

#### Acceptance Criteria

1. THE `ClaimSummaryRequest.useReranker` type documentation SHALL state that the flag applies to both "rag" and "graph-rag" strategies.
2. THE `ClaimSummaryResponse.useReranker` type documentation SHALL state that the field indicates whether reranking was enabled, applicable to both "rag" and "graph-rag" strategies.

### Requirement 5: Include useReranker in RAG Response

**User Story:** As an API consumer, I want the summary response to indicate whether reranking was used for a RAG summary, so that I can distinguish reranked results from non-reranked results.

#### Acceptance Criteria

1. WHEN `strategy` is "rag" and `useReranker` is true, THE Claim_Summary_API SHALL include `useReranker: true` in the response.
2. WHEN `strategy` is "rag" and `useReranker` is false or absent, THE Claim_Summary_API SHALL include `useReranker: false` or omit the field from the response.
3. THE Claim_Summary_API SHALL continue to include `useReranker` in the response for the "graph-rag" strategy as it does today.

### Requirement 6: Validate Existing Tests and Add Coverage

**User Story:** As a developer, I want comprehensive test coverage for the RAG reranker feature, so that regressions are caught early.

#### Acceptance Criteria

1. WHEN the RAG strategy is invoked with `useReranker` set to true, THE unit tests SHALL verify that the RetrieveCommand includes the Reranking_Configuration.
2. WHEN the RAG strategy is invoked with `useReranker` set to false, THE unit tests SHALL verify that the RetrieveCommand does not include a Reranking_Configuration.
3. THE unit tests SHALL verify that the cache key includes "#reranker" for RAG requests with `useReranker` set to true.
4. THE unit tests SHALL verify that the response includes `useReranker` for RAG strategy requests.

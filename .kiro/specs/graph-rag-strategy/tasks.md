# Implementation Plan: Graph RAG Strategy (Neptune Analytics)

## Overview

Replace the placeholder `executeGraphRagStrategy()` with a real GraphRAG implementation backed by a Bedrock Knowledge Base on Amazon Neptune Analytics. Provision the Neptune Analytics graph, KB, and data source via CDK; update the orchestrator Lambda to query the GraphRAG KB with optional Cohere Rerank 3.5; update types and cache key; add a reranker toggle to the frontend; and write unit + property-based tests.

## Tasks

- [x] 1. CDK Infrastructure — Neptune Analytics graph, KB, data source, IAM, and Lambda wiring
  - [x] 1.1 Add Neptune Analytics graph, GraphRAG Knowledge Base, S3 data source, and KB service role to `infrastructure/rag-application-stack.ts`
    - Create `AWS::NeptuneGraph::Graph` via `CfnResource` with `GraphName: {applicationName}-graph-{environment}`, `ProvisionedMemory: 32`, `VectorSearchDimension: 1024`, `PublicConnectivity: false`, `ReplicaCount: 0`, `DeletionProtection: environment === 'prod'`
    - Export the Neptune graph ARN as a stack output
    - Create IAM service role `GraphRagKbRole` for `bedrock.amazonaws.com` with inline policies for S3 read on documents bucket, Neptune Analytics read/write on graph ARN, and Bedrock InvokeModel on `amazon.titan-embed-text-v2:0` and `amazon.nova-micro-v1:0`
    - Create `CfnKnowledgeBase` with `storageType: NEPTUNE_ANALYTICS`, `neptuneAnalyticsConfiguration.graphArn`, and `embeddingModelArn: amazon.titan-embed-text-v2:0`
    - Create `CfnDataSource` with `type: S3`, `bucketArn: documentsBucket.bucketArn`, and `contextEnrichmentConfiguration` using `CHUNK_ENTITY_EXTRACTION` with `amazon.nova-micro-v1:0`
    - Add CDK dependency chain: data source → KB → Neptune graph
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 5.1_

  - [x] 1.2 Add orchestrator Lambda permissions and environment variable for GraphRAG KB
    - Grant `bedrock:Retrieve` and `bedrock:RetrieveAndGenerate` on the GraphRAG KB ARN to the orchestrator Lambda role
    - Grant `neptune-graph:ReadDataViaQuery` and `neptune-graph:GetQueryResults` on the Neptune graph ARN
    - Grant `bedrock:InvokeModel` on `cohere.rerank-v3-5:0` for the reranker
    - Add `GRAPH_RAG_KNOWLEDGE_BASE_ID: graphRagKb.attrKnowledgeBaseId` to the orchestrator Lambda environment variables
    - Verify existing permissions (Bedrock InvokeModel, existing KB Retrieve, DynamoDB, S3) remain unchanged
    - _Requirements: 2.6, 4.1, 4.2, 4.3, 7.4_

  - [ ]* 1.3 Write CDK synthesis unit tests in `unit_tests/graph-rag-cdk.test.ts`
    - Verify synthesized template contains `AWS::NeptuneGraph::Graph` with correct name, memory, and vector dimension
    - Verify template contains `AWS::Bedrock::KnowledgeBase` with `NEPTUNE_ANALYTICS` storage type
    - Verify template contains `AWS::Bedrock::DataSource` with `CHUNK_ENTITY_EXTRACTION` enrichment
    - Verify IAM role has S3, Neptune Analytics, and Bedrock permissions
    - Verify orchestrator Lambda environment includes `GRAPH_RAG_KNOWLEDGE_BASE_ID`
    - Verify stack output for Neptune graph ARN exists
    - Verify reranker model IAM permission (`cohere.rerank-v3-5:0`) is present
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 7.4_

- [x] 2. Checkpoint — Ensure CDK synthesis tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Type updates and cache key changes
  - [x] 3.1 Add `useReranker` field to `ClaimSummaryRequest` and `ClaimSummaryResponse` in `src/types/claim-summary.ts`
    - Add optional `useReranker?: boolean` to `ClaimSummaryRequest` with JSDoc comment
    - Add optional `useReranker?: boolean` to `ClaimSummaryResponse` with JSDoc comment
    - _Requirements: 7.1, 7.6_

  - [x] 3.2 Update `buildCacheKey` in `src/services/summary-cache.ts` to include reranker setting for graph-rag
    - When strategy is `graph-rag` and `useReranker` is true, append `#reranker` to the cache key (e.g., `{claimId}#graph-rag#reranker`)
    - When `useReranker` is false or omitted, keep existing key format (`{claimId}#graph-rag#none`)
    - Update `buildCacheKey` signature to accept an optional `useReranker` parameter
    - _Requirements: 7.7_

- [x] 4. Orchestrator Lambda — Replace placeholder `executeGraphRagStrategy` and update handler routing
  - [x] 4.1 Rewrite `executeGraphRagStrategy` in `src/lambda/claim-summary-orchestrator.ts`
    - Change signature from `(documents: DocumentRecord[])` to `(claimId: string, useReranker: boolean)`
    - Read `GRAPH_RAG_KNOWLEDGE_BASE_ID` from environment variable
    - Build `RetrieveCommand` targeting `GRAPH_RAG_KNOWLEDGE_BASE_ID` with `numberOfResults: 20`
    - When `useReranker` is true, add `rerankingConfiguration` with `cohere.rerank-v3-5:0` model ARN
    - Build prompt from retrieval chunks with S3 source URIs and strategy identifier `"graph-rag (Neptune Analytics GraphRAG)"`
    - Return `{ summary, anomalies, documentCount }` where `documentCount` is the count of unique S3 source URIs
    - Return `{ summary: '', anomalies: [], documentCount: 0 }` when retrieval results are empty
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.1, 6.2, 6.3, 7.2, 7.3_

  - [x] 4.2 Update handler routing in `handlePostSummary` for graph-rag strategy
    - Extract `useReranker` from `request.useReranker ?? false`
    - Move `graph-rag` to its own branch calling `executeGraphRagStrategy(claimId, useReranker)` directly (no document pre-fetch)
    - Return 404 when `documentCount === 0`
    - On GraphRAG KB failure, catch error, log it, and fall back to `executeFullContextStrategy` with documents from DynamoDB
    - Include `useReranker` in the `ClaimSummaryResponse`
    - Update `validateRequest` to parse `useReranker` from the request body
    - Update cache key construction to pass `useReranker` for graph-rag strategy
    - _Requirements: 3.5, 3.6, 3.7, 7.2, 7.3, 7.6, 7.7_

  - [ ]* 4.3 Write orchestrator unit tests in `unit_tests/graph-rag-orchestrator.test.ts`
    - Test graph-rag strategy calls `RetrieveCommand` with `GRAPH_RAG_KNOWLEDGE_BASE_ID`
    - Test zero retrieval results returns 404
    - Test GraphRAG KB failure falls back to full-context strategy
    - Test successful retrieval builds prompt and invokes Bedrock Nova Pro
    - Test response includes `strategy: "graph-rag"` and correct `documentCount`
    - Test `useReranker: true` includes `rerankingConfiguration` with `cohere.rerank-v3-5:0`
    - Test `useReranker: false` does not include `rerankingConfiguration`
    - Test cache key includes reranker setting for graph-rag
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 7.2, 7.3, 7.7_

- [x] 5. Checkpoint — Ensure orchestrator tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Property-based tests for correctness properties
  - [ ]* 6.1 Write property test for GraphRAG KB Routing in `unit_tests/graph-rag-strategy.property.test.ts`
    - **Property 1: GraphRAG KB Routing**
    - For any claim ID, verify `RetrieveCommand` uses `GRAPH_RAG_KNOWLEDGE_BASE_ID` and `numberOfResults: 20`
    - **Validates: Requirements 3.1, 3.2, 6.2**

  - [ ]* 6.2 Write property test for Prompt Construction in `unit_tests/graph-rag-strategy.property.test.ts`
    - **Property 2: Prompt Construction from Retrieval Results**
    - For any non-empty array of retrieval results, verify prompt contains all chunk text, all S3 URIs, and `"graph-rag (Neptune Analytics GraphRAG)"`
    - **Validates: Requirements 3.3, 6.1, 6.3**

  - [ ]* 6.3 Write property test for LLM Response Parsing in `unit_tests/graph-rag-strategy.property.test.ts`
    - **Property 3: LLM Response Parsing Round Trip**
    - For any valid JSON with summary and anomalies, verify `parseSummaryResponse` returns correct summary text and anomalies with valid severity values
    - **Validates: Requirements 3.4**

  - [ ]* 6.4 Write property test for Response Structure in `unit_tests/graph-rag-strategy.property.test.ts`
    - **Property 4: Graph-RAG Response Structure**
    - For any successful invocation with non-empty results, verify `strategy === "graph-rag"` and `documentCount === unique S3 URIs count`
    - **Validates: Requirements 3.5**

  - [ ]* 6.5 Write property test for Reranker Toggle in `unit_tests/graph-rag-strategy.property.test.ts`
    - **Property 5: Reranker Configuration Toggle**
    - For any claim ID and boolean `useReranker`, verify `rerankingConfiguration` is present with `cohere.rerank-v3-5:0` when true, absent when false
    - **Validates: Requirements 7.2, 7.3**

- [x] 7. Frontend changes — API client and reranker toggle
  - [x] 7.1 Add `useReranker` parameter to `buildSummaryRequest` and `getClaimSummary` in `frontend/src/services/claimApi.ts`
    - Add optional `useReranker?: boolean` parameter to both functions
    - Include `useReranker` in the request body when defined
    - _Requirements: 7.1, 7.6_

  - [x] 7.2 Add reranker checkbox to `frontend/src/components/StrategyComparisonView.tsx`
    - Add `useReranker` state (default `false`)
    - Render a "Graph RAG: Use Reranker (Cohere Rerank 3.5)" checkbox below the chunking method selector
    - Pass `useReranker` to `getClaimSummary` only for the `graph-rag` strategy in both `handleGenerateAll` and `generateForStrategy`
    - _Requirements: 7.5, 7.6_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Post-Deployment: Sync GraphRAG Data Source

After CDK deployment completes, run this to ingest documents into the GraphRAG Knowledge Base:

```bash
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id <GRAPH_RAG_KNOWLEDGE_BASE_ID> \
  --data-source-id <GRAPH_RAG_DATA_SOURCE_ID>
```

Get the IDs from the CDK stack outputs (`GraphRagKnowledgeBaseId`) and the Bedrock console. This is required — the data source does not auto-sync on creation.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 5 correctness properties from the design document
- After CDK deployment, the GraphRAG data source must be synced manually via `aws bedrock-agent start-ingestion-job` or the Bedrock console — sync is not automatic on creation (Requirement 5.2, 5.3)
- The Neptune Analytics graph takes a few minutes to provision; CDK dependency chain ensures correct ordering
- The same S3 documents bucket is shared between the existing OpenSearch KB and the new Neptune Analytics KB

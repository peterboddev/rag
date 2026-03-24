# Implementation Plan: RAG Reranker Support

## Overview

Extend the existing Cohere Rerank 3.5 support from the `graph-rag` strategy to the `rag` strategy. The implementation replicates the existing reranker pattern from `executeGraphRagStrategy` into `executeRagStrategy`, updates cache key generation, response building, and type documentation.

## Tasks

- [x] 1. Update type documentation for useReranker
  - [x] 1.1 Update ClaimSummaryRequest.useReranker JSDoc in `src/types/claim-summary.ts`
    - Change from `"When true and strategy is 'graph-rag'"` to `"When true and strategy is 'rag' or 'graph-rag'"`
    - _Requirements: 4.1_
  - [x] 1.2 Update ClaimSummaryResponse.useReranker JSDoc in `src/types/claim-summary.ts`
    - Change from `"Whether reranking was enabled for this summary (graph-rag only)."` to `"Whether reranking was enabled for this summary (rag and graph-rag strategies)."`
    - _Requirements: 4.2_

- [x] 2. Update cache key builder for RAG reranker
  - [x] 2.1 Modify `buildCacheKey` in `src/services/summary-cache.ts`
    - Change condition from `strategy === 'graph-rag' && useReranker` to `(strategy === 'graph-rag' || strategy === 'rag') && useReranker`
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ]* 2.2 Write property test for cache key reranker suffix (Property 3)
    - **Property 3: Cache key reranker suffix**
    - Generate random `(claimId, strategy, chunkingMethod, useReranker)` tuples. Call `buildCacheKey` and assert `#reranker` suffix is present iff `strategy ∈ {rag, graph-rag}` and `useReranker === true`. For `full-context`, assert `#reranker` never appears.
    - Create `unit_tests/rag-reranker-cache-key.property.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 3. Add useReranker parameter to RAG strategy execution
  - [x] 3.1 Add `useReranker: boolean = false` parameter to `executeRagStrategy` in `src/lambda/claim-summary-orchestrator.ts`
    - Insert after `chunkingMethod` parameter, before `patientId`
    - _Requirements: 1.1, 1.2_
  - [x] 3.2 Add conditional `rerankingConfiguration` block in `executeRagStrategy`
    - When `useReranker` is true, add `rerankingConfiguration` to the `RetrieveCommand` input with type `BEDROCK_RERANKING_MODEL` and model ARN `arn:aws:bedrock:{region}::foundation-model/cohere.rerank-v3-5:0`
    - Use the same structure as `executeGraphRagStrategy`
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 3.3 Update handler routing in `handlePostSummary` to pass `useReranker` to `executeRagStrategy`
    - In the `request.strategy === 'rag'` branch, extract `const useReranker = request.useReranker ?? false` and pass it to `executeRagStrategy`
    - _Requirements: 1.1, 1.2_
  - [ ]* 3.4 Write property test for RAG rerankingConfiguration (Property 1)
    - **Property 1: RAG RetrieveCommand includes rerankingConfiguration iff useReranker is true**
    - Generate random valid RAG requests with `useReranker` in `{true, false}`. Mock the `RetrieveCommand` constructor and assert presence/absence of `rerankingConfiguration` in the command input.
    - Create `unit_tests/rag-reranker-retrieve-command.property.test.ts`
    - **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
  - [ ]* 3.5 Write property test for structural consistency (Property 2)
    - **Property 2: RAG and GraphRAG use identical rerankingConfiguration structure**
    - Generate random regions. Invoke both RAG and GraphRAG with `useReranker=true` and compare the `rerankingConfiguration` blocks for structural equality.
    - Add to `unit_tests/rag-reranker-retrieve-command.property.test.ts`
    - **Validates: Requirements 2.3**

- [x] 4. Update response builder for RAG reranker
  - [x] 4.1 Update response `useReranker` field in `handlePostSummary` in `src/lambda/claim-summary-orchestrator.ts`
    - Change `request.strategy === 'graph-rag'` to `(request.strategy === 'graph-rag' || request.strategy === 'rag')`
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ]* 4.2 Write property test for response useReranker field (Property 4)
    - **Property 4: Response useReranker field reflects request**
    - Generate random valid requests across all strategies with random `useReranker` values. Assert the response field matches expectations per strategy: present for `rag`/`graph-rag`, `undefined` for `full-context`.
    - Create `unit_tests/rag-reranker-response.property.test.ts`
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Write unit tests for RAG reranker
  - [x]* 6.1 Write unit tests for RAG reranker integration
    - Create `unit_tests/rag-reranker.test.ts`
    - Test: RAG request with `useReranker: true` produces response with `useReranker: true`
    - Test: RAG request with `useReranker: false` produces response without `useReranker: true`
    - Test: RAG request without `useReranker` field defaults to `false`
    - Test: Graph-rag with `useReranker: true` continues to work (regression)
    - Test: Cache key for `rag` + `useReranker: true` ends with `#reranker`
    - Test: Cache key for `rag` + `useReranker: false` does NOT end with `#reranker`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The implementation replicates the existing `executeGraphRagStrategy` reranker pattern into `executeRagStrategy` — no new abstractions needed
- Property tests use `fast-check` with minimum 100 iterations per property
- Unit tests use `jest` — run with `npx jest`

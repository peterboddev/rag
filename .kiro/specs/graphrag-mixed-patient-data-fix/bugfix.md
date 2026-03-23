# Bugfix Requirements Document

## Introduction

The `executeGraphRagStrategy()` function in `src/lambda/claim-summary-orchestrator.ts` contains a dangerous unfiltered fallback. When the Bedrock Knowledge Base metadata filter (patientId or claimId) returns 0 results, the function falls back to querying the GraphRAG KB without any filter. This returns document chunks from all patients in the knowledge base, causing the generated claim summary to contain mixed patient data — a serious data isolation violation.

This is the same bug pattern that was already fixed in `executeRagStrategy()` in the same file. The fix for `executeRagStrategy` removed the unfiltered fallback and returns empty results when the metadata filter returns nothing. The `executeGraphRagStrategy` function needs the identical fix.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `executeGraphRagStrategy()` queries the GraphRAG Knowledge Base with a metadata filter (patientId or claimId) and the filter returns 0 results THEN the system falls back to an unfiltered query that removes the metadata filter entirely

1.2 WHEN the unfiltered fallback query executes THEN the system returns document chunks from ALL patients in the knowledge base, not just the target patient

1.3 WHEN mixed-patient chunks are sent to Bedrock Nova Pro for summarization THEN the system generates a summary containing information from multiple patients, violating data isolation

### Expected Behavior (Correct)

2.1 WHEN `executeGraphRagStrategy()` queries the GraphRAG Knowledge Base with a metadata filter and the filter returns 0 results THEN the system SHALL return empty results (`{ summary: '', anomalies: [], documentCount: 0 }`) without performing any unfiltered fallback query

2.2 WHEN the metadata filter returns 0 results THEN the system SHALL log a warning indicating the KB may need re-sync to index metadata sidecars, consistent with the `executeRagStrategy()` behavior

2.3 WHEN `executeGraphRagStrategy()` returns empty results (documentCount: 0) THEN the caller SHALL return a 404 response indicating no documents were found for the claim

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the GraphRAG Knowledge Base metadata filter returns 1 or more results THEN the system SHALL CONTINUE TO build context from the retrieved chunks and generate a summary using Bedrock Nova Pro

3.2 WHEN the `useReranker` flag is true and the metadata filter returns results THEN the system SHALL CONTINUE TO apply Cohere Rerank 3.5 to the retrieval results

3.3 WHEN `executeGraphRagStrategy()` throws an error (e.g., KB service failure) THEN the caller SHALL CONTINUE TO fall back to the full-context strategy using DynamoDB documents

3.4 WHEN the `executeRagStrategy()` function queries the standard RAG Knowledge Base THEN the system SHALL CONTINUE TO return empty results when the metadata filter returns 0 results (existing fix must be preserved)

3.5 WHEN the full-context or rag strategies are used THEN the system SHALL CONTINUE TO behave identically to current behavior

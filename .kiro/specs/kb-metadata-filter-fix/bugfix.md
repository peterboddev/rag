# Bugfix Requirements Document

## Introduction

The RAG and GraphRAG summarization strategies return 404 ("No documents found for claim") because the Bedrock Knowledge Base data sources were never configured with metadata/parsing configuration to recognize `.metadata.json` sidecar files. The claim-loader Lambda correctly writes sidecar files alongside each uploaded document in S3, but the KB data sources (RAG KB `IJ9SLGVYQ1` / data source `ND5VILOG2Q`, and GraphRAG KB `B72QTGJBCX` / data source `PEZG3NEKRP`) ignore them during ingestion. As a result, metadata attributes like `patientId` and `claimId` are never indexed, and any metadata-filtered retrieval query returns zero results.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user triggers the RAG strategy for a claim summary AND the orchestrator queries KB `IJ9SLGVYQ1` with a metadata filter `{ equals: { key: 'patientId', value: '<patientId>' } }` THEN the KB returns 0 retrieval results because the data source `ND5VILOG2Q` was not configured to parse `.metadata.json` sidecar files, so metadata attributes were never indexed

1.2 WHEN a user triggers the GraphRAG strategy for a claim summary AND the orchestrator queries KB `B72QTGJBCX` with a metadata filter `{ equals: { key: 'patientId', value: '<patientId>' } }` THEN the KB returns 0 retrieval results because the data source `PEZG3NEKRP` was not configured to parse `.metadata.json` sidecar files, so metadata attributes were never indexed

1.3 WHEN either RAG or GraphRAG strategy receives 0 retrieval results THEN the orchestrator returns HTTP 404 with message "No documents found for claim {claimId}" and the frontend displays "No documents found for claim"

### Expected Behavior (Correct)

2.1 WHEN the RAG KB data source `ND5VILOG2Q` is configured with metadata file parsing for `.metadata.json` sidecars AND a KB re-sync (ingestion job) completes THEN the metadata attributes (`patientId`, `claimId`, `patientName`, `documentType`) SHALL be indexed and available for filtered retrieval queries

2.2 WHEN the GraphRAG KB data source `PEZG3NEKRP` is configured with metadata file parsing for `.metadata.json` sidecars AND a KB re-sync (ingestion job) completes THEN the metadata attributes (`patientId`, `claimId`, `patientName`, `documentType`) SHALL be indexed and available for filtered retrieval queries

2.3 WHEN a user triggers the RAG strategy for a claim summary AND the orchestrator queries the KB with a metadata filter `{ equals: { key: 'patientId', value: '<patientId>' } }` THEN the KB SHALL return matching document chunks that belong to that patient, and the orchestrator SHALL generate a summary successfully

2.4 WHEN a user triggers the GraphRAG strategy for a claim summary AND the orchestrator queries the KB with a metadata filter `{ equals: { key: 'patientId', value: '<patientId>' } }` THEN the KB SHALL return matching document chunks that belong to that patient, and the orchestrator SHALL generate a summary successfully

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user triggers the full-context strategy for a claim summary THEN the system SHALL CONTINUE TO query DynamoDB directly for claim documents and generate summaries without using KB retrieval

3.2 WHEN the claim-loader Lambda uploads documents to S3 THEN the system SHALL CONTINUE TO write `.metadata.json` sidecar files alongside each document with the correct format (`metadataAttributes` containing `claimId`, `patientId`, `patientName`, `documentType`)

3.3 WHEN the orchestrator queries a KB with a metadata filter and receives 0 results THEN the system SHALL CONTINUE TO return HTTP 404 without falling back to unfiltered queries (preserving the mixed-patient-data fix)

3.4 WHEN the orchestrator receives a cached summary for a RAG or GraphRAG strategy THEN the system SHALL CONTINUE TO return the cached result without re-querying the KB


---

## Bug Condition Derivation

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type KBRetrievalRequest
  OUTPUT: boolean

  // The bug triggers when a retrieval query uses a metadata filter
  // on a KB whose data source lacks metadata parsing configuration
  RETURN X.strategy IN {'rag', 'graph-rag'}
     AND X.metadataFilter IS NOT NULL
     AND X.dataSourceMetadataParsingEnabled = false
END FUNCTION
```

### Property Specification — Fix Checking

```pascal
// Property: After enabling metadata parsing and re-syncing the KB,
// filtered retrieval queries return matching chunks
FOR ALL X WHERE isBugCondition(X) DO
  // After fix: data source has metadata parsing enabled and KB re-synced
  result ← RetrieveFromKB'(X)
  ASSERT result.retrievalResults.length > 0
     AND ALL chunks IN result.retrievalResults SATISFY
         chunk.metadata[X.metadataFilter.key] = X.metadataFilter.value
END FOR
```

### Preservation Goal

```pascal
// Property: Non-buggy inputs (full-context strategy, cached results,
// and the no-fallback behavior) remain unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

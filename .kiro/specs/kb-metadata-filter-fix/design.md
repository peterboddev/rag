# KB Metadata Filter Fix — Bugfix Design

## Overview

The RAG and GraphRAG summarization strategies return 404 ("No documents found for claim") because neither Bedrock Knowledge Base data source was configured with a `parsingConfiguration` that recognizes `.metadata.json` sidecar files. The claim-loader Lambda already writes correct sidecars, and the orchestrator already sends metadata-filtered retrieval queries — the missing piece is purely the data source configuration on the Bedrock side. The fix involves updating both data source configurations to enable metadata file parsing, then re-syncing (ingesting) both KBs so the metadata attributes get indexed.

## Glossary

- **Bug_Condition (C)**: A KB retrieval request that uses a metadata filter (`patientId` or `claimId`) against a data source whose `parsingConfiguration` does not include metadata file settings — causing the filter to match zero documents
- **Property (P)**: After enabling metadata parsing and re-syncing, filtered retrieval queries return document chunks whose metadata matches the filter value
- **Preservation**: The full-context strategy, cached summary returns, the no-fallback-to-unfiltered behavior, and the claim-loader sidecar writing must all remain unchanged
- **Data Source**: A Bedrock KB data source that points to an S3 bucket and defines how documents are ingested
- **Sidecar File**: A `<source_file>.metadata.json` file co-located with the source document in S3, containing `metadataAttributes` that Bedrock indexes during ingestion
- **Ingestion Job**: A KB sync operation that crawls the S3 data source, processes documents, generates embeddings, and indexes metadata

## Bug Details

### Bug Condition

The bug manifests when the orchestrator queries either KB with a metadata filter (e.g., `{ equals: { key: 'patientId', value: '...' } }`) but the data source was never configured with `parsingConfiguration.parsingStrategy: "BEDROCK_DATA_AUTOMATION"` and `metadataConfiguration` to recognize `.metadata.json` sidecars. Without this configuration, ingestion ignores the sidecar files, metadata attributes are never indexed, and any filtered retrieval returns 0 results.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type KBRetrievalRequest
  OUTPUT: boolean

  RETURN input.strategy IN ['rag', 'graph-rag']
         AND input.metadataFilter IS NOT NULL
         AND input.targetDataSource.parsingConfiguration.metadataConfiguration IS UNDEFINED
         AND input.targetKB.lastIngestionDidNotIndexMetadata = true
END FUNCTION
```

### Examples

- **RAG strategy, patientId filter**: User requests RAG summary for claim CLM-001 (patientId PAT-123). Orchestrator sends `Retrieve` with filter `{ equals: { key: 'patientId', value: 'PAT-123' } }` to KB `IJ9SLGVYQ1`. Returns 0 results → HTTP 404. **Expected**: Returns chunks from PAT-123's documents.
- **GraphRAG strategy, patientId filter**: User requests GraphRAG summary for claim CLM-001. Orchestrator sends `Retrieve` with filter `{ equals: { key: 'patientId', value: 'PAT-123' } }` to KB `B72QTGJBCX`. Returns 0 results → HTTP 404. **Expected**: Returns chunks from PAT-123's documents.
- **RAG strategy, claimId fallback**: If patientId resolution fails, orchestrator filters by `claimId`. Same 0-result behavior because metadata is not indexed.
- **Edge case — no sidecar exists**: If a document was uploaded before the claim-loader wrote sidecars, even after the fix that document would have no metadata. This is expected — only documents with sidecars will be filterable.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Full-context strategy must continue to query DynamoDB directly and never touch KB retrieval
- Cached summary returns must continue to short-circuit without re-querying KBs
- The orchestrator must NOT fall back to unfiltered queries when metadata-filtered retrieval returns 0 results (mixed-patient-data fix)
- The claim-loader Lambda must continue to write `.metadata.json` sidecars in the existing format (`{ metadataAttributes: { claimId, patientId, patientName, documentType } }`)
- Mouse/UI interactions, API Gateway routing, and all non-KB-retrieval paths remain unaffected

**Scope:**
All inputs that do NOT involve KB metadata-filtered retrieval are completely unaffected by this fix. This includes:
- Full-context strategy requests
- Cached summary lookups
- Claim-loader document uploads and sidecar writes
- Frontend UI interactions
- API Gateway routing and authorization

## Hypothesized Root Cause

Based on the bug description, the root cause is confirmed (not hypothesized):

1. **Missing `parsingConfiguration` on RAG data source `ND5VILOG2Q`**: This data source (KB `IJ9SLGVYQ1`) was created by the platform team outside CDK. It was never configured with metadata file parsing. The `update-data-source` API must be called to add `parsingConfiguration` with `metadataConfiguration` pointing to `.metadata.json` sidecars.

2. **Missing `parsingConfiguration` on GraphRAG data source `PEZG3NEKRP`**: This data source (KB `B72QTGJBCX`) was created via `AwsCustomResource` in CDK (`infrastructure/rag-application-stack.ts`). The `createDataSource` parameters include `vectorIngestionConfiguration` for context enrichment but omit `parsingConfiguration` entirely.

3. **No KB re-sync after configuration change**: Even after adding the parsing configuration, the KBs must be re-synced (ingestion job started) so that existing documents' sidecar metadata gets indexed. Without re-sync, the configuration change alone does nothing.

4. **GraphRAG ingestion file limit**: Previous GraphRAG ingestion failed with "MaxIngestionFileCountPerJob limit: 1000 reached" because the S3 bucket contains 1272+ files (documents + sidecars). The fix must account for this — either by using inclusion prefixes to scope ingestion, or by accepting that GraphRAG ingestion may need to be run in batches or with AWS support to increase the limit.

## Correctness Properties

Property 1: Bug Condition — Metadata-Filtered Retrieval Returns Results

_For any_ KB retrieval request where the strategy is `rag` or `graph-rag` AND a metadata filter is applied (`patientId` or `claimId`) AND the data source has been updated with metadata parsing configuration AND the KB has been re-synced, the `Retrieve` API call SHALL return one or more document chunks whose metadata attribute matches the filter value.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation — Non-KB Paths Unchanged

_For any_ request that uses the full-context strategy, or returns a cached summary, or involves the claim-loader writing sidecars, the fixed system SHALL produce exactly the same behavior as the original system, preserving all existing functionality for non-KB-retrieval paths. Additionally, the no-fallback behavior (returning empty results instead of unfiltered queries) SHALL be preserved.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

**Change 1: Update RAG KB data source `ND5VILOG2Q` configuration (runtime API call)**

This data source is platform-managed (not in CDK). Use the `aws bedrock-agent update-data-source` API to add metadata parsing configuration:

```
aws bedrock-agent update-data-source \
  --knowledge-base-id IJ9SLGVYQ1 \
  --data-source-id ND5VILOG2Q \
  --name <current-data-source-name> \
  --data-source-configuration type=S3,s3Configuration={bucketArn=arn:aws:s3:::rag-app-development-documentsbucket9ec9deb9-hn1z8ikqrnwt} \
  --server-side-encryption-configuration '{}' \
  --parsing-configuration parsingStrategy=BEDROCK_DATA_AUTOMATION,bedrockDataAutomationConfiguration={parsingModality=TEXT},parsingModality=TEXT
```

Note: The exact CLI syntax for metadata configuration may require JSON input. The key parameters are:
- `parsingStrategy`: Set to enable metadata file recognition
- The data source must recognize `<filename>.metadata.json` sidecar pattern (this is the Bedrock default sidecar naming convention)

**Change 2: Update GraphRAG data source CDK code in `infrastructure/rag-application-stack.ts`**

**File**: `infrastructure/rag-application-stack.ts`
**Resource**: `GraphRagDataSource` AwsCustomResource

Add `parsingConfiguration` to the `createDataSource` parameters alongside the existing `vectorIngestionConfiguration`. This ensures future CDK deployments create the data source with metadata parsing enabled.

**Change 3: Update live GraphRAG data source `PEZG3NEKRP` configuration (runtime API call)**

Since the data source already exists and CDK `AwsCustomResource` only runs `onCreate` (not `onUpdate`), the live data source must also be updated via the `update-data-source` API call, similar to Change 1.

**Change 4: Re-sync RAG KB `IJ9SLGVYQ1`**

Start an ingestion job:
```
aws bedrock-agent start-ingestion-job --knowledge-base-id IJ9SLGVYQ1 --data-source-id ND5VILOG2Q
```

**Change 5: Re-sync GraphRAG KB `B72QTGJBCX`**

Start an ingestion job:
```
aws bedrock-agent start-ingestion-job --knowledge-base-id B72QTGJBCX --data-source-id PEZG3NEKRP
```

**Important**: This KB previously failed ingestion with "MaxIngestionFileCountPerJob limit: 1000 reached" (1272 files). Mitigation options:
- Use `inclusionPrefixes` in the S3 data source configuration to scope ingestion to a subset of files
- Request a limit increase from AWS
- Reduce file count in the bucket (remove old/unused documents)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, confirm the bug exists by observing 0-result retrieval on the current (unfixed) configuration, then verify the fix works after updating data source configs and re-syncing.

Because this is an infrastructure/configuration bug (not a code bug), testing is primarily integration-level — verifying that the Bedrock `Retrieve` API returns results after the configuration change. Property-based testing applies to the preservation side (verifying non-KB paths remain unchanged).

### Exploratory Bug Condition Checking

**Goal**: Confirm that metadata-filtered retrieval returns 0 results on the current (unfixed) data sources. This validates the root cause before making changes.

**Test Plan**: Run `Retrieve` API calls against both KBs with metadata filters and observe 0 results.

**Test Cases**:
1. **RAG KB patientId filter**: Call `Retrieve` on KB `IJ9SLGVYQ1` with filter `{ equals: { key: 'patientId', value: '<known-patientId>' } }` — expect 0 results (will fail on unfixed config)
2. **RAG KB claimId filter**: Call `Retrieve` on KB `IJ9SLGVYQ1` with filter `{ equals: { key: 'claimId', value: '<known-claimId>' } }` — expect 0 results (will fail on unfixed config)
3. **GraphRAG KB patientId filter**: Call `Retrieve` on KB `B72QTGJBCX` with filter `{ equals: { key: 'patientId', value: '<known-patientId>' } }` — expect 0 results (will fail on unfixed config)
4. **RAG KB unfiltered query**: Call `Retrieve` on KB `IJ9SLGVYQ1` WITHOUT a metadata filter — expect >0 results (confirms documents are ingested, just not metadata-indexed)

**Expected Counterexamples**:
- All metadata-filtered queries return 0 results
- Unfiltered queries return results, confirming the documents exist but metadata is not indexed

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed configuration produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  // After: data source updated with parsingConfiguration + KB re-synced
  result := Retrieve(input.knowledgeBaseId, input.query, input.metadataFilter)
  ASSERT result.retrievalResults.length > 0
  ASSERT ALL chunks IN result.retrievalResults SATISFY
      chunk.metadata[input.metadataFilter.key] = input.metadataFilter.value
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed system produces the same result as the original system.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT F(input) = F'(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking of the orchestrator code paths because:
- It generates many test cases automatically across the input domain (different strategies, cache states, claim IDs)
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that non-KB behavior is unchanged

**Test Plan**: Write property-based tests that exercise the full-context strategy, cached summary returns, and the no-fallback behavior to verify they remain unchanged.

**Test Cases**:
1. **Full-context strategy preservation**: Verify that full-context strategy continues to query DynamoDB and never calls KB retrieval APIs
2. **Cache hit preservation**: Verify that cached summaries are returned without re-querying KBs
3. **No-fallback preservation**: Verify that when metadata-filtered retrieval returns 0 results, the orchestrator returns empty results (not unfiltered results)
4. **Claim-loader sidecar preservation**: Verify that the claim-loader continues to write `.metadata.json` sidecars in the correct format

### Unit Tests

- Test that the orchestrator's `executeRagStrategy` correctly constructs metadata filters from patientId/claimId
- Test that the orchestrator returns empty results (not errors) when KB retrieval returns 0 chunks
- Test that the full-context strategy does not invoke any KB retrieval APIs

### Property-Based Tests

- Generate random claim/patient IDs and verify the orchestrator always constructs valid metadata filters for RAG/GraphRAG strategies
- Generate random strategy selections and verify full-context never touches KB retrieval
- Generate random cache states and verify cached results are returned without KB queries

### Integration Tests

- After updating data source configs and re-syncing: call the claim summary API with RAG strategy and verify a summary is returned (not 404)
- After updating data source configs and re-syncing: call the claim summary API with GraphRAG strategy and verify a summary is returned (not 404)
- Verify that the full-context strategy continues to work identically before and after the fix
- Verify that the GraphRAG ingestion job completes successfully (or document the file limit workaround)

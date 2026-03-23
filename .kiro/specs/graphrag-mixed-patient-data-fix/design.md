# GraphRAG Mixed Patient Data Fix — Bugfix Design

## Overview

The `executeGraphRagStrategy()` function in `src/lambda/claim-summary-orchestrator.ts` contains a dangerous unfiltered fallback that violates patient data isolation. When the Bedrock Knowledge Base metadata filter (patientId or claimId) returns 0 results, the function falls back to querying the GraphRAG KB (ID: `B72QTGJBCX`) without any filter, returning document chunks from all patients. The fix removes this unfiltered fallback and returns empty results instead — mirroring the pattern already applied to `executeRagStrategy()` in the same file.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when `executeGraphRagStrategy()` receives 0 chunks from the filtered KB query and proceeds to execute an unfiltered fallback query
- **Property (P)**: The desired behavior — when the filtered query returns 0 chunks, return `{ summary: '', anomalies: [], documentCount: 0 }` and log a warning, with no unfiltered fallback
- **Preservation**: The existing behavior that must remain unchanged — normal GraphRAG flow when chunks are returned, reranker configuration, error fallback to full-context, and the existing `executeRagStrategy()` fix
- **executeGraphRagStrategy**: The function in `src/lambda/claim-summary-orchestrator.ts` that queries the GraphRAG Knowledge Base backed by Neptune Analytics
- **executeRagStrategy**: The sibling function in the same file that already has the correct fix applied (returns empty results on 0 filtered chunks)
- **filterKey**: Either `patientId` or `claimId`, used as the metadata filter key for KB retrieval
- **fallbackInput**: The buggy variable that constructs a RetrieveCommand without a metadata filter

## Bug Details

### Bug Condition

The bug manifests when `executeGraphRagStrategy()` queries the GraphRAG Knowledge Base with a metadata filter (patientId or claimId) and receives 0 results. Instead of returning empty results, the function constructs a `fallbackInput` without any metadata filter and executes a second unfiltered query, which returns chunks from all patients in the knowledge base.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { claimId: string, useReranker: boolean, patientId: string | null }
  OUTPUT: boolean

  filteredResults := queryGraphRagKB(input.claimId, input.patientId, withFilter=true)
  
  RETURN filteredResults.length === 0
END FUNCTION
```

### Examples

- **Example 1**: Patient A's claim `CLM-001` has no metadata sidecars indexed in the GraphRAG KB. The filtered query returns 0 chunks. The buggy code falls back to an unfiltered query and returns chunks from Patient B, Patient C, etc. The generated summary contains mixed patient data. **Expected**: Return `{ summary: '', anomalies: [], documentCount: 0 }`.
- **Example 2**: A newly ingested claim `CLM-NEW` hasn't been indexed yet. The filtered query returns 0 chunks. The buggy fallback returns unrelated patient documents. **Expected**: Return empty results and log a warning about KB re-sync.
- **Example 3**: Patient A's claim `CLM-001` has metadata sidecars indexed. The filtered query returns 5 chunks. **Expected**: Normal flow — build context, invoke Bedrock, return summary. This is NOT a bug condition.
- **Example 4**: The `useReranker` flag is true but the filtered query returns 0 chunks. The buggy code applies the reranker to the unfiltered fallback results. **Expected**: Return empty results immediately, no reranker invocation needed.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When the GraphRAG KB metadata filter returns 1 or more chunks, the function must continue to build context from retrieved chunks and generate a summary using Bedrock Nova Pro
- When `useReranker` is true and the metadata filter returns results, Cohere Rerank 3.5 must continue to be applied to the retrieval results
- When `executeGraphRagStrategy()` throws an error, the caller (`handlePostSummary`) must continue to fall back to the full-context strategy using DynamoDB documents
- The existing fix in `executeRagStrategy()` must be preserved — it must continue to return empty results when its metadata filter returns 0 results
- The full-context strategy and all other strategies must behave identically to current behavior

**Scope:**
All inputs where the GraphRAG KB metadata filter returns 1 or more results should be completely unaffected by this fix. This includes:
- Normal GraphRAG queries that return chunks
- GraphRAG queries with reranker enabled that return chunks
- All `executeRagStrategy()` invocations
- All full-context strategy invocations
- Error handling and fallback paths in the caller

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is clear and confirmed:

1. **Intentional but dangerous fallback logic**: Lines ~340-370 of `executeGraphRagStrategy()` contain an explicit `if (chunks.length === 0)` block that constructs a `fallbackInput` without a metadata filter. This was likely added as a "helpful" fallback to ensure results are always returned, but it violates data isolation by returning chunks from all patients.

2. **Inconsistent fix application**: The same bug pattern was already identified and fixed in `executeRagStrategy()` (which now returns empty results on 0 filtered chunks), but the fix was not applied to `executeGraphRagStrategy()`. This is a classic case of fixing a bug in one location but missing the same pattern in a sibling function.

3. **No data isolation enforcement at the KB query layer**: The function relies on metadata filters for data isolation, but the fallback explicitly removes this filter. There is no secondary check to ensure returned chunks belong to the target patient.

## Correctness Properties

Property 1: Bug Condition - GraphRAG Empty Filter Returns Empty Results

_For any_ input where the GraphRAG KB metadata filter returns 0 chunks (isBugCondition returns true), the fixed `executeGraphRagStrategy` function SHALL return `{ summary: '', anomalies: [], documentCount: 0 }` without executing any unfiltered fallback query against the Knowledge Base.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Normal GraphRAG Flow Unchanged

_For any_ input where the GraphRAG KB metadata filter returns 1 or more chunks (isBugCondition returns false), the fixed `executeGraphRagStrategy` function SHALL produce the same result as the original function — building context from chunks, invoking Bedrock Nova Pro, and returning the summary with document count.

**Validates: Requirements 3.1, 3.2**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct (which is confirmed by code inspection):

**File**: `src/lambda/claim-summary-orchestrator.ts`

**Function**: `executeGraphRagStrategy`

**Specific Changes**:
1. **Remove unfiltered fallback block**: Delete the entire `if (chunks.length === 0)` block (~lines 340-370) that constructs `fallbackInput` without a filter, executes the fallback query, processes fallback chunks, and returns fallback results.

2. **Replace with empty return + warning log**: Replace the removed block with the same pattern used in `executeRagStrategy()`:
   ```typescript
   if (chunks.length === 0) {
     console.warn(`No GraphRAG KB results with ${filterKey} metadata filter for claim ${claimId}. KB may need re-sync to index metadata sidecars.`);
     return { summary: '', anomalies: [], documentCount: 0 };
   }
   ```

3. **No other changes**: The rest of the function (filtered query construction, reranker configuration, chunk processing, Bedrock invocation) remains unchanged.

4. **No caller changes needed**: The caller (`handlePostSummary`) already handles `documentCount === 0` by returning a 404 response.

5. **No test infrastructure changes**: Existing test mocks and helpers are sufficient.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that the unfiltered fallback is executed when the filtered query returns 0 chunks.

**Test Plan**: Write tests that mock the GraphRAG KB to return 0 results for the filtered query and verify that a second unfiltered query IS made (demonstrating the bug). Run these tests on the UNFIXED code to observe the fallback behavior.

**Test Cases**:
1. **Unfiltered Fallback Executed**: Mock filtered query returning 0 chunks, verify `RetrieveCommand` is called twice — once with filter, once without (will demonstrate bug on unfixed code)
2. **Mixed Patient Data Returned**: Mock filtered query returning 0 chunks and unfiltered query returning chunks from multiple patients, verify the summary is generated from mixed data (will demonstrate data isolation violation on unfixed code)
3. **Reranker Applied to Unfiltered Results**: Mock filtered query returning 0 chunks with `useReranker=true`, verify reranker is applied to unfiltered fallback results (will demonstrate bug on unfixed code)

**Expected Counterexamples**:
- `RetrieveCommand` is called twice when filtered query returns 0 chunks
- The second call has no metadata filter in `vectorSearchConfiguration`
- Summary is generated from chunks belonging to multiple patients

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := executeGraphRagStrategy_fixed(input.claimId, input.useReranker, input.patientId)
  ASSERT result.summary === ''
  ASSERT result.anomalies.length === 0
  ASSERT result.documentCount === 0
  ASSERT RetrieveCommand was called exactly ONCE (filtered only, no fallback)
  ASSERT console.warn was called with KB re-sync message
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT executeGraphRagStrategy_original(input) = executeGraphRagStrategy_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for normal GraphRAG queries (filter returns 1+ chunks), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Normal Flow Preservation**: Verify that when filtered query returns 1+ chunks, the function builds context, invokes Bedrock, and returns summary identically to original
2. **Reranker Preservation**: Verify that when `useReranker=true` and filtered query returns chunks, reranker configuration is included in the retrieve command
3. **Caller Error Fallback Preservation**: Verify that when `executeGraphRagStrategy` throws, the caller falls back to full-context strategy

### Unit Tests

- Test `executeGraphRagStrategy` returns empty results when filtered query returns 0 chunks
- Test `executeGraphRagStrategy` logs warning when filtered query returns 0 chunks
- Test `RetrieveCommand` is called exactly once (no unfiltered fallback) when filtered query returns 0 chunks
- Test normal flow when filtered query returns chunks (context building, Bedrock invocation, summary return)
- Test reranker configuration is preserved when `useReranker=true` and chunks are returned

### Property-Based Tests

- Generate random `{ claimId, useReranker, patientId }` inputs with mocked 0-chunk filtered results, verify empty return and single KB call (fix checking)
- Generate random `{ claimId, useReranker, patientId }` inputs with mocked 1+ chunk filtered results, verify normal flow produces summary with correct document count (preservation checking)
- Generate random inputs for `executeRagStrategy` with 0-chunk results, verify existing fix is preserved (regression prevention)

### Integration Tests

- Test full handler flow with `strategy: 'graph-rag'` when GraphRAG KB returns 0 filtered chunks — verify 404 response
- Test full handler flow with `strategy: 'graph-rag'` when GraphRAG KB returns chunks — verify 200 response with summary
- Test full handler flow with `strategy: 'graph-rag'` and `useReranker: true` when GraphRAG KB returns chunks — verify reranker is applied

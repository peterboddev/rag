# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - GraphRAG Unfiltered Fallback on Empty Filter Results
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the unfiltered fallback executes when the metadata filter returns 0 chunks
  - **Scoped PBT Approach**: For any `{ claimId, useReranker, patientId }` input where the GraphRAG KB filtered query returns 0 chunks, scope the property to verify that `RetrieveCommand` is called exactly once (no unfiltered fallback) and the result is `{ summary: '', anomalies: [], documentCount: 0 }`
  - Create test file `unit_tests/bug-graphrag-mixed-patient-exploration.property.test.ts`
  - Mock `BedrockAgentRuntimeClient.send` to return `{ retrievalResults: [] }` for the first (filtered) call, and return chunks from multiple patients for the second (unfiltered) call
  - Mock `BedrockRuntimeClient.send` to return a valid summary response
  - Use fast-check to generate random `{ claimId, useReranker, patientId }` inputs
  - For each generated input, call the handler with `strategy: 'graph-rag'` and assert:
    - `RetrieveCommand` is called exactly ONCE (filtered only, no unfiltered fallback)
    - The handler returns 404 (since `documentCount === 0` triggers 404 in caller)
    - No summary is generated from mixed patient data
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists because `RetrieveCommand` is called TWICE and a summary is generated from unfiltered results)
  - Document counterexamples found: `RetrieveCommand` called twice — second call has no metadata filter in `vectorSearchConfiguration`, summary generated from mixed patient chunks
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Normal GraphRAG Flow and Sibling Strategy Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `unit_tests/preservation-graphrag-mixed-patient.property.test.ts`
  - Observe behavior on UNFIXED code for non-buggy inputs (filtered query returns 1+ chunks)
  - Observe: `executeGraphRagStrategy` with 1+ chunks builds context, invokes Bedrock Nova Pro, returns `{ summary, anomalies, documentCount }` matching unique source count
  - Observe: When `useReranker=true` and chunks are returned, `rerankingConfiguration` is included in the `RetrieveCommand` input
  - Observe: When `executeGraphRagStrategy` throws an error, `handlePostSummary` falls back to full-context strategy using DynamoDB documents
  - Observe: `executeRagStrategy` with 0 filtered chunks returns `{ summary: '', anomalies: [], documentCount: 0 }` (existing fix preserved)
  - Write property-based tests with fast-check capturing observed behavior:
    - For all random `{ claimId, patientId }` inputs where filtered query returns 1+ chunks, verify summary is generated, `documentCount` matches unique source URIs, and `RetrieveCommand` is called once with metadata filter
    - For all random `{ claimId, patientId }` inputs with `useReranker=true` and 1+ chunks, verify `rerankingConfiguration` is present in the retrieve input
    - For all random `{ claimId }` inputs, verify `executeRagStrategy` with 0 filtered chunks still returns empty results (regression prevention for existing fix)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for GraphRAG unfiltered fallback returning mixed patient data

  - [x] 3.1 Remove unfiltered fallback and return empty results in `executeGraphRagStrategy`
    - In `src/lambda/claim-summary-orchestrator.ts`, function `executeGraphRagStrategy`
    - Replace the entire `if (chunks.length === 0)` block (~lines 340-370) that constructs `fallbackInput` without a metadata filter, executes the unfiltered fallback query, processes fallback chunks, and returns fallback results
    - Replace with the same pattern used in `executeRagStrategy()`:
      ```typescript
      if (chunks.length === 0) {
        console.warn(`No GraphRAG KB results with ${filterKey} metadata filter for claim ${claimId}. KB may need re-sync to index metadata sidecars.`);
        return { summary: '', anomalies: [], documentCount: 0 };
      }
      ```
    - No changes to the rest of the function (filtered query construction, reranker config, chunk processing, Bedrock invocation)
    - No caller changes needed — `handlePostSummary` already handles `documentCount === 0` by returning 404
    - _Bug_Condition: isBugCondition(input) where filteredResults.length === 0 triggers unfiltered fallback query_
    - _Expected_Behavior: Return `{ summary: '', anomalies: [], documentCount: 0 }` and log warning, no unfiltered fallback_
    - _Preservation: Normal flow when chunks.length >= 1 remains unchanged; reranker config unchanged; caller error fallback unchanged; executeRagStrategy fix unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - GraphRAG Empty Filter Returns Empty Results
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms `executeGraphRagStrategy` returns empty results on 0 filtered chunks with no unfiltered fallback
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Normal GraphRAG Flow and Sibling Strategy Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Verify normal GraphRAG flow with 1+ chunks still produces summary correctly
    - Verify reranker configuration still applied when `useReranker=true`
    - Verify `executeRagStrategy` existing fix still returns empty results on 0 filtered chunks
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run all unit tests: `npx jest --run`
  - Verify bug condition exploration test passes (no unfiltered fallback, empty results returned)
  - Verify preservation tests pass (normal GraphRAG flow, reranker, existing RAG fix all unchanged)
  - Verify all existing tests in `unit_tests/claim-summary-orchestrator.test.ts` and `unit_tests/claim-summary-orchestrator.property.test.ts` still pass
  - Ensure all tests pass, ask the user if questions arise

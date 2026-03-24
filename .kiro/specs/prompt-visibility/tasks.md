# Implementation Plan: Prompt Visibility

## Overview

Add prompt visibility to the claim summary API and comparison UI. The orchestrator captures prompt metadata (template with `[DOCUMENTS]` placeholder, strategy label, retrieval query) via a new `buildPromptInfo` helper, includes it in responses and cache, and the frontend renders it in `StrategyColumn` (collapsible section) and `StrategyComparisonPanel` (compact preview). All changes are additive and backward-compatible.

## Tasks

- [x] 1. Add PromptInfo type and update ClaimSummaryResponse
  - [x] 1.1 Add `PromptInfo` interface and update `ClaimSummaryResponse` in `src/types/claim-summary.ts`
    - Define `PromptInfo` with required `promptTemplate: string`, required `strategyLabel: string`, and optional `retrievalQuery?: string`
    - Add optional `promptInfo?: PromptInfo` field to `ClaimSummaryResponse`
    - _Requirements: 3.1, 3.2_

  - [x] 1.2 Add `PromptInfo` shape and update `ClaimSummaryResponse` in `frontend/src/services/claimApi.ts`
    - Add `PromptInfo` interface matching backend shape
    - Add optional `promptInfo?: PromptInfo` to `ClaimSummaryResponse`
    - Update `parseClaimSummaryResponse` to validate `promptInfo` when present: check `promptTemplate` is string, `strategyLabel` is string, `retrievalQuery` is string if present; treat absent `promptInfo` as valid
    - _Requirements: 4.1, 7.1, 7.2, 7.3_

  - [x] 1.3 Add `PromptInfo` shape and update local `ClaimSummaryResponse` in `frontend/src/components/StrategyComparisonPanel.tsx`
    - Add `PromptInfo` interface and optional `promptInfo` field to the local `ClaimSummaryResponse` interface
    - _Requirements: 4.2_

- [x] 2. Implement buildPromptInfo and wire into orchestrator
  - [x] 2.1 Add `buildPromptInfo` helper in `src/lambda/claim-summary-orchestrator.ts`
    - Create `buildPromptInfo(strategyLabel: string, retrievalQuery?: string): PromptInfo` that calls `buildSummaryPrompt('[DOCUMENTS]', strategyLabel)` for the template
    - Import `PromptInfo` from `../types/claim-summary`
    - _Requirements: 1.2, 1.3_

  - [x] 2.2 Update `executeFullContextStrategy` to return `promptInfo`
    - Call `buildPromptInfo('full-context')` (no retrieval query)
    - Return `promptInfo` alongside existing `summary` and `anomalies`
    - _Requirements: 1.1, 1.5_

  - [x] 2.3 Update `executeRagStrategy` to return `promptInfo`
    - Call `buildPromptInfo('rag ({chunkingMethod} chunking)', retrievalQueryText)` using the same retrieval query text from the `RetrieveCommand`
    - Return `promptInfo` alongside existing fields
    - _Requirements: 1.1, 1.4_

  - [x] 2.4 Update `executeGraphRagStrategy` to return `promptInfo`
    - Call `buildPromptInfo('graph-rag (Neptune Analytics GraphRAG)', retrievalQueryText)` using the same retrieval query text from the `RetrieveCommand`
    - Return `promptInfo` alongside existing fields
    - _Requirements: 1.1, 1.4_

  - [x] 2.5 Update `handlePostSummary` to attach `promptInfo` to response
    - Extract `promptInfo` from each strategy result and set it on the `ClaimSummaryResponse` before caching and returning
    - For graph-rag fallback-to-full-context path, rebuild `promptInfo` using full-context strategy label
    - _Requirements: 1.1, 2.1, 2.2_

  - [ ]* 2.6 Write property test: buildPromptInfo produces correct template and label
    - **Property 1: buildPromptInfo produces correct template and label**
    - Generate arbitrary strategy label strings with fast-check, verify `promptTemplate === buildSummaryPrompt('[DOCUMENTS]', label)` and `strategyLabel === label`
    - **Validates: Requirements 1.2, 1.3**

  - [ ]* 2.7 Write property test: retrievalQuery presence matches strategy type
    - **Property 2: retrievalQuery presence matches strategy type**
    - Generate random strategy from `['full-context', 'rag', 'graph-rag']`, verify `retrievalQuery` is present iff strategy is `rag` or `graph-rag`
    - **Validates: Requirements 1.4, 1.5**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add prompt section to StrategyColumn
  - [x] 4.1 Add collapsible prompt section to `frontend/src/components/StrategyColumn.tsx`
    - Add `promptExpanded` local state, default `false`
    - Render prompt section between evaluation scores and summary text when `response.promptInfo` is present
    - Render toggle button with `▶`/`▼` prefix and "LLM Prompt" label
    - When expanded: show `retrievalQuery` in labeled subsection (if present), then `promptTemplate` in scrollable monospace `<pre>` with `maxHeight: 200px`
    - Add `data-testid` attributes: `prompt-section-{strategyKey}`, `retrieval-query-{strategyKey}`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 4.2 Write property test: StrategyColumn renders prompt section when promptInfo is present
    - **Property 4: StrategyColumn renders prompt section when promptInfo is present**
    - Generate random `promptInfo` with/without `retrievalQuery`, render component, verify prompt section presence and retrieval query rendering
    - **Validates: Requirements 5.1, 5.3**

  - [ ]* 4.3 Write property test: StrategyColumn prompt section toggle behavior
    - **Property 5: StrategyColumn prompt section toggle behavior**
    - Generate random click count (1-20), simulate clicks, verify visibility matches parity (odd=visible, even=hidden)
    - **Validates: Requirements 5.4, 5.5**

- [x] 5. Add prompt preview to StrategyComparisonPanel
  - [x] 5.1 Add prompt preview to comparison cards in `frontend/src/components/StrategyComparisonPanel.tsx`
    - Below the metadata row, render strategy label with 🏷️ emoji when `promptInfo` is present
    - Render "🔍 KB Query:" with first 80 characters of `retrievalQuery` followed by `…` when `retrievalQuery` is present
    - _Requirements: 6.1, 6.2_

  - [ ]* 5.2 Write property test: ComparisonPanel displays prompt preview
    - **Property 6: ComparisonPanel displays prompt preview**
    - Generate random `promptInfo` with varying `retrievalQuery` lengths, render component, verify label display and truncation to 80 chars
    - **Validates: Requirements 6.1, 6.2**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Write unit tests for prompt visibility
  - [ ]* 7.1 Write unit tests in `unit_tests/prompt-visibility.test.ts`
    - Test `buildPromptInfo` returns expected shape for `full-context`, `rag (semantic chunking)`, `graph-rag (Neptune Analytics GraphRAG)`
    - Test `buildPromptInfo` with `rag` strategy includes `retrievalQuery`; `full-context` omits it
    - Test `parseClaimSummaryResponse` accepts response without `promptInfo` (backward compat)
    - Test `parseClaimSummaryResponse` rejects `promptInfo` with numeric `promptTemplate`
    - Test `StrategyColumn` renders prompt section collapsed by default when `promptInfo` present
    - Test `StrategyColumn` does not render prompt section when `promptInfo` absent
    - Test `StrategyComparisonPanel` shows strategy label and truncated KB query in card
    - Test `StrategyComparisonPanel` omits KB query indicator when `retrievalQuery` absent
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 5.1, 5.4, 6.1, 6.2, 7.1, 7.2, 7.3_

  - [ ]* 7.2 Write property test: Cache round-trip preserves promptInfo
    - **Property 3: Cache round-trip preserves promptInfo**
    - Generate random `PromptInfo` objects, embed in `ClaimSummaryResponse`, serialize to JSON and deserialize, verify deep equality of `promptInfo`
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 7.3 Write property test: parseClaimSummaryResponse validates promptInfo correctly
    - **Property 7: parseClaimSummaryResponse validates promptInfo correctly**
    - Generate random objects with valid/invalid `promptInfo` shapes, verify validation results match expected valid/invalid status
    - **Validates: Requirements 7.1, 7.2, 7.3**

- [~] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (7 properties)
- Unit tests complement properties by covering specific example-based acceptance criteria
- The `promptInfo` field is optional on `ClaimSummaryResponse`, so older cached responses without it remain valid
- Cache stores the full `ClaimSummaryResponse` as JSON in S3, so `promptInfo` is automatically persisted — no cache schema changes needed
- All frontend components use inline styles consistent with the existing codebase

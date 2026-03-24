# Requirements Document

## Introduction

This feature adds prompt visibility to the "Compare All Strategies" view in the insurance claims portal. Currently, the strategy comparison UI displays summaries, anomalies, evaluation scores, document counts, and processing times for each strategy (full-context, rag, graph-rag), but does not show the actual LLM prompts used. This feature exposes the prompt template, strategy label, and retrieval query (for rag/graph-rag) in the API response and renders them in the comparison UI, enabling users to understand and tune summarization behavior.

## Glossary

- **Orchestrator**: The `claim-summary-orchestrator` Lambda function that routes summarization requests to the appropriate strategy, builds prompts, invokes Bedrock, and returns responses.
- **Prompt_Template**: The static portion of the LLM prompt built by `buildSummaryPrompt`, excluding the variable documents text. Contains the system instructions, anomaly detection rules, date comparison rules, and JSON output format specification.
- **Strategy_Label**: The strategy identifier string embedded in the prompt (e.g., `"full-context"`, `"rag (semantic chunking)"`, `"graph-rag (Neptune Analytics GraphRAG)"`).
- **Retrieval_Query**: The natural-language query sent to the Bedrock Knowledge Base Retrieve API for rag and graph-rag strategies to fetch relevant document chunks.
- **Prompt_Info**: A JSON object containing `promptTemplate`, `strategyLabel`, and optionally `retrievalQuery`, returned as part of the `ClaimSummaryResponse`.
- **Comparison_Panel**: The `StrategyComparisonPanel` React component that renders side-by-side strategy result cards.
- **Strategy_Column**: The `StrategyColumn` React component that renders an individual strategy's full results including summary, anomalies, evaluation scores, and metadata.
- **ClaimSummaryResponse**: The TypeScript interface (defined in both `src/types/claim-summary.ts` and `frontend/src/services/claimApi.ts`) that describes the shape of the summary API response.

## Requirements

### Requirement 1: Return Prompt Information in API Response

**User Story:** As a claims analyst, I want the summary API to return the prompt information used for each strategy, so that I can inspect what instructions the LLM received.

#### Acceptance Criteria

1. WHEN a summary is generated successfully, THE Orchestrator SHALL include a `promptInfo` field in the ClaimSummaryResponse containing the Prompt_Template (without the documents text), the Strategy_Label, and the Retrieval_Query (when applicable).
2. THE Orchestrator SHALL populate `promptInfo.promptTemplate` with the static prompt text where the documents text placeholder reads `"[DOCUMENTS]"` instead of the actual document content.
3. THE Orchestrator SHALL populate `promptInfo.strategyLabel` with the exact strategy string passed to `buildSummaryPrompt` (e.g., `"full-context"`, `"rag (semantic chunking)"`, `"graph-rag (Neptune Analytics GraphRAG)"`).
4. WHEN the strategy is `rag` or `graph-rag`, THE Orchestrator SHALL populate `promptInfo.retrievalQuery` with the retrieval query text sent to the Bedrock Knowledge Base Retrieve API.
5. WHEN the strategy is `full-context`, THE Orchestrator SHALL omit the `retrievalQuery` field from `promptInfo`.

### Requirement 2: Include Prompt Information in Cached Responses

**User Story:** As a claims analyst, I want cached summary responses to also include prompt information, so that prompt visibility is consistent regardless of whether the response is fresh or cached.

#### Acceptance Criteria

1. WHEN a summary is stored in the cache, THE Orchestrator SHALL include the `promptInfo` field in the cached content stored in S3.
2. WHEN a cached summary is retrieved, THE Orchestrator SHALL return the `promptInfo` field from the cached content in the ClaimSummaryResponse.

### Requirement 3: Update Backend Type Definitions

**User Story:** As a developer, I want the TypeScript type definitions to include prompt information, so that the API contract is well-defined and type-safe.

#### Acceptance Criteria

1. THE ClaimSummaryResponse interface in `src/types/claim-summary.ts` SHALL include an optional `promptInfo` field of type `PromptInfo`.
2. THE `PromptInfo` interface SHALL define `promptTemplate` as a required string field, `strategyLabel` as a required string field, and `retrievalQuery` as an optional string field.

### Requirement 4: Update Frontend Type Definitions

**User Story:** As a developer, I want the frontend type definitions to match the updated API response, so that prompt data can be consumed type-safely in React components.

#### Acceptance Criteria

1. THE ClaimSummaryResponse interface in `frontend/src/services/claimApi.ts` SHALL include an optional `promptInfo` field matching the backend PromptInfo shape.
2. THE ClaimSummaryResponse interface in `frontend/src/components/StrategyComparisonPanel.tsx` SHALL include an optional `promptInfo` field matching the backend PromptInfo shape.

### Requirement 5: Display Prompt Information in Strategy Column

**User Story:** As a claims analyst, I want to see the prompt used for each strategy in the strategy comparison view, so that I can understand and compare what instructions each strategy sends to the LLM.

#### Acceptance Criteria

1. WHEN a strategy result includes `promptInfo`, THE Strategy_Column SHALL render a collapsible "LLM Prompt" section below the evaluation scores and above the summary text.
2. THE Strategy_Column SHALL display the `promptTemplate` in a scrollable, monospace-font container with a maximum height of 200 pixels.
3. WHEN `promptInfo.retrievalQuery` is present, THE Strategy_Column SHALL display the retrieval query in a labeled subsection above the prompt template.
4. THE Strategy_Column SHALL render the prompt section in a collapsed state by default to avoid overwhelming the view.
5. WHEN the user clicks the prompt section header, THE Strategy_Column SHALL toggle between collapsed and expanded states.

### Requirement 6: Display Prompt Preview in Comparison Panel Cards

**User Story:** As a claims analyst, I want a brief prompt indicator in the comparison panel cards, so that I can quickly see whether prompts differ across strategies without expanding each card.

#### Acceptance Criteria

1. WHEN a comparison card's response includes `promptInfo`, THE Comparison_Panel SHALL display the Strategy_Label below the metadata row.
2. WHEN a comparison card's response includes `promptInfo` with a `retrievalQuery`, THE Comparison_Panel SHALL display a "KB Query" indicator showing a truncated preview (first 80 characters) of the retrieval query.

### Requirement 7: Validate Prompt Info in Response Parser

**User Story:** As a developer, I want the response parser to validate the promptInfo field, so that malformed responses are caught early.

#### Acceptance Criteria

1. WHEN the API response contains a `promptInfo` field, THE `parseClaimSummaryResponse` function SHALL validate that `promptInfo.promptTemplate` is a string and `promptInfo.strategyLabel` is a string.
2. WHEN the API response contains a `promptInfo` field with a `retrievalQuery`, THE `parseClaimSummaryResponse` function SHALL validate that `retrievalQuery` is a string.
3. WHEN the API response does not contain a `promptInfo` field, THE `parseClaimSummaryResponse` function SHALL treat the response as valid (backward compatibility).

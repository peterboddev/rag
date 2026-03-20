# Requirements Document

## Introduction

This feature adds a dedicated full-summary comparison view to the insurance claim portal. Currently, the ClaimSummaryModal generates summaries one strategy at a time, and the StrategyComparisonPanel only shows truncated summary previews alongside evaluation scores. Users need a way to view the complete summary output from all three strategies (Full Context, RAG, Graph RAG) side by side in a three-column layout, enabling direct qualitative comparison of summary content.

## Glossary

- **Comparison_View**: A new React component that displays full claim summaries from all three strategies in a three-column layout within the ClaimSummaryModal
- **Strategy_Column**: A single column within the Comparison_View that displays the full summary output, metadata, and loading state for one summarization strategy
- **Summary_Generator**: The existing `getClaimSummary()` API client function that calls POST /claims/{claimId}/summary with a strategy parameter
- **Full_Context_Strategy**: A summarization strategy that passes all document text directly to the LLM without retrieval
- **RAG_Strategy**: A summarization strategy that uses Knowledge Base retrieval with configurable chunking
- **Graph_RAG_Strategy**: A summarization strategy that builds a knowledge graph for entity-relationship-aware retrieval
- **ClaimSummaryModal**: The existing modal component that allows users to select a strategy and generate a single summary at a time
- **Strategy_Tab**: A tab control within the ClaimSummaryModal that switches between the single-strategy generation view and the Comparison_View

## Requirements

### Requirement 1: Tab Navigation for Comparison View

**User Story:** As a claims reviewer, I want to switch between single-strategy generation and a full comparison view, so that I can choose the workflow that fits my current task.

#### Acceptance Criteria

1. WHEN the ClaimSummaryModal opens, THE Strategy_Tab SHALL display two tabs: "Generate Summary" and "Compare All Strategies"
2. WHEN the user selects the "Compare All Strategies" tab, THE ClaimSummaryModal SHALL display the Comparison_View
3. WHEN the user selects the "Generate Summary" tab, THE ClaimSummaryModal SHALL display the existing single-strategy generation interface
4. THE Strategy_Tab SHALL visually indicate which tab is currently active using a distinct background color and border style

### Requirement 2: Three-Column Summary Layout

**User Story:** As a claims reviewer, I want to see full summaries from all three strategies displayed side by side, so that I can directly compare the quality and content of each approach.

#### Acceptance Criteria

1. THE Comparison_View SHALL display three Strategy_Columns arranged horizontally: one for Full_Context_Strategy, one for RAG_Strategy, and one for Graph_RAG_Strategy
2. THE Comparison_View SHALL label each Strategy_Column with the strategy name: "Full Context", "RAG", and "Graph RAG"
3. WHEN the Comparison_View is displayed, each Strategy_Column SHALL show the complete, untruncated summary text with vertical scrolling enabled for overflow
4. THE Comparison_View SHALL allocate equal width to each Strategy_Column

### Requirement 3: Summary Generation for Comparison

**User Story:** As a claims reviewer, I want to generate summaries for all three strategies from the comparison view, so that I can populate the columns with content to compare.

#### Acceptance Criteria

1. WHEN the user opens the Comparison_View, THE Comparison_View SHALL display a "Generate All" button that triggers summary generation for all three strategies
2. WHEN the user clicks "Generate All", THE Summary_Generator SHALL be called once for each of the three strategies (full-context, rag, graph-rag) concurrently
3. WHEN a summary is successfully generated for a strategy, THE corresponding Strategy_Column SHALL display the full summary text, anomaly count, document count, and processing time
4. WHILE a summary is being generated for a strategy, THE corresponding Strategy_Column SHALL display a loading indicator with the strategy name
5. IF a summary generation fails for a strategy, THEN THE corresponding Strategy_Column SHALL display the error message without affecting the other columns

### Requirement 4: Individual Strategy Regeneration

**User Story:** As a claims reviewer, I want to regenerate a summary for a single strategy without re-running all three, so that I can refresh one result without waiting for the others.

#### Acceptance Criteria

1. WHEN a Strategy_Column has a loaded summary, THE Strategy_Column SHALL display a "Regenerate" button
2. WHEN the user clicks "Regenerate" on a Strategy_Column, THE Summary_Generator SHALL be called with `forceRegenerate: true` for that strategy only
3. WHILE a single strategy is regenerating, THE other Strategy_Columns SHALL remain unchanged and interactive

### Requirement 5: Summary Metadata Display

**User Story:** As a claims reviewer, I want to see key metadata for each strategy's summary, so that I can compare processing characteristics alongside content.

#### Acceptance Criteria

1. WHEN a summary is loaded in a Strategy_Column, THE Strategy_Column SHALL display the document count used for that summary
2. WHEN a summary is loaded in a Strategy_Column, THE Strategy_Column SHALL display the processing time in milliseconds
3. WHEN a summary is loaded in a Strategy_Column, THE Strategy_Column SHALL display whether the result was served from cache
4. WHEN a summary includes evaluation scores, THE Strategy_Column SHALL display helpfulness, faithfulness, and completeness scores

### Requirement 6: Responsive Layout

**User Story:** As a claims reviewer, I want the comparison view to remain usable on smaller screens, so that I can compare strategies regardless of my display size.

#### Acceptance Criteria

1. WHEN the ClaimSummaryModal width is below 900 pixels, THE Comparison_View SHALL stack the three Strategy_Columns vertically instead of horizontally
2. THE Comparison_View SHALL use a minimum column width of 250 pixels to maintain readability of summary text

### Requirement 7: Anomaly Comparison

**User Story:** As a claims reviewer, I want to see anomaly counts per strategy, so that I can evaluate which strategy detects the most data issues.

#### Acceptance Criteria

1. WHEN a summary includes detected anomalies, THE Strategy_Column SHALL display the total anomaly count grouped by severity (critical, warning, info)
2. WHEN no anomalies are detected for a strategy, THE Strategy_Column SHALL display a "No anomalies detected" indicator

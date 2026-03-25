# Requirements Document

## Introduction

The ClaimSummaryModal currently provides two tabs: "Generate Summary" (single-strategy workflow) and "Compare All Strategies" (side-by-side StrategyComparisonView). The Compare All Strategies tab now covers all functionality previously unique to the Generate Summary tab — per-strategy generation, regeneration, evaluation scores, prompt visibility, and anomaly detection — in a superior side-by-side layout. This feature removes the redundant Generate Summary tab, eliminates the tab bar entirely, and defaults the modal to show only the StrategyComparisonView. Dead code from the single-strategy workflow and the StrategyComparisonPanel component are removed.

## Glossary

- **ClaimSummaryModal**: The React modal component (`frontend/src/components/ClaimSummaryModal.tsx`) that displays claim summary generation UI, opened from ClaimDetailPage.
- **StrategyComparisonView**: The React component (`frontend/src/components/StrategyComparisonView.tsx`) that renders three strategy columns side-by-side with concurrent generation, per-column regeneration, evaluation scores, prompt visibility, and anomaly detection.
- **StrategyComparisonPanel**: The React component (`frontend/src/components/StrategyComparisonPanel.tsx`) that renders evaluation-score comparison cards within the old Generate Summary tab. Becomes dead code after this change.
- **Generate_Summary_Tab**: The tab in ClaimSummaryModal that provides single-strategy selection, chunking method selector, include-evaluation checkbox, and single-strategy generate/regenerate buttons.
- **Tab_Bar**: The horizontal bar below the modal header containing the "Generate Summary" and "Compare All Strategies" tab buttons.
- **Dead_Code**: State variables, handlers, imports, constants, and components that are no longer reachable after the Generate Summary tab and its associated workflows are removed.

## Requirements

### Requirement 1: Remove Tab Bar and Default to Comparison View

**User Story:** As a user, I want the ClaimSummaryModal to open directly to the comparison view without a tab bar, so that I see the most useful layout immediately without extra navigation.

#### Acceptance Criteria

1. WHEN the ClaimSummaryModal opens, THE ClaimSummaryModal SHALL render the StrategyComparisonView as its sole content area without displaying a Tab_Bar.
2. THE ClaimSummaryModal SHALL NOT render any tab buttons for "Generate Summary" or "Compare All Strategies".
3. THE ClaimSummaryModal SHALL use a fixed max-width of 1200px for the modal dialog container.

### Requirement 2: Preserve Modal Shell Behavior

**User Story:** As a user, I want the modal to retain its existing shell behavior (header, close button, overlay, escape key), so that the interaction model remains consistent.

#### Acceptance Criteria

1. THE ClaimSummaryModal SHALL render a header displaying the claim ID with a close button.
2. WHEN the user clicks the close button, THE ClaimSummaryModal SHALL invoke the onClose callback.
3. WHEN the user presses the Escape key while the modal is open, THE ClaimSummaryModal SHALL invoke the onClose callback.
4. WHEN the user clicks the overlay backdrop outside the modal dialog, THE ClaimSummaryModal SHALL invoke the onClose callback.
5. THE ClaimSummaryModal SHALL set focus to the dialog container when the modal opens.
6. THE ClaimSummaryModal SHALL render with role="dialog" and aria-modal="true" attributes on the overlay element.

### Requirement 3: Remove Single-Strategy Generate Tab Code

**User Story:** As a developer, I want all code related to the single-strategy Generate Summary tab removed from ClaimSummaryModal, so that the codebase stays clean and maintainable.

#### Acceptance Criteria

1. THE ClaimSummaryModal SHALL NOT contain state variables for activeTab, strategy, chunkingMethod, includeEvaluation, response, showComparison, comparisonData, comparisonLoading, or promptExpanded.
2. THE ClaimSummaryModal SHALL NOT contain the handleGenerate or handleCompareStrategies callback functions.
3. THE ClaimSummaryModal SHALL NOT import the EvaluationScoreDisplay component.
4. THE ClaimSummaryModal SHALL NOT import the StrategyComparisonPanel component.
5. THE ClaimSummaryModal SHALL NOT contain the STRATEGY_OPTIONS or CHUNKING_OPTIONS constant arrays.
6. THE ClaimSummaryModal SHALL NOT render strategy selection radio buttons, chunking method selectors, the include-evaluation checkbox, or single-strategy generate/regenerate buttons.

### Requirement 4: Remove StrategyComparisonPanel Component

**User Story:** As a developer, I want the StrategyComparisonPanel component file deleted, so that unused code does not remain in the repository.

#### Acceptance Criteria

1. THE file `frontend/src/components/StrategyComparisonPanel.tsx` SHALL NOT exist in the repository after this change.

### Requirement 5: Retain Exported Pure Helper Functions

**User Story:** As a developer, I want the exported pure helper functions (getAnomalySeverityColor, extractDisplayFields) to remain available, so that existing tests and potential consumers continue to work.

#### Acceptance Criteria

1. THE ClaimSummaryModal module SHALL continue to export the getAnomalySeverityColor function with the same signature and behavior.
2. THE ClaimSummaryModal module SHALL continue to export the extractDisplayFields function with the same signature and behavior.
3. THE type definitions required by getAnomalySeverityColor and extractDisplayFields (DataAnomaly, EvaluationScores, PromptInfo, ClaimSummaryResponse) SHALL remain defined in ClaimSummaryModal.

### Requirement 6: Reset Comparison View State on Modal Open

**User Story:** As a user, I want the comparison view to start fresh each time I open the modal, so that I do not see stale results from a previous session.

#### Acceptance Criteria

1. WHEN the ClaimSummaryModal opens (isOpen transitions to true), THE ClaimSummaryModal SHALL reset the StrategyComparisonView to its initial idle state by remounting the component.

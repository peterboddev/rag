# Implementation Plan: Remove Generate Tab

## Overview

Simplify ClaimSummaryModal by removing the redundant "Generate Summary" tab, tab bar, and all associated dead code. The modal defaults to StrategyComparisonView as its sole content. Delete the unused StrategyComparisonPanel component. Retain exported pure helpers and their types.

## Tasks

- [x] 1. Remove dead imports, state, handlers, and constants from ClaimSummaryModal
  - [x] 1.1 Strip dead code from ClaimSummaryModal
    - Remove imports: `getClaimSummary`, `getClaimEvaluations`, `EvaluationScoreDisplay`, `StrategyComparisonPanel`
    - Remove state variables: `activeTab`, `strategy`, `chunkingMethod`, `includeEvaluation`, `isLoading`, `error`, `response`, `showComparison`, `comparisonData`, `comparisonLoading`, `promptExpanded`
    - Remove callbacks: `handleGenerate`, `handleCompareStrategies`
    - Remove constants: `STRATEGY_OPTIONS`, `CHUNKING_OPTIONS`
    - Remove unused type aliases `Strategy` and `ChunkingMethod`
    - Remove the `useState` import if no longer needed (keep `useEffect`, `useRef`, `useCallback` only if used)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.2 Remove tab bar and Generate tab JSX, default to StrategyComparisonView
    - Remove the tab bar `<div>` containing "Generate Summary" and "Compare All Strategies" buttons
    - Remove all Generate tab JSX (strategy radios, chunking selector, include-evaluation checkbox, generate/regenerate buttons, error display, loading indicator, summary results, compare strategies button, StrategyComparisonPanel)
    - Render `<StrategyComparisonView claimId={claimId} />` as the sole content inside the scrollable area
    - Set `maxWidth: '1200px'` unconditionally on the dialog container
    - _Requirements: 1.1, 1.2, 1.3, 3.6_

  - [x] 1.3 Add key-based remount for StrategyComparisonView reset
    - Add a `mountKey` counter state (via `useState`) that increments each time `isOpen` transitions to `true`
    - Pass `key={mountKey}` to `StrategyComparisonView` to force remount and reset internal state
    - Simplify the existing reset `useEffect` to only manage the mount key increment
    - Keep focus-trap `useEffect` and escape-key `useEffect` unchanged
    - _Requirements: 6.1_

  - [x] 1.4 Verify retained exports and types
    - Confirm `getAnomalySeverityColor` and `extractDisplayFields` remain exported with unchanged signatures
    - Confirm type definitions `DataAnomaly`, `EvaluationScores`, `PromptInfo`, `ClaimSummaryResponse` remain in the file
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 2. Delete StrategyComparisonPanel component
  - [x] 2.1 Delete `frontend/src/components/StrategyComparisonPanel.tsx`
    - Remove the file from the repository
    - _Requirements: 4.1_

- [x] 3. Checkpoint - Verify compilation and modal shell behavior
  - Ensure the project compiles without errors (no dangling imports of StrategyComparisonPanel)
  - Ensure all existing tests pass
  - Verify modal shell preserved: header with claim ID, close button, escape key, overlay click, focus trap, role="dialog", aria-modal="true"
  - Ask the user if questions arise.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 4. Write tests for removed tab and preserved behavior
  - [x] 4.1 Write unit tests for simplified ClaimSummaryModal
    - Test: modal renders StrategyComparisonView without tab bar or tab buttons (Req 1.1, 1.2)
    - Test: modal dialog container has maxWidth 1200px (Req 1.3)
    - Test: header displays claim ID and close button (Req 2.1)
    - Test: close button click invokes onClose (Req 2.2)
    - Test: escape key invokes onClose (Req 2.3)
    - Test: overlay click invokes onClose (Req 2.4)
    - Test: dialog receives focus on open (Req 2.5)
    - Test: overlay has role="dialog" and aria-modal="true" (Req 2.6)
    - Test: no strategy radio buttons, chunking selectors, or generate buttons rendered (Req 3.6)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.6_

  - [ ]* 4.2 Write property test for anomaly severity color mapping (Property 1)
    - **Property 1: Anomaly severity color mapping is total and deterministic**
    - For any string input, `getAnomalySeverityColor` returns one of four hex colors; for known severities it returns the specific mapped color
    - **Validates: Requirements 5.1**

  - [ ]* 4.3 Write property test for extractDisplayFields round-trip (Property 2)
    - **Property 2: extractDisplayFields preserves all response fields**
    - For any valid `ClaimSummaryResponse`, the output fields match the input and `hasEvaluation === !!response.evaluation`
    - **Validates: Requirements 5.2**

  - [ ]* 4.4 Write property test for StrategyComparisonView reset on modal open (Property 3)
    - **Property 3: StrategyComparisonView resets to idle on each modal open**
    - For any sequence of open/close cycles, the `key` prop changes on each open, forcing a remount
    - **Validates: Requirements 6.1**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript/React — all code examples use TypeScript

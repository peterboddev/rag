# Implementation Plan: Strategy Comparison View

## Overview

Add a tab-based comparison view to the existing ClaimSummaryModal that displays full, untruncated summaries from all three strategies (Full Context, RAG, Graph RAG) in a side-by-side three-column layout. This involves creating two new components (`StrategyComparisonView`, `StrategyColumn`) and modifying `ClaimSummaryModal` to add tab navigation and dynamic width.

## Tasks

- [x] 1. Create StrategyColumn component
  - [x] 1.1 Create `frontend/src/components/StrategyColumn.tsx` with the `StrategyColumnProps` and `ColumnState` interfaces
    - Render four states: idle (empty placeholder), loading (spinner with strategy name), error (error message), success (full summary, metadata, anomalies, evaluation scores)
    - Display full untruncated summary text with vertical scroll (`overflowY: auto`)
    - Display metadata: document count, processing time, cache indicator
    - Display anomaly counts grouped by severity (critical, warning, info) or "No anomalies detected" when empty
    - Conditionally render `EvaluationScoreDisplay` when `evaluation` is present
    - Show "Regenerate" button only in success state, calling `onRegenerate` prop
    - Apply `minWidth: 250px` and `flex: 1 1 0` for equal column width
    - _Requirements: 2.2, 2.3, 2.4, 3.3, 3.4, 3.5, 4.1, 5.1, 5.2, 5.3, 5.4, 6.2, 7.1, 7.2_

  - [ ]* 1.2 Write property tests for StrategyColumn
    - **Property 2: Summary text is never truncated**
    - **Property 5: Successful column displays all required metadata**
    - **Property 6: Loading column displays strategy-specific indicator**
    - **Property 7: Column state independence**
    - **Property 8: Regenerate button visibility follows column state**
    - **Property 10: Cache status indicator reflects response**
    - **Property 11: Evaluation scores are rendered when present**
    - **Property 12: Minimum column width**
    - **Property 13: Anomaly counts are correctly grouped by severity**
    - **Validates: Requirements 2.3, 2.4, 3.3, 3.4, 3.5, 4.1, 4.3, 5.1, 5.2, 5.3, 5.4, 6.2, 7.1, 7.2**

- [x] 2. Create StrategyComparisonView component
  - [x] 2.1 Create `frontend/src/components/StrategyComparisonView.tsx` with `StrategyComparisonViewProps`
    - Maintain a `Record<Strategy, ColumnState>` for the three strategies (full-context, rag, graph-rag)
    - Render a "Generate All" button that calls `getClaimSummary` concurrently for all three strategies via `Promise.allSettled`
    - Pass `chunkingMethod: 'semantic'` for the RAG strategy call
    - Update each column's state independently based on settled promise results
    - Render three `StrategyColumn` instances with labels "Full Context", "RAG", "Graph RAG"
    - Implement individual regeneration: call `getClaimSummary` with `forceRegenerate: true` for a single strategy
    - Use `ResizeObserver` on the container to detect width < 900px and switch flex-direction from row to column
    - Apply `flex: 1 1 0` and `minWidth: 250px` to each column wrapper
    - _Requirements: 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 6.1, 6.2_

  - [ ]* 2.2 Write property tests for StrategyComparisonView
    - **Property 3: Equal column width allocation**
    - **Property 4: Generate All triggers exactly three concurrent API calls**
    - **Property 9: Regenerate calls API with correct parameters**
    - **Validates: Requirements 2.4, 3.2, 4.2**

- [x] 3. Modify ClaimSummaryModal to add tab navigation
  - [x] 3.1 Add tab state and tab bar to `frontend/src/components/ClaimSummaryModal.tsx`
    - Add `activeTab` state of type `'generate' | 'compare'`, defaulting to `'generate'`
    - Render a tab bar below the modal header with two tabs: "Generate Summary" and "Compare All Strategies"
    - Active tab gets distinct background color and bottom border; inactive tab gets default styling
    - When `activeTab === 'generate'`, render the existing single-strategy view
    - When `activeTab === 'compare'`, render `StrategyComparisonView` with `claimId`
    - Widen modal `maxWidth` from `800px` to `1200px` when compare tab is active
    - Reset `activeTab` to `'generate'` when modal opens (in the existing `useEffect` on `isOpen`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 3.2 Write property test for tab styling
    - **Property 1: Active tab has distinct styling**
    - **Validates: Requirements 1.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Write unit tests for integration scenarios
  - [ ]* 5.1 Write unit tests for ClaimSummaryModal tab navigation in `unit_tests/strategy-comparison-view.test.ts`
    - Test that modal renders two tabs on open (Requirement 1.1)
    - Test switching to "Compare All Strategies" tab renders StrategyComparisonView (Requirement 1.2)
    - Test switching back to "Generate Summary" tab renders existing view (Requirement 1.3)
    - Test modal widens to 1200px on compare tab
    - Test three columns render with correct labels (Requirements 2.1, 2.2)
    - Test "Generate All" button is present in comparison view (Requirement 3.1)
    - Test responsive stacking at 900px breakpoint (Requirement 6.1)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 6.1_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (13 properties across tasks 1.2, 2.2, 3.2)
- Unit tests complement properties by covering specific example-based acceptance criteria
- All components use inline styles consistent with the existing codebase
- The existing `getClaimSummary()` from `claimApi.ts` is reused with no API changes
- The existing `EvaluationScoreDisplay` component is reused inside `StrategyColumn`

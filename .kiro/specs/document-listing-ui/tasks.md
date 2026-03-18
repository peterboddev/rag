# Implementation Plan: Document Listing UI

## Overview

Replace the placeholder alert in ClaimDetailPage with a functional document listing modal. Implementation proceeds bottom-up: types and utilities first, then the DocumentListItem component, then the DocumentListModal, and finally wiring into ClaimDetailPage. Property-based tests with fast-check validate correctness properties from the design.

## Tasks

- [x] 1. Define types and utility functions
  - [x] 1.1 Add ClaimDocument interface and DocumentActionState type to `frontend/src/services/claimApi.ts`
    - Add `ClaimDocument` interface with fields: `documentId`, `fileName`, `documentType?`, `processingStatus`, `createdAt`, `updatedAt?`
    - Add `DocumentActionState` type for tracking per-document loading states
    - Extend `ClaimStatusResponse` to include optional `documents: ClaimDocument[]` array
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 Create utility functions in `frontend/src/components/DocumentListModal.tsx`
    - Implement `formatDate(isoString: string): string` to convert ISO 8601 to human-readable format
    - Implement `getStatusColor(status: string): string` returning hex color per status
    - Implement `getStatusIcon(status: string): string` returning emoji per status
    - Export utilities for testability
    - _Requirements: 1.5, 4.1, 4.2, 4.3, 4.4_

  - [x]* 1.3 Write property test for date formatting (Property 3)
    - **Property 3: Date formatting produces human-readable output**
    - Generate arbitrary valid ISO 8601 date strings, call `formatDate`, assert output is non-empty and differs from raw ISO input
    - **Validates: Requirements 1.5**

  - [x]* 1.4 Write property test for status indicator mapping (Property 5)
    - **Property 5: Status indicator mapping is total and correct**
    - Generate arbitrary status values from valid set, call `getStatusColor` and `getStatusIcon`, assert non-empty deterministic results
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 2. Implement DocumentListItem component
  - [x] 2.1 Create `frontend/src/components/DocumentListItem.tsx`
    - Accept `DocumentListItemProps` (document, onView, onDownload, isViewLoading, isDownloadLoading)
    - Display document fileName, documentType (or "Unknown" if missing), processingStatus text, and formatted createdAt date
    - Render status indicator with color and icon based on processingStatus
    - Render View and Download buttons, enabled only when processingStatus is "completed"
    - Show loading state on buttons when isViewLoading or isDownloadLoading is true
    - Add `aria-label` attributes to action buttons
    - Truncate long file names with CSS `text-overflow: ellipsis`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.6, 3.1, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x]* 2.2 Write property test for document metadata display (Property 2)
    - **Property 2: Document metadata display**
    - Generate arbitrary ClaimDocument objects, render DocumentListItem, assert fileName, documentType, and processingStatus text appear in output
    - **Validates: Requirements 1.2, 1.3, 1.4, 4.5**

  - [x]* 2.3 Write property test for action button enabled state (Property 4)
    - **Property 4: Action buttons enabled only for completed documents**
    - Generate arbitrary ClaimDocument objects with random statuses, render DocumentListItem, assert buttons disabled when status !== "completed"
    - **Validates: Requirements 2.1, 2.6, 3.1**

- [x] 3. Implement DocumentListModal component
  - [x] 3.1 Create `frontend/src/components/DocumentListModal.tsx` (full component)
    - Accept `DocumentListModalProps` (isOpen, onClose, claimId, documents)
    - Render modal overlay with focus trap and Escape key handler
    - Display loading indicator while fetching documents
    - Display error state with retry button on fetch failure
    - Display empty state message when documents array is empty
    - Render DocumentListItem for each document in the list
    - Implement `handleView`: call `getDocument(documentId)`, open presigned URL in new tab via `window.open`
    - Implement `handleDownload`: call `getDocument(documentId)`, trigger download with original fileName using anchor element
    - Track per-document action loading states via `DocumentActionState`
    - Disable buttons during loading to prevent duplicate API calls
    - Close button in modal header
    - _Requirements: 1.1, 1.6, 1.7, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2, 5.3, 6.1, 6.2_

  - [x]* 3.2 Write property test for document count rendering (Property 1)
    - **Property 1: Document count rendering**
    - Generate arbitrary arrays of ClaimDocument objects, render DocumentListModal, assert rendered DocumentListItem count equals input array length
    - **Validates: Requirements 1.1**

  - [x]* 3.3 Write property test for download filename preservation (Property 6)
    - **Property 6: Download preserves original filename**
    - Generate arbitrary file names, simulate download flow, assert the download anchor uses the exact original fileName
    - **Validates: Requirements 3.3**

- [x] 4. Checkpoint - Verify components render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Wire DocumentListModal into ClaimDetailPage
  - [x] 5.1 Update `frontend/src/components/ClaimDetailPage.tsx`
    - Import DocumentListModal
    - Add state: `documentModalClaimId: string | null` and `documentModalDocuments: ClaimDocument[]`
    - Replace `handleViewDocuments` placeholder alert: set modal state, call `getClaimStatus(claimId)` to fetch documents, open modal
    - Render `<DocumentListModal>` with isOpen, onClose, claimId, and documents props
    - Handle loading and error states during document fetch before modal opens
    - _Requirements: 1.1, 5.1, 5.2, 5.3_

  - [x]* 5.2 Write unit tests for modal integration in ClaimDetailPage
    - Test that clicking "View Documents & Summary" opens the DocumentListModal
    - Test that closing the modal resets state
    - Test that Escape key closes the modal
    - Test error handling when getClaimStatus fails
    - _Requirements: 1.1, 1.7, 5.1, 5.2, 5.3_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check with minimum 100 iterations per property
- All tests go in `unit_tests/document-listing-ui.test.tsx` per project guidelines
- Existing `getClaimStatus` and `getDocument` API functions are reused without modification
- The design uses TypeScript/React, so all implementation follows that stack

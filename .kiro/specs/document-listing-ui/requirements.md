# Requirements Document

## Introduction

This feature replaces the placeholder alert in the ClaimDetailPage with a functional document listing UI. When a claim's documents are fully processed (status: "completed"), users can view a list of all documents associated with that claim, see document metadata (type, status, timestamps), and view or download individual documents via presigned URLs.

## Glossary

- **Document_Listing_UI**: The React component that displays a list of processed documents for a claim
- **Claim_Detail_Page**: The existing page component (`ClaimDetailPage.tsx`) that shows patient and claim information
- **Document_Card**: A UI element displaying individual document information including name, type, status, and action buttons
- **Presigned_URL**: A time-limited S3 URL that allows secure document viewing/downloading
- **Claim_Status_API**: The backend endpoint (`/claims/{claimId}/status`) that returns claim and document information
- **Document_Retrieval_API**: The backend endpoint (`/documents/{documentId}`) that returns presigned URLs for document access

## Requirements

### Requirement 1: Display Document List Modal

**User Story:** As a claims processor, I want to see a list of all documents for a completed claim, so that I can review the claim materials.

#### Acceptance Criteria

1. WHEN the user clicks "View Documents & Summary" on a completed claim, THE Document_Listing_UI SHALL display a modal or panel showing all documents for that claim
2. THE Document_Listing_UI SHALL display the document file name for each document in the list
3. THE Document_Listing_UI SHALL display the document type (if available) for each document
4. THE Document_Listing_UI SHALL display the processing status for each document
5. THE Document_Listing_UI SHALL display the creation date for each document in a human-readable format
6. WHILE the document list is loading, THE Document_Listing_UI SHALL display a loading indicator
7. IF the document list fails to load, THEN THE Document_Listing_UI SHALL display an error message with a retry option

### Requirement 2: View Individual Documents

**User Story:** As a claims processor, I want to view individual documents, so that I can examine the claim evidence.

#### Acceptance Criteria

1. THE Document_Card SHALL display a "View" button for each document with status "completed"
2. WHEN the user clicks the "View" button, THE Document_Listing_UI SHALL call the Document_Retrieval_API to obtain a presigned URL
3. WHEN the presigned URL is successfully retrieved, THE Document_Listing_UI SHALL open the document in a new browser tab
4. WHILE the presigned URL is being retrieved, THE Document_Card SHALL display a loading state on the View button
5. IF the presigned URL retrieval fails, THEN THE Document_Listing_UI SHALL display an error message to the user
6. WHERE a document has status other than "completed", THE Document_Card SHALL disable the View button

### Requirement 3: Download Individual Documents

**User Story:** As a claims processor, I want to download documents, so that I can save them locally for offline review.

#### Acceptance Criteria

1. THE Document_Card SHALL display a "Download" button for each document with status "completed"
2. WHEN the user clicks the "Download" button, THE Document_Listing_UI SHALL initiate a file download using the presigned URL
3. THE Document_Listing_UI SHALL preserve the original file name when downloading
4. WHILE the download is being prepared, THE Document_Card SHALL display a loading state on the Download button
5. IF the download fails, THEN THE Document_Listing_UI SHALL display an error message to the user

### Requirement 4: Document Status Indicators

**User Story:** As a claims processor, I want to see the processing status of each document, so that I know which documents are ready for review.

#### Acceptance Criteria

1. THE Document_Card SHALL display a visual status indicator (icon and/or color) based on processing status
2. WHEN a document has status "completed", THE Document_Card SHALL display a green success indicator
3. WHEN a document has status "processing" or "queued", THE Document_Card SHALL display a yellow/amber in-progress indicator
4. WHEN a document has status "failed", THE Document_Card SHALL display a red error indicator
5. THE Document_Card SHALL display the status text alongside the visual indicator

### Requirement 5: Close Document List

**User Story:** As a claims processor, I want to close the document list and return to the claim view, so that I can continue reviewing other claims.

#### Acceptance Criteria

1. THE Document_Listing_UI SHALL display a close button or mechanism to dismiss the document list
2. WHEN the user clicks the close button, THE Document_Listing_UI SHALL close and return focus to the Claim_Detail_Page
3. WHEN the user presses the Escape key, THE Document_Listing_UI SHALL close the document list modal

### Requirement 6: Empty State Handling

**User Story:** As a claims processor, I want to see a clear message when a claim has no documents, so that I understand the claim state.

#### Acceptance Criteria

1. IF a completed claim has zero documents, THEN THE Document_Listing_UI SHALL display an empty state message
2. THE empty state message SHALL indicate that no documents are available for the claim

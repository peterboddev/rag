# Design Document: Document Selection and Summary Interface

## Overview

This design enhances the existing document summary feature by introducing a split-panel interface that allows users to select specific documents for summarization. The interface provides better user control, improved visual organization, and enhanced document management capabilities.

## Architecture

### Component Structure

```
DocumentSummary (Enhanced)
├── CustomerEmailInput
├── DocumentSelectionPanel
│   ├── DocumentList
│   │   ├── DocumentItem (multiple)
│   │   │   ├── SelectionCheckbox
│   │   │   ├── DocumentInfo
│   │   │   ├── StatusIndicator
│   │   │   └── ActionButtons (retry/delete)
│   │   └── SelectionControls (select all/none)
│   └── SummarizeButton
└── SummaryDisplayPanel
    ├── SummaryHeader
    ├── SummaryContent
    └── SummaryActions (copy, etc.)
```

### State Management

The component will manage the following state:

```typescript
interface DocumentSummaryState {
  customerEmail: string;
  documents: DocumentSummaryItem[];
  selectedDocuments: Set<string>; // document IDs
  summaryData: {
    content: string;
    includedDocuments: string[];
    generatedAt: string;
    documentCount: number;
    totalTextLength: number;
  } | null;
  isLoading: boolean;
  isSummarizing: boolean;
  error: string | null;
  retryingDocuments: Set<string>;
  deletingDocuments: Set<string>;
}
```

## Components and Interfaces

### Enhanced DocumentSummary Component

The main component will be restructured to support the new layout:

```typescript
interface DocumentSummaryProps {
  // No props needed - uses auth context
}

interface DocumentSelectionPanelProps {
  documents: DocumentSummaryItem[];
  selectedDocuments: Set<string>;
  onDocumentSelect: (documentId: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSummarize: () => void;
  onRetry: (documentId: string, customerUUID: string) => void;
  onDelete: (documentId: string, customerUUID: string, fileName: string) => void;
  isLoading: boolean;
  isSummarizing: boolean;
  retryingDocuments: Set<string>;
  deletingDocuments: Set<string>;
}

interface SummaryDisplayPanelProps {
  summaryData: SummaryData | null;
  isSummarizing: boolean;
  error: string | null;
}
```

### DocumentItem Component

A new component for individual document display:

```typescript
interface DocumentItemProps {
  document: DocumentSummaryItem;
  isSelected: boolean;
  onSelect: (documentId: string) => void;
  onRetry: (documentId: string, customerUUID: string) => void;
  onDelete: (documentId: string, customerUUID: string, fileName: string) => void;
  isRetrying: boolean;
  isDeleting: boolean;
}
```

## Data Models

### Enhanced DocumentSummaryItem

Extend the existing type to include selection state:

```typescript
interface EnhancedDocumentSummaryItem extends DocumentSummaryItem {
  fileSize?: number;
  confidence?: number;
  pageCount?: number;
  textPreview?: string;
  errorDetails?: string;
}
```

### SummaryData

New interface for summary display:

```typescript
interface SummaryData {
  content: string;
  includedDocuments: DocumentReference[];
  generatedAt: string;
  documentCount: number;
  totalTextLength: number;
  processingTime?: number;
}

interface DocumentReference {
  documentId: string;
  fileName: string;
  textLength: number;
}
```

## API Enhancements

### Selective Summary Endpoint

Create a new endpoint for selective document summarization:

```typescript
// New endpoint: POST /documents/summary/selective
interface SelectiveSummaryRequest {
  customerEmail: string;
  documentIds: string[]; // Only summarize these documents
}

interface SelectiveSummaryResponse {
  summary: string;
  includedDocuments: DocumentReference[];
  documentCount: number;
  totalTextLength: number;
  processingTime: number;
}
```

### Document List Endpoint

Enhance the existing summary endpoint to return more detailed document information:

```typescript
// Enhanced response for existing endpoint
interface EnhancedDocumentSummaryResponse extends DocumentSummaryResponse {
  documents: EnhancedDocumentSummaryItem[]; // More detailed document info
}
```

## User Interface Design

### Layout Structure

```css
.document-summary-container {
  display: flex;
  height: 100vh;
  gap: 20px;
}

.document-selection-panel {
  flex: 0 0 40%;
  min-width: 400px;
  border-right: 1px solid #ddd;
}

.summary-display-panel {
  flex: 1;
  min-width: 500px;
}

@media (max-width: 768px) {
  .document-summary-container {
    flex-direction: column;
    height: auto;
  }
  
  .document-selection-panel {
    flex: none;
    min-width: auto;
    border-right: none;
    border-bottom: 1px solid #ddd;
  }
}
```

### Document List Styling

```css
.document-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.document-item:hover {
  background-color: #f5f5f5;
  border-color: #007bff;
}

.document-item.selected {
  background-color: #e3f2fd;
  border-color: #007bff;
}

.document-item.failed {
  border-left: 4px solid #dc3545;
}

.document-item.completed {
  border-left: 4px solid #28a745;
}

.document-item.processing {
  border-left: 4px solid #ffc107;
}
```

### Status Indicators

Visual indicators for document status:

```typescript
const getStatusIcon = (status: string) => {
  switch (status) {
    case 'completed': return '✅';
    case 'failed': return '❌';
    case 'processing': return '⏳';
    case 'queued': return '⏸️';
    default: return '❓';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed': return '#28a745';
    case 'failed': return '#dc3545';
    case 'processing': return '#ffc107';
    case 'queued': return '#17a2b8';
    default: return '#6c757d';
  }
};
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Selection State Consistency
*For any* document list, the selected documents set should only contain IDs of documents that exist in the current document list
**Validates: Requirements 1.3, 1.4**

### Property 2: Summary Content Correspondence
*For any* generated summary, the included documents list should exactly match the documents that were selected when the summary was requested
**Validates: Requirements 3.1, 6.1**

### Property 3: UI State Synchronization
*For any* document operation (retry/delete), the UI state should be updated to reflect the new document status before allowing further operations
**Validates: Requirements 4.3, 7.3**

### Property 4: Selection Persistence
*For any* summary generation, the document selection state should remain unchanged during and after the summarization process
**Validates: Requirements 2.4, 3.4**

### Property 5: Responsive Layout Integrity
*For any* screen width, the interface should maintain usability with all essential functions accessible
**Validates: Requirements 2.2, 2.3, 8.1**

### Property 6: Error State Recovery
*For any* failed operation, the interface should return to a consistent state that allows users to retry or take alternative actions
**Validates: Requirements 7.1, 7.2, 7.3**

## Error Handling

### Document Loading Errors
- Network failures when fetching document list
- Invalid customer email format
- Customer not found scenarios

### Selection Validation
- Attempting to summarize with no selected documents
- Selecting documents that have no extractable text
- Maximum selection limits (if implemented)

### Summarization Errors
- AI service failures
- Timeout handling for long summarization requests
- Partial failures when some selected documents are inaccessible

### Document Operation Errors
- Retry failures with clear error messages
- Delete operation failures
- Concurrent operation conflicts

## Testing Strategy

### Unit Tests
- Document selection state management
- Summary data formatting and display
- Error handling for various failure scenarios
- Responsive layout behavior

### Property-Based Tests
- Selection state consistency across operations
- Summary content accuracy verification
- UI state synchronization validation
- Error recovery completeness

### Integration Tests
- End-to-end document selection and summarization flow
- Document management operations within selection interface
- Cross-browser compatibility testing
- Accessibility compliance verification

## Performance Considerations

### Optimization Strategies
- Virtualized scrolling for large document lists
- Debounced selection updates
- Memoized summary content rendering
- Lazy loading of document previews

### Caching Strategy
- Cache document lists per customer
- Cache generated summaries with selection fingerprint
- Invalidate cache on document operations

### Loading States
- Skeleton loading for document list
- Progressive loading indicators for summarization
- Optimistic updates for document operations

## Accessibility Requirements

### Keyboard Navigation
- Tab navigation through document list
- Space/Enter for document selection
- Arrow keys for list navigation
- Escape to clear selection

### Screen Reader Support
- Proper ARIA labels for all interactive elements
- Live regions for status updates
- Descriptive text for visual indicators
- Semantic HTML structure

### Visual Accessibility
- High contrast mode support
- Text alternatives for color-coded status
- Scalable text and UI elements
- Focus indicators for all interactive elements

## Migration Strategy

### Backward Compatibility
- Existing document summary functionality remains available
- Gradual rollout with feature flag support
- Fallback to original interface if new features fail

### Data Migration
- No database schema changes required
- Enhanced API responses are additive
- Existing API endpoints remain functional

### User Experience Transition
- Progressive enhancement approach
- User preference storage for interface choice
- Smooth transition animations between views
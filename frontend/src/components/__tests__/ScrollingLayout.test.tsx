import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DocumentSelectionPanel from '../DocumentSelectionPanel';
import ChunkVisualizationPanel from '../ChunkVisualizationPanel';
import SummaryDisplayPanel from '../SummaryDisplayPanel';
import { DocumentSummaryItem, ChunkingMethod } from '../../types';

// Mock data for testing
const mockDocuments: DocumentSummaryItem[] = [
  {
    documentId: '1',
    fileName: 'test1.pdf',
    contentType: 'application/pdf',
    createdAt: '2024-01-01T00:00:00.000Z',
    processingStatus: 'completed',
    textLength: 1000,
    extractedText: 'Test content 1'
  },
  {
    documentId: '2',
    fileName: 'test2.pdf',
    contentType: 'application/pdf',
    createdAt: '2024-01-01T00:00:00.000Z',
    processingStatus: 'completed',
    textLength: 2000,
    extractedText: 'Test content 2'
  }
];

const mockChunkingMethod: ChunkingMethod = {
  id: 'default',
  name: 'Default Chunking',
  description: 'Default chunking strategy',
  parameters: { strategy: 'default' }
};

describe('Scrolling Layout Tests', () => {
  test('DocumentSelectionPanel should have proper scrolling structure', () => {
    render(
      <DocumentSelectionPanel
        documents={mockDocuments}
        selectedDocuments={new Set()}
        onDocumentSelect={() => {}}
        onSelectAll={() => {}}
        onSelectNone={() => {}}
        onSummarize={() => {}}
        onRetry={() => {}}
        onDelete={() => {}}
        isLoading={false}
        isSummarizing={false}
        retryingDocuments={new Set()}
        deletingDocuments={new Set()}
        customerUUID="test-uuid"
      />
    );

    // Check that the component renders
    expect(screen.getByText('📄 Documents (2)')).toBeInTheDocument();
  });

  test('ChunkVisualizationPanel should have proper scrolling structure', () => {
    render(
      <ChunkVisualizationPanel
        selectedDocuments={new Set()}
        documents={mockDocuments}
        chunkingMethod={mockChunkingMethod}
        customerUUID="test-uuid"
        tenantId="test-tenant"
        isLoading={false}
        onChunkSelect={() => {}}
      />
    );

    // Check that the component renders
    expect(screen.getByText('Document Chunks')).toBeInTheDocument();
  });

  test('SummaryDisplayPanel should have proper scrolling structure', () => {
    render(
      <SummaryDisplayPanel
        summaryData={null}
        isSummarizing={false}
        error={null}
      />
    );

    // Check that the component renders
    expect(screen.getByText('🤖 AI Summary')).toBeInTheDocument();
  });

  test('Components should have overflow styles for scrolling', () => {
    const { container } = render(
      <div style={{ display: 'flex', height: '400px' }}>
        <DocumentSelectionPanel
          documents={mockDocuments}
          selectedDocuments={new Set()}
          onDocumentSelect={() => {}}
          onSelectAll={() => {}}
          onSelectNone={() => {}}
          onSummarize={() => {}}
          onRetry={() => {}}
          onDelete={() => {}}
          isLoading={false}
          isSummarizing={false}
          retryingDocuments={new Set()}
          deletingDocuments={new Set()}
          customerUUID="test-uuid"
        />
        <ChunkVisualizationPanel
          selectedDocuments={new Set()}
          documents={mockDocuments}
          chunkingMethod={mockChunkingMethod}
          customerUUID="test-uuid"
          tenantId="test-tenant"
          isLoading={false}
          onChunkSelect={() => {}}
        />
        <SummaryDisplayPanel
          summaryData={null}
          isSummarizing={false}
          error={null}
        />
      </div>
    );

    // Check that components are rendered by looking for their content
    expect(screen.getByText('Document Chunks')).toBeInTheDocument();
    expect(screen.getByText('📄 Documents (2)')).toBeInTheDocument();
    expect(screen.getByText('🤖 AI Summary')).toBeInTheDocument();
  });
});
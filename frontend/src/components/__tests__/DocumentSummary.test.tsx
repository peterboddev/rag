import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DocumentSummary from '../DocumentSummary';
import { AuthContext } from '../../contexts/AuthContext';

// Mock the child components
jest.mock('../DocumentSelectionPanel', () => {
  return function MockDocumentSelectionPanel(props: any) {
    return (
      <div data-testid="document-selection-panel">
        Document Selection Panel
        <button onClick={() => props.onChunkingMethodChange({ id: 'test' })}>
          Change Method
        </button>
      </div>
    );
  };
});

jest.mock('../SummaryDisplayPanel', () => {
  return function MockSummaryDisplayPanel() {
    return <div data-testid="summary-display-panel">Summary Display Panel</div>;
  };
});

// Mock fetch
global.fetch = jest.fn();

const mockAuthContext = {
  user: { username: 'test', email: 'test@example.com', tenantId: 'test-tenant' },
  tenantId: 'test-tenant',
  isAuthenticated: true,
  isLoading: false,
  signIn: jest.fn(),
  signOut: jest.fn(),
  createTenant: jest.fn(),
  joinTenant: jest.fn(),
};

const mockDocumentSummaryResponse = {
  customerUUID: 'test-customer-uuid',
  customerEmail: 'customer@example.com',
  documentCount: 2,
  summary: 'Test summary',
  documents: [
    {
      documentId: 'doc1',
      fileName: 'test1.pdf',
      contentType: 'application/pdf',
      createdAt: '2024-01-01T00:00:00Z',
      processingStatus: 'completed' as const,
      textLength: 1000,
    },
    {
      documentId: 'doc2',
      fileName: 'test2.pdf',
      contentType: 'application/pdf',
      createdAt: '2024-01-02T00:00:00Z',
      processingStatus: 'completed' as const,
      textLength: 1500,
    },
  ],
};

const renderWithAuth = (component: React.ReactElement) => {
  return render(
    <AuthContext.Provider value={mockAuthContext}>
      {component}
    </AuthContext.Provider>
  );
};

describe('DocumentSummary Layout Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDocumentSummaryResponse),
    });
  });

  test('should display three columns when documents are loaded', async () => {
    renderWithAuth(<DocumentSummary />);
    
    // Fill in email and submit
    const emailInput = screen.getByLabelText(/customer email/i);
    const submitButton = screen.getByRole('button', { name: /load documents/i });
    
    fireEvent.change(emailInput, { target: { value: 'customer@example.com' } });
    fireEvent.click(submitButton);
    
    // Wait for documents to load
    await waitFor(() => {
      expect(screen.getByTestId('document-selection-panel')).toBeInTheDocument();
    });
    
    // Check that three-column layout is present
    const layout = document.querySelector('.three-column-layout');
    expect(layout).toBeInTheDocument();
    
    // Check that all three columns are present
    const columns = document.querySelectorAll('.column');
    expect(columns).toHaveLength(3);
    
    // Verify column classes
    expect(document.querySelector('.column-left')).toBeInTheDocument();
    expect(document.querySelector('.column-middle')).toBeInTheDocument();
    expect(document.querySelector('.column-right')).toBeInTheDocument();
  });

  test('should display placeholder message when no documents are selected', async () => {
    renderWithAuth(<DocumentSummary />);
    
    // Fill in email and submit
    const emailInput = screen.getByLabelText(/customer email/i);
    const submitButton = screen.getByRole('button', { name: /load documents/i });
    
    fireEvent.change(emailInput, { target: { value: 'customer@example.com' } });
    fireEvent.click(submitButton);
    
    // Wait for documents to load
    await waitFor(() => {
      expect(screen.getByText('Select documents to view their chunks')).toBeInTheDocument();
    });
  });

  test('should contain document selection panel in left column', async () => {
    renderWithAuth(<DocumentSummary />);
    
    // Fill in email and submit
    const emailInput = screen.getByLabelText(/customer email/i);
    const submitButton = screen.getByRole('button', { name: /load documents/i });
    
    fireEvent.change(emailInput, { target: { value: 'customer@example.com' } });
    fireEvent.click(submitButton);
    
    // Wait for documents to load
    await waitFor(() => {
      const leftColumn = document.querySelector('.column-left');
      const documentPanel = screen.getByTestId('document-selection-panel');
      expect(leftColumn).toContainElement(documentPanel);
    });
  });

  test('should contain chunk visualization placeholder in middle column', async () => {
    renderWithAuth(<DocumentSummary />);
    
    // Fill in email and submit
    const emailInput = screen.getByLabelText(/customer email/i);
    const submitButton = screen.getByRole('button', { name: /load documents/i });
    
    fireEvent.change(emailInput, { target: { value: 'customer@example.com' } });
    fireEvent.click(submitButton);
    
    // Wait for documents to load
    await waitFor(() => {
      const middleColumn = document.querySelector('.column-middle');
      const chunkPlaceholder = document.querySelector('.chunk-visualization-placeholder');
      expect(middleColumn).toContainElement(chunkPlaceholder);
      expect(screen.getByText('Document Chunks')).toBeInTheDocument();
    });
  });

  test('should contain summary display panel in right column', async () => {
    renderWithAuth(<DocumentSummary />);
    
    // Fill in email and submit
    const emailInput = screen.getByLabelText(/customer email/i);
    const submitButton = screen.getByRole('button', { name: /load documents/i });
    
    fireEvent.change(emailInput, { target: { value: 'customer@example.com' } });
    fireEvent.click(submitButton);
    
    // Wait for documents to load
    await waitFor(() => {
      const rightColumn = document.querySelector('.column-right');
      const summaryPanel = screen.getByTestId('summary-display-panel');
      expect(rightColumn).toContainElement(summaryPanel);
    });
  });
});

describe('DocumentSummary Responsive Layout Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDocumentSummaryResponse),
    });
  });

  test('should maintain proportional column widths on viewport resize', async () => {
    // Mock window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });

    renderWithAuth(<DocumentSummary />);
    
    // Fill in email and submit
    const emailInput = screen.getByLabelText(/customer email/i);
    const submitButton = screen.getByRole('button', { name: /load documents/i });
    
    fireEvent.change(emailInput, { target: { value: 'customer@example.com' } });
    fireEvent.click(submitButton);
    
    // Wait for documents to load
    await waitFor(() => {
      const layout = document.querySelector('.three-column-layout');
      expect(layout).toBeInTheDocument();
    });

    // Simulate viewport resize to tablet size
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 768,
    });

    // Trigger resize event
    fireEvent(window, new Event('resize'));

    // Layout should still be present and responsive
    const layout = document.querySelector('.three-column-layout');
    expect(layout).toBeInTheDocument();
    
    // Check that CSS grid is still applied (this would be handled by CSS media queries)
    const computedStyle = window.getComputedStyle(layout!);
    expect(computedStyle.display).toBe('grid');
  });

  test('should handle mobile viewport correctly', async () => {
    // Mock mobile viewport
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 480,
    });

    renderWithAuth(<DocumentSummary />);
    
    // Fill in email and submit
    const emailInput = screen.getByLabelText(/customer email/i);
    const submitButton = screen.getByRole('button', { name: /load documents/i });
    
    fireEvent.change(emailInput, { target: { value: 'customer@example.com' } });
    fireEvent.click(submitButton);
    
    // Wait for documents to load
    await waitFor(() => {
      const layout = document.querySelector('.three-column-layout');
      expect(layout).toBeInTheDocument();
      
      // All columns should still be present
      const columns = document.querySelectorAll('.column');
      expect(columns).toHaveLength(3);
    });
  });
});
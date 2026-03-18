import React, { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { DocumentSummaryRequest, DocumentSummaryResponse, SelectiveSummaryRequest, SelectiveSummaryResponse, ChunkingMethod } from '../types';
import DocumentSelectionPanel from './DocumentSelectionPanel';
import SummaryDisplayPanel from './SummaryDisplayPanel';
import ChunkVisualizationPanel from './ChunkVisualizationPanel';
import NotificationContainer from './NotificationContainer';
import { Notification } from './NotificationToast';

let notificationIdCounter = 0;

const DocumentSummary: React.FC = () => {
  const { tenantId } = useAuth();
  const [customerEmail, setCustomerEmail] = useState('');
  const [summaryData, setSummaryData] = useState<DocumentSummaryResponse | null>(null);
  const [selectiveSummaryData, setSelectiveSummaryData] = useState<SelectiveSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [retryingDocuments, setRetryingDocuments] = useState<Set<string>>(new Set());
  const [deletingDocuments, setDeletingDocuments] = useState<Set<string>>(new Set());
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [currentChunkingMethod, setCurrentChunkingMethod] = useState<ChunkingMethod | undefined>();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const API_BASE_URL = process.env.REACT_APP_API_GATEWAY_URL || 'https://0128pkytnc.execute-api.us-east-1.amazonaws.com/prod';

  const addNotification = useCallback((type: Notification['type'], message: string, details?: string, actions?: Notification['actions']) => {
    const id = `notif-${++notificationIdCounter}`;
    setNotifications(prev => [...prev, { id, type, message, details, actions }]);
    return id;
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleDeleteDocument = async (documentId: string, customerUUID: string, fileName: string) => {
    if (!tenantId) {
      addNotification('error', 'Missing tenant information', 'Please sign in again to continue.');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeletingDocuments(prev => new Set(prev).add(documentId));
      
      const response = await fetch(`${API_BASE_URL}/documents/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify({ documentId, customerUUID })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Delete failed: ${response.statusText}`);
      }

      if (summaryData) {
        await refreshDocumentList();
      }

      setSelectedDocuments(prev => {
        const newSet = new Set(prev);
        newSet.delete(documentId);
        return newSet;
      });

      addNotification('success', `Document "${fileName}" deleted successfully`);

    } catch (err) {
      console.error('Delete error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      addNotification('error', `Failed to delete "${fileName}"`, errorMsg, [
        { label: 'Retry Delete', onClick: () => handleDeleteDocument(documentId, customerUUID, fileName) }
      ]);
    } finally {
      setDeletingDocuments(prev => {
        const newSet = new Set(prev);
        newSet.delete(documentId);
        return newSet;
      });
    }
  };

  const handleRetryDocument = async (documentId: string, customerUUID: string) => {
    if (!tenantId) {
      addNotification('error', 'Missing tenant information', 'Please sign in again to continue.');
      return;
    }

    try {
      setRetryingDocuments(prev => new Set(prev).add(documentId));
      
      const response = await fetch(`${API_BASE_URL}/documents/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify({ documentId, customerUUID })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Retry failed: ${response.statusText}`);
      }

      if (summaryData) {
        await refreshDocumentList();
      }

      addNotification('success', 'Document retry successful', `Text extracted: ${result.textLength} characters`);

    } catch (err) {
      console.error('Retry error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      addNotification('error', 'Document retry failed', errorMsg, [
        { label: 'Try Again', onClick: () => handleRetryDocument(documentId, customerUUID) }
      ]);
    } finally {
      setRetryingDocuments(prev => {
        const newSet = new Set(prev);
        newSet.delete(documentId);
        return newSet;
      });
    }
  };

  const refreshDocumentList = async () => {
    if (!summaryData || !tenantId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/documents/summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify({ customerEmail: summaryData.customerEmail })
      });

      if (response.ok) {
        const refreshedData: DocumentSummaryResponse = await response.json();
        setSummaryData(refreshedData);
      }
    } catch (err) {
      console.error('Error refreshing document list:', err);
    }
  };

  const handleGetDocuments = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!customerEmail.trim() || !tenantId) {
      setError('Please enter a customer email address');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSummaryData(null);
      setSelectiveSummaryData(null);
      setSelectedDocuments(new Set());

      const request: DocumentSummaryRequest = {
        customerEmail: customerEmail.trim()
      };

      const response = await fetch(`${API_BASE_URL}/documents/summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed: ${response.statusText}`);
      }

      const data: DocumentSummaryResponse = await response.json();
      setSummaryData(data);

    } catch (err) {
      console.error('Document fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch documents');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDocumentSelect = (documentId: string) => {
    setSelectedDocuments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(documentId)) {
        newSet.delete(documentId);
      } else {
        newSet.add(documentId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (!summaryData) return;
    
    const selectableDocuments = summaryData.documents.filter(doc => 
      doc.processingStatus === 'completed' && doc.textLength && doc.textLength > 0
    );
    
    setSelectedDocuments(new Set(selectableDocuments.map(doc => doc.documentId)));
  };

  const handleSelectNone = () => {
    setSelectedDocuments(new Set());
  };

  const handleChunkingMethodChange = (method: ChunkingMethod) => {
    console.log('Chunking method changed:', method);
    setCurrentChunkingMethod(method);
    setSelectedDocuments(new Set());
    setSelectiveSummaryData(null);
  };

  const handleSummarize = async () => {
    if (!summaryData || !tenantId || selectedDocuments.size === 0) {
      setSummaryError('No documents selected for summarization');
      return;
    }

    // Req 7.4: Warn when all selected documents have no extractable text
    const selectedDocs = summaryData.documents.filter(doc => selectedDocuments.has(doc.documentId));
    const docsWithText = selectedDocs.filter(doc => doc.textLength && doc.textLength > 0);
    
    if (docsWithText.length === 0) {
      addNotification(
        'warning',
        'No extractable text in selected documents',
        'The selected documents have no text content that can be summarized. Try selecting documents with completed processing status.',
      );
      setSummaryError('All selected documents have no extractable text. Please select documents with available text content.');
      return;
    }

    try {
      setIsSummarizing(true);
      setSummaryError(null);
      setSelectiveSummaryData(null);

      const request: SelectiveSummaryRequest = {
        customerEmail: summaryData.customerEmail,
        documentIds: Array.from(selectedDocuments)
      };

      const response = await fetch(`${API_BASE_URL}/documents/summary/selective`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Summarization failed: ${response.statusText}`);
      }

      const data: SelectiveSummaryResponse = await response.json();
      setSelectiveSummaryData(data);
      addNotification('success', 'Summary generated successfully', `Processed ${data.documentCount} document(s)`);

    } catch (err) {
      console.error('Summarization error:', err);
      setSummaryError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleSummaryRetry = () => {
    handleSummarize();
  };

  const handleClearSummaryError = () => {
    setSummaryError(null);
  };

  return (
    <div className="container">
      {/* Notification Toast Container */}
      <NotificationContainer notifications={notifications} onDismiss={dismissNotification} />

      <h2>Document Summary</h2>
      <p>Select and summarize documents for a specific customer using AI.</p>

      {/* Customer Email Form */}
      <form onSubmit={handleGetDocuments} className="upload-form">
        <div className="form-group">
          <label htmlFor="customerEmail">Customer Email:</label>
          <input
            type="email"
            id="customerEmail"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="Enter customer email address"
            required
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={isLoading || !customerEmail.trim()}
        >
          {isLoading ? (
            <><span aria-hidden="true">⏳</span> Loading Documents...</>
          ) : (
            'Load Documents'
          )}
        </button>
      </form>

      {/* Req 7.1: Error display for document loading failures */}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Req 7.1: No documents found message */}
      {summaryData && summaryData.documents.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #dee2e6',
          marginTop: '20px'
        }} role="status">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
          <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: '#495057' }}>
            No documents found for this customer
          </div>
          <div style={{ fontSize: '14px', color: '#6c757d', maxWidth: '400px', margin: '0 auto' }}>
            This customer does not have any uploaded documents yet. Documents need to be uploaded and processed before they can be summarized.
          </div>
        </div>
      )}

      {/* Three-Column Panel Layout */}
      {summaryData && summaryData.documents.length > 0 && (
        <div className="three-column-layout">
          {/* Left Panel - Document Selection */}
          <div className="column column-left">
            <DocumentSelectionPanel
              documents={summaryData.documents}
              selectedDocuments={selectedDocuments}
              onDocumentSelect={handleDocumentSelect}
              onSelectAll={handleSelectAll}
              onSelectNone={handleSelectNone}
              onSummarize={handleSummarize}
              onRetry={handleRetryDocument}
              onDelete={handleDeleteDocument}
              isLoading={false}
              isSummarizing={isSummarizing}
              retryingDocuments={retryingDocuments}
              deletingDocuments={deletingDocuments}
              customerUUID={summaryData.customerUUID}
              onChunkingMethodChange={handleChunkingMethodChange}
            />
          </div>

          {/* Middle Panel - Chunk Visualization */}
          <div className="column column-middle">
            <ChunkVisualizationPanel
              selectedDocuments={selectedDocuments}
              documents={summaryData.documents}
              chunkingMethod={currentChunkingMethod}
              customerUUID={summaryData.customerUUID}
              tenantId={tenantId || ''}
              isLoading={isLoading}
              onChunkSelect={(chunkId) => console.log('Chunk selected:', chunkId)}
            />
          </div>

          {/* Right Panel - Summary Display */}
          <div className="column column-right">
            <SummaryDisplayPanel
              summaryData={selectiveSummaryData}
              isSummarizing={isSummarizing}
              error={summaryError}
              onRetry={handleSummaryRetry}
              onClearError={handleClearSummaryError}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentSummary;

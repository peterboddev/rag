import React from 'react';
import { DocumentSummaryItem, ChunkingMethod } from '../types';
import DocumentItem from './DocumentItem';
import ChunkingMethodSelector from './ChunkingMethodSelector';

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
  customerUUID: string;
  onChunkingMethodChange?: (method: ChunkingMethod) => void;
}

const DocumentSelectionPanel: React.FC<DocumentSelectionPanelProps> = ({
  documents,
  selectedDocuments,
  onDocumentSelect,
  onSelectAll,
  onSelectNone,
  onSummarize,
  onRetry,
  onDelete,
  isLoading,
  isSummarizing,
  retryingDocuments,
  deletingDocuments,
  customerUUID,
  onChunkingMethodChange
}) => {
  // Filter documents that can be selected (completed with text)
  const selectableDocuments = documents.filter(doc => 
    doc.processingStatus === 'completed' && doc.textLength && doc.textLength > 0
  );

  const allSelectableSelected = selectableDocuments.length > 0 && 
    selectableDocuments.every(doc => selectedDocuments.has(doc.documentId));

  const someSelected = selectedDocuments.size > 0;

  const getDocumentStats = () => {
    const completed = documents.filter(doc => doc.processingStatus === 'completed').length;
    const failed = documents.filter(doc => doc.processingStatus === 'failed').length;
    const processing = documents.filter(doc => doc.processingStatus === 'processing').length;
    const queued = documents.filter(doc => doc.processingStatus === 'queued').length;

    return { completed, failed, processing, queued };
  };

  const stats = getDocumentStats();

  if (isLoading) {
    return (
      <div style={{ 
        flex: '1',
        overflow: 'auto',
        padding: '20px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>⏳</div>
          <div>Loading documents...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      flex: '1',
      overflow: 'auto',
      padding: '20px',
      height: '100%'
    }}>
      {/* Header */}
      <div style={{ 
        marginBottom: '20px',
        padding: '20px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #eee'
      }}>
        {/* Chunking Method Selector */}
        <ChunkingMethodSelector
          customerUUID={customerUUID}
          onMethodChange={onChunkingMethodChange}
          disabled={isSummarizing}
        />

        <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>
          📄 Documents ({documents.length})
        </h3>
        
        {/* Document Stats */}
        <div style={{ 
          display: 'flex', 
          gap: '12px', 
          fontSize: '12px',
          marginBottom: '15px'
        }}>
          {stats.completed > 0 && (
            <span style={{ color: '#28a745' }}>
              ✅ {stats.completed} completed
            </span>
          )}
          {stats.failed > 0 && (
            <span style={{ color: '#dc3545' }}>
              ❌ {stats.failed} failed
            </span>
          )}
          {stats.processing > 0 && (
            <span style={{ color: '#ffc107' }}>
              ⏳ {stats.processing} processing
            </span>
          )}
          {stats.queued > 0 && (
            <span style={{ color: '#17a2b8' }}>
              ⏸️ {stats.queued} queued
            </span>
          )}
        </div>

        {/* Selection Controls */}
        {selectableDocuments.length > 0 && (
          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            alignItems: 'center',
            marginBottom: '15px'
          }}>
            <button
              onClick={onSelectAll}
              disabled={allSelectableSelected || isSummarizing}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                backgroundColor: allSelectableSelected ? '#6c757d' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: allSelectableSelected || isSummarizing ? 'not-allowed' : 'pointer',
                opacity: allSelectableSelected || isSummarizing ? 0.6 : 1
              }}
            >
              Select All ({selectableDocuments.length})
            </button>
            
            <button
              onClick={onSelectNone}
              disabled={!someSelected || isSummarizing}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                backgroundColor: !someSelected ? '#6c757d' : '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: !someSelected || isSummarizing ? 'not-allowed' : 'pointer',
                opacity: !someSelected || isSummarizing ? 0.6 : 1
              }}
            >
              Clear Selection
            </button>

            {someSelected && (
              <span style={{ 
                fontSize: '12px', 
                color: '#007bff',
                fontWeight: 'bold'
              }}>
                {selectedDocuments.size} selected
              </span>
            )}
          </div>
        )}

        {/* Summarize Button */}
        <button
          onClick={onSummarize}
          disabled={!someSelected || isSummarizing}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '14px',
            fontWeight: 'bold',
            backgroundColor: someSelected && !isSummarizing ? '#28a745' : '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: someSelected && !isSummarizing ? 'pointer' : 'not-allowed',
            opacity: someSelected && !isSummarizing ? 1 : 0.6,
            transition: 'all 0.2s ease'
          }}
        >
          {isSummarizing ? (
            <>⏳ Generating Summary...</>
          ) : someSelected ? (
            <>🤖 Summarize Selected ({selectedDocuments.size})</>
          ) : (
            <>Select documents to summarize</>
          )}
        </button>

        {/* Help Text */}
        {selectableDocuments.length === 0 && documents.length > 0 && (
          <div style={{
            marginTop: '10px',
            padding: '8px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffeaa7',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#856404'
          }}>
            ℹ️ No documents are ready for summarization. Documents must be successfully processed to be selectable.
          </div>
        )}
      </div>

      {/* Document List */}
      <div>
        {documents.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '40px 20px',
            color: '#6c757d'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
            <div style={{ fontSize: '16px', marginBottom: '8px' }}>No documents found</div>
            <div style={{ fontSize: '14px' }}>Upload some documents to get started</div>
          </div>
        ) : (
          <div>
            {documents.map((document) => (
              <DocumentItem
                key={document.documentId}
                document={document}
                isSelected={selectedDocuments.has(document.documentId)}
                onSelect={onDocumentSelect}
                onRetry={onRetry}
                onDelete={onDelete}
                isRetrying={retryingDocuments.has(document.documentId)}
                isDeleting={deletingDocuments.has(document.documentId)}
                customerUUID={customerUUID}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentSelectionPanel;
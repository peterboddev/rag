import React, { useState, useEffect, useCallback } from 'react';
import { ClaimDocument, DocumentActionState, getDocument } from '../services/claimApi';
import DocumentListItem from './DocumentListItem';

interface DocumentListModalProps {
  isOpen: boolean;
  onClose: () => void;
  claimId: string;
  documents: ClaimDocument[];
}

const DocumentListModal: React.FC<DocumentListModalProps> = ({
  isOpen,
  onClose,
  claimId,
  documents,
}) => {
  const [actionStates, setActionStates] = useState<DocumentActionState>({});
  const [error, setError] = useState<string | null>(null);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleView = useCallback(async (documentId: string) => {
    setActionStates((prev) => ({
      ...prev,
      [documentId]: { ...prev[documentId], isViewLoading: true, isDownloadLoading: prev[documentId]?.isDownloadLoading || false },
    }));
    setError(null);

    try {
      const response = await getDocument(documentId);
      window.open(response.documentUrl, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to view document');
    } finally {
      setActionStates((prev) => ({
        ...prev,
        [documentId]: { ...prev[documentId], isViewLoading: false },
      }));
    }
  }, []);

  const handleDownload = useCallback(async (documentId: string, fileName: string) => {
    setActionStates((prev) => ({
      ...prev,
      [documentId]: { ...prev[documentId], isDownloadLoading: true, isViewLoading: prev[documentId]?.isViewLoading || false },
    }));
    setError(null);

    try {
      const response = await getDocument(documentId);
      // Create anchor element to trigger download with original filename
      const link = document.createElement('a');
      link.href = response.documentUrl;
      link.download = response.fileName || fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download document');
    } finally {
      setActionStates((prev) => ({
        ...prev,
        [documentId]: { ...prev[documentId], isDownloadLoading: false },
      }));
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-list-title"
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          width: '90%',
          maxWidth: '800px',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 id="document-list-title" style={{ margin: 0, fontSize: '18px' }}>
            📄 Documents for Claim {claimId}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '4px 8px',
              color: '#666',
            }}
            aria-label="Close document list"
          >
            ×
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              padding: '12px 20px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderBottom: '1px solid #f5c6cb',
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {/* Content */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {documents.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px',
                color: '#666',
              }}
            >
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
              <div>No documents available for this claim.</div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: '12px', color: '#666', fontSize: '14px' }}>
                {documents.length} document{documents.length !== 1 ? 's' : ''}
              </div>
              {documents.map((doc) => (
                <DocumentListItem
                  key={doc.documentId}
                  document={doc}
                  onView={handleView}
                  onDownload={handleDownload}
                  isViewLoading={actionStates[doc.documentId]?.isViewLoading || false}
                  isDownloadLoading={actionStates[doc.documentId]?.isDownloadLoading || false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentListModal;

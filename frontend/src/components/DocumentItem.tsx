import React from 'react';
import { DocumentSummaryItem } from '../types';

interface DocumentItemProps {
  document: DocumentSummaryItem;
  isSelected: boolean;
  onSelect: (documentId: string) => void;
  onRetry: (documentId: string, customerUUID: string) => void;
  onDelete: (documentId: string, customerUUID: string, fileName: string) => void;
  isRetrying: boolean;
  isDeleting: boolean;
  customerUUID: string;
}

const DocumentItem: React.FC<DocumentItemProps> = ({
  document,
  isSelected,
  onSelect,
  onRetry,
  onDelete,
  isRetrying,
  isDeleting,
  customerUUID
}) => {
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

  const getFileTypeIcon = (contentType: string) => {
    if (contentType.includes('pdf')) return '📄';
    if (contentType.includes('word') || contentType.includes('document')) return '📝';
    if (contentType.includes('text')) return '📃';
    if (contentType.includes('image')) return '🖼️';
    return '📎';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Removed unused formatFileSize function

  const handleCheckboxChange = () => {
    onSelect(document.documentId);
  };

  const handleRetryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRetry(document.documentId, customerUUID);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(document.documentId, customerUUID, document.fileName);
  };

  const canBeSelected = document.processingStatus === 'completed' && document.textLength && document.textLength > 0;

  return (
    <div 
      className={`document-item ${isSelected ? 'selected' : ''} ${document.processingStatus}`}
      onClick={canBeSelected ? handleCheckboxChange : undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: '12px',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        marginBottom: '8px',
        cursor: canBeSelected ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        backgroundColor: isSelected ? '#e3f2fd' : '#fff',
        borderColor: isSelected ? '#007bff' : '#e0e0e0',
        borderLeftWidth: '4px',
        borderLeftColor: getStatusColor(document.processingStatus),
        opacity: isDeleting ? 0.5 : 1
      }}
    >
      {/* Selection Checkbox */}
      <div style={{ marginRight: '12px', marginTop: '2px' }}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          disabled={!canBeSelected || isDeleting}
          style={{
            width: '16px',
            height: '16px',
            cursor: canBeSelected ? 'pointer' : 'not-allowed'
          }}
        />
      </div>

      {/* Document Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header with file icon, name, and status */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '18px', marginRight: '8px' }}>
            {getFileTypeIcon(document.contentType)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ 
              fontWeight: 'bold', 
              fontSize: '14px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {document.fileName}
            </div>
            <div style={{ 
              fontSize: '12px', 
              color: '#666',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '2px'
            }}>
              <span style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '4px',
                color: getStatusColor(document.processingStatus)
              }}>
                {getStatusIcon(document.processingStatus)}
                {document.processingStatus}
              </span>
              <span>•</span>
              <span>{formatDate(document.createdAt)}</span>
              {document.textLength && (
                <>
                  <span>•</span>
                  <span>{document.textLength.toLocaleString()} chars</span>
                </>
              )}
              {document.confidence && (
                <>
                  <span>•</span>
                  <span>{Math.round(document.confidence)}% confidence</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Text Preview */}
        {document.textPreview && (
          <div style={{
            fontSize: '12px',
            color: '#555',
            backgroundColor: '#f8f9fa',
            padding: '8px',
            borderRadius: '4px',
            fontStyle: 'italic',
            marginBottom: '8px',
            lineHeight: '1.4'
          }}>
            {document.textPreview}
          </div>
        )}

        {/* Error Message */}
        {document.processingStatus === 'failed' && document.errorDetails && (
          <div style={{
            fontSize: '12px',
            color: '#dc3545',
            backgroundColor: '#f8d7da',
            padding: '8px',
            borderRadius: '4px',
            marginBottom: '8px',
            lineHeight: '1.4'
          }}>
            ❌ {document.errorDetails}
          </div>
        )}

        {/* Processing Info */}
        {document.processingStatus === 'processing' && (
          <div style={{
            fontSize: '12px',
            color: '#6c757d',
            backgroundColor: '#f8f9fa',
            padding: '8px',
            borderRadius: '4px',
            fontStyle: 'italic',
            marginBottom: '8px'
          }}>
            ⏳ Processing in progress...
          </div>
        )}

        {/* Retry Count Info */}
        {document.retryCount && document.retryCount > 0 && (
          <div style={{
            fontSize: '11px',
            color: '#6c757d',
            marginBottom: '8px'
          }}>
            Retry attempts: {document.retryCount}/{document.maxRetries || 3}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '4px',
        marginLeft: '8px'
      }}>
        {document.processingStatus === 'failed' && (
          <button
            onClick={handleRetryClick}
            disabled={isRetrying || isDeleting}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isRetrying || isDeleting ? 'not-allowed' : 'pointer',
              opacity: isRetrying || isDeleting ? 0.6 : 1,
              whiteSpace: 'nowrap'
            }}
          >
            {isRetrying ? '⏳ Retrying...' : '🔄 Retry'}
          </button>
        )}
        
        <button
          onClick={handleDeleteClick}
          disabled={isDeleting || isRetrying}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isDeleting || isRetrying ? 'not-allowed' : 'pointer',
            opacity: isDeleting || isRetrying ? 0.6 : 1,
            whiteSpace: 'nowrap'
          }}
        >
          {isDeleting ? '⏳ Deleting...' : '🗑️ Delete'}
        </button>
      </div>
    </div>
  );
};

export default DocumentItem;
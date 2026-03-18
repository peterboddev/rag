import React from 'react';
import { ClaimDocument } from '../services/claimApi';
import { formatDate, getStatusColor, getStatusIcon } from './documentUtils';

interface DocumentListItemProps {
  document: ClaimDocument;
  onView: (documentId: string) => void;
  onDownload: (documentId: string, fileName: string) => void;
  isViewLoading: boolean;
  isDownloadLoading: boolean;
}

const DocumentListItem: React.FC<DocumentListItemProps> = ({
  document,
  onView,
  onDownload,
  isViewLoading,
  isDownloadLoading,
}) => {
  const isCompleted = document.processingStatus === 'completed';

  return (
    <div
      style={{
        padding: '12px 16px',
        marginBottom: '8px',
        border: '1px solid #e0e0e0',
        borderRadius: '6px',
        backgroundColor: '#fff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      {/* Document info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: '4px',
          }}
          title={document.fileName}
        >
          {document.fileName}
        </div>
        <div style={{ fontSize: '12px', color: '#666', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <span>{document.documentType || 'Unknown'}</span>
          <span
            style={{
              color: getStatusColor(document.processingStatus),
              fontWeight: 500,
            }}
          >
            {getStatusIcon(document.processingStatus)} {document.processingStatus}
          </span>
          <span>{formatDate(document.createdAt)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={() => onView(document.documentId)}
          disabled={!isCompleted || isViewLoading}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            backgroundColor: isCompleted ? '#007bff' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isCompleted && !isViewLoading ? 'pointer' : 'not-allowed',
            opacity: isViewLoading ? 0.6 : 1,
          }}
          aria-label={`View ${document.fileName}`}
        >
          {isViewLoading ? '⏳' : '👁️'} View
        </button>
        <button
          onClick={() => onDownload(document.documentId, document.fileName)}
          disabled={!isCompleted || isDownloadLoading}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            backgroundColor: isCompleted ? '#28a745' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isCompleted && !isDownloadLoading ? 'pointer' : 'not-allowed',
            opacity: isDownloadLoading ? 0.6 : 1,
          }}
          aria-label={`Download ${document.fileName}`}
        >
          {isDownloadLoading ? '⏳' : '⬇️'} Download
        </button>
      </div>
    </div>
  );
};

export default DocumentListItem;

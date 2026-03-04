import React, { useState } from 'react';

interface SummaryData {
  summary: string;
  includedDocuments: DocumentReference[];
  documentCount: number;
  totalTextLength: number;
  processingTime: number;
  generatedAt: string;
}

interface DocumentReference {
  documentId: string;
  fileName: string;
  textLength: number;
}

interface SummaryDisplayPanelProps {
  summaryData: SummaryData | null;
  isSummarizing: boolean;
  error: string | null;
}

const SummaryDisplayPanel: React.FC<SummaryDisplayPanelProps> = ({
  summaryData,
  isSummarizing,
  error
}) => {
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopyToClipboard = async () => {
    if (!summaryData?.summary) return;

    try {
      await navigator.clipboard.writeText(summaryData.summary);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = summaryData.summary;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed: ', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };

  const formatProcessingTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div style={{ 
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    }}>
      {/* Header */}
      <div style={{ 
        padding: '20px',
        borderBottom: '1px solid #eee',
        backgroundColor: '#f8f9fa',
        flexShrink: 0
      }}>
        <h3 style={{ margin: '0', fontSize: '18px' }}>
          🤖 AI Summary
        </h3>
      </div>

      {/* Content */}
      <div style={{ 
        flex: 1,
        overflow: 'auto',
        padding: '20px',
        minHeight: 0
      }}>
        {/* Loading State */}
        {isSummarizing && (
          <div style={{ 
            textAlign: 'center', 
            padding: '60px 20px',
            color: '#6c757d'
          }}>
            <div style={{ 
              fontSize: '48px', 
              marginBottom: '20px',
              animation: 'pulse 2s infinite'
            }}>
              🤖
            </div>
            <div style={{ fontSize: '18px', marginBottom: '10px' }}>
              Generating AI Summary...
            </div>
            <div style={{ fontSize: '14px' }}>
              Analyzing selected documents with Amazon Nova Pro
            </div>
            <div style={{
              width: '200px',
              height: '4px',
              backgroundColor: '#e0e0e0',
              borderRadius: '2px',
              margin: '20px auto',
              overflow: 'hidden'
            }}>
              <div style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#007bff',
                animation: 'loading 2s infinite'
              }} />
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isSummarizing && (
          <div style={{ 
            textAlign: 'center', 
            padding: '60px 20px',
            color: '#dc3545'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
            <div style={{ fontSize: '18px', marginBottom: '10px' }}>
              Summary Generation Failed
            </div>
            <div style={{ 
              fontSize: '14px',
              backgroundColor: '#f8d7da',
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #f5c6cb',
              maxWidth: '400px',
              margin: '0 auto'
            }}>
              {error}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!summaryData && !isSummarizing && !error && (
          <div style={{ 
            textAlign: 'center', 
            padding: '60px 20px',
            color: '#6c757d'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>📝</div>
            <div style={{ fontSize: '18px', marginBottom: '10px' }}>
              Ready to Generate Summary
            </div>
            <div style={{ fontSize: '14px', maxWidth: '300px', margin: '0 auto' }}>
              Select documents from the left panel and click "Summarize Selected" to generate an AI-powered summary
            </div>
          </div>
        )}

        {/* Summary Content */}
        {summaryData && !isSummarizing && (
          <div>
            {/* Summary Header */}
            <div style={{
              backgroundColor: '#e3f2fd',
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '20px',
              border: '1px solid #bbdefb'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'flex-start',
                marginBottom: '12px'
              }}>
                <h4 style={{ 
                  margin: '0', 
                  fontSize: '16px',
                  color: '#1976d2'
                }}>
                  📊 Summary Details
                </h4>
                <button
                  onClick={handleCopyToClipboard}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    backgroundColor: copySuccess ? '#28a745' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {copySuccess ? '✅ Copied!' : '📋 Copy Summary'}
                </button>
              </div>
              
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '12px',
                fontSize: '13px'
              }}>
                <div>
                  <strong>Documents:</strong> {summaryData.documentCount}
                </div>
                <div>
                  <strong>Total Text:</strong> {summaryData.totalTextLength.toLocaleString()} chars
                </div>
                <div>
                  <strong>Processing Time:</strong> {formatProcessingTime(summaryData.processingTime)}
                </div>
                <div>
                  <strong>Generated:</strong> {formatDate(summaryData.generatedAt)}
                </div>
              </div>

              {/* Included Documents */}
              <div style={{ marginTop: '12px' }}>
                <div style={{ 
                  fontSize: '13px', 
                  fontWeight: 'bold',
                  marginBottom: '6px',
                  color: '#1976d2'
                }}>
                  📄 Included Documents:
                </div>
                <div style={{ 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: '6px'
                }}>
                  {summaryData.includedDocuments.map((doc, index) => (
                    <span
                      key={doc.documentId}
                      style={{
                        fontSize: '11px',
                        backgroundColor: '#fff',
                        padding: '4px 8px',
                        borderRadius: '12px',
                        border: '1px solid #90caf9',
                        color: '#1976d2'
                      }}
                    >
                      {doc.fileName} ({doc.textLength.toLocaleString()} chars)
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Summary Content */}
            <div style={{
              backgroundColor: '#fff',
              padding: '20px',
              borderRadius: '8px',
              border: '1px solid #dee2e6',
              lineHeight: '1.6',
              fontSize: '14px'
            }}>
              <div style={{ 
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word'
              }}>
                {summaryData.summary}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default SummaryDisplayPanel;
import React, { useState, useEffect } from 'react';
import { getPatientDetail, loadClaim, getClaimStatus, getDocument, PatientDetail, ClaimStatusResponse, ClaimDocument } from '../services/claimApi';
import DocumentSummary from './DocumentSummary';
import DocumentListModal from './DocumentListModal';
import ClaimSummaryModal from './ClaimSummaryModal';

interface ClaimDetailPageProps {
  patientId: string;
  onBack: () => void;
}

const ClaimDetailPage: React.FC<ClaimDetailPageProps> = ({ patientId, onBack }) => {
  const [patientDetail, setPatientDetail] = useState<PatientDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingClaim, setLoadingClaim] = useState<string | null>(null);
  const [claimStatuses, setClaimStatuses] = useState<Record<string, ClaimStatusResponse>>({});
  const [documentModalClaimId, setDocumentModalClaimId] = useState<string | null>(null);
  const [documentModalDocuments, setDocumentModalDocuments] = useState<ClaimDocument[]>([]);
  const [summaryModalClaimId, setSummaryModalClaimId] = useState<string | null>(null);
  const pollIntervalsRef = React.useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    loadPatientDetail();
    return () => {
      // Cleanup all polling intervals on unmount
      pollIntervalsRef.current.forEach(clearInterval);
      pollIntervalsRef.current = [];
    };
  }, [patientId]);

  const loadPatientDetail = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const detail = await getPatientDetail(patientId);
      setPatientDetail(detail);
      
      // Load status for all claims
      for (const claim of detail.claims) {
        loadClaimStatusSilently(claim.claimId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patient details');
    } finally {
      setIsLoading(false);
    }
  };

  const loadClaimStatusSilently = async (claimId: string) => {
    try {
      const status = await getClaimStatus(claimId);
      setClaimStatuses((prev) => ({ ...prev, [claimId]: status }));
    } catch (err) {
      // Silently fail - claim might not be loaded yet
      console.error(`Failed to load status for claim ${claimId}:`, err);
    }
  };

  const handleLoadClaim = async (claimId: string) => {
    try {
      setLoadingClaim(claimId);
      setError(null);
      
      // TODO: Get customerUUID from auth context or API
      // For now, using a placeholder - this needs to be implemented
      const customerUUID = 'placeholder-customer-uuid';
      
      const response = await loadClaim(patientId, claimId, customerUUID);
      
      // Poll for status updates with stale-detection
      let lastProcessed = -1;
      let staleCount = 0;
      const maxStalePolls = 5; // Stop after 5 polls with no progress

      const pollInterval = setInterval(async () => {
        try {
          const status = await getClaimStatus(claimId);
          setClaimStatuses((prev) => ({ ...prev, [claimId]: status }));
          
          // Stop polling when complete or failed
          if (status.status === 'completed' || status.status === 'failed') {
            clearInterval(pollInterval);
            setLoadingClaim(null);
            return;
          }

          // Detect stale progress — stop polling if no documents are advancing
          if (status.documentsProcessed === lastProcessed) {
            staleCount++;
          } else {
            staleCount = 0;
            lastProcessed = status.documentsProcessed;
          }

          if (staleCount >= maxStalePolls) {
            clearInterval(pollInterval);
            setLoadingClaim(null);
          }
        } catch (err) {
          console.error('Failed to poll claim status:', err);
        }
      }, 5000); // Poll every 5 seconds (was 3)

      pollIntervalsRef.current.push(pollInterval);
      
      // Stop polling after 2 minutes max
      setTimeout(() => {
        clearInterval(pollInterval);
        setLoadingClaim(null);
      }, 120000);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load claim');
      setLoadingClaim(null);
    }
  };

  const handleViewDocuments = async (claimId: string) => {
    try {
      setError(null);
      const status = await getClaimStatus(claimId);
      setClaimStatuses((prev) => ({ ...prev, [claimId]: status }));
      setDocumentModalDocuments(status.documents || []);
      setDocumentModalClaimId(claimId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    }
  };

  const handleSummarizeClaim = (claimId: string) => {
    setSummaryModalClaimId(claimId);
  };

  const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'completed':
        return '#28a745';
      case 'processing':
      case 'in_progress':
        return '#ffc107';
      case 'failed':
        return '#dc3545';
      case 'pending':
        return '#17a2b8';
      default:
        return '#6c757d';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'completed':
        return '✅';
      case 'processing':
      case 'in_progress':
        return '⏳';
      case 'failed':
        return '❌';
      case 'pending':
        return '⏸️';
      default:
        return '❓';
    }
  };

  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px' 
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '16px' }}>⏳</div>
          <div>Loading patient details...</div>
        </div>
      </div>
    );
  }

  if (error && !patientDetail) {
    return (
      <div style={{ padding: '20px' }}>
        <button
          onClick={onBack}
          style={{
            marginBottom: '20px',
            padding: '8px 16px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          ← Back to Patients
        </button>
        <div style={{ 
          padding: '20px', 
          backgroundColor: '#f8d7da', 
          border: '1px solid #f5c6cb',
          borderRadius: '8px',
          color: '#721c24'
        }}>
          <div style={{ fontSize: '18px', marginBottom: '8px' }}>❌ Error</div>
          <div>{error}</div>
          <button
            onClick={loadPatientDetail}
            style={{
              marginTop: '12px',
              padding: '8px 16px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!patientDetail) {
    return null;
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Back Button */}
      <button
        onClick={onBack}
        style={{
          marginBottom: '20px',
          padding: '8px 16px',
          backgroundColor: '#6c757d',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        ← Back to Patients
      </button>

      {/* Patient Header */}
      <div style={{
        padding: '20px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #e0e0e0',
        marginBottom: '24px'
      }}>
        <h2 style={{ margin: '0 0 12px 0' }}>🏥 {patientDetail.patientName}</h2>
        <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
          <span style={{ fontWeight: '500' }}>Patient ID:</span> {patientDetail.patientId}
        </div>
        <div style={{ fontSize: '14px', color: '#666' }}>
          <span style={{ fontWeight: '500' }}>TCIA Collection:</span> {patientDetail.tciaCollectionId}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          marginBottom: '20px',
          padding: '12px',
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '6px',
          color: '#856404',
          fontSize: '14px'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Claims List */}
      <div>
        <h3 style={{ marginBottom: '16px' }}>📋 Claims ({patientDetail.claims.length})</h3>
        
        {patientDetail.claims.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '40px', 
            color: '#999',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
            <div>No claims found for this patient</div>
          </div>
        ) : (
          <div>
            {patientDetail.claims.map((claim) => {
              const status = claimStatuses[claim.claimId];
              const isLoadingThisClaim = loadingClaim === claim.claimId;
              
              return (
                <div
                  key={claim.claimId}
                  style={{
                    padding: '16px',
                    marginBottom: '16px',
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    backgroundColor: '#fff'
                  }}
                >
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'flex-start',
                    marginBottom: '12px'
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ 
                        fontSize: '16px', 
                        fontWeight: 'bold', 
                        marginBottom: '8px' 
                      }}>
                        Claim {claim.claimId}
                      </div>
                      <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                        <span style={{ fontWeight: '500' }}>Documents:</span> {claim.documentCount}
                      </div>
                      {claim.filingDate && (
                        <div style={{ fontSize: '13px', color: '#666' }}>
                          <span style={{ fontWeight: '500' }}>Filed:</span> {new Date(claim.filingDate).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    
                    {/* Status Badge */}
                    {status && (
                      <div style={{
                        padding: '6px 12px',
                        backgroundColor: getStatusColor(status.status),
                        color: 'white',
                        borderRadius: '16px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        {getStatusIcon(status.status)} {status.status}
                      </div>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {status && status.status !== 'completed' && status.totalDocuments > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ 
                        fontSize: '12px', 
                        color: '#666', 
                        marginBottom: '4px' 
                      }}>
                        Processing: {status.documentsProcessed} / {status.totalDocuments} documents
                      </div>
                      <div style={{
                        width: '100%',
                        height: '8px',
                        backgroundColor: '#e0e0e0',
                        borderRadius: '4px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${(status.documentsProcessed / status.totalDocuments) * 100}%`,
                          height: '100%',
                          backgroundColor: '#007bff',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                    </div>
                  )}

                  {/* Load Claim Button */}
                  {(!status || status.status === 'not_loaded') && (
                    <button
                      onClick={() => handleLoadClaim(claim.claimId)}
                      disabled={isLoadingThisClaim}
                      style={{
                        padding: '8px 16px',
                        fontSize: '14px',
                        backgroundColor: isLoadingThisClaim ? '#6c757d' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isLoadingThisClaim ? 'not-allowed' : 'pointer',
                        opacity: isLoadingThisClaim ? 0.6 : 1
                      }}
                    >
                      {isLoadingThisClaim ? '⏳ Loading...' : '📥 Load Claim Documents'}
                    </button>
                  )}

                  {/* View Documents and Summarize Claim Buttons (when loaded) */}
                  {status && status.status === 'completed' && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleViewDocuments(claim.claimId)}
                        style={{
                          padding: '8px 16px',
                          fontSize: '14px',
                          backgroundColor: '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        📄 View Documents
                      </button>
                      <button
                        onClick={() => handleSummarizeClaim(claim.claimId)}
                        style={{
                          padding: '8px 16px',
                          fontSize: '14px',
                          backgroundColor: '#6f42c1',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        📝 Summarize Claim
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Document List Modal */}
      {documentModalClaimId && (
        <DocumentListModal
          isOpen={!!documentModalClaimId}
          onClose={() => {
            setDocumentModalClaimId(null);
            setDocumentModalDocuments([]);
          }}
          claimId={documentModalClaimId}
          documents={documentModalDocuments}
        />
      )}

      {/* Claim Summary Modal */}
      {summaryModalClaimId && (
        <ClaimSummaryModal
          isOpen={!!summaryModalClaimId}
          onClose={() => setSummaryModalClaimId(null)}
          claimId={summaryModalClaimId}
        />
      )}
    </div>
  );
};

export default ClaimDetailPage;

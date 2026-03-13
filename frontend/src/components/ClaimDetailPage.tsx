import React, { useState, useEffect } from 'react';
import { getPatientDetail, loadClaim, getClaimStatus, getDocument, PatientDetail, ClaimStatusResponse } from '../services/claimApi';
import DocumentSummary from './DocumentSummary';

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

  useEffect(() => {
    loadPatientDetail();
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
      
      // Poll for status updates
      const pollInterval = setInterval(async () => {
        try {
          const status = await getClaimStatus(claimId);
          setClaimStatuses((prev) => ({ ...prev, [claimId]: status }));
          
          // Stop polling when complete or failed
          if (status.status === 'completed' || status.status === 'failed') {
            clearInterval(pollInterval);
            setLoadingClaim(null);
          }
        } catch (err) {
          console.error('Failed to poll claim status:', err);
        }
      }, 3000); // Poll every 3 seconds
      
      // Stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setLoadingClaim(null);
      }, 300000);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load claim');
      setLoadingClaim(null);
    }
  };

  const handleViewDocuments = async (claimId: string) => {
    try {
      // TODO: Implement document listing and viewing
      // For now, this is a placeholder that shows the integration is ready
      // Future implementation should:
      // 1. Query DynamoDB for documents with claimId
      // 2. Display list of documents
      // 3. Allow user to click on a document to view it
      // 4. Call getDocument(documentId) to get presigned URL
      // 5. Open document in new tab or embedded viewer
      
      alert('Document viewing integration is ready. Next step: implement document listing UI.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to view documents');
    }
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
                  {!status && (
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

                  {/* View Documents Button (when loaded) */}
                  {status && status.status === 'completed' && (
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
                      📄 View Documents & Summary
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Document Summary Section (placeholder for integration) */}
      {patientDetail.claims.some(claim => claimStatuses[claim.claimId]?.status === 'completed') && (
        <div style={{ marginTop: '32px' }}>
          <h3 style={{ marginBottom: '16px' }}>📊 Claim Summary</h3>
          <div style={{
            padding: '20px',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
            border: '1px solid #e0e0e0'
          }}>
            <p style={{ margin: 0, color: '#666' }}>
              Integration with DocumentSummary component will display AI-generated claim summaries here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClaimDetailPage;

import React, { useState, useEffect } from 'react';
import { listPatients, PatientSummary } from '../services/claimApi';

interface PatientListPageProps {
  onPatientSelect: (patientId: string) => void;
}

const PatientListPage: React.FC<PatientListPageProps> = ({ onPatientSelect }) => {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [filteredPatients, setFilteredPatients] = useState<PatientSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);

  // Load patients on mount
  useEffect(() => {
    loadPatients();
  }, []);

  // Filter patients when search query changes
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredPatients(patients);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = patients.filter(
        (patient) =>
          patient.patientId.toLowerCase().includes(query) ||
          patient.patientName.toLowerCase().includes(query) ||
          patient.tciaCollectionId.toLowerCase().includes(query)
      );
      setFilteredPatients(filtered);
    }
  }, [searchQuery, patients]);

  const loadPatients = async (token?: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await listPatients(50, token);
      
      if (token) {
        // Append to existing patients (pagination)
        setPatients((prev) => [...prev, ...response.patients]);
      } else {
        // Replace patients (initial load)
        setPatients(response.patients);
      }
      
      setNextToken(response.nextToken);
      setHasMore(!!response.nextToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patients');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadMore = () => {
    if (nextToken && !isLoading) {
      loadPatients(nextToken);
    }
  };

  const handlePatientClick = (patientId: string) => {
    onPatientSelect(patientId);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  if (isLoading && patients.length === 0) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px' 
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '16px' }}>⏳</div>
          <div>Loading patients...</div>
        </div>
      </div>
    );
  }

  if (error && patients.length === 0) {
    return (
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
          onClick={() => loadPatients()}
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
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 8px 0' }}>🏥 Patients</h2>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          Select a patient to view their claims
        </p>
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search by patient ID, name, or TCIA collection..."
          value={searchQuery}
          onChange={handleSearchChange}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '14px',
            border: '1px solid #ddd',
            borderRadius: '6px',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Patient Count */}
      <div style={{ 
        marginBottom: '16px', 
        fontSize: '14px', 
        color: '#666' 
      }}>
        {searchQuery ? (
          <>Showing {filteredPatients.length} of {patients.length} patients</>
        ) : (
          <>Total patients: {patients.length}</>
        )}
      </div>

      {/* Patient List */}
      {filteredPatients.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '40px', 
          color: '#999' 
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
          <div>No patients found</div>
          {searchQuery && (
            <div style={{ fontSize: '14px', marginTop: '8px' }}>
              Try a different search term
            </div>
          )}
        </div>
      ) : (
        <div>
          {filteredPatients.map((patient) => (
            <div
              key={patient.patientId}
              onClick={() => handlePatientClick(patient.patientId)}
              style={{
                padding: '16px',
                marginBottom: '12px',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                backgroundColor: '#fff'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f8f9fa';
                e.currentTarget.style.borderColor = '#007bff';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#fff';
                e.currentTarget.style.borderColor = '#e0e0e0';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'flex-start' 
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontSize: '16px', 
                    fontWeight: 'bold', 
                    marginBottom: '8px',
                    color: '#333'
                  }}>
                    {patient.patientName}
                  </div>
                  <div style={{ 
                    fontSize: '13px', 
                    color: '#666',
                    marginBottom: '4px'
                  }}>
                    <span style={{ fontWeight: '500' }}>Patient ID:</span> {patient.patientId}
                  </div>
                  <div style={{ 
                    fontSize: '13px', 
                    color: '#666' 
                  }}>
                    <span style={{ fontWeight: '500' }}>TCIA Collection:</span> {patient.tciaCollectionId}
                  </div>
                </div>
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'flex-end' 
                }}>
                  <div style={{
                    padding: '6px 12px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    borderRadius: '16px',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    {patient.claimCount} {patient.claimCount === 1 ? 'Claim' : 'Claims'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {hasMore && !searchQuery && (
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            onClick={handleLoadMore}
            disabled={isLoading}
            style={{
              padding: '12px 24px',
              fontSize: '14px',
              backgroundColor: isLoading ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1
            }}
          >
            {isLoading ? '⏳ Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {/* Error Message (for pagination errors) */}
      {error && patients.length > 0 && (
        <div style={{
          marginTop: '16px',
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
    </div>
  );
};

export default PatientListPage;

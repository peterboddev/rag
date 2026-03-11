import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import TenantSetup from './components/TenantSetup';
import DocumentUpload from './components/DocumentUpload';
import DocumentSummary from './components/DocumentSummary';
import PatientListPage from './components/PatientListPage';
import ClaimDetailPage from './components/ClaimDetailPage';

type Page = 'upload' | 'summary' | 'patients' | 'claim-detail';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, signOut, tenantId } = useAuth();
  const [activePage, setActivePage] = useState<Page>('upload');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="container">
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <h2>Loading...</h2>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !tenantId) {
    return <TenantSetup />;
  }

  const handlePatientSelect = (patientId: string) => {
    setSelectedPatientId(patientId);
    setActivePage('claim-detail');
  };

  const handleBackToPatients = () => {
    setSelectedPatientId(null);
    setActivePage('patients');
  };

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Document Manager</h1>
        <div>
          <span style={{ marginRight: '15px', fontSize: '14px', color: '#666' }}>
            Tenant: {tenantId}
          </span>
          <button onClick={signOut} className="btn" style={{ background: '#6c757d', color: 'white' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button
          className={`btn ${activePage === 'upload' ? 'btn-primary' : ''}`}
          onClick={() => setActivePage('upload')}
          style={{ marginRight: '10px' }}
        >
          📤 Upload Documents
        </button>
        <button
          className={`btn ${activePage === 'summary' ? 'btn-primary' : ''}`}
          onClick={() => setActivePage('summary')}
          style={{ marginRight: '10px' }}
        >
          📋 Document Summary
        </button>
        <button
          className={`btn ${activePage === 'patients' || activePage === 'claim-detail' ? 'btn-primary' : ''}`}
          onClick={() => setActivePage('patients')}
        >
          🏥 Patients
        </button>
      </div>

      {activePage === 'upload' && <DocumentUpload />}
      {activePage === 'summary' && <DocumentSummary />}
      {activePage === 'patients' && <PatientListPage onPatientSelect={handlePatientSelect} />}
      {activePage === 'claim-detail' && selectedPatientId && (
        <ClaimDetailPage patientId={selectedPatientId} onBack={handleBackToPatients} />
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
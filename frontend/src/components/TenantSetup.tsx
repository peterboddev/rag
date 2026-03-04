import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const TenantSetup: React.FC = () => {
  const { createTenant, joinTenant, error } = useAuth();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [companyName, setCompanyName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;

    try {
      setIsLoading(true);
      const newTenantId = await createTenant(companyName.trim());
      setCreatedTenantId(newTenantId);
    } catch (err) {
      console.error('Failed to create tenant:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId.trim()) return;

    try {
      setIsLoading(true);
      await joinTenant(tenantId.trim());
    } catch (err) {
      console.error('Failed to join tenant:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (createdTenantId) {
    return (
      <div className="container">
        <div className="tenant-info">
          <h2>🎉 Tenant Created Successfully!</h2>
          <p>Your company tenant has been created. Share this tenant ID with your team members so they can join:</p>
          <div className="tenant-code">{createdTenantId}</div>
          <p><strong>Important:</strong> Save this tenant ID - your team members will need it to access the same documents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Welcome to Document Manager</h1>
      <p>To get started, either create a new tenant for your company or join an existing one.</p>

      <div style={{ marginBottom: '20px' }}>
        <button
          className={`btn ${mode === 'create' ? 'btn-primary' : ''}`}
          onClick={() => setMode('create')}
          style={{ marginRight: '10px' }}
        >
          Create New Tenant
        </button>
        <button
          className={`btn ${mode === 'join' ? 'btn-primary' : ''}`}
          onClick={() => setMode('join')}
        >
          Join Existing Tenant
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {mode === 'create' ? (
        <form onSubmit={handleCreateTenant} className="upload-form">
          <h3>Create New Tenant</h3>
          <div className="form-group">
            <label htmlFor="companyName">Company Name:</label>
            <input
              type="text"
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Enter your company name"
              required
              disabled={isLoading}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading || !companyName.trim()}
          >
            {isLoading ? 'Creating...' : 'Create Tenant'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleJoinTenant} className="upload-form">
          <h3>Join Existing Tenant</h3>
          <div className="form-group">
            <label htmlFor="tenantId">Tenant ID:</label>
            <input
              type="text"
              id="tenantId"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="Enter the tenant ID provided by your team"
              required
              disabled={isLoading}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading || !tenantId.trim()}
          >
            {isLoading ? 'Joining...' : 'Join Tenant'}
          </button>
        </form>
      )}
    </div>
  );
};

export default TenantSetup;
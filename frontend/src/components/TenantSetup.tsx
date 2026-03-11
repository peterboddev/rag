import React, { useState, useEffect } from 'react';
import { signIn, getCurrentUser } from 'aws-amplify/auth';
import { useAuth } from '../contexts/AuthContext';

const TenantSetup: React.FC = () => {
  const { createTenant, joinTenant, error: authError, tenantId: contextTenantId } = useAuth();
  const [mode, setMode] = useState<'signin' | 'create' | 'join'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);

  // Check if user is already signed in when component mounts
  useEffect(() => {
    const checkExistingAuth = async () => {
      try {
        await getCurrentUser();
        // User is already signed in, show tenant setup
        setIsSignedIn(true);
        // If they already have a tenant, they shouldn't be here
        // but we'll let them create/join another one
        setMode('create');
      } catch (err) {
        // User not signed in, stay on sign-in form
        setIsSignedIn(false);
      }
    };
    
    checkExistingAuth();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    try {
      setIsLoading(true);
      setError(null);
      
      await signIn({
        username: email.trim(),
        password: password.trim(),
      });
      
      setIsSignedIn(true);
      // After sign-in, show tenant setup
      setMode('create');
    } catch (err: any) {
      console.error('Sign in error:', err);
      setError(err.message || 'Failed to sign in. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;

    try {
      setIsLoading(true);
      setError(null);
      const newTenantId = await createTenant(companyName.trim());
      setCreatedTenantId(newTenantId);
    } catch (err: any) {
      console.error('Failed to create tenant:', err);
      setError(err.message || 'Failed to create tenant');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId.trim()) return;

    try {
      setIsLoading(true);
      setError(null);
      await joinTenant(tenantId.trim());
    } catch (err: any) {
      console.error('Failed to join tenant:', err);
      setError(err.message || 'Failed to join tenant');
    } finally {
      setIsLoading(false);
    }
  };

  // Show tenant created success message
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

  // Show tenant setup after sign-in
  if (isSignedIn) {
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

        {(error || authError) && (
          <div className="alert alert-error">
            {error || authError}
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
  }

  // Show sign-in form
  return (
    <div className="container">
      <h1>Welcome to Document Manager</h1>
      <p>Please sign in to continue</p>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      <form onSubmit={handleSignIn} className="upload-form">
        <h3>Sign In</h3>
        <div className="form-group">
          <label htmlFor="email">Email:</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            required
            disabled={isLoading}
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password:</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            disabled={isLoading}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isLoading || !email.trim() || !password.trim()}
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div style={{ marginTop: '20px', padding: '15px', background: '#f8f9fa', borderRadius: '4px' }}>
        <p style={{ margin: 0, fontSize: '14px', color: '#666' }}>
          <strong>Note:</strong> Users must be created by an administrator. Contact your admin if you don't have an account.
        </p>
      </div>
    </div>
  );
};

export default TenantSetup;
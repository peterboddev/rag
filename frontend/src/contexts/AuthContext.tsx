import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthContextType } from '../types';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing tenant in localStorage
    const storedTenantId = localStorage.getItem('tenantId');
    if (storedTenantId) {
      setTenantId(storedTenantId);
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, []);

  const createTenant = async (companyName: string): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Generate tenant ID from company name (simplified for local development)
      const generatedTenantId = `tenant_${companyName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
      
      // Store tenant info
      localStorage.setItem('tenantId', generatedTenantId);
      localStorage.setItem('companyName', companyName);
      localStorage.setItem('isFirstUser', 'true');
      
      setTenantId(generatedTenantId);
      setIsAuthenticated(true);
      
      return generatedTenantId;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create tenant';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const joinTenant = async (tenantIdToJoin: string): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      
      // In a real implementation, this would validate the tenant exists
      // For now, we'll just accept any tenant ID
      localStorage.setItem('tenantId', tenantIdToJoin);
      localStorage.setItem('isFirstUser', 'false');
      
      setTenantId(tenantIdToJoin);
      setIsAuthenticated(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to join tenant';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = (): void => {
    localStorage.removeItem('tenantId');
    localStorage.removeItem('companyName');
    localStorage.removeItem('isFirstUser');
    setTenantId(null);
    setIsAuthenticated(false);
    setError(null);
  };

  const value: AuthContextType = {
    tenantId,
    isAuthenticated,
    isLoading,
    error,
    createTenant,
    joinTenant,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
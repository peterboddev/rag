import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { signIn, signOut as amplifySignOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
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
    // Check if user is already authenticated
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const user = await getCurrentUser();
      const session = await fetchAuthSession();
      
      if (user && session.tokens) {
        setIsAuthenticated(true);
        // Use user's email or sub as tenant identifier
        const storedTenantId = localStorage.getItem('tenantId') || user.username;
        setTenantId(storedTenantId);
      }
    } catch (err) {
      // User not authenticated
      setIsAuthenticated(false);
      setTenantId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const createTenant = async (companyName: string): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);
      
      // For now, we'll use the username as tenant ID
      // In a real implementation, this would call an API to create a tenant
      const user = await getCurrentUser();
      const generatedTenantId = `tenant_${companyName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${user.username}`;
      
      // Store tenant info
      localStorage.setItem('tenantId', generatedTenantId);
      localStorage.setItem('companyName', companyName);
      localStorage.setItem('isFirstUser', 'true');
      
      setTenantId(generatedTenantId);
      
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
      
      // Verify user is authenticated
      await getCurrentUser();
      
      // Store tenant info
      localStorage.setItem('tenantId', tenantIdToJoin);
      localStorage.setItem('isFirstUser', 'false');
      
      setTenantId(tenantIdToJoin);
      setIsAuthenticated(true); // Ensure authenticated state is set
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to join tenant';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      await amplifySignOut();
      localStorage.removeItem('tenantId');
      localStorage.removeItem('companyName');
      localStorage.removeItem('isFirstUser');
      setTenantId(null);
      setIsAuthenticated(false);
      setError(null);
    } catch (err) {
      console.error('Sign out error:', err);
      // Force local sign out even if Amplify fails
      localStorage.clear();
      setTenantId(null);
      setIsAuthenticated(false);
    }
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
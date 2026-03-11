import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { signIn, signOut as amplifySignOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { AuthContextType } from '../types';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Initialize state from localStorage immediately to avoid flicker
  const [tenantId, setTenantId] = useState<string | null>(() => {
    const stored = localStorage.getItem('tenantId');
    console.log('Initial tenant from localStorage:', stored);
    return stored;
  });
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
        console.log('User authenticated:', user.username);
        setIsAuthenticated(true);
        // Re-check localStorage for tenant (in case it was set before auth check)
        const storedTenantId = localStorage.getItem('tenantId');
        if (storedTenantId) {
          console.log('Confirmed stored tenant:', storedTenantId);
          setTenantId(storedTenantId);
        } else {
          console.log('No stored tenant found after auth check');
        }
      }
    } catch (err) {
      // User not authenticated
      console.log('User not authenticated:', err);
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
      
      // Update state immediately to trigger re-render
      setTenantId(generatedTenantId);
      setIsAuthenticated(true);
      
      // Force a small delay to ensure state updates propagate
      await new Promise(resolve => setTimeout(resolve, 100));
      
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
      
      // Update state immediately to trigger re-render
      setTenantId(tenantIdToJoin);
      setIsAuthenticated(true);
      
      // Force a small delay to ensure state updates propagate
      await new Promise(resolve => setTimeout(resolve, 100));
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
import React, { createContext, useContext, useState, useEffect } from 'react';

interface Membership {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  roles: string[];
}

interface Account {
  id: string;
  email: string;
  memberships: Membership[];
}

interface AuthContextType {
  account: Account | null;
  activeWorkspaceId: string | null;
  activeRoles: string[];
  token: string | null;
  login: (token: string, account: Account) => void;
  logout: () => void;
  setActiveWorkspace: (workspaceId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('simprok_token'));
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(localStorage.getItem('simprok_workspace'));

  const logout = React.useCallback(() => {
    localStorage.removeItem('simprok_token');
    localStorage.removeItem('simprok_workspace');
    setToken(null);
    setAccount(null);
    setActiveWorkspaceId(null);
  }, []);

  useEffect(() => {
    if (token) {
      // Validate token and fetch profile
      fetch('http://localhost:3000/auth/profile', {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => {
        if (!res.ok) throw new Error('Invalid token');
        return res.json();
      })
      .then(data => setAccount(data))
      .catch(() => {
        // If profile fetch fails (e.g. 401), we dispatch the global event.
        // The event listener will handle the actual logout.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('simprok:unauthorized'));
        } else {
          logout();
        }
      });
    }
  }, [token, logout]);

  const login = (newToken: string, newAccount: Account) => {
    localStorage.setItem('simprok_token', newToken);
    setToken(newToken);
    setAccount(newAccount);
  };

  useEffect(() => {
    const handleUnauthorized = () => {
      console.warn('[SIMPROK] 401 Unauthorized detected, clearing session.');
      logout();
    };

    window.addEventListener('simprok:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('simprok:unauthorized', handleUnauthorized);
    };
  }, [logout]);

  const setActiveWorkspace = (workspaceId: string) => {
    localStorage.setItem('simprok_workspace', workspaceId);
    setActiveWorkspaceId(workspaceId);
  };

  // Auto-correct stale workspaceId: if the stored workspace doesn't match
  // any membership, switch to the first available membership's workspace.
  useEffect(() => {
    if (!account || !account.memberships || account.memberships.length === 0) return;
    if (!activeWorkspaceId) return;
    
    const found = account.memberships.find(m => m.workspaceId === activeWorkspaceId);
    if (!found) {
      // Stale workspace ID — auto-correct
      console.warn('[SIMPROK] Stale workspaceId detected, auto-correcting...');
      const first = account.memberships[0];
      setActiveWorkspace(first.workspaceId);
    }
  }, [account, activeWorkspaceId]);

  // Derive active roles based on active workspace
  const activeRoles = React.useMemo(() => {
    if (!account || !account.memberships || !activeWorkspaceId) return [];
    const membership = account.memberships.find(m => m.workspaceId === activeWorkspaceId);
    return membership ? membership.roles : [];
  }, [account, activeWorkspaceId]);

  return (
    <AuthContext.Provider value={{ account, token, activeWorkspaceId, activeRoles, login, logout, setActiveWorkspace }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

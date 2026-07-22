/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { evaluatePermission, type PermissionState } from '../utils/capability';

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
  /** IDLE | LOADING | READY | ERROR — see hasPermission for the fail-closed contract. */
  permissionState: PermissionState;
  activePermissions: string[];
  /** Fail-closed: false unless permissionState is READY for the *current* workspace and the code is present. */
  hasPermission: (code: string) => boolean;
  login: (token: string, account: Account) => void;
  logout: () => void;
  setActiveWorkspace: (workspaceId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('simprok_token'));
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(localStorage.getItem('simprok_workspace'));
  const [permissionState, setPermissionState] = useState<PermissionState>('IDLE');
  const [activePermissions, setActivePermissions] = useState<string[]>([]);
  // Identifies which (token, workspace) pair the latest fetch was started
  // for, so a late-arriving response for a since-abandoned token/workspace
  // can never be applied — it is compared against the live values, not a
  // simple boolean flag, so a rapid workspace-switch-back-and-forth can't
  // false-positive either.
  const capabilityRequestRef = useRef(0);

  const logout = React.useCallback(() => {
    localStorage.removeItem('simprok_token');
    localStorage.removeItem('simprok_workspace');
    setToken(null);
    setAccount(null);
    setActiveWorkspaceId(null);
    capabilityRequestRef.current += 1;
    setPermissionState('IDLE');
    setActivePermissions([]);
  }, []);

  useEffect(() => {
    if (token) {
      // Validate token and fetch profile
      fetch(`${API_BASE_URL}/auth/profile`, {
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveWorkspace(first.workspaceId);
    }
  }, [account, activeWorkspaceId]);

  // Derive active roles based on active workspace
  const activeRoles = React.useMemo(() => {
    if (!account || !account.memberships || !activeWorkspaceId) return [];
    const membership = account.memberships.find(m => m.workspaceId === activeWorkspaceId);
    return membership ? membership.roles : [];
  }, [account, activeWorkspaceId]);

  // Fail-closed capability fetch. Runs on login, logout, token change, and
  // workspace switch — permission is cleared immediately on any of those
  // (not just on completion), so a stale grant is never visible even for one
  // render. A response only applies if this effect run is still the latest
  // one when it resolves; a superseded run's response — for the old token or
  // old workspace — is discarded even if it happens to arrive after a newer
  // request already started.
  useEffect(() => {
    const requestId = ++capabilityRequestRef.current;

    if (!token || !activeWorkspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPermissionState('IDLE');
      setActivePermissions([]);
      return;
    }

    setPermissionState('LOADING');
    setActivePermissions([]);

    fetch(`${API_BASE_URL}/auth/capabilities`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`capabilities-fetch-failed-${res.status}`);
        return res.json();
      })
      .then((data: { workspaceId: string; permissions: string[] }) => {
        if (requestId !== capabilityRequestRef.current) return; // superseded — discard
        if (data.workspaceId !== activeWorkspaceId) {
          // Defensive: the backend should never do this, but never apply a
          // response for a workspace other than the one it was requested for.
          setPermissionState('ERROR');
          setActivePermissions([]);
          return;
        }
        setActivePermissions(data.permissions);
        setPermissionState('READY');
      })
      .catch(() => {
        if (requestId !== capabilityRequestRef.current) return; // superseded — discard
        setPermissionState('ERROR');
        setActivePermissions([]);
      });
  }, [token, activeWorkspaceId]);

  const hasPermission = React.useCallback(
    (code: string) => evaluatePermission(permissionState, activePermissions, code),
    [permissionState, activePermissions],
  );

  return (
    <AuthContext.Provider
      value={{
        account,
        token,
        activeWorkspaceId,
        activeRoles,
        permissionState,
        activePermissions,
        hasPermission,
        login,
        logout,
        setActiveWorkspace,
      }}
    >
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

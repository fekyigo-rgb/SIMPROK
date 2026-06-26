import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function WorkspaceSelectPage() {
  const { account, setActiveWorkspace } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!account) {
      navigate('/login');
    } else if (account.memberships && account.memberships.length === 1) {
      // Auto-select if only 1 workspace
      const membership = account.memberships[0];
      setActiveWorkspace(membership.workspaceId);
      
      if (membership.roles.includes('FOREMAN') || membership.roles.includes('FIELD_ENGINEER')) {
        navigate('/field');
      } else {
        navigate('/');
      }
    }
  }, [account, navigate, setActiveWorkspace]);

  if (!account || !account.memberships) {
    return <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>Loading Sovereign Data...</div>;
  }

  return (
    <div style={{ padding: 'var(--space-8)', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--text-3xl)', color: 'var(--simprok-engineering-blue-900)' }}>Select Sovereign Workspace</h1>
      <p style={{ color: 'var(--simprok-engineering-blue-700)' }}>You have access to multiple governance zones. Choose your entry point.</p>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
        {account.memberships.map(m => (
          <div 
            key={m.workspaceId}
            onClick={() => {
              setActiveWorkspace(m.workspaceId);
              if (m.roles.includes('FOREMAN') || m.roles.includes('FIELD_ENGINEER')) {
                navigate('/field');
              } else {
                navigate('/');
              }
            }}
            style={{
              padding: 'var(--space-6)',
              backgroundColor: 'var(--simprok-white)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--simprok-engineering-blue-200)',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
              transition: 'all 0.2s ease'
            }}
          >
            <h3 style={{ margin: '0 0 var(--space-2) 0', color: 'var(--simprok-engineering-blue-900)' }}>{m.workspaceName}</h3>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-600)', backgroundColor: 'var(--simprok-surface-light)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
              Roles: {m.roles.join(', ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

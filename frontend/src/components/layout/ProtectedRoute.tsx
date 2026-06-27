import type { ReactNode } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function ProtectedRoute() {
  const { account, token, activeWorkspaceId } = useAuth();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (!account) {
    // Waiting for profile to load
    return <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>Validating Sovereign Identity...</div>;
  }

  if (!activeWorkspaceId) {
    return <Navigate to="/workspace-select" replace />;
  }

  return <Outlet />;
}

export function RoleRoute({ allowedRoles, children }: { allowedRoles: string[], children: ReactNode }) {
  const { activeRoles, logout } = useAuth();
  const navigate = useNavigate();
  
  const hasAccess = allowedRoles.some(role => activeRoles.includes(role));

  if (!hasAccess) {
    const handleLogout = () => {
      logout();
      navigate('/login');
    };

    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', marginTop: '80px' }}>
        <div>
          <h2 style={{ color: 'var(--simprok-critical-red-600)' }}>Access Denied</h2>
          <p style={{ color: 'var(--simprok-engineering-blue-700)' }}>
            Your current workspace role does not have authorization to enter this zone.
          </p>
          <p style={{ color: 'var(--simprok-engineering-blue-500)', fontSize: 'var(--text-sm)' }}>
            Active roles: <strong>{activeRoles.length > 0 ? activeRoles.join(', ') : '(none — please logout and login again)'}</strong>
          </p>
          <p style={{ color: 'var(--simprok-engineering-blue-500)', fontSize: 'var(--text-sm)' }}>
            Required: <strong>{allowedRoles.join(' or ')}</strong>
          </p>
        </div>

        {activeRoles.includes('FOREMAN') || activeRoles.includes('FIELD_ENGINEER') ? (
          <button
            onClick={() => navigate('/field')}
            style={{
              padding: 'var(--space-3) var(--space-6)',
              backgroundColor: 'var(--simprok-engineering-blue-600)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: 'var(--text-base)'
            }}
          >
            Go to Field Terminal
          </button>
        ) : null}

        <button
          onClick={handleLogout}
          style={{
            padding: 'var(--space-3) var(--space-6)',
            backgroundColor: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-semibold)'
          }}
        >
          Logout &amp; Login with Correct Account
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

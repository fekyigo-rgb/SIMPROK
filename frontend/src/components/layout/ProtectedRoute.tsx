import type { ReactNode } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { formatRoleLabel } from '../../utils/roleLabels';

/**
 * Permission-code-based route gate (RM-01a authority matrix), the RAB
 * journey's replacement for role-literal RoleRoute. Fail-closed while the
 * capability fetch is IDLE/LOADING/ERROR — never renders children or an
 * "Access Denied" verdict from a state that isn't actually known yet.
 * Backend PermissionsGuard remains the real security decision; this only
 * controls what's visible/enterable in the UI.
 */
export function PermissionRoute({ permission, children }: { permission: string; children: ReactNode }) {
  const { permissionState, hasPermission, logout } = useAuth();
  const navigate = useNavigate();

  if (permissionState === 'IDLE' || permissionState === 'LOADING') {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        Memeriksa kewenangan...
      </div>
    );
  }

  if (hasPermission(permission)) {
    return <>{children}</>;
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ padding: 'var(--space-8)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', marginTop: '80px' }}>
      <div>
        <h2 style={{ color: 'var(--simprok-critical-red-600)' }}>Access Denied</h2>
        <p style={{ color: 'var(--simprok-engineering-blue-700)' }}>
          {permissionState === 'ERROR'
            ? 'Kewenangan tidak dapat diperiksa. Muat ulang atau login kembali.'
            : 'Workspace aktif Anda tidak memiliki kewenangan untuk membuka ruang ini.'}
        </p>
      </div>
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
          fontWeight: 'var(--weight-semibold)',
        }}
      >
        Logout &amp; Login with Correct Account
      </button>
    </div>
  );
}

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
            Active roles: <strong>{activeRoles.length > 0 ? activeRoles.map(formatRoleLabel).join(', ') : '(none — please logout and login again)'}</strong>
          </p>
          <p style={{ color: 'var(--simprok-engineering-blue-500)', fontSize: 'var(--text-sm)' }}>
            Required: <strong>{allowedRoles.map(formatRoleLabel).join(' or ')}</strong>
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

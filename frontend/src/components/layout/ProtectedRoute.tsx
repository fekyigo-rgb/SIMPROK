import type { ReactNode } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { formatRoleLabel } from '../../utils/roleLabels';
import { computeBasicPriceSpaceViewModel } from '../../utils/basicPriceSpaceViewModel';

/**
 * Shared "Access Denied" panel for the permission-code route gates below
 * (PermissionRoute, BasicPriceSpaceRoute). Kept as one component so the two
 * gates cannot silently diverge in copy or Color Lock — the logout button
 * uses the locked critical-red token, never a hardcoded hex.
 */
function AccessDeniedPanel({ message, onLogout }: { message: string; onLogout: () => void }) {
  return (
    <div style={{ padding: 'var(--space-8)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', marginTop: '80px' }}>
      <div>
        <h2 style={{ color: 'var(--simprok-critical-red-600)' }}>Access Denied</h2>
        <p style={{ color: 'var(--simprok-engineering-blue-700)' }}>{message}</p>
      </div>
      <button
        onClick={onLogout}
        style={{
          padding: 'var(--space-3) var(--space-6)',
          backgroundColor: 'var(--simprok-critical-red-600)',
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

const accessDeniedMessage = (permissionState: 'ERROR' | 'READY'): string =>
  permissionState === 'ERROR'
    ? 'Kewenangan tidak dapat diperiksa. Muat ulang atau login kembali.'
    : 'Workspace aktif Anda tidak memiliki kewenangan untuk membuka ruang ini.';

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

  return (
    <AccessDeniedPanel
      message={accessDeniedMessage(permissionState === 'ERROR' ? 'ERROR' : 'READY')}
      onLogout={() => {
        logout();
        navigate('/login');
      }}
    />
  );
}

/**
 * RM02D2A2-REMEDIATION-02 — Basic-Price-specific route gate: `/basic-price`
 * is a capability-aware space, not an Explorer-only route gated by a single
 * permission. Entry is allowed with ANY of BASIC_PRICE_VIEW, _IMPORT,
 * _REVIEW_VIEW, or _PUBLISH (BASIC_PRICE_VERIFY alone is deliberately not
 * enough — see basicPriceSpaceViewModel). Deliberately a separate, narrow
 * gate rather than widening the generic single-permission PermissionRoute.
 */
export function BasicPriceSpaceRoute({ children }: { children: ReactNode }) {
  const { permissionState, hasPermission, logout } = useAuth();
  const navigate = useNavigate();

  if (permissionState === 'IDLE' || permissionState === 'LOADING') {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        Memeriksa kewenangan...
      </div>
    );
  }

  const canEnter = computeBasicPriceSpaceViewModel({
    hasView: hasPermission('BASIC_PRICE_VIEW'),
    hasImport: hasPermission('BASIC_PRICE_IMPORT'),
    hasReviewView: hasPermission('BASIC_PRICE_REVIEW_VIEW'),
    hasPublish: hasPermission('BASIC_PRICE_PUBLISH'),
  }).canEnterBasicPriceSpace;

  if (canEnter) {
    return <>{children}</>;
  }

  return (
    <AccessDeniedPanel
      message={accessDeniedMessage(permissionState === 'ERROR' ? 'ERROR' : 'READY')}
      onLogout={() => {
        logout();
        navigate('/login');
      }}
    />
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

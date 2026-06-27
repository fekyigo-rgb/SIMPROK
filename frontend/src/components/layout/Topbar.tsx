import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function Topbar() {
  const { account, activeRoles, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Derive initials from displayName or email
  const displayName = (account as any)?.displayName || account?.email || 'User';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const roleLabel = activeRoles.length > 0 ? activeRoles[0] : 'No Role Assigned';

  return (
    <header style={{
      height: '72px',
      backgroundColor: 'var(--simprok-white)',
      borderBottom: '1px solid var(--simprok-engineering-blue-100)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 var(--space-8)',
      position: 'sticky',
      top: 0,
      zIndex: 10
    }}>
      
      {/* Left Context */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--simprok-engineering-blue-900)', margin: 0 }}>
          Global Portfolio Overview
        </h2>
      </div>

      {/* Right Context: User Profile + Logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--simprok-engineering-blue-900)' }}>
            {displayName}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-600)' }}>
            {roleLabel}
          </span>
        </div>
        <div style={{ 
          width: '40px', 
          height: '40px', 
          borderRadius: '50%', 
          backgroundColor: 'var(--simprok-engineering-blue-900)',
          color: 'var(--simprok-white)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'var(--weight-bold)'
        }}>
          {initials}
        </div>
        <button
          onClick={handleLogout}
          title="Logout"
          style={{
            background: 'transparent',
            border: '1px solid var(--simprok-engineering-blue-200)',
            color: 'var(--simprok-engineering-blue-700)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
          }}
        >
          Logout
        </button>
      </div>

    </header>
  );
}

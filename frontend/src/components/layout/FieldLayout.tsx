import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function FieldLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F8FAFC' }}>
      {/* Simple Header for Field Workers */}
      <header style={{ 
        backgroundColor: 'var(--simprok-engineering-blue-900)', 
        color: 'white', 
        padding: 'var(--space-4) var(--space-6)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'bold' }}>SIMPROK Mandor</h1>
        <button 
          onClick={handleLogout}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.3)',
            color: 'white',
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer'
          }}
        >
          Keluar
        </button>
      </header>
      
      {/* Scrollable Page Content */}
      <main style={{ flex: 1, padding: 'var(--space-6)', overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}

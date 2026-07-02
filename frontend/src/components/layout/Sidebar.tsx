import { Link, useLocation } from 'react-router-dom';

export function Sidebar() {
  const location = useLocation();

  const navItems = [
    { name: 'Observatory', path: '/' },
    { name: 'Buat RAB', path: '/project/new' },
    { name: 'Field Terminal', path: '/field' },
    { name: 'UI Showcase (Dev)', path: '/showcase' },
  ];

  return (
    <aside style={{
      width: '260px',
      backgroundColor: 'var(--simprok-white)',
      borderRight: '1px solid var(--simprok-engineering-blue-100)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0
    }}>
      
      {/* Brand Header */}
      <div style={{ padding: 'var(--space-6)', backgroundColor: 'var(--simprok-bright-sky-blue-600)', borderBottom: '1px solid var(--simprok-bright-sky-blue-700)' }}>
        <h1 style={{ 
          fontSize: 'var(--text-3xl)', 
          fontWeight: 'var(--weight-bold)', 
          color: 'var(--simprok-white)',
          margin: 0,
          letterSpacing: '0.02em'
        }}>
          SIMPROK
        </h1>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-bright-sky-blue-100)', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 'var(--weight-medium)' }}>
          Sistem Manajemen Proyek
        </span>
      </div>

      {/* Navigation Links */}
      <nav style={{ flex: 1, padding: 'var(--space-6) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link 
              key={item.path} 
              to={item.path}
              style={{
                padding: 'var(--space-3) var(--space-4)',
                textDecoration: 'none',
                color: isActive ? 'var(--simprok-bright-sky-blue-600)' : 'var(--simprok-engineering-blue-700)',
                backgroundColor: isActive ? 'var(--simprok-bright-sky-blue-50)' : 'transparent',
                borderRadius: '6px',
                fontSize: 'var(--text-sm)',
                fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-medium)',
                transition: 'all 0.2s ease-in-out',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <div style={{
                width: '4px',
                height: '16px',
                backgroundColor: isActive ? 'var(--simprok-bright-sky-blue-500)' : 'transparent',
                borderRadius: '2px',
                marginRight: 'var(--space-3)'
              }} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Owner Brand Footer */}
      <div style={{ padding: 'var(--space-6)', borderTop: '1px solid var(--simprok-engineering-blue-100)', backgroundColor: 'var(--simprok-white)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: '10px', color: 'var(--simprok-engineering-blue-600)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--weight-medium)' }}>
            A Product of
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-bold)', letterSpacing: '0.02em' }}>
            Dirk & Jo Group
          </span>
        </div>
      </div>

    </aside>
  );
}

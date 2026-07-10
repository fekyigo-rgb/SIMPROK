import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export interface DashboardOutletContext {
  isRabWorkspaceFocus: boolean;
  isSidebarVisible: boolean;
  showSidebar: () => void;
  hideSidebar: () => void;
  toggleSidebar: () => void;
}

export function DashboardLayout() {
  const location = useLocation();
  const isRabWorkspaceFocus = location.pathname.includes('/rab/workspace');
  const [isRabSidebarVisible, setIsRabSidebarVisible] = useState(false);
  const isSidebarVisible = !isRabWorkspaceFocus || isRabSidebarVisible;

  useEffect(() => {
    if (isRabWorkspaceFocus) {
      setIsRabSidebarVisible(false);
    }
  }, [isRabWorkspaceFocus, location.key]);

  return (
    <div className="simprok-app-shell">
      <div
        className={`simprok-rab-sidebar-shell${isRabWorkspaceFocus && !isSidebarVisible ? ' simprok-rab-sidebar-shell--collapsed' : ''}`}
      >
        <Sidebar />
      </div>
      {isRabWorkspaceFocus ? (
        <button
          className="simprok-rab-sidebar-toggle"
          style={{ left: isSidebarVisible ? '286px' : '0px' }}
          onClick={() => setIsRabSidebarVisible((v) => !v)}
          aria-label={isSidebarVisible ? 'Sembunyikan menu navigasi' : 'Tampilkan menu navigasi'}
          title={isSidebarVisible ? 'Sembunyikan menu' : 'Tampilkan menu'}
        >
          {isSidebarVisible ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />}
        </button>
      ) : null}
      <div className="simprok-app-shell__main">
        <Topbar />
        <main className="simprok-page-shell">
          <Outlet
            context={{
              isRabWorkspaceFocus,
              isSidebarVisible,
              showSidebar: () => setIsRabSidebarVisible(true),
              hideSidebar: () => setIsRabSidebarVisible(false),
              toggleSidebar: () => setIsRabSidebarVisible((visible) => !visible),
            } satisfies DashboardOutletContext}
          />
        </main>
      </div>
    </div>
  );
}

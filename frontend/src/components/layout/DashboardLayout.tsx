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
  const isRabWorkspaceFocus = new URLSearchParams(location.search).get('ruang') === 'ruang-kerja-rab';
  const [isRabSidebarVisible, setIsRabSidebarVisible] = useState(false);
  const isSidebarVisible = !isRabWorkspaceFocus || isRabSidebarVisible;

  useEffect(() => {
    if (!isRabWorkspaceFocus) return;
    const resetFocusSidebar = window.setTimeout(() => setIsRabSidebarVisible(false), 0);
    return () => window.clearTimeout(resetFocusSidebar);
  }, [isRabWorkspaceFocus, location.key]);

  return (
    <div className="simprok-app-shell">
      {isSidebarVisible ? <Sidebar /> : null}
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

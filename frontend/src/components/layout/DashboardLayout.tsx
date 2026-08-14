import { ChevronsDown, ChevronsLeft, ChevronsRight, ChevronsUp } from 'lucide-react';
import { Outlet, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import {
  readHeaderPreference,
  resolveChromeVisibility,
  writeHeaderPreference,
} from '../../utils/rabChromeVisibility';
import type { PreferenceStore } from '../../utils/rabChromeVisibility';

/**
 * RAB-FOCUS-01 — the RAB rooms can give their table the screen.
 *
 * Two INDEPENDENT dimensions of chrome, both owned here because both belong to
 * the shell rather than to a page: the app header above, and the navigation
 * sidebar at the left. Ruang Kerja already had the sidebar half; Ruang Hidup
 * had neither, so reading an official RAB happened in whatever space was left
 * over. Rather than teach a second page the same collapse rules, the existing
 * seam was widened to cover both rooms — there is one implementation and one
 * set of states.
 *
 * PRESENTATION ONLY. Nothing here reads or writes RAB data; collapsing chrome
 * cannot change a number, a lock, or an authority.
 */

export interface DashboardOutletContext {
  /** True in Ruang Kerja RAB specifically — the editing room. */
  isRabWorkspaceFocus: boolean;
  /** True in either RAB room, where the chrome may be collapsed. */
  isRabRoom: boolean;
  isSidebarVisible: boolean;
  showSidebar: () => void;
  hideSidebar: () => void;
  toggleSidebar: () => void;
  isHeaderVisible: boolean;
  showHeader: () => void;
  toggleHeader: () => void;
}

/**
 * Presentation preference, so a collapse survives a rerender and the ordinary
 * navigation between the two RAB rooms — §9 keeps it out of the backend
 * because a collapsed header is not business truth. sessionStorage rather than
 * localStorage: a preference for this sitting, not a permanent change to how
 * SIMPROK looks. The read/write pair degrade safely and are proven in
 * utils/rabChromeVisibility.test.ts.
 */
const preferenceStore = (): PreferenceStore | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export function DashboardLayout() {
  const location = useLocation();

  /** null = this room's default; a boolean = the user said so. */
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean | null>(null);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(() =>
    readHeaderPreference(preferenceStore()),
  );

  const { isRabWorkspaceFocus, isRabRoom, isSidebarVisible, isHeaderVisible } =
    resolveChromeVisibility({
      pathname: location.pathname,
      sidebarCollapsed,
      headerCollapsed: isHeaderCollapsed,
    });

  /**
   * Entering a room hands the sidebar back to that room's own default, so
   * arriving in Ruang Kerja still clears the way for the table and arriving in
   * Ruang Hidup still shows the navigation — whatever the previous room was
   * told to do.
   */
  useEffect(() => {
    setSidebarCollapsed(null);
  }, [isRabWorkspaceFocus, isRabRoom, location.key]);

  const toggleHeader = useCallback(() => {
    setIsHeaderCollapsed((collapsed) => {
      writeHeaderPreference(preferenceStore(), !collapsed);
      return !collapsed;
    });
  }, []);

  const showHeader = useCallback(() => {
    writeHeaderPreference(preferenceStore(), false);
    setIsHeaderCollapsed(false);
  }, []);

  // The sidebar may be collapsed in either room; only Ruang Kerja hides it by
  // default, so only there does the rail need to offer "show" as well.
  const sidebarShellCollapsed = isRabRoom && !isSidebarVisible;
  const setSidebarVisible = (visible: boolean) => setSidebarCollapsed(!visible);

  return (
    <div className="simprok-app-shell">
      <div
        className={`simprok-rab-sidebar-shell${sidebarShellCollapsed ? ' simprok-rab-sidebar-shell--collapsed' : ''}`}
      >
        <Sidebar />
      </div>
      {isRabRoom ? (
        <button
          className="simprok-rab-sidebar-toggle"
          style={{ left: isSidebarVisible ? '286px' : '0px' }}
          onClick={() => setSidebarVisible(!isSidebarVisible)}
          aria-label={isSidebarVisible ? 'Sembunyikan menu navigasi' : 'Tampilkan menu navigasi'}
          aria-expanded={isSidebarVisible}
          title={isSidebarVisible ? 'Sembunyikan menu' : 'Tampilkan menu'}
        >
          {isSidebarVisible ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />}
        </button>
      ) : null}
      <div className="simprok-app-shell__main">
        {isHeaderVisible ? <Topbar /> : null}
        {/*
          THE WAY BACK IS PART OF THE DOOR. A collapsed header leaves this rail
          in its place — same top edge, same width — so the control that
          restores it is exactly where the thing it restores used to be. It is
          never conditional on hover, scroll position or pointer type.
        */}
        {isRabRoom ? (
          <button
            className={`simprok-rab-header-toggle${isHeaderVisible ? '' : ' simprok-rab-header-toggle--collapsed'}`}
            onClick={toggleHeader}
            aria-label={isHeaderVisible ? 'Sembunyikan header' : 'Tampilkan header'}
            aria-expanded={isHeaderVisible}
            title={isHeaderVisible ? 'Mode fokus — sembunyikan header' : 'Tampilkan header'}
          >
            {isHeaderVisible ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
            <span>{isHeaderVisible ? 'Mode Fokus' : 'Tampilkan Header'}</span>
          </button>
        ) : null}
        <main className={`simprok-page-shell${isHeaderVisible ? '' : ' simprok-page-shell--focus'}`}>
          <Outlet
            context={{
              isRabWorkspaceFocus,
              isRabRoom,
              isSidebarVisible,
              showSidebar: () => setSidebarVisible(true),
              hideSidebar: () => setSidebarVisible(false),
              toggleSidebar: () => setSidebarVisible(!isSidebarVisible),
              isHeaderVisible,
              showHeader,
              toggleHeader,
            } satisfies DashboardOutletContext}
          />
        </main>
      </div>
    </div>
  );
}

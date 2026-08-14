/**
 * RAB-FOCUS-01 — how much chrome a RAB room is showing, as one rule.
 *
 * The shell has two independent collapse dimensions (header, sidebar) across
 * two rooms with different defaults. Left inline in the layout that is four
 * booleans deriving each other inside JSX, which is exactly the kind of state
 * that drifts the first time a third room appears. It lives here instead: one
 * function, no React, and therefore something that can be PROVEN rather than
 * screenshotted.
 *
 * PRESENTATION ONLY. Nothing in this module reads or writes RAB data. A
 * collapsed header cannot change a number, a lock or an authority — which is
 * why the same rule is safe in Draft, Locked, Approved and Viewer alike.
 */

export interface ChromeInput {
  pathname: string;
  /**
   * The user's explicit choice for the sidebar, or `null` for "whatever this
   * room opens with".
   *
   * A plain boolean cannot express this: the two rooms disagree about the
   * default, so `false` has to mean "closed" in one room and "not chosen yet"
   * in the other. That ambiguity is exactly what made the viewer's sidebar
   * uncollapsible — its default won every time and the user's click had
   * nowhere to be recorded.
   */
  sidebarCollapsed: boolean | null;
  /** Has the user collapsed the header? */
  headerCollapsed: boolean;
}

export interface ChromeVisibility {
  /** Ruang Kerja RAB specifically — the editing room. */
  isRabWorkspaceFocus: boolean;
  /** Either RAB room: the only places chrome may be collapsed. */
  isRabRoom: boolean;
  isSidebarVisible: boolean;
  isHeaderVisible: boolean;
}

/**
 * `/project/:id/rab` and `/project/:id/rab/workspace`, and nothing that merely
 * contains the letters — `/rabat` is not a RAB room.
 */
export const isRabRoomPath = (pathname: string): boolean =>
  /\/rab(\/|$)/.test(pathname);

export const isRabWorkspacePath = (pathname: string): boolean =>
  pathname.includes('/rab/workspace');

/**
 * What a room opens with before the user says otherwise.
 *
 * Ruang Kerja starts with the sidebar out of the way: it is the editing room
 * and the table is the work. Ruang Hidup starts with it in place — a reader
 * arrived by navigating, and hiding the navigation they just used would be a
 * surprise. Everywhere else the sidebar is simply the app's navigation.
 */
export const sidebarDefaultCollapsed = (pathname: string): boolean =>
  isRabWorkspacePath(pathname);

/**
 * The user's choice wins wherever they made one; the room's default applies
 * only until then. Outside a RAB room there is no collapse control, so the
 * sidebar is always shown — chrome is never collapsible where it cannot be
 * restored, and the same rule governs the header.
 */
export const resolveChromeVisibility = ({
  pathname,
  sidebarCollapsed,
  headerCollapsed,
}: ChromeInput): ChromeVisibility => {
  const isRabWorkspaceFocus = isRabWorkspacePath(pathname);
  const isRabRoom = isRabRoomPath(pathname);
  const collapsed = sidebarCollapsed ?? sidebarDefaultCollapsed(pathname);
  return {
    isRabWorkspaceFocus,
    isRabRoom,
    isSidebarVisible: !(isRabRoom && collapsed),
    isHeaderVisible: !(isRabRoom && headerCollapsed),
  };
};

/** Minimal shape of Storage, so the preference is testable without a browser. */
export interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const HEADER_PREFERENCE_KEY = 'simprok.rab.headerCollapsed';

/**
 * A stored preference is presentation state, so anything other than the exact
 * string `'true'` means "not collapsed" — a malformed, absent or unreadable
 * value degrades to the normal default rather than to a blank screen (§28).
 * Storage that throws (private mode, blocked cookies) must never reach render.
 */
export const readHeaderPreference = (store: PreferenceStore | null | undefined): boolean => {
  try {
    return store?.getItem(HEADER_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeHeaderPreference = (
  store: PreferenceStore | null | undefined,
  collapsed: boolean,
): void => {
  try {
    store?.setItem(HEADER_PREFERENCE_KEY, collapsed ? 'true' : 'false');
  } catch {
    // A browser that refuses storage still gets a working toggle for this view.
  }
};

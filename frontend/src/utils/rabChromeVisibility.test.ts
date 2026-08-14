import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HEADER_PREFERENCE_KEY,
  isRabRoomPath,
  isRabWorkspacePath,
  readHeaderPreference,
  resolveChromeVisibility,
  writeHeaderPreference,
} from "./rabChromeVisibility.ts";

/**
 * RAB-FOCUS-01 §34 — focus mode, proven as behaviour.
 *
 * These drive the real state law the shell renders from: a pathname plus two
 * user intents in, four visibility facts out. No pixels are asserted — a
 * collapse that moved the wrong thing by 4px is a design question, but a
 * collapse that loses the way back, or that reaches a room it does not
 * govern, is a defect.
 */

const WORKSPACE = "/project/p1/rab/workspace";
const VIEWER = "/project/p1/rab";
const ELSEWHERE = "/proyek";

const chrome = (
  pathname: string,
  sidebarCollapsed: boolean | null,
  headerCollapsed: boolean,
) => resolveChromeVisibility({ pathname, sidebarCollapsed, headerCollapsed });

/** The four states as the user reaches them: explicit choices, not defaults. */
const combinations = (pathname: string) =>
  [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ].map(([sidebar, header]) => {
    const state = chrome(pathname, sidebar, header);
    return `${state.isHeaderVisible}/${state.isSidebarVisible}`;
  });

// ── Which rooms may collapse at all ─────────────────────────────────────────
test("both RAB rooms are collapsible rooms; ordinary pages are not", () => {
  assert.equal(isRabRoomPath(WORKSPACE), true);
  assert.equal(isRabRoomPath(VIEWER), true);
  assert.equal(isRabRoomPath(ELSEWHERE), false);
  // A path that merely contains the letters is not a RAB room.
  assert.equal(isRabRoomPath("/project/p1/rabat"), false);
  assert.equal(isRabWorkspacePath(VIEWER), false);
  assert.equal(isRabWorkspacePath(WORKSPACE), true);
});

test("chrome cannot be collapsed where no control exists to restore it", () => {
  // Even with both preferences set, a non-RAB page keeps its chrome: the
  // toggles are only rendered in a RAB room, so honouring them elsewhere would
  // strand the user with no way back.
  assert.equal(chrome(ELSEWHERE, true, true).isHeaderVisible, true);
  assert.equal(chrome(ELSEWHERE, true, true).isSidebarVisible, true);
  assert.equal(chrome(ELSEWHERE, true, true).isRabRoom, false);
});

// ── A. Workspace header: open → collapse → closed → expand → open ───────────
test("A. workspace header collapses and expands", () => {
  assert.equal(chrome(WORKSPACE, null, false).isHeaderVisible, true);
  assert.equal(chrome(WORKSPACE, null, true).isHeaderVisible, false);
  // ...and back again, without any other fact changing.
  const closed = chrome(WORKSPACE, null, true);
  const reopened = chrome(WORKSPACE, null, false);
  assert.equal(reopened.isHeaderVisible, true);
  assert.equal(reopened.isSidebarVisible, closed.isSidebarVisible);
});

// ── B. Living RAB header, independently ─────────────────────────────────────
test("B. viewer header collapses independently of the workspace", () => {
  assert.equal(chrome(VIEWER, null, false).isHeaderVisible, true);
  assert.equal(chrome(VIEWER, null, true).isHeaderVisible, false);
});

// ── B2. Sidebar, independently ──────────────────────────────────────────────
test("B2. the sidebar answers to its own intent, not the header's", () => {
  // Header collapsed, sidebar open → sidebar unchanged.
  assert.equal(chrome(WORKSPACE, false, true).isSidebarVisible, true);
  assert.equal(chrome(WORKSPACE, true, true).isSidebarVisible, false);
  // Header open, sidebar toggled → header unchanged.
  assert.equal(chrome(WORKSPACE, false, false).isHeaderVisible, true);
});

test("B2b. the VIEWER's sidebar collapses too, not only the workspace's", () => {
  // The regression this file exists to prevent: the viewer's sidebar used to
  // ignore the user entirely because its default won every time.
  assert.equal(chrome(VIEWER, null, false).isSidebarVisible, true);
  assert.equal(chrome(VIEWER, true, false).isSidebarVisible, false);
  assert.equal(chrome(VIEWER, false, false).isSidebarVisible, true);
});

test("each room opens with the sidebar its work needs", () => {
  // Ruang Kerja: the table is the work, so navigation starts out of the way.
  assert.equal(chrome(WORKSPACE, null, false).isSidebarVisible, false);
  // Ruang Hidup: the reader arrived by navigating; that navigation stays.
  assert.equal(chrome(VIEWER, null, false).isSidebarVisible, true);
  // And an explicit choice overrides the default in BOTH rooms.
  assert.equal(chrome(WORKSPACE, false, false).isSidebarVisible, true);
  assert.equal(chrome(VIEWER, true, false).isSidebarVisible, false);
});

// ── All four combinations are valid, in BOTH rooms ──────────────────────────
test("all four header × sidebar combinations are reachable in the viewer", () => {
  assert.deepEqual(combinations(VIEWER), [
    "true/true",
    "false/true",
    "true/false",
    "false/false",
  ]);
});

test("all four combinations are reachable in the workspace", () => {
  assert.deepEqual(combinations(WORKSPACE), [
    "true/true",
    "false/true",
    "true/false",
    "false/false",
  ]);
});

test("both collapsed is the full-canvas state and is legal in both rooms", () => {
  for (const room of [WORKSPACE, VIEWER]) {
    const full = chrome(room, true, true);
    assert.equal(full.isHeaderVisible, false, room);
    assert.equal(full.isSidebarVisible, false, room);
    assert.equal(full.isRabRoom, true, room);
  }
});

// ── Preference: survives rerender, degrades safely ──────────────────────────
test("a collapse survives a rerender", () => {
  const store = new Map<string, string>();
  const backing = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };

  writeHeaderPreference(backing, true);
  // A fresh mount reads the same answer back.
  assert.equal(readHeaderPreference(backing), true);
  assert.equal(store.get(HEADER_PREFERENCE_KEY), "true");

  writeHeaderPreference(backing, false);
  assert.equal(readHeaderPreference(backing), false);
});

test("malformed or unavailable preference degrades to the normal default", () => {
  assert.equal(readHeaderPreference(null), false);
  assert.equal(readHeaderPreference(undefined), false);
  assert.equal(readHeaderPreference({ getItem: () => "yes", setItem: () => {} }), false);
  assert.equal(readHeaderPreference({ getItem: () => "", setItem: () => {} }), false);
  // Storage that throws must never reach the render path.
  const hostile = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readHeaderPreference(hostile), false);
  assert.doesNotThrow(() => writeHeaderPreference(hostile, true));
});

// ── Collapse is presentation, never data ────────────────────────────────────
const layout = readFileSync("src/components/layout/DashboardLayout.tsx", "utf8");
const chromeSource = readFileSync("src/utils/rabChromeVisibility.ts", "utf8");

test("collapsing chrome cannot mutate RAB data", () => {
  // Neither the state law nor the shell that renders it can reach the API or
  // the draft: no fetch, no row mutation, no persistence call anywhere.
  for (const source of [layout, chromeSource]) {
    assert.doesNotMatch(source, /apiFetch|fetch\(|boq\/draft|setRows|mutateRows/);
  }
});

test("the restore control is rendered whenever the header is collapsed", () => {
  // The toggle's presence is conditional on being in a RAB room, never on the
  // header being visible — so it is still there to bring the header back.
  assert.match(layout, /isRabRoom \? \(\s*<button\s+className=\{`simprok-rab-header-toggle/);
  assert.match(layout, /aria-expanded=\{isHeaderVisible\}/);
  // And it is a real button with an accessible name in both states.
  assert.match(layout, /aria-label=\{isHeaderVisible \? 'Sembunyikan header' : 'Tampilkan header'\}/);
});

test("the sidebar toggle serves both RAB rooms and reports its state", () => {
  assert.match(layout, /className="simprok-rab-sidebar-toggle"/);
  assert.match(layout, /aria-expanded=\{isSidebarVisible\}/);
});

// ── TRUE FOCUS: all three workspace chrome blocks leave the layout ──────────
const workspace = readFileSync("src/pages/RabWorkspacePage.tsx", "utf8");

test("focus mode is derived from the shell, and defaults to the ordinary workspace", () => {
  assert.match(workspace, /const focusMode = layoutContext\?\.isHeaderVisible === false;/);
});

test("TRUE FOCUS removes navigation, status and toolbar from the LAYOUT", () => {
  // Each block is rendered only when focus mode is off. Guarding with
  // `focusMode ? null : (…)` takes it out of layout flow entirely — a height
  // or opacity rule would keep the very space the Owner asked to reclaim.
  const guarded = [...workspace.matchAll(/\{focusMode \? null : \(/g)].map((match) =>
    // The class name that opens each guarded block.
    (workspace.slice(match.index!, match.index! + 400).match(/className="([\w-]+)"/) ?? [])[1],
  );

  assert.equal(guarded.length, 3, "expected exactly three focus-guarded blocks");
  assert.deepEqual(guarded.slice().sort(), [
    "simprok-rab-focus-nav",       // Kembali · Ubah Data Pekerjaan · Menu
    "simprok-rab-toolbar",         // Import BOQ · Export · Print · Simpan · Kunci
    "simprok-rab-workspace__header", // the status row
  ]);
});

test("no shrunken focus variant survives in the stylesheet", () => {
  // The compact header variant was replaced by true removal; leaving its rules
  // behind would be CSS nothing can match.
  const css = readFileSync("src/index.css", "utf8");
  assert.doesNotMatch(css, /simprok-rab-workspace__header--focus/);
});

test("the way back is never hidden with the rest of the chrome", () => {
  // The restore rail lives in the shell, guarded only by "am I in a RAB room",
  // so no page-level focus state can remove it.
  assert.doesNotMatch(layout, /focusMode/);
  assert.match(layout, /isRabRoom \? \(\s*<button\s+className=\{`simprok-rab-header-toggle/);
});

test("focus mode cannot touch RAB data", () => {
  // The three guards are pure render conditions; entering or leaving focus
  // calls nothing that saves, locks, imports or recalculates.
  const focusGuardRegion = workspace.slice(
    workspace.indexOf("const focusMode ="),
    workspace.indexOf("const focusMode =") + 400,
  );
  assert.doesNotMatch(focusGuardRegion, /apiFetch|handleSaveDraft|mutateRows|setRows/);
});

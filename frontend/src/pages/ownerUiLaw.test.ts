import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * OWNER UI LAW — structural guards.
 *
 * These pages have no DOM test harness in this repo, and adding one would mean
 * adding a dependency nobody asked for. So the laws that are structural facts
 * about the JSX are asserted against the source itself: which control carries
 * a navigation handler, how many lock controls exist, and whether a sentence
 * that only makes sense for an editable draft can be reached while the RAB is
 * frozen. A regression here fails the build rather than waiting to be noticed
 * in a screenshot.
 *
 * The behavioural half of the same law lives in utils/projectCardAction.test.ts.
 */

const projectList = readFileSync("src/pages/ProjectListPage.tsx", "utf8");
const workspace = readFileSync("src/pages/RabWorkspacePage.tsx", "utf8");
const cardAction = readFileSync("src/utils/projectCardAction.ts", "utf8");
const rabDoor = readFileSync("src/pages/ProjectRabDoorPage.tsx", "utf8");
const legacyWarRoom = readFileSync("src/pages/ProjectWarRoomPage.tsx", "utf8");
/** The one stylesheet both RAB rooms share, and therefore the one place a
 *  column-geometry regression can hide. */
const css = readFileSync("src/index.css", "utf8");
/** The lock control's stable identity, independent of how it is styled. */
const LOCK_ANCHOR = 'data-route="/?ruang=kunci-rab"';

/**
 * The JSX opening tag starting at `index`. Scans to the closing angle bracket
 * at brace depth zero, so an arrow function inside a handler is not mistaken
 * for the end of the tag.
 */
const openingTagAt = (source: string, index: number) => {
  let depth = 0;
  for (let i = index; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0 && source[i - 1] !== "=") return source.slice(index, i + 1);
  }
  throw new Error("unterminated opening tag");
};

/** The body of a top-level `const NAME = (...) => { ... }` declaration. */
const functionBody = (source: string, name: string) => {
  const start = source.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf("{", source.indexOf("=>", start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced body for ${name}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// MY PROJECTS — three controls, three destinations
// ─────────────────────────────────────────────────────────────────────────────

test("A. the project name is the one door to Ruang Hidup RAB", () => {
  const index = projectList.indexOf('className="simprok-project-card__name-button"');
  assert.notEqual(index, -1, "the project name button is missing");

  const tag = openingTagAt(projectList, projectList.lastIndexOf("<button", index));
  assert.match(tag, /onClick=\{\(\) => openRab\(project\.id\)\}/);
  assert.match(projectList, /const openRab = \(id: string\) => \{\s*navigate\(buildRabPath\(id\)\);/);
  assert.match(cardAction, /buildRabPath = \(id: string\) => `\/project\/\$\{id\}\/rab`/);
});

test("B. the status badge is passive — information carries no handler", () => {
  const index = projectList.indexOf("simprok-project-chip simprok-project-chip--$");
  assert.notEqual(index, -1, "the status chip is missing");

  const start = projectList.lastIndexOf("<", index);
  assert.equal(projectList.slice(start, start + 5), "<span", "the badge must not be a button");

  const tag = openingTagAt(projectList, start);
  assert.doesNotMatch(tag, /onClick/, "the badge must not navigate");
  assert.doesNotMatch(tag, /navigate\(/);
});

test("C. the lifecycle slot opens Ruang Kerja RAB", () => {
  assert.match(projectList, /if \(action\.path\) navigate\(action\.path\);/);
  assert.match(cardAction, /buildContinueDraftPath = \(id: string\) => `\/project\/\$\{id\}\/rab\/workspace`/);
});

test("D. Lihat Detail opens Detail Project", () => {
  const index = projectList.indexOf('className="simprok-project-card__detail"');
  assert.notEqual(index, -1, "the detail door is missing");

  const tag = openingTagAt(projectList, projectList.lastIndexOf("<button", index));
  assert.match(tag, /onClick=\{\(\) => openDetail\(project\.id\)\}/);
  assert.match(cardAction, /buildDetailPath = \(id: string\) => `\/project\/\$\{id\}\/detail`/);
});

test("the card as a whole is not a fourth door", () => {
  const tag = openingTagAt(projectList, projectList.indexOf("<article"));
  assert.doesNotMatch(tag, /onClick/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RUANG KERJA — one lock control, and it only ever toggles a paragraph
// ─────────────────────────────────────────────────────────────────────────────

test("E. a locked workspace shows exactly one TERKUNCI control", () => {
  // lockedBadge is the word TERKUNCI. It may be rendered once and referenced
  // once more as that control's accessible name — never as a second control.
  const rendered = workspace.match(/\{rabLocked \? RAB_LOCK_COPY\.lockedBadge/g) ?? [];
  assert.equal(rendered.length, 2, "expected one control (label + aria-label), found another");

  // A <details> is legitimate elsewhere now — Detail Teknis on the price
  // trace. What must never return is a second lock disclosure.
  for (const block of workspace.split("<details").slice(1)) {
    const body = block.slice(0, block.indexOf("</details>"));
    assert.doesNotMatch(
      body,
      /lockedBadge|lockedNote/,
      "the lock disclosure must not return as its own <details> block",
    );
  }
  // Anchored on the control's own route marker rather than on its exact
  // className string: the class now carries a state modifier (GAP-04), and the
  // law being protected is "one lock control", not how it is styled.
  assert.equal(
    workspace.split('data-route="/?ruang=kunci-rab"').length - 1,
    1,
    "there must be exactly one lock control",
  );
});

/**
 * RAB-TABLE-UX-01R GAP-04 — the control must not wear the state it produces.
 * Navy is SIMPROK's authority colour, so a solid navy chip on an UNLOCKED RAB
 * read as "already locked". The lifecycle is untouched; only the affordance is.
 */
test("E2. Kunci RAB looks like an action until the RAB is actually locked", () => {
  const tag = openingTagAt(workspace, workspace.lastIndexOf("<button", workspace.indexOf(LOCK_ANCHOR)));
  // The authority modifier is applied ONLY on the locked branch.
  assert.match(tag, /simprok-rab-toolbar__lock--locked/);
  assert.match(tag, /rabLocked \? ' simprok-rab-toolbar__lock--locked' : ''/);

  // The base control is no longer painted with the locked-state fill, and the
  // navy authority styling now belongs to the modifier alone.
  const base = css.slice(
    css.indexOf(".simprok-rab-toolbar__lock {"),
    css.indexOf(".simprok-rab-toolbar__lock--locked"),
  );
  assert.doesNotMatch(base, /background:\s*var\(--simprok-authority-navy-900\)/);
  assert.match(css, /\.simprok-rab-toolbar__lock--locked[\s\S]{0,200}--simprok-authority-navy-900/);
});

test("F. the lock control toggles explanation only — no write, no transition", () => {
  const tag = openingTagAt(workspace, workspace.lastIndexOf("<button", workspace.indexOf(LOCK_ANCHOR)));

  // Locked: toggles local disclosure state. Editable: the existing lock command.
  assert.match(tag, /rabLocked \? setLockNoteOpen\(\(open\) => !open\) : setLockConfirmOpen\(true\)/);
  assert.match(tag, /aria-expanded=\{rabLocked \? lockNoteOpen : undefined\}/);
  assert.match(tag, /aria-controls=\{rabLocked \? 'simprok-rab-lock-note' : undefined\}/);

  // The toggle reaches no network and no lifecycle command.
  assert.doesNotMatch(tag, /apiFetch|handleLockRab|fetch\(/);

  // The disclosure is closed until asked for.
  assert.match(workspace, /const \[lockNoteOpen, setLockNoteOpen\] = useState\(false\);/);
  assert.match(workspace, /\{rabLocked && lockNoteOpen \? \(/);
});

test("G. a locked workspace cannot claim it is an editable draft", () => {
  // Each of these only makes sense for a live draft, so each must sit on the
  // false branch of a lifecycle gate.
  const editableClaims = [
    "Ruang kerja draft RAB — edit dan simpan sebelum baseline resmi.",
    "Draft tersimpan dimuat. Ruang kerja siap.",
    "Draft tersimpan di server — edit bebas, simpan kapan saja",
    "Draft kosong. Tambahkan item pekerjaan, lalu klik Simpan Draft.",
    "Draft kosong. Data baseline dimuat sebagai titik awal — klik Simpan Draft untuk menyimpan perubahan.",
  ];

  for (const claim of editableClaims) {
    const line = workspace.split("\n").find((candidate) => candidate.includes(claim));
    assert.notEqual(line, undefined, `missing copy: ${claim}`);

    const gatedOnItsOwnLine = /frozen \?|rabLocked$|rabLocked \?/.test(line as string);
    const gatedByBlock = /^\s*: '/.test(line as string) || /^\s*: `/.test(line as string);
    assert.equal(
      gatedOnItsOwnLine || gatedByBlock,
      true,
      `not gated by lifecycle state: ${claim}`,
    );
  }

  // The one editable claim that is guarded by an early return rather than a
  // ternary: saving. It cannot run at all on a frozen RAB.
  const save = functionBody(workspace, "handleSaveDraft");
  assert.match(save, /if \(!canEditDraft\) \{/);
  assert.equal(save.indexOf("if (!canEditDraft)") < save.indexOf("Draft tersimpan —"), true);

  // Every row edit is refused at one gateway, so no path can announce work it
  // did not do.
  const mutate = functionBody(workspace, "mutateRows");
  assert.match(mutate, /if \(!canEditDraft\) return false;/);
  assert.match(workspace, /if \(!mutateRows\(\(current\) => \[\.\.\.current, newRow\]\)\) return;/);
  assert.match(workspace, /if \(!removed\) return;/);
});

test("H. the editable draft keeps its own wording and its lock command", () => {
  // The draft path is gated, never deleted.
  assert.match(workspace, /Ruang kerja draft RAB — edit dan simpan sebelum baseline resmi\./);
  assert.match(workspace, /Draft tersimpan di server — edit bebas, simpan kapan saja/);
  assert.match(workspace, /Draft tersimpan dimuat\. Ruang kerja siap\./);

  // And an editable draft still reaches the real lock command.
  assert.match(workspace, /setLockConfirmOpen\(true\)/);
  assert.match(workspace, /disabled=\{rabLocked \? false : isLocking \|\| !projectId \|\| !canEditDraft \|\| !pricingComplete\}/);
});

test("the frozen workspace states its own truth", () => {
  assert.match(workspace, /Ruang kerja RAB terkunci — baca dan telusuri hasil RAB\./);
  assert.match(workspace, /RAB terkunci dimuat\. Mode baca\./);
  assert.match(workspace, /Tersimpan di server — dapat dibaca dan ditelusuri, tidak dapat diubah/);
});

// ─────────────────────────────────────────────────────────────────────────────
// FROZEN MEANS READ-ONLY — every write path, not only the row mutations
//
// LOCKED is readable and traceable, but the RAB truth it displays cannot be
// changed. Volume, manual unit price, margin and PPN never went through
// mutateRows, so a frozen RAB could still have its displayed numbers moved
// underneath the lock; and the destructive row controls were refused only
// after the click, which is not the same as being non-actionable.
// ─────────────────────────────────────────────────────────────────────────────

/** Interactive controls that must be inert while the RAB is frozen. */
const WRITE_CONTROLS = [
  // RAB-TABLE-UX-01R-FINAL: the per-row trash icons are gone from the Aksi
  // column. Deleting is now a STRUCTURAL act reached from the contextual
  // control, which is gated more strongly than `disabled` — it is not rendered
  // at all unless the draft is editable. That guarantee is asserted by I3.
  { name: 'add sub judul (row)', anchor: 'aria-label="Tambah Sub Judul"' },
  { name: 'add item (row)', anchor: 'aria-label="Tambah Item"' },
  { name: 'add sub judul (empty state)', anchor: 'aria-label="Tambah Sub Judul ke draft"' },
  { name: 'add item (empty state)', anchor: 'aria-label="Tambah Item pekerjaan ke draft"' },
  { name: 'move up', anchor: 'aria-label="Pindah baris ke atas"' },
  { name: 'move down', anchor: 'aria-label="Pindah baris ke bawah"' },
  { name: 'indent', anchor: 'aria-label="Jadikan sub-bagian"' },
  { name: 'outdent', anchor: 'aria-label="Naikkan tingkat"' },
];

/** Every opening tag in `workspace` that contains `anchor`. */
const tagsContaining = (anchor: string) => {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const hit = workspace.indexOf(anchor, from);
    if (hit === -1) return tags;
    tags.push(openingTagAt(workspace, workspace.lastIndexOf("<button", hit)));
    from = hit + anchor.length;
  }
};

test("I. structural row controls are disabled at the control while frozen", () => {
  for (const control of WRITE_CONTROLS) {
    const tags = tagsContaining(control.anchor);
    assert.notEqual(tags.length, 0, `${control.name} not found`);

    for (const tag of tags) {
      assert.match(tag, /disabled=\{[^}]*!canEditDraft/, `${control.name} is not gated at the control`);
    }
  }
});

test("I2. delete is gated at render, not merely refused after the click", () => {
  // The Owner's distinction: a control that fires and is rejected still looks
  // and behaves like a live control.
  for (const anchor of ['aria-label="Hapus baris"', 'aria-label="Hapus catatan"']) {
    for (const tag of tagsContaining(anchor)) {
      assert.match(tag, /disabled=\{!canEditDraft\}/);
    }
  }
});

/**
 * RAB-TABLE-UX-01R-FINAL — the delete door moved, and got a stronger gate.
 *
 * The Owner removed the trash icon from the price-action column. Deletion is
 * now reached from the contextual structural control, which is not disabled
 * while frozen — it is not rendered at all, so there is no control to fire.
 */
test("I3. the structural delete door exists, and only while the draft is editable", () => {
  // The trash icon is gone from Aksi, and no second delete icon replaced it.
  assert.equal(workspace.includes('aria-label="Hapus baris"'), false, "the row trash icon is back");
  assert.equal(workspace.includes('aria-label="Hapus catatan"'), false, "the note trash icon is back");
  assert.equal(workspace.includes("Trash2"), false, "a trash icon is still imported");

  // The structural controls are rendered behind the lifecycle gate itself.
  assert.match(workspace, /\{canEditDraft \? \(\s*<div className="simprok-rab-row-structure">/);
  // …and deletion still runs through the existing authority.
  assert.match(workspace, /const requestRemoveRow = \(rowId: string\)/);
  assert.match(workspace, /removeRow\(rowId\)/);
});

test("II. delete stays available while the draft is editable", () => {
  // Reachable from the contextual control on every row, with a real handler.
  assert.match(workspace, /onClick=\{\(\) => requestRemoveRow\(row\.id\)\}/);
  // A section never disappears silently: children force a confirmation.
  assert.match(workspace, /const children = descendantIdsOf\(rows, rowId\)/);
  assert.match(workspace, /if \(children\.length > 0\) \{[\s\S]{0,120}setPendingDelete/);
  assert.match(workspace, /Hapus Sub Judul beserta\s*\n?\s*isinya\?|Hapus Sub Judul beserta/);
});

test("III. no local edit path bypasses a gateway", () => {
  // markDraftMutated marks the draft dirty, so anything calling it is a write.
  // It may be called from the two gateways and nowhere else.
  const calls = workspace.match(/markDraftMutated\(\)/g) ?? [];
  assert.equal(calls.length, 2, "a write path outside the gateways reappeared");

  const mutate = functionBody(workspace, "mutateRows");
  const local = functionBody(workspace, "applyLocalEdit");
  assert.match(mutate, /if \(!canEditDraft\) return false;/);
  assert.match(local, /if \(!canEditDraft\) return false;/);
  assert.match(mutate, /markDraftMutated\(\);/);
  assert.match(local, /markDraftMutated\(\);/);
});

test("IV. value fields cannot be changed or typed into while frozen", () => {
  const valueFields = [
    { name: 'volume', anchor: 'aria-label={`Volume ${row.name}`}' },
    { name: 'manual unit price', anchor: 'aria-label={`Harga satuan ${row.name}`}' },
    { name: 'margin', anchor: 'aria-label="Persentase margin"' },
    { name: 'PPN', anchor: 'aria-label="Persentase PPN"' },
    { name: 'row name', anchor: 'aria-label="Uraian catatan"' },
    { name: 'unit', anchor: 'aria-label={`Satuan ${row.name}`}' },
  ];

  for (const field of valueFields) {
    const hit = workspace.indexOf(field.anchor);
    assert.notEqual(hit, -1, `${field.name} field not found`);
    const tag = openingTagAt(workspace, workspace.lastIndexOf("<input", hit));
    assert.match(tag, /readOnly=\{!canEditDraft\}/, `${field.name} is still typeable while frozen`);
    assert.match(tag, /aria-readonly=\{!canEditDraft\}/, `${field.name} does not announce read-only`);
  }

  // And the values themselves route through the guarded gateway.
  for (const setter of ['setVolumes', 'setUnitPrices', 'setMarginPercent', 'setPpnPercent']) {
    const inHandlers = workspace
      .split("\n")
      .filter((line) => line.includes(`${setter}(`) && line.includes("onChange"));
    for (const line of inHandlers) {
      assert.match(line, /applyLocalEdit/, `${setter} is written outside applyLocalEdit`);
    }
  }
});

test("V. commands refuse as well, so the freeze is not only on the screen", () => {
  assert.match(functionBody(workspace, "handleSaveDraft"), /if \(!canEditDraft\) \{/);
  assert.match(functionBody(workspace, "handlePickAhsp"), /if \(!canEditDraft\) return;/);
  // Persisting a price already derives its reachability from the same flag.
  assert.match(workspace, /evaluatePersistActionReachability\(\{[\s\S]{0,200}canEditDraft,/);
});

test("VI. read-only traces stay reachable while frozen", () => {
  // The AHSP column was removed from the table at the Owner's instruction, so
  // the analysis is reached the way it always also was: by selecting the row.
  // That path stays open while frozen — freezing writes must not hide reading.
  assert.match(workspace, /const handleRowClick = \(rowId: string[\s\S]{0,200}activateRow\(rowId\)/);
  assert.match(workspace, /const activateRow = \(rowId: string, mode: DrawerMode = 'AHSP_ANALYSIS'\)/);

  // And the price-trace door in the Aksi column is never disabled.
  const hit = workspace.indexOf('className="simprok-rab-table-action"');
  assert.notEqual(hit, -1, "the price-trace door is missing");
  const tag = openingTagAt(workspace, workspace.lastIndexOf("<button", hit));
  assert.doesNotMatch(tag, /disabled/, "reading the price trace must stay reachable");

  // The lock disclosure likewise only explains the lifecycle.
  const lockTag = openingTagAt(workspace, workspace.lastIndexOf("<button", workspace.indexOf(LOCK_ANCHOR)));
  assert.match(lockTag, /disabled=\{rabLocked \? false :/);
});

// ─────────────────────────────────────────────────────────────────────────────
// FROZEN AFFORDANCES — a control must not fire and then be refused
//
// Two write controls still advertised themselves while the RAB was frozen.
// Save carried aria-disabled but no native gate, so it stayed focusable,
// clickable and still said "Simpan Draft" until handleSaveDraft refused it.
// "Pilih AHSP" invited a choice on a row that cannot be changed.
// ─────────────────────────────────────────────────────────────────────────────

/** The JSX region beginning at `anchor`, `length` characters wide. */
const regionAt = (anchor: string, length: number) => {
  const hit = workspace.indexOf(anchor);
  assert.notEqual(hit, -1, `region not found: ${anchor}`);
  return workspace.slice(Math.max(0, hit - length), hit + length);
};

test("AFF-A. Save is non-actionable at render level while LOCKED", () => {
  // Present only when the draft can actually be saved — there is no frozen
  // variant of this control to focus, click, or read as an offer.
  assert.match(workspace, /\{canEditDraft \? \(\s*<button className="simprok-rab-toolbar__save"/);

  // The old shape — a permanently rendered button leaning on aria-disabled —
  // must not come back.
  const saveTag = openingTagAt(workspace, workspace.lastIndexOf("<button", workspace.indexOf('className="simprok-rab-toolbar__save"')));
  assert.doesNotMatch(saveTag, /aria-disabled=\{[^}]*!canEditDraft/);
});

test("AFF-B. Save keeps its exact behaviour while the draft is editable", () => {
  const saveTag = openingTagAt(workspace, workspace.lastIndexOf("<button", workspace.indexOf('className="simprok-rab-toolbar__save"')));

  assert.match(saveTag, /onClick=\{handleSaveDraft\}/);
  assert.match(saveTag, /aria-disabled=\{hasNegativeValue \|\| isSaving \|\| !projectId\}/);
  assert.match(saveTag, /data-route="\/\?ruang=simpan-draft"/);
  // The command still refuses independently, so the screen is not the only guard.
  assert.match(functionBody(workspace, "handleSaveDraft"), /if \(!canEditDraft\) \{/);
});

test("AFF-C. no reachable control claims Simpan Draft while LOCKED", () => {
  // Exactly one control is labelled Simpan Draft, and it lives inside the
  // editable-only branch.
  const labels = workspace.match(/aria-label="Simpan Draft"/g) ?? [];
  assert.equal(labels.length, 1);

  const region = regionAt('className="simprok-rab-toolbar__save"', 700);
  assert.match(region, /\{canEditDraft \? \(/);
  assert.match(region, /aria-label="Simpan Draft"/);

  // The phrase also appears in status messages that instruct a user to save.
  // Each must be unreachable while frozen: either gated on the lifecycle at
  // load, or set only after a row mutation the freeze already refuses.
  const guardedMutators = [functionBody(workspace, "addChild"), functionBody(workspace, "removeRow")];
  for (const line of workspace.split("\n")) {
    if (!line.includes("setStatusMessage") || !line.includes("Simpan Draft")) continue;
    const gatedOnLoad = /frozen \?/.test(line);
    const insideGuardedMutator = guardedMutators.some((body) => body.includes(line.trim()));
    assert.equal(
      gatedOnLoad || insideGuardedMutator,
      true,
      `a Simpan Draft instruction is reachable while frozen: ${line.trim()}`,
    );
  }
});

test("AFF-D. the table row offers no AHSP write affordance at all", () => {
  // The AHSP cell — which carried both the analysis door and the "Pilih AHSP"
  // write invitation — is gone from the table entirely. The capability itself
  // is not lost: choosing or changing an AHSP still lives in the drawer, where
  // it is gated by canEditDraft.
  assert.equal(
    workspace.includes('className="simprok-rab-ahsp-pick"'),
    false,
    "the table must not invite an AHSP change",
  );
  assert.match(workspace, /Pilih \/ Ganti AHSP/, "the drawer keeps the capability");
  const drawerPick = openingTagAt(workspace, workspace.lastIndexOf("<button", workspace.indexOf("Pilih / Ganti AHSP")));
  assert.match(drawerPick, /disabled=\{!canEditDraft/);
});

test("AFF-E. AHSP truth remains readable while LOCKED", () => {
  // The identity is no longer advertised in every row, but it is still known
  // and still shown when the user asks for the analysis.
  assert.match(workspace, /resolveAhspIdentity\(selectedItem\.ahsp\)\.fullLabel/);
  assert.match(workspace, /<span>Analisa AHSP<\/span>/);
  // Nothing about that reading is gated on editability.
  const meta = workspace.slice(workspace.indexOf("<span>Analisa AHSP</span>"), workspace.indexOf("<span>Status AHSP</span>"));
  assert.doesNotMatch(meta, /canEditDraft|disabled/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RUANG HIDUP RAB — the recap total is not a storage report
//
// The recap is read from the draft persistence structure even when the RAB is
// frozen. Where the numbers live is not what state the RAB is in, and the
// total was labelled from rabSource — so a locked RAB showed "Grand Total
// Draft" directly beneath a chip reading TERKUNCI.
//
// Nor is "not frozen" the same as "draft": that would put the word back on
// BERJALAN, SELESAI and UNKNOWN. The label is chosen positively, by the one
// presentation authority, and its per-status behaviour is proved by calling it
// in utils/rabLockDisplay.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

test("REC-1. the recap label is chosen positively from the lifecycle", () => {
  const line = rabDoor.split("\n").find((candidate) => candidate.includes("grandTotalDisplay"));
  assert.notEqual(line, undefined, "the grand total line is missing");

  assert.match(line as string, /\{recapTotalLabel\(presentation\.status\)\}/);
  assert.match(rabDoor, /import \{[\s\S]{0,200}recapTotalLabel,/);
});

test("REC-2. the page never decides the label by negation", () => {
  const line = rabDoor.split("\n").find((candidate) => candidate.includes("grandTotalDisplay")) as string;

  // No "frozen? / else draft" reasoning, and no storage-source reasoning.
  assert.doesNotMatch(line, /rabFrozen/);
  assert.doesNotMatch(line, /isDraftPreview/);
  assert.doesNotMatch(line, /rabSource/);
  // The page holds no literal of its own to drift from the authority.
  assert.equal(rabDoor.includes("'Grand Total Draft'"), false);
  assert.equal(rabDoor.includes("'Grand Total RAB'"), false);
});

test("REC-3. the persisted display source is untouched", () => {
  // The figures are still exactly what the server persisted; only the word
  // beside them changed.
  assert.match(rabDoor, /\{recapDisplay\.grandTotalDisplay\}/);
  assert.match(rabDoor, /\{recapDisplay\.subtotalDisplay\}/);
  assert.match(rabDoor, /\{recapDisplay\.marginAmountDisplay\}/);
  assert.match(rabDoor, /\{recapDisplay\.taxAmountDisplay\}/);
  assert.match(rabDoor, /const recapDisplay = useMemo\(\(\) => toRecapDisplay\(draftRecap\), \[draftRecap\]\);/);
});

test("REC-4. the surrounding lifecycle presentation is unchanged", () => {
  assert.match(rabDoor, /className=\{`simprok-rab-status simprok-rab-status--\$\{presentation\.chipModifier\}`\}/);
  assert.match(rabDoor, /\{presentation\.badgeLabel\}/);
  // The lifecycle itself still governs the page, even though it no longer
  // prints itself once per row — see REC-5.
  assert.match(rabDoor, /const rabFrozen = presentation\.status === 'TERKUNCI'/);
});

/**
 * RAB-TABLE-UX-01R GAP-02 — the row-level STATUS column was one document fact
 * repeated on every row. The Owner removed the visible column; the lifecycle
 * behind it is untouched and still stated once, authoritatively.
 */
test("REC-5. Ruang Hidup states RAB status once, not once per row", () => {
  const head = rabDoor.slice(rabDoor.indexOf("<thead"), rabDoor.indexOf("</thead>"));
  assert.doesNotMatch(head, /<th[^>]*>Status<\/th>/, "the row Status column is back");
  assert.equal(rabDoor.includes("{rowStateLabel}"), false, "a row still prints the document status");

  // …and the document-level status did NOT go with it.
  assert.match(rabDoor, /Status &amp; Mekanisme|Status & Mekanisme/);
  assert.match(rabDoor, /Status RAB/);
  // Asal Harga, the other narrow column, is untouched.
  assert.match(head, /<th[^>]*>Asal Harga<\/th>/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RAB-TRACE-01 — two doors, two questions, and evidence outside the table
//
// The AHSP code and the Aksi "Detail" button opened the identical panel, so
// the second was not a door at all. They now answer different questions, and
// price evidence opens beside the document instead of expanding a table cell.
// ─────────────────────────────────────────────────────────────────────────────

test("TR-1. selecting a row opens AHSP-analysis mode", () => {
  // With the AHSP column removed, row selection is the analysis door.
  assert.match(workspace, /const activateRow = \(rowId: string, mode: DrawerMode = 'AHSP_ANALYSIS'\)/);
  assert.match(workspace, /setDrawerMode\(mode\)/);
  // The drawer names the analysis by proven identity, never by the row's code.
  const meta = workspace.slice(workspace.indexOf("<span>Analisa AHSP</span>"), workspace.indexOf("<span>Status AHSP</span>"));
  assert.match(meta, /resolveAhspIdentity/);
  assert.doesNotMatch(meta, /wbsCode/);
});

test("TR-2. the Aksi control opens price-trace mode and is named Rincian Harga", () => {
  const hit = workspace.indexOf('className="simprok-rab-table-action"');
  assert.notEqual(hit, -1, "the price-trace door is missing");
  const tag = openingTagAt(workspace, workspace.lastIndexOf("<button", hit));

  assert.match(tag, /activateRow\(row\.id, 'PRICE_TRACE'\)/);
  assert.match(workspace, /PRICE_TRACE_ROW_ACTION/);
  // The generic word that made it a duplicate door is gone.
  assert.doesNotMatch(tag, /aria-label="Buka Detail Analisa AHSP"/);
});

test("TR-3. the two doors resolve to different modes", () => {
  // Row selection opens the analysis; the Aksi control opens the price trace.
  assert.match(workspace, /activateRow\(rowId\)/, "row selection opens the default mode");
  assert.match(workspace, /const activateRow = \(rowId: string, mode: DrawerMode = 'AHSP_ANALYSIS'\)/);

  const hit = workspace.indexOf('className="simprok-rab-table-action"');
  const tag = openingTagAt(workspace, workspace.lastIndexOf("<button", hit));
  assert.match(tag, /activateRow\(row\.id, 'PRICE_TRACE'\)/);

  // Two modes exist and the drawer branches on them.
  assert.match(workspace, /type DrawerMode = 'AHSP_ANALYSIS' \| 'PRICE_TRACE'/);
  assert.match(workspace, /\{drawerMode === 'PRICE_TRACE' \? \(/);
  assert.match(workspace, /\{drawerMode === 'AHSP_ANALYSIS' \? \(/);
});

test("TR-4. price evidence opens outside the table, not inside a cell", () => {
  // The evidence surface must not be an element expanding within a <td>.
  const tableStart = rabDoor.indexOf("<table");
  const tableEnd = rabDoor.indexOf("</table>", tableStart);
  const tableBody = rabDoor.slice(tableStart, tableEnd);

  assert.doesNotMatch(tableBody, /<details/, "evidence must not expand inside the table");
  assert.doesNotMatch(tableBody, /<dl /, "the evidence list must not live in a cell");

  // It is a panel beside the document, opened by a control that only sets
  // which row is being read.
  assert.match(rabDoor, /aria-label=\{PRICE_TRACE_TITLE\}/);
  assert.match(rabDoor, /onClick=\{\(\) => setEvidenceRowId\(row\.id\)\}/);
  assert.match(rabDoor, /const \[evidenceRowId, setEvidenceRowId\] = useState<string \| null>\(null\)/);
});

test("TR-5. opening a trace performs no business mutation", () => {
  // Corrected law. A read-only GET for authoritative evidence is lawful and
  // desirable — the earlier version of this test forbade any fetch, which is
  // what kept the viewer describing prices from row metadata instead of from
  // the proof SIMPROK already owns. What must never happen is a write.
  const viewerEffect = rabDoor.slice(
    rabDoor.indexOf("Opening evidence reads the authoritative proof"),
    rabDoor.indexOf("const evidenceRow = useMemo("),
  );

  assert.match(viewerEffect, /apiFetch\(/, "evidence must read the authoritative proof");
  assert.match(viewerEffect, /persisted-calculation/);
  for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(viewerEffect.includes(`method: '${verb}'`), false, `evidence must not ${verb}`);
  }
  for (const command of ["setRabRows", "setDraftRecap", "handleLockRab", "saveDraft"]) {
    assert.equal(viewerEffect.includes(command), false, `evidence must not call ${command}`);
  }

  // The workspace price-trace panel renders proof; it issues no command.
  const drawer = workspace.slice(
    workspace.indexOf("{drawerMode === 'PRICE_TRACE' ? ("),
    workspace.indexOf("{drawerMode === 'AHSP_ANALYSIS' ? ("),
  );
  assert.doesNotMatch(drawer, /handlePersistCalculation|handleSaveDraft|handlePickAhsp/);
  for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(drawer.includes(`method: '${verb}'`), false, `price trace must not ${verb}`);
  }
});

test("TR-6. Ruang Hidup shows the structural NO, not a row index", () => {
  // Attribute-tolerant: the law is which VALUE the column carries, not whether
  // the element also carries a width class.
  assert.match(rabDoor, /<th[^>]*>No<\/th>/);
  assert.match(rabDoor, /<td[^>]*>\{row\.number\}<\/td>/);
  // The old index fallback is gone.
  assert.doesNotMatch(rabDoor, /String\(index \+ 1\)/);
  assert.match(rabDoor, /toPersistedRowDisplayList\(/);
});

test("TR-7. Asal Harga uses the Owner's locked vocabulary, from one resolver", () => {
  assert.match(rabDoor, /resolvePriceOrigin\(row\.priceOrigin/);
  // The page holds no origin literal of its own to drift from the authority.
  assert.equal(rabDoor.includes("'Auto SIMPROK'"), false);
  assert.equal(rabDoor.includes("'Input Pengguna'"), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// RAB-TRACE-01 FINAL — row identity, one support slot, and two real rooms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RAB-TABLE-UX-01 supersedes the earlier reading of this law.
 *
 * TR-8 used to assert the opposite: that KODE showed the row's own WBS code
 * and must never be called an AHSP code. That was faithful to the law as it
 * stood. The Owner has since decided the visible code in the RAB table is the
 * ANALYSIS the row is priced by — a BOQ/WBS identity is machine identity and
 * no longer spends a human-facing column.
 *
 * What has NOT changed, and is still asserted below: there is exactly one code
 * column, the internal identity survives untouched on the row, and the value
 * shown comes from the single AHSP identity authority rather than from the
 * row's position or from any code invented here.
 */
test("TR-8. both tables carry NO and one KODE AHSP column, sourced from the identity authority", () => {
  for (const [name, source] of [["Ruang Hidup", rabDoor], ["Ruang Kerja", workspace]] as const) {
    const head = source.slice(source.indexOf("<thead"), source.indexOf("</thead>"));
    assert.match(head, /<th[^>]*>No<\/th>/, `${name} lost the NO column`);
    assert.match(head, /<th[^>]*>Kode AHSP<\/th>/, `${name} lost the KODE AHSP column`);
    // Still exactly one code column — the AHSP code replaced the WBS code in
    // place and did not become a second identity column beside it.
    assert.equal(
      (head.match(/<th[^>]*>Kode/g) ?? []).length,
      1,
      `${name} shows more than one code column`,
    );
  }

  // The displayed value is the resolved AHSP identity, in both rooms.
  assert.match(workspace, /const ahspIdentity = resolveAhspIdentity\(row\.ahsp\)/);
  assert.match(workspace, /\{ahspIdentity\.shortLabel\}/);
  assert.match(rabDoor, /\{row\.ahsp\.shortLabel\}/);

  // No room derives a code from the row's own identity or position.
  assert.doesNotMatch(workspace, /<td[^>]*>\{row\.wbsCode\}<\/td>/, "wbsCode is back in a visible cell");
  assert.doesNotMatch(rabDoor, /<td[^>]*>\{row\.code\}<\/td>/, "row.code is back in a visible cell");

  // RICH INSIDE: the machine identity itself is untouched and still carried.
  assert.match(workspace, /wbsCode/, "the row lost its WBS identity entirely");
  assert.match(rabDoor, /code: item\.wbsCode|row\.code/, "the viewer lost its code identity entirely");

  // The AHSP truth itself is untouched — still projected, still resolved.
  assert.match(rabDoor, /evidenceRow\.ahspWire/);
  assert.match(workspace, /resolveAhspIdentity/);
});

/**
 * The geometry law this refinement exists for: one column absorbs the room,
 * the compact ones do not, and neither room prices its columns by position.
 */
test("TR-8b. column widths are named by function, not by position", () => {
  // Position-based widths cannot be right in two tables whose column orders
  // differ — that is what put Uraian on 160px and Harga Satuan on 80px in the
  // viewer. They must not come back.
  assert.doesNotMatch(css, /\.simprok-rab-table th:nth-child/);
  assert.doesNotMatch(css, /\.simprok-rab-draft-table th:nth-child/);

  // Uraian is the one flexible column.
  assert.match(css, /\.simprok-rab-col-uraian\s*\{[^}]*width:\s*auto/);
  assert.match(css, /\.simprok-rab-col-uraian\s*\{[^}]*min-width:/);

  // Money never wraps.
  for (const money of ["simprok-rab-col-harga", "simprok-rab-col-jumlah"]) {
    assert.match(
      css,
      new RegExp(`\\.${money}\\s*\\{[^}]*white-space:\\s*nowrap`),
      `${money} may wrap a Rupiah value`,
    );
  }

  // Exactly one horizontal scrolling authority per room, and the viewer has
  // one at all — it previously scrolled the whole document instead.
  assert.match(css, /\.simprok-rab-table-canvas\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(rabDoor, /simprok-rab-table-canvas/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RAB-TABLE-UX-01R — Owner remediation laws
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GAP-05. `addChild` never broke; its only visible doors were the empty state
 * and a folder row's own action cell, so a draft with rows and no sub-heading
 * offered no way to add anything. The door must stay reachable from the sheet
 * itself, independently of whether any folder exists.
 */
test("UX-1. the creation door is reachable without an empty draft or a folder", () => {
  const tools = workspace.slice(
    workspace.indexOf('className="simprok-rab-sheet__tools"'),
    workspace.indexOf('className="simprok-rab-table-wrap"'),
  );
  assert.notEqual(tools.length, 0, "the sheet tools strip is gone");
  assert.match(tools, /addChild\(null, 'folder'\)/, "+ Sub Judul door lost");
  assert.match(tools, /addChild\(null, 'item'\)/, "+ Item door lost");
  // It is a door, not decoration: gated by the same lifecycle as every other
  // draft edit, never by row shape.
  assert.match(tools, /disabled=\{!canEditDraft\}/);
  // The existing per-folder doors are preserved, not replaced.
  assert.match(workspace, /addChild\(row\.id, 'folder'\)/);
  assert.match(workspace, /addChild\(row\.id, 'item'\)/);
});

/**
 * GAP-06. One numbering authority, shared by both rooms. A second algorithm —
 * or a decimal number written in JSX — is how hierarchy quietly becomes flat.
 */
test("UX-2. hierarchical numbering has exactly one authority", () => {
  assert.match(workspace, /assignStructuralNumbers/);
  assert.match(
    readFileSync("src/utils/rabPersistedDraftDisplay.ts", "utf8"),
    /assignStructuralNumbers/,
  );
  // Neither room composes a number itself.
  for (const [name, source] of [["Ruang Kerja", workspace], ["Ruang Hidup", rabDoor]] as const) {
    assert.doesNotMatch(source, /\$\{[^}]*\}\.\$\{[^}]*\}/, `${name} builds a number in JSX`);
  }
});

/**
 * GAP-07. Zoom belongs to the TABLE. If it ever wrapped the page, the toolbar
 * and the detail panel would scale with it and this would be browser zoom.
 */
test("UX-3. zoom is scoped to the table and is session-local", () => {
  assert.match(workspace, /simprok-rab-canvas__zoom simprok-rab-table-zoom/);
  // The scaled box sits inside the table canvas, never around the page body.
  const zoomAt = workspace.indexOf("simprok-rab-table-zoom");
  const wrapAt = workspace.indexOf('className="simprok-rab-table-wrap"');
  assert.ok(wrapAt !== -1 && wrapAt < zoomAt, "zoom must live inside the table canvas");
  assert.ok(
    zoomAt < workspace.indexOf('className="simprok-rab-table simprok-rab-draft-table"'),
    "zoom must wrap the table",
  );
  // Bounded, and reusing Ruang Hidup's own variable rather than a new engine.
  assert.match(workspace, /Math\.min\(140, Math\.max\(80, next\)\)/);
  assert.match(workspace, /'--simprok-rab-zoom': zoom \/ 100/);
  // Nothing is persisted and nothing is fetched by zooming.
  const zoomBlock = workspace.slice(
    workspace.indexOf("const changeZoom"),
    workspace.indexOf("const changeZoom") + 200,
  );
  assert.doesNotMatch(zoomBlock, /apiFetch|localStorage|fetch\(/);
});

/**
 * GAP-06/07 geometry. Resizing is session-local, bounded, and must never turn
 * a pointer move into a network call or a stored preference.
 */
test("UX-4. the detail panel resizes locally, bounded, with no persistence", () => {
  assert.match(workspace, /className="simprok-rab-drawer-resizer"/);
  assert.match(workspace, /onPointerDown=\{startDrawerResize\}/);
  // Bounded on both sides.
  assert.match(workspace, /const DRAWER_MIN = \d+;/);
  assert.match(workspace, /const DRAWER_MAX = \d+;/);
  assert.match(workspace, /Math\.min\(\s*DRAWER_MAX/);
  assert.match(workspace, /Math\.max\(DRAWER_MIN/);
  // The drag writes a CSS variable, not React state, so the table does not
  // re-render on every pointer move.
  assert.match(workspace, /setProperty\('--simprok-rab-drawer-width'/);
  const resizeStart = workspace.indexOf("const startDrawerResize");
  const resize = workspace.slice(
    resizeStart,
    workspace.indexOf("'pointercancel', onUp);", resizeStart),
  );
  assert.doesNotMatch(resize, /apiFetch|localStorage|fetch\(/, "resize must not persist or fetch");
  // Listeners are removed again — no leak.
  assert.match(resize, /removeEventListener\('pointermove'/);
  assert.match(resize, /removeEventListener\('pointerup'/);
});

/**
 * GAP-08 (mobile). The SAME drawer, presented full-screen — not a second
 * mobile detail component carrying its own copy of the truth.
 */
test("UX-5. mobile shows the same panel full-screen, and can be closed", () => {
  assert.match(workspace, /simprok-ahsp-drawer--fullscreen/);
  assert.match(workspace, /matchMedia\('\(max-width: 640px\)'\)/);
  // Exactly one drawer element exists in the page.
  assert.equal(workspace.split("<aside").length - 1, 1, "a second detail surface appeared");
  // The resize handle is desktop-only; there is nothing to drag full-screen.
  assert.match(workspace, /isMobileViewport \? null : \(/);
  // The existing close control still closes it.
  assert.match(workspace, /aria-label="Tutup panel"/);
  assert.match(css, /\.simprok-ahsp-drawer--fullscreen[\s\S]{0,240}position:\s*fixed/);
});

/**
 * GAP-03. The badge used to float over the sentence explaining the price. In a
 * panel the Owner can now narrow, that collision is guaranteed unless the two
 * share normal flow.
 */
test("UX-6. the drawer's explanatory text cannot be covered by its badge", () => {
  const frame = css.slice(
    css.indexOf(".simprok-ahsp-drawer__frame {"),
    css.indexOf(".simprok-ahsp-drawer__primary"),
  );
  assert.match(frame, /position:\s*static/, "the badge still floats over the text");
  assert.doesNotMatch(frame, /position:\s*relative/);
  assert.match(frame, /flex-direction:\s*column/);
  // The message itself is untouched.
  assert.match(workspace, /\{costEngineStatus\.frameMessage\}/);
  assert.match(workspace, /\{costEngineStatus\.frameBadge\}/);
});

/**
 * GAP-08. The recipe is grouped EXISTING data read through an endpoint that
 * already exists — and it must not become a second price trace.
 */
test("UX-7. the AHSP door shows the recipe, and Rincian Harga still owns price", () => {
  assert.match(workspace, /groupAhspComposition/);
  assert.match(workspace, /ahsp-occurrences\/\$\{compositionOccurrenceId\}/);
  // Reuses the occurrence the row already has; invents no identity.
  assert.match(
    workspace,
    /selectedItem\?\.calculationOccurrenceId \?\? selectedItem\?\.workingOccurrenceId/,
  );
  // The price-trace block has a frame of its own earlier in the file, so the
  // recipe's slice must end at the frame that FOLLOWS it.
  const compositionStart = workspace.indexOf('className="simprok-ahsp-composition"');
  assert.notEqual(compositionStart, -1, "the AHSP recipe block is missing");
  const composition = workspace.slice(
    compositionStart,
    workspace.indexOf('className="simprok-ahsp-drawer__frame"', compositionStart),
  );
  assert.match(composition, /Koefisien/);
  // No money in the recipe: that question belongs to Rincian Harga.
  assert.doesNotMatch(composition, /formatRupiah|unitPrice|lineTotal|Harga/);
  // …and Rincian Harga is still its own door.
  assert.match(workspace, /PRICE_TRACE_ROW_ACTION/);
  assert.match(workspace, /drawerMode === 'PRICE_TRACE'/);
});

test("TR-9. the origin badge is itself the evidence door", () => {
  // The separate link text is gone; the fact and the door are one element.
  assert.equal(rabDoor.includes(">{PRICE_TRACE_ACTION}<"), false, "the separate link text is back");
  const badge = rabDoor.slice(rabDoor.indexOf("const openable ="), rabDoor.indexOf("<span style={badgeStyle}>"));
  assert.match(badge, /onClick=\{\(\) => setEvidenceRowId\(row\.id\)\}/);
  // Lineage-aware label: "Import · Auto SIMPROK" when the row was transferred
  // in, otherwise just the origin. Same single element, same door.
  assert.match(badge, /\{origin\.lineageLabel\}/);
  // A row with no price is a plain fact, not a door.
  assert.match(rabDoor, /<span style=\{badgeStyle\}>\{origin\.lineageLabel\}<\/span>/);
});

test("TR-10. one right-side slot switches contents — no third grid sibling", () => {
  // Exactly two <aside> supports exist, and they are the two branches of one
  // conditional, so the grid never gains a child when evidence opens.
  const supports = rabDoor.match(/<aside className="simprok-rab-support"/g) ?? [];
  assert.equal(supports.length, 2, "the support slot was duplicated into siblings");

  const slot = rabDoor.slice(rabDoor.indexOf("{evidenceRow ? ("), rabDoor.indexOf("</aside>", rabDoor.indexOf('aria-label="Data Pendukung RAB"')));
  assert.match(slot, /aria-label=\{PRICE_TRACE_TITLE\}/);
  assert.match(slot, /\) : \(/, "the two panels must be branches of one slot");
  assert.match(slot, /aria-label="Data Pendukung RAB"/);
  // Closing evidence returns the slot to Data Pendukung.
  assert.match(rabDoor, /onClick=\{\(\) => setEvidenceRowId\(null\)\}/);
});

test("TR-11. price trace renders no AHSP write control", () => {
  // The analysis body — which owns selection, persistence and Execution
  // Factor — is gated to AHSP_ANALYSIS, so a read-only evidence room cannot
  // reach a write control.
  assert.match(workspace, /\{drawerMode === 'AHSP_ANALYSIS' \? \(/);

  const priceTracePanel = workspace.slice(
    workspace.indexOf("{drawerMode === 'PRICE_TRACE' ? ("),
    workspace.indexOf("{drawerMode === 'AHSP_ANALYSIS' ? ("),
  );
  for (const control of [
    "handlePersistCalculation",
    "handlePickAhsp",
    "handleSaveDraft",
    "simprok-execution-factor",
    "Pilih / Ganti AHSP",
    "Hitung & Simpan Harga",
  ]) {
    assert.equal(
      priceTracePanel.includes(control),
      false,
      `price trace must not offer "${control}"`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE PRICE AUTHORITY — one proof, many views
// ─────────────────────────────────────────────────────────────────────────────

test("TR-12. both rooms feed the same presenter from the authoritative proof", () => {
  for (const [name, source] of [["Ruang Kerja", workspace], ["Ruang Hidup", rabDoor]] as const) {
    assert.match(source, /buildPriceTrace\(\{/, `${name} must use the shared presenter`);
    assert.match(
      source,
      /authoritative:[^,]*SERVER_COST_KERNEL/,
      `${name} must pass the authoritative proof for a kernel price`,
    );
  }
  // Both derive that proof through the one display authority.
  assert.match(workspace, /toPersistedCalculationDisplay\(/);
  assert.match(rabDoor, /toPersistedCalculationDisplay\(/);
});

test("TR-13. the rich persisted proof belongs to PRICE_TRACE, not AHSP analysis", () => {
  const priceTrace = workspace.slice(
    workspace.indexOf("{drawerMode === 'PRICE_TRACE' ? ("),
    workspace.indexOf("{drawerMode === 'AHSP_ANALYSIS' ? ("),
  );
  const ahspAnalysis = workspace.slice(workspace.indexOf("{drawerMode === 'AHSP_ANALYSIS' ? ("));

  assert.match(priceTrace, /persistedProofDisplay/, "price trace must own the persisted proof");
  assert.equal(
    ahspAnalysis.includes("persistedProofDisplay"),
    false,
    "AHSP analysis must not duplicate the project price evidence",
  );
});

test("TR-14. the viewer fails closed rather than showing row numbers as proof", () => {
  const viewerEffect = rabDoor.slice(
    rabDoor.indexOf("Opening evidence reads the authoritative proof"),
    rabDoor.indexOf("const evidenceRow = useMemo("),
  );
  // An unreadable proof becomes null — which the presenter reports as unproven.
  assert.match(viewerEffect, /\.catch\(\(\) => \{[\s\S]*display: null/);
});

// ─────────────────────────────────────────────────────────────────────────────
// ONE VISIBLE MESSAGE — the RAB stops explaining itself twice
//
// "RAB Terkunci" already says the RAB is locked, and the baseline sentence sat
// permanently above the document. Both facts are still true and still readable;
// neither spends permanent space any more.
// ─────────────────────────────────────────────────────────────────────────────

test("VD-1. the lock explanation is not rendered by default", () => {
  // The sentence exists as copy and is still reachable, but nothing renders it
  // unconditionally beside the status chip.
  assert.equal(
    rabDoor.includes("<p>{statusMechanismCopy}</p>"),
    false,
    "the permanent lock paragraph is back",
  );
  assert.equal(
    rabDoor.includes("<small>{RAB_LOCK_COPY.lockedNote}</small>"),
    false,
    "the toolbar repeats the lock sentence again",
  );
  // It is shown only inside the disclosure the user opened.
  const detail = rabDoor.slice(
    rabDoor.indexOf("{statusDetailOpen ? ("),
    rabDoor.indexOf("</dl>", rabDoor.indexOf("{statusDetailOpen ? (")),
  );
  assert.match(detail, /\{statusMechanismCopy\}/);
});

test("VD-2. the baseline banner is gone from the primary RAB surface", () => {
  // No permanent banner, and no toolbar subtitle carrying the same sentence.
  const document = rabDoor.slice(rabDoor.indexOf('aria-label="Dokumen RAB"'), rabDoor.indexOf("</table>"));
  assert.equal(
    document.includes("RAB tersimpan, belum menjadi baseline resmi."),
    false,
    "the baseline banner still occupies the document",
  );
});

test("VD-3. the baseline fact survives, on request", () => {
  const detail = rabDoor.slice(
    rabDoor.indexOf("{statusDetailOpen ? ("),
    rabDoor.indexOf("</dl>", rabDoor.indexOf("{statusDetailOpen ? (")),
  );
  assert.match(detail, /<dt[^>]*>Baseline<\/dt>/);
  assert.match(detail, /Belum menjadi baseline resmi/);
  // Read from lifecycle truth already loaded — no new authority, no new fetch.
  assert.match(detail, /rabLifecycle\?\.activeBaselineCount/);
  assert.match(detail, /rabLifecycle\.activeBaselineCount > 0/);
});

test("VD-4. the status chip discloses; it never unlocks", () => {
  const index = rabDoor.indexOf('aria-controls="simprok-rab-status-detail"');
  assert.notEqual(index, -1, "the status disclosure is missing");
  const tag = openingTagAt(rabDoor, rabDoor.lastIndexOf("<button", index));

  assert.match(tag, /onClick=\{\(\) => setStatusDetailOpen\(\(open\) => !open\)\}/);
  assert.match(tag, /aria-expanded=\{statusDetailOpen\}/);
  // Closed until asked for.
  assert.match(rabDoor, /const \[statusDetailOpen, setStatusDetailOpen\] = useState\(false\)/);

  // This control reaches no server, no lifecycle transition, no lock command.
  assert.doesNotMatch(
    tag,
    /apiFetch|fetch\(|handleLockRab|setRabLifecycle|setRabLocked|unlock|reopen/i,
  );

  // Scoped to THIS control on purpose. An earlier version of this test
  // forbade words like "Buka Kunci" or "Reopen" anywhere on the page, which
  // would have made a lawful future Reopen capability fail a test written
  // about a disclosure chip. What must stay true is that this chip only opens
  // a paragraph — not that the word may never appear in SIMPROK.
});

test("VD-5. the primary status and the Addendum action are untouched", () => {
  // "RAB Terkunci" still comes from the one presentation resolver...
  assert.match(rabDoor, /\{presentation\.badgeLabel\}/);
  assert.match(rabDoor, /simprok-rab-mechanism__label">Status & Mekanisme/);
  // ...and the existing Addendum control is exactly as it was.
  assert.match(rabDoor, /onClick=\{handleAddendumAction\}/);
  assert.match(rabDoor, /Ajukan Perubahan \/ Addendum/);
  assert.match(rabDoor, /\{!archived \? \(/);
});

test("PRE-MON-04. legacy Reality fails closed and keeps the canonical Monitoring door", () => {
  assert.match(legacyWarRoom, /projects\/\$\{id\}\/reality/);
  assert.match(
    legacyWarRoom,
    /Perhitungan progress dan deviasi resmi belum diaktifkan/,
  );
  assert.match(
    legacyWarRoom,
    /Actual lapangan yang tercatat tetap dapat ditinjau melalui Monitoring/,
  );
  assert.match(legacyWarRoom, /navigate\(`\/field\/project\/\$\{id\}`\)/);
  assert.match(legacyWarRoom, />\s*Buka Monitoring\s*<\/button>/);
  assert.doesNotMatch(legacyWarRoom, /Overall Project Execution/);
  assert.doesNotMatch(legacyWarRoom, /Observed Deviations/);
  assert.doesNotMatch(legacyWarRoom, /SIMPROK SIGNAL/);
  assert.doesNotMatch(legacyWarRoom, /certaintyLevel="C4"/);
  assert.doesNotMatch(legacyWarRoom, /overallActualProgress/);
});

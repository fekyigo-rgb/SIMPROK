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

  assert.equal(workspace.includes("<details"), false, "the standalone disclosure must be gone");
  assert.equal(
    workspace.split('className="simprok-rab-toolbar__lock"').length - 1,
    1,
    "there must be exactly one lock control",
  );
});

test("F. the lock control toggles explanation only — no write, no transition", () => {
  const tag = openingTagAt(workspace, workspace.lastIndexOf("<button", workspace.indexOf('className="simprok-rab-toolbar__lock"')));

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

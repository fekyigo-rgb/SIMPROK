import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * ACG-01 OWNER BROWSER GAP — FINDINGS B & C, AS SOURCE LAW.
 *
 * An action in the AHSP room or on the Import AHSP door must look pressable,
 * answer a pointer, a keyboard and a finger, show that it is working, and say
 * what it did beside the item it acted on. These laws pin the SHARED path that
 * gives every action that behaviour — one stylesheet, one outcome notice, one
 * feedback module — so no item is ever fixed alone and none is left behind.
 */

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const codeOnly = (source: string) =>
  source
    .split(CARRIAGE_RETURN)
    .join("")
    .split(NEWLINE)
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join(NEWLINE);

const importPage = codeOnly(readFileSync("src/pages/AhspImportPage.tsx", "utf8"));
const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));
const dialog = codeOnly(readFileSync("src/components/ahsp/UsulkanSimprokDialog.tsx", "utf8"));
const css = readFileSync("src/styles/ahsp.css", "utf8");

/**
 * Every <button> element in a source, from its opening to its closing tag. JSX
 * attributes hold arrow functions ("=>"), so an opening tag cannot be found by
 * its first ">"; the whole element is taken instead.
 */
const buttonTags = (source: string): string[] =>
  source
    .split("<button")
    .slice(1)
    .map((rest) => "<button" + rest.slice(0, rest.indexOf("</button>")));

test("B1: no action is an inline style object any more — inline styles cannot hover, focus or press", () => {
  for (const [name, source] of [["import", importPage], ["room", room], ["dialog", dialog]] as const) {
    assert.ok(!source.includes("primaryButton"), `${name} still styles an action inline`);
    assert.ok(!source.includes("outlineButton"), `${name} still styles an action inline`);
  }
});

test("B2: every button on both doors and in the dialog uses the shared action contract", () => {
  for (const [name, source] of [["import", importPage], ["room", room], ["dialog", dialog]] as const) {
    const tags = buttonTags(source);
    assert.ok(tags.length > 0, `${name} has no buttons to check`);
    for (const tag of tags) {
      assert.match(tag, /className="ahsp-action ahsp-action--/u, `${name}: ${tag.slice(0, 80)}`);
    }
  }
  assert.ok(importPage.includes("import '../styles/ahsp.css'"));
  assert.ok(room.includes("import '../styles/ahsp.css'"));
});

test("B3: the contract has every state — hover for pointers only, focus, pressed, busy, disabled, touch size", () => {
  assert.match(css, /@media \(hover: hover\)\s*\{[\s\S]*:hover:not\(:disabled\)/u);
  assert.match(css, /\.ahsp-action:focus-visible\s*\{/u);
  assert.match(css, /\.ahsp-action:active:not\(:disabled\)\s*\{/u);
  assert.match(css, /\.ahsp-action:disabled\s*\{/u);
  assert.match(css, /\.ahsp-action\[aria-busy='true'\]/u);
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*min-height: 44px/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  // Pressing never moves the layout: only transform, never margin or size.
  const active = css.slice(css.indexOf(".ahsp-action:active:not(:disabled)"));
  assert.doesNotMatch(active.slice(0, active.indexOf("}")), /margin|width|height|padding/u);
});

test("B4: the stylesheet adds no colour outside the Colour Lock", () => {
  const locked = new Set(["#c0392b", "#98a2b3", "#c77a17"]);
  const hexes = (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((hex) => hex.toLowerCase());
  for (const hex of hexes) {
    // Alpha shadows of Biru, Merah and Navy are the locked hues, translucent.
    const base = hex.length === 9 ? hex.slice(0, 7) : hex;
    assert.ok(
      locked.has(base) || base === "#1da1f2" || base === "#16294b",
      `unlocked colour ${hex}`,
    );
  }
  assert.ok(!css.includes("#7E22CE") && !css.toLowerCase().includes("#704da1"));
});

test("C1: every curation and learning action shows it is working and refuses a second press", () => {
  assert.ok(importPage.includes("curationLock.current"));
  assert.ok(importPage.includes("questionLock.current"));
  assert.ok(importPage.includes("'Menyimpan…'"));
  assert.ok(importPage.includes("aria-busy={busy || undefined}"));
  assert.ok(importPage.includes("disabled={locked}"));
  // The document buttons each say what they are doing.
  assert.ok(importPage.includes("importAction === 'PREVIEW' ? 'Membaca…' : 'Pahami dokumen'"));
  assert.ok(importPage.includes("importAction === 'COMMIT' ? 'Menyimpan…' : 'Simpan yang terbukti'"));
});

test("C2: results are READ from the server and shown where the action was pressed", () => {
  assert.ok(importPage.includes("readApiFailure(response)"));
  assert.ok(importPage.includes("learningOutcomeOf(results)"));
  assert.ok(importPage.includes("describeResourceDecisionSuccess"));
  assert.ok(importPage.includes("describeResourceDecisionFailure"));
  assert.ok(importPage.includes("describeGovernanceSuccess"));
  assert.ok(importPage.includes("placeOutcomes("));
  assert.ok(importPage.includes("<ActionOutcomeNotice"));
  // The distant section-level banners are gone.
  assert.ok(!importPage.includes("setCurationNotice"));
  assert.ok(!importPage.includes("setCurationError"));
  assert.ok(!importPage.includes("' Coba lagi.'"));
});

test("C3: the room's bulk actions count what the server accepted instead of ignoring the answer", () => {
  assert.ok(room.includes("if (response.ok)"));
  assert.ok(room.includes("describeBulkPropose"));
  assert.ok(room.includes("describeBulkDelete"));
  assert.ok(room.includes("<ActionOutcomeNotice"));
  assert.ok(room.includes("'Menghapus…'"));
});

test("E: 'genuinely new' is a live door only when it can open, and otherwise shut and explained", () => {
  assert.ok(importPage.includes("view.canProposeNew && view.newUnitDefinitionId ? ("));
  assert.ok(importPage.includes("view.newResourceBlockedLine"));
  assert.ok(importPage.includes("aria-describedby={blockedReasonId}"));
  // Ruled-out rows are words, never buttons.
  assert.ok(importPage.includes("view.ruledOutLine"));
  assert.ok(!importPage.includes("view.ruledOut.map"));
});

test("ACG-01.1: the preview separates ruled-out rows, and the queue says the resource was accepted", () => {
  assert.ok(importPage.includes("previewRuledOutLine(previewRuledOutNames(item.resources))"));
  // The possible-match line still reads ONLY nominated names.
  assert.ok(importPage.includes("previewCandidateNames(item.resources)"));
  assert.ok(importPage.includes("sudah diterima serta disimpan SIMPROK"));
  // Nothing on the door says a source resource was refused.
  assert.ok(!/Sumber daya (ini )?ditolak/u.test(importPage));
});

test("ACG-01.1 U1: the preview never calls a possibility a match — neutral for weak and strong alike", () => {
  // The preview receives NAMES only; it cannot know which are confirmable, so
  // it may not use the word the queue reserves for a row a person may confirm.
  assert.ok(!importPage.includes("kemungkinan padanan"));
  assert.ok(importPage.includes("Kemungkinan yang masih perlu diperiksa:"));
  // Still points at the one act that puts them in front of a person — and still
  // claims no equivalence, no storage, no decision.
  assert.ok(importPage.includes("Simpan untuk meninjaunya di bawah."));
  assert.ok(!/(padanan|sama dengan) (yang )?(sudah|telah)/u.test(importPage));
  // Every name SIMPROK found is still shown: nothing is hidden, nothing reordered.
  assert.ok(importPage.includes("previewCandidateNames(item.resources)"));
  assert.ok(importPage.includes("candidateNames.slice(0, 4).join(', ')"));
  assert.ok(importPage.includes("dan ${candidateNames.length - 4} lainnya"));
  // The QUEUE keeps its own two-strength wording, built from confirmable rows.
  const display = readFileSync("src/utils/resourceObservationDisplay.ts", "utf8");
  assert.ok(display.includes("'SIMPROK menemukan kemungkinan padanan: ' + nameList(names)"));
  assert.ok(display.includes("belum cukup kuat untuk dipilih"));
});

test("D: learning is offered or its absence explained from ONE display function", () => {
  assert.ok(importPage.includes("describeGroupLearning(members, view)"));
  assert.ok(importPage.includes("learning.offered ? ("));
  assert.ok(importPage.includes("learning.unavailableLine"));
  assert.ok(!importPage.includes("groupCanRemember("));
});

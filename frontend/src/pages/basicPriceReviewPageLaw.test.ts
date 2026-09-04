import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * BASIC PRICE REVIEW — HUMAN SURFACE LAW.
 *
 * This page has no DOM harness in this repo, and adding one would mean adding a
 * dependency nobody asked for — the same reasoning `ownerUiLaw.test.ts` already
 * settled on, so the same shape is used here.
 *
 * The behavioural half of this law is pure and lives in
 * `utils/basicPriceImportDisplay.test.ts`, where every sentence the reviewer
 * reads is asserted against fixtures built from the authorities' REAL
 * explanation strings. What that half cannot see is whether the PAGE still
 * reads those sentences from the right place. That is what these guards hold:
 *
 *   RICH INSIDE, SIMPLE OUTSIDE.
 *
 * The engines keep their full internal explanation — ResourceCatalog ids, raw
 * reason codes, and on the governed-decision branch the account, the moment and
 * the note of a human who decided elsewhere. This page must simply never read
 * it. A guard on the SOURCE is what makes "never read" a build failure instead
 * of a promise.
 */

const page = readFileSync("src/pages/BasicPriceReviewPage.tsx", "utf8");

/** The JSX body — everything after the component opens. Comments above it are
 *  documentation and may lawfully NAME what the page must not render. */
const body = page.slice(page.indexOf("export function BasicPriceReviewPage"));

/** JSX comment blocks carry the reasoning; they render nothing. Stripping them
 *  keeps a guard from failing on the very sentence that explains it. */
const renderable = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("HS-1. the page never reads an authority's internal explanation", () => {
  assert.doesNotMatch(
    renderable,
    /\.explanation\b/,
    "the internal explanation carries database ids and, on one branch, another person's record",
  );
});

test("HS-2. no internal identifier is rendered as content", () => {
  for (const field of ["resourceCatalogId", "unitDefinitionId", "policyVersion", "authority"]) {
    assert.doesNotMatch(
      renderable,
      new RegExp("\\.\\s*" + field + "\\b"),
      `${field} is an internal key, never text on a reviewer's screen`,
    );
  }
});

test("HS-3. raw reason codes are never joined straight onto the page", () => {
  assert.doesNotMatch(
    renderable,
    /reasonCodes\s*\.\s*join/,
    "row reason codes are UPPER_SNAKE; they reach the screen through rowNoteLines or not at all",
  );
  assert.doesNotMatch(renderable, /blockingFacts\s*\.\s*join/);
});

test("HS-4. every machine sentence comes from the shared narrative", () => {
  assert.match(page, /rowMachineNarrative,/, "the narrative must be imported");
  assert.match(page, /rowNoteLines,/, "the note split must be imported");
  assert.match(renderable, /\{narrative\.unit\}/);
  assert.match(renderable, /\{narrative\.resource\}/);
  assert.match(renderable, /\{narrative\.stateLabel\}/);
});

test("HS-5. a candidate's id keys its row and is not its text", () => {
  assert.match(renderable, /key=\{candidate\.key\}/);
  assert.match(renderable, /\{candidate\.text\}/);
  assert.doesNotMatch(renderable, /candidate\.resourceCatalogId/);
});

test("HS-6. leftover technical vocabulary reuses the app's ONE Detail Teknis title", () => {
  assert.match(page, /import \{ TECHNICAL_DETAIL_TITLE \} from '\.\.\/utils\/rabTraceDisplay'/);
  assert.match(renderable, /<summary>\{TECHNICAL_DETAIL_TITLE\}<\/summary>/);
  // And it is a disclosure, not the first thing read.
  assert.ok(
    renderable.indexOf("notes.human.map") < renderable.indexOf("TECHNICAL_DETAIL_TITLE"),
    "plain sentences must precede the technical disclosure",
  );
});

test("HS-7. the technical disclosure renders a NOTICE, never a list of codes", () => {
  // Detail Teknis discloses HOW MANY facts have no user sentence yet. If this
  // ever goes back to rendering the codes themselves, a site engineer is reading
  // programmer vocabulary again — one level down the page, which is not a fix.
  assert.match(renderable, /\{notes\.technicalNotice\}/);
  // `technicalNotice` is masked out first, so this guard cannot pass merely
  // because the notice's own name contains the word it searches for.
  assert.doesNotMatch(
    renderable.replace(/notes\.technicalNotice/g, ""),
    /notes\.technical/,
    "the raw code list must not be rendered",
  );
  assert.doesNotMatch(renderable, /technical\s*\.\s*join/);
  assert.doesNotMatch(renderable, /untranslated/);
});

test("HS-8. the review room still decides nothing — only a human resolve/reject acts", () => {
  // Unchanged law, guarded here because this slice edited the same JSX: the
  // page may not auto-submit a row it believes is proven.
  assert.doesNotMatch(renderable, /useEffect\([^)]*handleResolve/);
  assert.equal((page.match(/resolveBasicPriceImportRow\(/g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// THE SILENT DOOR — the defect this room existed to close, guarded at source.
//
// The Owner clicked `Ajukan Batch (6 siap)` and got nothing: no request, no
// message, no navigation. The button carried the native `disabled` attribute,
// so the browser dispatched no click at all — and it was disabled by this
// page's OWN copy of the server's preconditions, which could answer only yes or
// no and therefore had no reason to render.
//
// Every guard below is a way that failure could come back.
// ---------------------------------------------------------------------------

test("HS-9. the page holds no copy of the server's preconditions", () => {
  // `canSubmitBatch` was the copy. Its return value was a boolean, and a
  // boolean cannot explain itself to anybody.
  assert.doesNotMatch(page, /canSubmitBatch/, "the frontend law copy must stay deleted");
  // Nor may the page rebuild it from the same counters under a new name.
  assert.doesNotMatch(
    renderable,
    /needsReviewRows\s*===\s*0/,
    "availability is the server's verdict, never recomputed here",
  );
});

test("HS-10. both actions take their availability from the server's verdict", () => {
  // PRIVATE USE now travels through `oneActionAcceptanceView`, which CONSUMES
  // the server verdict (offered / reasonCode / actionableRows) and applies
  // exactly one documented overrule: the server counts only rows a human has
  // already finished, so a batch of machine-proven unbound rows honestly reads
  // as "nothing ready yet" until this very press binds them. The page still
  // computes no precondition of its own — HS-9 guards that — and the button and
  // the refusal line now read the SAME derived verdict, which is what stopped
  // the room offering an action and denying it in the same breath.
  //
  // BP-SHARED-PROPOSAL-01 — proposal visibility may use `proposalDoorView`, but
  // enablement remains the server's `simprokProposal.offered` (via enabled).
  assert.match(page, /oneActionAcceptanceView\(batch, touchedRowIds\)/);
  assert.match(renderable, /oneActionOffered/);
  assert.match(page, /proposalDoorView\(batch\.actions\.simprokProposal\)/);
  assert.match(renderable, /proposalDoor\.enabled/);
});

test("HS-11. no toolbar control is disabled without a reason on screen", () => {
  // A disabled button in this toolbar must be accompanied by the sentence for
  // its reason code. Both halves are asserted, because either one alone is the
  // old defect: a reason with no greying, or greying with no reason.
  assert.match(renderable, /privateUseBlockSentence\(batch\.actions\.privateUse\.reasonCode\)/);
  assert.match(renderable, /proposalBlockSentence\(batch\.actions\.simprokProposal\.reasonCode\)/);
});

test("HS-12. a disabled control also carries aria-disabled, so it LOOKS shut", () => {
  // The greying rule in index.css is keyed on `aria-disabled`, and the old
  // button set only the native attribute — so it rendered fully coloured, with
  // `cursor: pointer`, over a door that could not open. Native `disabled` stays
  // too: aria alone would look shut while still firing clicks.
  const toolbar = renderable.slice(
    renderable.indexOf('className="simprok-rab-toolbar"'),
    renderable.indexOf("</section>", renderable.indexOf('className="simprok-rab-toolbar"')),
  );
  assert.ok(toolbar.length > 0, "the action toolbar must still exist");
  // The lookbehind matters: `\bdisabled=\{` also matches inside
  // `aria-disabled={`, which would make the two counts agree by construction
  // and leave this guard proving nothing.
  const disabledCount = (toolbar.match(/(?<!-)\bdisabled=\{/g) ?? []).length;
  const ariaCount = (toolbar.match(/aria-disabled=\{/g) ?? []).length;
  assert.equal(disabledCount, ariaCount, "every disabled control must also be aria-disabled");
  assert.ok(disabledCount > 0);
});

test("HS-13. the primary action keeps prices; proposing is separate and optional", () => {
  // The single `Ajukan Batch` was untrue twice: it saved nothing, and it was
  // the only way out of the room. These two must stay distinct doors.
  //
  // KEEPING is now ONE server command (`smartSaveBatch`) rather than two calls
  // this page sequenced itself. Proposing to curation remains its own separate,
  // optional act.
  assert.match(page, /smartSaveBatch/, "the private-use door must be wired");
  assert.equal((page.match(/smartSaveBatch\(/g) ?? []).length, 1);
  assert.equal((page.match(/submitBasicPriceImportBatch\(/g) ?? []).length, 1);
  assert.match(renderable, /Simpan &amp; Gunakan/, "the primary action must say what it does");
});

test("HS-13b. the browser never sequences the two halves of one intent", () => {
  // The binding half and the keeping half are two governed acts with two
  // different permissions. That is fine; what is not fine is a PAGE deciding
  // the order, because a dropped connection between them leaves the batch
  // half-done and the person who pressed once cannot tell which half ran.
  assert.doesNotMatch(
    page,
    /acceptMachineProvenRows\(/,
    "the page must not call the binding half itself",
  );
  assert.doesNotMatch(
    page,
    /keepBasicPriceImportBatchPrivate\(/,
    "the page must not call the keeping half itself",
  );
});

test("HS-14. no failure is swallowed — every catch reads the error it caught", () => {
  // A bare `catch {}` discards the status and body the API client parsed, which
  // is how a 403 came to be reported as "the row may have changed".
  assert.doesNotMatch(page, /\}\s*catch\s*\{/, "a catch must bind and read its error");
});

test("HS-13c. a failed smart-save is explained by the smart-save law, not the private-use one", () => {
  // ONE COMMAND IS NOT ONE TRANSACTION. Bindings commit in bounded chunks, so a
  // failure in the keeping step leaves them in the database — and every
  // private-use sentence ends by promising the opposite. Pointing this catch at
  // `lifecycleActionFailureMessage` therefore told a reviewer their thirteen
  // bound rows did not exist, which is the one lie this room cannot afford.
  assert.match(
    page,
    /catch \(error\) \{\s*setStatusMessage\(smartSaveFailure\(error\)\);/,
    "the smart-save catch must use the smart-save failure law",
  );
  assert.match(page, /smartSaveFailureMessage/, "the smart-save law must be imported");
  // And the borrowed vocabulary is gone rather than merely unused: a dead
  // wrapper is an invitation to wire it back in.
  assert.doesNotMatch(
    page,
    /privateUseFailureMessage/,
    "the private-use wrapper must not survive as dead code",
  );
});

test("HS-13d. a stored row is not offered as new work, and the room says so", () => {
  // THE OWNER'S BROWSER DEFECT. Thirteen prices existed and the primary button
  // still read `Simpan & Gunakan (13 siap)`. The count now comes from the
  // server's own `actionableRows` (ready MINUS already private) via
  // `oneActionAcceptanceView`, and when nothing is left the room prints a
  // sentence instead of a greyed-out control nobody can explain.
  assert.match(page, /alreadyStoredNotice\(oneAction\)/, "the notice must be derived from the same view");
  assert.match(
    renderable,
    /alreadyStored \?/,
    "the room must choose between the sentence and the button",
  );
  // The page still does not recompute availability from server counters; it
  // consumes one verdict and renders it.
  assert.doesNotMatch(
    renderable,
    /alreadyPrivateRows/,
    "the page must not do its own already-stored arithmetic",
  );
});

test("HS-13e. the room never offers an action and denies it in the same breath", () => {
  // The button reads the client's `oneAction.offered`, which deliberately
  // overrules the server for the two codes the press itself removes. The
  // "why not" line used to read the RAW server flag, so the Owner's own batch
  // rendered an ENABLED "Simpan & Gunakan (13 siap)" directly above
  // "Simpan & Gunakan belum bisa: Belum ada baris yang selesai."
  assert.match(
    renderable,
    /\{!oneActionOffered && !alreadyStored && privateUseBlockSentence/,
    "the refusal line must be gated on the same verdict as the button",
  );
  assert.doesNotMatch(
    renderable,
    /!batch\.actions\.privateUse\.offered && privateUseBlockSentence/,
    "the raw server flag must not gate the refusal line any more",
  );
});

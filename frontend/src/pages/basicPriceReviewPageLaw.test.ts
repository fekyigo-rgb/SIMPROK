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
  assert.match(renderable, /rowStateLabel\(row\)/);
});

test("HS-5. candidate selection stays inside the existing catalog picker", () => {
  assert.match(renderable, /<CatalogSearchSelect[\s\S]*mode="resource"/u);
  assert.match(renderable, /onSelect=\{\(item\) => updateDraft\(row\.id, \{ resource:/u);
  assert.doesNotMatch(renderable, />\s*\{[^}]*resourceCatalogId[^}]*\}\s*</u);
});

test("HS-6. supporting machine detail stays under the row's one explanation disclosure", () => {
  assert.match(renderable, /<summary>\{WHY_DISCLOSURE_TITLE\}<\/summary>/);
  assert.match(renderable, /\{notes\.technicalNotice\}/);
  assert.ok(
    renderable.indexOf("Apa yang perlu ditinjau?") < renderable.indexOf("WHY_DISCLOSURE_TITLE"),
    "the short review question must precede supporting detail",
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

test("HS-8b. bulk new-resource admission is explicit, bounded, and carries no catalog id", () => {
  const api = readFileSync("src/api/basicPriceImport.ts", "utf8");
  assert.match(page, /safeNewRowIds/);
  assert.match(renderable, /Pilih jenis untuk baris terpilih/);
  assert.match(renderable, /Tetapkan sebagai Item Baru/);
  assert.match(api, /admit-safe-new/);
  const requestStart = api.indexOf("export async function admitSafeNewBasicPriceResources");
  const request = api.slice(
    requestStart,
    api.indexOf("\nexport async function", requestStart + 1),
  );
  assert.match(request, /selections/);
  assert.doesNotMatch(request, /resourceCatalogId:\s*/);
  assert.doesNotMatch(request, /force/i);
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

test("HS-15. optional KDN never masquerades as unfinished work", () => {
  assert.match(page, /Informasi tambahan \(tidak wajib\)/u);
  assert.match(page, /optionalRowCanEnrichKdnNow\(row\) && row\.privateBasicPriceId/u);
  assert.doesNotMatch(page, /<summary>Lengkapi Data<\/summary>/u);
  assert.doesNotMatch(page, /OPTIONAL_KDN_INCOMPLETE/u);
  assert.doesNotMatch(page, /optionalRowKdnIncomplete\(row\)/u);
});

test("HS-17. only live optional KDN is offered; absent features are not user tasks", () => {
  assert.match(page, /ReviewOptionalKdnForm/u);
  assert.doesNotMatch(page, /optionalEnrichmentBlockedCapabilities/u);
  assert.doesNotMatch(renderable, /gap\.reason/u);
  assert.doesNotMatch(renderable, /alamat sumber"/u);
  assert.doesNotMatch(renderable, /<input[^>]*alamat/iu);
});

test("HS-15b. machine-proven rows expose no per-row identity resolution choice", () => {
  assert.match(page, /\{proven \? \([\s\S]*Dikenali otomatis/u);
  assert.match(page, /lookupRows\.has\(row\.id\) && mutable && !proven/u);
  assert.doesNotMatch(page, /Ubah hasil|setCorrectionRows|reviewNeedsManualControls/u);
});

test("HS-18. Tinjau Hasil offers the existing Tinjau wilayah confirm at the blocked Simpan, without loosening the gate", () => {
  assert.match(page, /updateBasicPriceImportBatch/);
  assert.match(page, /regionScopeNoticeView/);
  assert.match(page, /handleConfirmRegionScope/);
  assert.match(renderable, /confirmRegionScopeCompatibility: true/);
  assert.match(renderable, /\{regionScopeNotice\.actionLabel\}/);
  assert.match(renderable, /aria-label="Peninjauan wilayah sumber"/);
  assert.match(
    renderable,
    /onClick=\{\(\) => void handleConfirmRegionScope\(\)\}/,
  );
  const loadEffect = renderable.slice(
    renderable.indexOf("useEffect"),
    renderable.indexOf("}, [batchId]"),
  );
  assert.doesNotMatch(
    loadEffect,
    /confirmRegionScopeCompatibility|handleConfirmRegionScope/,
    "confirmation is a human press, never an effect",
  );
  assert.doesNotMatch(
    renderable,
    /privateUseBlockReason\s*=/,
    "this page must not rewrite the save gate",
  );
  assert.match(
    renderable,
    /disabled=\{!oneActionOffered \|\| isBusy\}/,
    "Simpan remains bound to the existing oneAction verdict",
  );
});

test("HS-16. Tinjau Hasil offers existing resource admission only when identity is exhausted", () => {
  assert.match(page, /admitResourceForImportRow/);
  assert.match(page, /rowIdentityAdmissionOffered/);
  assert.match(renderable, /admissionOffered/);
  assert.match(renderable, /\{IDENTITY_ADMISSION_LABEL\}/);
  assert.doesNotMatch(
    renderable,
    /admitResourceForImportRow\([^)]*name/,
    "admission must not send a client-invented resource name",
  );
});

test("UX-CALM-01. tabs partition actual rows into recognized, review, and human-decided without inventing counts", () => {
  assert.match(renderable, /const recognizedRowCount = batch\.rows\.filter\(\(row\) => reviewRowBucket\(row\) === 'RECOGNIZED'\)\.length;/u);
  assert.match(renderable, /const decidedRowCount = batch\.rows\.filter\(\(row\) => reviewRowBucket\(row\) === 'DECIDED'\)\.length;/u);
  assert.match(renderable, /const needsReviewRowCount = batch\.rows\.filter\(\(row\) => reviewRowBucket\(row\) === 'NEEDS_REVIEW'\)\.length;/u);
  assert.match(renderable, /rowFilter === 'ALL' \|\| reviewRowBucket\(row\) === rowFilter/u);
  assert.match(renderable, /Sudah Diputuskan \(\{decidedRowCount\}\)/u);
  assert.match(renderable, /Semua \(\{batch\.rows\.length\}\)/u);
  assert.match(renderable, /Menampilkan \{visibleRows\.length\} dari \{filteredRows\.length\} baris yang dimuat/u);
});

test("UX-CALM-02. row forms are collapsed, explicitly opened, and limited to thirty at first", () => {
  assert.match(page, /const REVIEW_ROW_PAGE_SIZE = 30;/);
  assert.match(renderable, /\{visibleRows\.map\(\(row\) =>/);
  assert.match(renderable, /aria-expanded=\{expanded\}/);
  assert.match(renderable, /\{expanded \? \(\s*<>[\s\S]*bp-rowcard__column/);
  assert.match(renderable, /Tampilkan berikutnya/);
});

test("UX-CALM-03. bulk save remains the one existing proven-row command, never a client bulk matcher", () => {
  assert.match(page, /oneActionAcceptanceView\(batch, touchedRowIds\)/);
  assert.equal((page.match(/smartSaveBatch\(/g) ?? []).length, 1);
  assert.match(renderable, /smartSaveBatch\(batchId, editedRowIds\(\)\)/);
  assert.match(renderable, /identityPairProven === true/);
  assert.doesNotMatch(renderable, /Promise\.all\([\s\S]*handleResolve/);
});

test("BP-UX-08: the review page uses one date notice and displays only a clean resource name", () => {
  assert.match(page, /reviewDisplayResourceName\(draft\.correctedCanonicalName \?\? row\.name\)/);
  assert.match(page, /proposalDoor\.visible && !batch\.actions\.simprokProposal\.offered/);
  assert.match(page, /proposalBlockSentence\(batch\.actions\.simprokProposal\.reasonCode\) !==/);
  assert.match(page, /privateUseBlockSentence\(batch\.actions\.privateUse\.reasonCode\)/);
  assert.match(page, /rowReviewFactsLine\(row\)/);
});

test("BP-HORIZONTAL-01. Owner-approved 35:65 layout keeps the contextual catalog picker on the decision side", () => {
  const css = readFileSync("src/styles/basicPrice.css", "utf8");
  const kindStart = renderable.indexOf('className="bp-rowcard__column bp-rowcard__kind-unit"');
  const decisionStart = renderable.indexOf('className="bp-rowcard__actions bp-rowcard__resolution"');
  assert.ok(kindStart >= 0 && decisionStart > kindStart, "left facts must precede the right-side decisions");
  const leftFacts = renderable.slice(kindStart, decisionStart);
  const decisionSide = renderable.slice(decisionStart);
  assert.doesNotMatch(leftFacts, /<CatalogSearchSelect/u, "catalog search must never float beneath jenis/satuan");
  assert.match(decisionSide, /className="bp-rowcard__lookup bp-rowcard__lookup--contextual"/u);
  assert.match(decisionSide, /<CatalogSearchSelect\s+mode="resource"/u);
  assert.match(decisionSide, /<CatalogSearchSelect\s+mode="unit"/u);
  assert.match(decisionSide, /handleResolve\(row\)/u);
  assert.match(decisionSide, /handleAdmit\(row\)/u);
  assert.match(decisionSide, /handleReject\(row\)/u);
  assert.match(css, /\.bp-rowcard\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*35fr\)\s+minmax\(0,\s*65fr\)/u);
  assert.match(css, /\.bp-rowcard__question\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/u);
  assert.match(css, /\.bp-rowcard__actions\s*\{[^}]*grid-column:\s*2/u);
  assert.match(css, /\.bp-room \.bp-rowcard__resolution > \.bp-rowcard__choice:hover:not\(:disabled\)/u);
  assert.match(css, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.bp-rowcard\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
});

test("BP-HORIZONTAL-02. contextual search results fill the right panel and remain readable", () => {
  const css = readFileSync("src/styles/basicPrice.css", "utf8");
  const prefix = ".bp-room .bp-rowcard__resolution .bp-rowcard__lookup--contextual ";
  const rule = (suffix: string) => {
    const start = css.lastIndexOf(`${prefix}${suffix} {`);
    assert.ok(start >= 0, `missing scoped rule for ${suffix}`);
    return css.slice(start, css.indexOf("}", start) + 1);
  };
  assert.match(rule(".bp-pop"), /display:\s*block;[\s\S]*width:\s*100%;/u);
  const panel = rule(".bp-pop__panel--list");
  assert.match(panel, /position:\s*relative;/u);
  assert.match(panel, /width:\s*100%;/u);
  assert.match(panel, /max-width:\s*100%;/u);
  assert.match(rule(".bp-option"), /white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;/u);
  assert.match(css, /\.bp-optionlist\s*\{[^}]*max-height:\s*220px;[^}]*overflow-y:\s*auto;/u);
});

test("BP-FUNCTION-01. safe-new selection never exceeds the backend's 100-row bound", () => {
  assert.match(page, /const SAFE_NEW_SELECTION_LIMIT = 100;/u);
  assert.match(renderable, /safeNewRowIds\.size >= SAFE_NEW_SELECTION_LIMIT/u);
  assert.match(renderable, /current\.size >= SAFE_NEW_SELECTION_LIMIT/u);
  assert.match(page, /if \(safeNewRowIds\.size > SAFE_NEW_SELECTION_LIMIT\)/u);
  assert.match(renderable, /Maksimal \{SAFE_NEW_SELECTION_LIMIT\} pilihan per tindakan/u);
  assert.match(renderable, /admitSafeNewBasicPriceResources\(/u);
});

test("BP-FUNCTION-02. source unit stays visible but is edited only through the existing decision-side selector", () => {
  assert.doesNotMatch(renderable, /Pilih\/Ubah Satuan|pendingUnitFocusRow/u);
  assert.match(renderable, /mode="unit"[\s\S]*?onSelect=\{\(item\) => \{[\s\S]*?updateDraft\(row\.id, \{ unit:/u);
  assert.match(renderable, /Pilih Satuan/u);
  assert.match(renderable, /Gunakan Satuan/u);
  assert.match(renderable, /Gunakan Pilihan/u);
  assert.match(renderable, /Belum bisa disimpan: \{blockReason\}/u);
  assert.match(renderable, /Langkah berikutnya ada di atas: tekan <strong>Konfirmasi Jenis<\/strong>/u);
  assert.match(renderable, /Teks dalam kotak hanya kata pencarian, belum menjadi pilihan/u);
  assert.match(page, /await resolveBasicPriceImportRow\(batchId, row\.id, row\.version, draft\.resource\.id, draft\.unit\.id, nomenclatureAuditReason\)/u);
});
test("BP-ROW-UX-OWNER: new item has the same canonical unit picker without changing decision paths", () => {
  const admission = renderable.slice(renderable.indexOf('className="bp-rowcard__admission"'));
  assert.match(admission, /<CatalogSearchSelect[\s\S]*?mode="unit"[\s\S]*?selected=\{draft\.unit\}/u);
  assert.doesNotMatch(admission, /admitOpen: false[\s\S]*?Pilih satuan/u);
  assert.match(renderable, /Belum bisa disimpan: \{blockReason\}/u);
  assert.match(renderable, /admitBlock \? <p className="bp-field__help"/u);
});

test("BP-FUNCTION-02b. Ubah Jenis opens an auditable row category editor, not item admission", () => {
  const start = renderable.indexOf('title="Pemilih jenis ada di panel penyelesaian sebelah kanan.');
  assert.ok(start > 0);
  const action = renderable.slice(start, start + 1400);
  assert.match(action, /setCategoryEditRows/u);
  assert.match(action, /Ubah Jenis/u);
  assert.ok(renderable.includes('id={`bp-category-editor-${row.id}`}'));
  assert.ok(renderable.indexOf('className="bp-rowcard__actions bp-rowcard__resolution"') < renderable.indexOf('id={`bp-category-editor-${row.id}`}'), 'type decision must live in the right-side resolution panel');
  assert.match(renderable, /row\.reasonCodes\.includes\('ROW_CATEGORY_CONFIRMED_BY_REVIEWER'\)/u);
  assert.match(renderable, /onClick=\{\(\) => void handleConfirmCategory\(row\)\}/u);
  assert.match(page, /await confirmBasicPriceImportRowCategory\(batchId, row\.id, row\.version, category\)/u);
  assert.match(page, /resource: null, unit: null/u);
});

test("BP-NEW-ITEM-NO-DEADEND: when admission is not offered, candidate reason is before the action choices", () => {
  const problem = renderable.indexOf('!admissionOffered && admissionReview?.reasonCode');
  const choices = renderable.indexOf('Pilih Item yang Sesuai Padanan');
  assert.ok(problem > 0 && problem < choices);
  assert.match(renderable, /Item Baru BELUM dapat disimpan/u);
});

test("BP-FUNCTION-03. Tetapkan Item Baru stays on server-offered review and passes the bound type, unit, and refusals", () => {
  assert.match(renderable, /\{admissionOffered && admissionReview \? \(/u);
  assert.match(renderable, /onClick=\{\(\) => void handleAdmit\(row\)\}/u);
  assert.match(page, /await admitResourceForImportRow\([\s\S]*?draft\.unit\.id,[\s\S]*?draft\.admitReason\.trim\(\),[\s\S]*?draft\.admitResourceType,[\s\S]*?draft\.refusedCandidateIds,[\s\S]*?typeConfirmation\.reviewBindingFingerprint,/u);
  assert.match(page, /rowIdentityAdmissionBlockReason\(/u);
});

test("BP-FUNCTION-04. Tolak is a deliberate reason-gated writer, never just a visual close", () => {
  assert.match(renderable, /onClick=\{\(\) => void handleReject\(row\)\}/u);
  assert.match(page, /if \(!draft\.rejectOpen\) \{[\s\S]*?rejectOpen: true/u);
  assert.match(page, /if \(!draft\.reason\.trim\(\)\)/u);
  assert.match(page, /await rejectBasicPriceImportRow\(batchId, row\.id, row\.version, draft\.reason\.trim\(\)\)/u);
  assert.match(page, /await recoverFromRowFailure\('REJECT', row, error\)/u);
});

test("BP-EDIT-SNAPSHOT-01. one corrected row name drives BOTH decision doors", () => {
  const start = renderable.indexOf('aria-label={draft.editingName');
  assert.ok(start > 0);
  const action = renderable.slice(start, start + 1700);
  assert.match(action, /if \(draft\.editingName\)/u);
  assert.match(action, /editingName: false/u);
  assert.match(action, /editingName: true/u);
  assert.match(action, /belum tersimpan permanen/u);
  assert.match(page, /const changeWorkingName = \(row: BasicPriceImportRowSummary, value: string\)/u);
  assert.match(page, /correctedCanonicalName: value, resource: null, resourcePending: false/u);
  assert.match(renderable, /onChange=\{\(event\) => changeWorkingName\(row, event\.target\.value\)\}/u);
  assert.match(renderable, /initialQuery=\{\(draft\.correctedCanonicalName \?\? row\.name\)/u);
  assert.match(renderable, /key=\{`\$\{row\.id\}:\$\{draft\.correctedCanonicalName \?\? row\.name\}`\}/u);
  const search = readFileSync('src/components/basic-price/CatalogSearchSelect.tsx', 'utf8');
  assert.match(search, /const \[query, setQuery\] = useState\(initialQuery\)/u);
  assert.match(search, /const \[hasInteracted, setHasInteracted\] = useState\(initialQuery\.trim\(\)\.length >= 2\)/u);
  assert.match(search, /if \(!hasInteracted \|\| query\.trim\(\)\.length < 2\) return/u);
  assert.match(search, /requestGate\.current\.invalidate\(\)/u);
  assert.match(page, /correctedCanonicalName: value, resource: null, resourcePending: false/u);
  assert.match(page, /draftFor\(row\.id\)\.correctedCanonicalName === row\.name/u);
  assert.match(page, /draft\.correctedCanonicalName\.trim\(\) !== row\.name/u);
  assert.match(renderable, /Nama katalog tersimpan/u);
  assert.doesNotMatch(renderable, /saveResourceName\(/u);
});

test("BP-REASON-UX-01. the new-item reason field asks for a factual note, not an answer to a question", () => {
  const display = readFileSync("src/utils/basicPriceImportDisplay.ts", "utf8");
  assert.match(renderable, /Alasan menetapkan item baru/u);
  assert.match(renderable, /placeholder="Tuliskan alasan berdasarkan hasil pemeriksaan"/u);
  assert.match(renderable, /Jika ada kandidat, catat perbedaan nyata seperti ukuran atau spesifikasi/u);
  assert.match(display, /Catat alasan penetapan item baru berdasarkan hasil pemeriksaan/u);
  assert.doesNotMatch(renderable, /Mengapa item ini belum ada\?/u);
});

test("BP-NAME-CORRECTION-01. catalog name edit is committed only by admission and read back from server", () => {
  const api = readFileSync("src/api/basicPriceImport.ts", "utf8");
  const service = readFileSync("../backend/src/basic-price/basic-price-import.service.ts", "utf8");
  const writer = readFileSync("../backend/src/resource-catalog/resource-admission.service.ts", "utf8");
  assert.match(renderable, /Nama item untuk kedua pilihan/u);
  assert.match(renderable, /Nama item yang akan disimpan/u);
  assert.match(page, /draft\.correctedCanonicalName\.trim\(\) !== row\.name/u);
  assert.match(api, /correctedCanonicalName\?: string/u);
  assert.match(writer, /name: canonicalName/u);
  assert.match(writer, /rawName: input\.rawName/u);
  assert.match(writer, /rawName: canonicalName/u);
  assert.match(service, /canonicalResourceName: r\.resourceCatalog\?\.name \?\? null/u);
  assert.match(renderable, /Nama katalog tersimpan:/u);
});

test("BP-NOMENCLATURE-ROW-AUDIT-01. corrected search name is persisted with the existing human mapping, and read back without renaming a catalog", () => {
  const api = readFileSync("src/api/basicPriceImport.ts", "utf8");
  const service = readFileSync("../backend/src/basic-price/basic-price-import.service.ts", "utf8");
  const resolver = readFileSync("../backend/src/basic-price/basic-price-row-resolution.service.ts", "utf8");
  assert.match(page, /KOREKSI_NOMENKLATUR: /u);
  assert.match(page, /nomenclatureAuditReason/u);
  assert.match(api, /\.\.\.\(nomenclatureAuditReason \? \{ reason: nomenclatureAuditReason \} : \{\}\)/u);
  assert.match(resolver, /reason: dto\.reason \?\? null/u);
  assert.match(service, /resourceMappings: \{/u);
  assert.match(service, /nomenclatureCorrectionName: r\.resourceCatalogId/u);
  assert.match(service, /r\.resourceMappings\[0\]\.reason\.slice/u);
  assert.match(renderable, /Koreksi nomenklatur tercatat:/u);
  assert.match(renderable, /bukan penggantian nama katalog/u);
});

test("BP-NAME-VISUAL-01. matching a same-type candidate blocks new-item action and asks for review", () => {
  assert.match(page, /const sameNameCandidate = draft\.admitOpen/u);
  assert.match(page, /correctedCatalogNameCandidateConflict\(/u);
  assert.match(page, /const admitBlock = row\.machineProposal\?\.blockingFacts\.includes\('SOURCE_SPECIFICATION_UNVERIFIED'\)/u);
  assert.match(page, /:\s*sameNameCandidate\s*\? correctedNameCandidateNotice/u);
  assert.match(page, /if \(sameNameCandidate\) \{\s*setStatusMessage\(correctedNameCandidateNotice/u);
  assert.match(page, /\{sameNameCandidate \? \([\s\S]*?role="status"/u);
  assert.match(page, /disabled=\{admitBlock !== null\}/u);
});

test("BP-BROWSER-READBACK-01. persisted unit is displayed before empty draft and backend capability is checked", () => {
  const service = readFileSync("../backend/src/basic-price/basic-price-import.service.ts", "utf8");
  assert.match(service, /unitDefinition: \{ select: \{ code: true, displayName: true, symbol: true \} \}/u);
  assert.match(service, /canonicalUnit: r\.unitDefinition/u);
  assert.match(service, /reviewCapabilities: \{ correctedCanonicalNameOnAdmission: true \}/u);
  assert.match(page, /row\.canonicalUnit\s*\? `\$\{row\.canonicalUnit\.displayName\} \(\$\{row\.canonicalUnit\.symbol\}\)`/u);
  assert.match(page, /row\.resolutionStatus === 'RESOLVED' && row\.status === 'READY_FOR_SUBMISSION'/u);
  assert.match(page, /Satuan standar tersimpan/u);
  assert.match(page, /batch\?\.reviewCapabilities\?\.correctedCanonicalNameOnAdmission !== true/u);
  assert.match(page, /Backend preview belum mendukung penyimpanan koreksi nama/u);
});

test("BP-NAME-CORRECTION-02. completed human decisions clear only their own unsaved-exclusion flag", () => {
  assert.match(page, /const editedRowIds = \(\): string\[\] => \[\.\.\.touchedRowIds\]/u);
  assert.match(page, /const forgetCompletedEdit = \(rowId: string\)/u);
  assert.match(page, /await resolveBasicPriceImportRow\([^;]+;\s*forgetCompletedEdit\(row\.id\)/u);
  assert.match(page, /await rejectBasicPriceImportRow\([^;]+;\s*forgetCompletedEdit\(row\.id\)/u);
  assert.match(page, /await admitResourceForImportRow\([\s\S]*?\);\s*forgetCompletedEdit\(row\.id\)/u);
  assert.match(page, /smartSaveBatch\(batchId, editedRowIds\(\)\)/u);
});

/**
 * BP-ACTIVATION-01 — the two real halves of the Owner's activation gate.
 * Earlier pure presentation tests prove what a given server proposal means.
 * These cross-stack source guards ensure the actual review screen consumes the
 * real API payload, and that the real controller still consults the established
 * kernels. Backend acceptance E2E separately proves writes and DB readback.
 */
test("BP-ACTIVATION-01. review facts flow from server kernel proposals to the visible room", () => {
  const api = readFileSync("src/api/basicPriceImport.ts", "utf8");
  const controller = readFileSync("../backend/src/basic-price/basic-price-import.controller.ts", "utf8");
  const service = readFileSync("../backend/src/basic-price/basic-price-import.service.ts", "utf8");
  const proposer = readFileSync("../backend/src/basic-price/basic-price-row-resolution-proposal.service.ts", "utf8");

  assert.match(page, /const result = await getBasicPriceImportBatch\(batchId\);\s*setBatch\(result\)/u);
  assert.ok(api.includes("apiFetch(`/basic-price-imports/${batchId}`)"));
  assert.match(controller, /@Get\(':batchId'\)[\s\S]*?return this\.importService\.getBatch\(workspaceId, batchId, currentAccountId\)/u);
  assert.match(service, /const proposals = await this\.proposals\.proposeForRows\(/u);
  assert.match(service, /machineProposal: proposals\?\.get\(r\.id\) \?\? null/u);
  assert.match(proposer, /private readonly units: UnitKernelService/u);
  assert.match(proposer, /private readonly identity: ResourceIdentityResolutionService/u);
  assert.match(renderable, /machinePickedResource\(row\)/u);
  assert.match(renderable, /machinePickedUnit\(row\)/u);
  assert.match(renderable, /rowMachineNarrative\(row\)/u);
  assert.match(renderable, /const admissionReview = row\.machineProposal\?\.resource\.admissionReview/u);
  assert.match(renderable, /typeConfirmation\.reviewBindingFingerprint/u);
});

test("BP-ACTIVATION-02. visible review actions reach their owned backend routes; server remains decision authority", () => {
  const api = readFileSync("src/api/basicPriceImport.ts", "utf8");
  const controller = readFileSync("../backend/src/basic-price/basic-price-import.controller.ts", "utf8");
  const connections = [
    ["resolveBasicPriceImportRow(", "/rows/${rowId}/resolve", "@Post(':batchId/rows/:rowId/resolve')", "this.resolutionService.resolveRow("],
    ["rejectBasicPriceImportRow(", "/rows/${rowId}/reject", "@Post(':batchId/rows/:rowId/reject')", "this.resolutionService.rejectRow("],
    ["admitResourceForImportRow(", "/rows/${rowId}/admit-resource", "@Post(':batchId/rows/:rowId/admit-resource')", "this.resolutionService.admitResourceForRow("],
    ["admitSafeNewBasicPriceResources(", "/admit-safe-new", "@Post(':batchId/admit-safe-new')", "this.resolutionService.admitSafeNewResources("],
    ["smartSaveBatch(", "/smart-save", "@Post(':batchId/smart-save')", "this.smartSaveService.acceptProvenAndKeepPrivate("],
    ["updateBasicPriceImportBatch(", "/basic-price-imports/${batchId}", "@Patch(':batchId')", "this.importService.updateBatchMetadata("],
    ["submitBasicPriceImportBatch(", "/submit", "@Post(':batchId/submit')", "this.importService.submitBatch("],
  ] as const;
  for (const [action, route, decorator, delegation] of connections) {
    assert.ok(page.includes(action), `visible flow lost its ${action} client call`);
    assert.ok(api.includes(route), `API client lost the route for ${action}`);
    assert.ok(controller.includes(decorator), `backend lost the route for ${action}`);
    assert.ok(controller.includes(delegation), `route lost server-owned service for ${action}`);
  }
  assert.match(page, /const outcome = await smartSaveBatch\(batchId, editedRowIds\(\)\);[\s\S]*?await loadBatch\(false\)/u);
  assert.match(controller, /@PermissionsAll\(\s*PERMISSIONS\.BASIC_PRICE_RESOLVE,\s*PERMISSIONS\.BASIC_PRICE_SUBMIT,/u);
  assert.match(page, /Nama kerja yang diedit menjadi acuan kedua pilihan/u);
  assert.match(api, /correctedCanonicalName \? \{ correctedCanonicalName \} : \{\}/u);
});

test("BP-EDIT-TRUTH-01. completing an edit reports a draft, never a database save", () => {
  assert.match(renderable, /draft\.editingName \? 'Selesai Edit' : 'Edit'/u);
  assert.match(renderable, /Draft koreksi — belum tersimpan permanen/u);
  assert.match(renderable, /draft untuk pencarian; belum tersimpan permanen/u);
  assert.match(page, /if \(!workingName\.trim\(\) \|\| workingName !== workingName\.trim\(\)\)/u);
  assert.doesNotMatch(page, /koreksi nama berhasil disimpan secara permanen/i);
});

test("BP-EDIT-TRUTH-02. material changes require confirmation before authoritative writes", () => {
  const resolveConfirmation = page.indexOf("Anda yakin menggunakan pilihan padanan");
  const resolveWriter = page.indexOf("await resolveBasicPriceImportRow(");
  const admitConfirmation = page.indexOf("Anda yakin menetapkan item privat baru");
  const admitWriter = page.indexOf("await admitResourceForImportRow(");
  assert.ok(resolveConfirmation >= 0 && resolveConfirmation < resolveWriter);
  assert.ok(admitConfirmation >= 0 && admitConfirmation < admitWriter);
  assert.match(page, /if \(!confirmed\) \{[\s\S]*?Draft koreksi tetap tersedia/u);
  assert.match(page, /Nama asli Excel dan nama katalog tidak diubah/u);
});

test("BP-CANDIDATE-DOOR-01. blocked admissions explain candidates without minting duplicate identities", () => {
  assert.match(renderable, /Bandingkan kandidat dan bukti identitas/u);
  assert.match(renderable, /candidate\.admissionDisposition === 'BLOCKED'/u);
  assert.match(renderable, /Hasil pencarian kosong belum membuktikan bahwa item ini baru/u);
  assert.match(renderable, /memuat ulang halaman saja tidak membuktikan perbedaan tersebut/u);
  assert.doesNotMatch(renderable, /Ajukan Pemeriksaan Item|handleRequestIdentityReview/u);
  assert.match(page, /admissionOffered && admissionReview/u);
});

test("BP-EDIT-FEEDBACK-01. feedback is visible on the affected row and means what happened", () => {
  assert.match(page, /const \[rowNotice, setRowNotice\] = useState/u);
  assert.match(renderable, /rowNotice\?\.rowId === row\.id/u);
  assert.match(renderable, /aria-live="polite"/u);
  assert.match(page, /setRowNotice\(\{ rowId: row\.id, text: notice \}\)/u);
  assert.match(page, /Berhasil: padanan dan satuan baris/u);
  assert.match(page, /Berhasil: item privat baru untuk baris/u);
  assert.match(page, /tampilan belum berhasil dimuat ulang/u);
  assert.match(renderable, /Selesaikan koreksi nama baris/u);
});

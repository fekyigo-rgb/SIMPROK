import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  formatIsoDateAsIndonesian,
  reimportDecisionView,
  rowNoteDisclosure,
  rowSectionDisplay,
  savedMetadataLines,
  staleRowRecoveryMessage,
  WHY_DISCLOSURE_TITLE,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
} from "../utils/basicPriceImportDisplay.ts";
import { reviewCounters } from "../utils/basicPriceJourney.ts";

/**
 * BP-VISUAL-TRUTH-07 — REGION TRUTH, IMPORT CLARITY, SMART REVIEW.
 *
 * Every pin here is about what a PERSON reads. The identity engines underneath
 * were proven correct before this mission and are deliberately not re-litigated
 * here: the region column has been a fingerprint axis and a sibling-lookup axis
 * since USI-01 (see the backend spec of the same name), and the defect this
 * file guards was that the browser printed only ONE of the two region facts,
 * under a word the other question had already used.
 */

const review = readFileSync("src/pages/BasicPriceReviewPage.tsx", "utf8");
const intakeQuestion = readFileSync(
  "src/components/basic-price/IntakeQuestion.tsx",
  "utf8",
);
const regionSelect = readFileSync(
  "src/components/basic-price/RegionSearchSelect.tsx",
  "utf8",
);
const journey = readFileSync("src/utils/basicPriceJourney.ts", "utf8");
/** Comments are design intent, not screen text — they must not satisfy a copy pin. */
const strip = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const reviewText = strip(review);
const intakeText = strip(intakeQuestion);
const regionSelectText = strip(regionSelect);

const TELUK_AMBON = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "8171031",
  name: "Kecamatan Teluk Ambon, Kota Ambon",
};
const TELUK_AMBON_BAGUALA = {
  id: "22222222-2222-4222-8222-222222222222",
  code: "8171030",
  name: "Kecamatan Teluk Ambon Baguala, Kota Ambon",
};

const batch = (
  over: Partial<BasicPriceImportBatchSummary> = {},
): BasicPriceImportBatchSummary =>
  ({
    batchId: "batch-1",
    status: "NEEDS_REVIEW",
    importFingerprint: "FP",
    effectiveDate: "2026-08-29T00:00:00.000Z",
    regionId: TELUK_AMBON.id,
    region: TELUK_AMBON,
    sourceType: "MARKET_SURVEY",
    sourceOrganizationName: "Dinas PU",
    sourceOrigin: "GOVERNMENT",
    version: 1,
    totalRows: 894,
    needsReviewRows: 894,
    readyForSubmissionRows: 0,
    rejectedRows: 0,
    submittedRows: 0,
    identityPairProvenRows: 0,
    actions: {} as BasicPriceImportBatchSummary["actions"],
    ...over,
  }) as BasicPriceImportBatchSummary;

const row = (
  over: Partial<BasicPriceImportRowSummary> = {},
): BasicPriceImportRowSummary =>
  ({
    id: "row-1",
    status: "NEEDS_REVIEW",
    resolutionStatus: "UNRESOLVED",
    code: null,
    name: "Batu Kali",
    unit: "M3",
    rawPriceDisplayText: "153.000",
    proposedCanonicalPrice: "153000",
    section: "LABOR",
    sectionProvenance: "UPLOADER_DECLARED",
    sourceCategoryCode: null,
    sourceCategoryName: null,
    sourceRowNumber: 8,
    collisionType: "NONE",
    collisionOfRowId: null,
    resourceCatalogId: null,
    unitDefinitionId: null,
    reasonCodes: [],
    version: 3,
    machineProposal: null,
    ...over,
  }) as BasicPriceImportRowSummary;

// ── REGION TRUTH (§6.1 / §7 / §8) ───────────────────────────────────────────

test("REGION-01: the canonical Wilayah is read back exactly as chosen, never widened to a longer name that merely contains it", () => {
  const lines = savedMetadataLines(
    batch({ regionId: TELUK_AMBON.id, region: TELUK_AMBON }),
  );
  const wilayah = lines.find((line) => line.startsWith("Wilayah:"));
  assert.equal(wilayah, `Wilayah: ${TELUK_AMBON.name}`);
  // The whole defect in one assertion: Teluk Ambon must not read as Baguala.
  assert.ok(!wilayah!.includes("Baguala"));
});

test("REGION-02: Teluk Ambon Baguala remains independently addressable and reads as itself", () => {
  const lines = savedMetadataLines(
    batch({ regionId: TELUK_AMBON_BAGUALA.id, region: TELUK_AMBON_BAGUALA }),
  );
  assert.ok(lines.includes(`Wilayah: ${TELUK_AMBON_BAGUALA.name}`));
});

test("REGION-03: the workbook's price column is stated as its OWN fact, so it can never be read as the Wilayah", () => {
  // The Owner answered "TELUK AMBON" to the column question and separately held
  // a canonical Region. Both facts must be on screen, under different names.
  const lines = savedMetadataLines(
    batch({
      regionId: TELUK_AMBON_BAGUALA.id,
      region: TELUK_AMBON_BAGUALA,
      sourceRegionScopeLabel: "TELUK AMBON",
    }),
  );
  assert.ok(lines.includes(`Wilayah: ${TELUK_AMBON_BAGUALA.name}`));
  assert.ok(lines.includes("Kolom harga pada berkas: TELUK AMBON"));
  // And the column line must not borrow the word that belongs to the Region.
  const column = lines.find((line) => line.startsWith("Kolom harga"))!;
  assert.ok(!column.startsWith("Wilayah"));
});

test("REGION-04: a source that offered no column choice gains no column line at all", () => {
  const lines = savedMetadataLines(batch({ sourceRegionScopeLabel: null }));
  assert.ok(!lines.some((line) => line.startsWith("Kolom harga")));
  // Blank-but-present is the same absence and must behave identically.
  assert.ok(
    !savedMetadataLines(batch({ sourceRegionScopeLabel: "   " })).some((line) =>
      line.startsWith("Kolom harga"),
    ),
  );
});

test("REGION-05: the two questions no longer share one word on screen", () => {
  // The column question asks about a COLUMN and says the Region is asked
  // elsewhere; the Region control is titled plainly "Wilayah".
  assert.match(intakeText, /Pilih kolom harga\./);
  assert.match(intakeText, /Wilayah resmi SIMPROK dipilih terpisah/);
  assert.doesNotMatch(intakeText, /Wilayah mana yang ingin Anda proses/);
  assert.match(regionSelectText, />\s*Wilayah\s*</);
});

// ── COPY / LOCALIZATION (§18 / §19) ─────────────────────────────────────────

test("COPY-02: 'Wilayah (Region)' is gone from the region selector", () => {
  assert.doesNotMatch(regionSelectText, /Wilayah \(Region\)/);
});

test("COPY-03: the source readback uses the approved vocabulary", () => {
  const lines = savedMetadataLines(batch());
  assert.ok(lines.some((line) => line.startsWith("Asal data:")));
  assert.ok(lines.some((line) => line.startsWith("Metode perolehan:")));
  assert.ok(lines.some((line) => line.startsWith("Nama sumber:")));
  assert.ok(!lines.some((line) => line.startsWith("Asal sumber:")));
  assert.ok(!lines.some((line) => line.startsWith("Jenis sumber:")));
});

test("DATE-01: Basic Price presentation dates read dd/mm/yyyy", () => {
  assert.equal(formatIsoDateAsIndonesian("2026-08-29"), "29/08/2026");
  assert.equal(
    formatIsoDateAsIndonesian("2026-12-31T00:00:00.000Z"),
    "31/12/2026",
  );
  const lines = savedMetadataLines(
    batch({ effectiveDate: "2026-08-29T00:00:00.000Z" }),
  );
  assert.ok(lines.some((line) => line.includes("29/08/2026")));
  assert.ok(!lines.some((line) => line.includes("08/29/2026")));
  assert.ok(!lines.some((line) => line.includes("2026-08-29")));
});

test("DATE-02: presentation never invents or shifts a day, and leaves a non-date alone", () => {
  // No `new Date()` anywhere in the path, so no time zone can move the day.
  assert.equal(formatIsoDateAsIndonesian("belum diisi"), "belum diisi");
  assert.equal(formatIsoDateAsIndonesian(""), "");
});

// ── CATEGORY / WEAK HINT (§12 / §26) ────────────────────────────────────────

test("CAT-UX-02: an unconfirmed batch hint is shown as a starting point, never as fact", () => {
  const shown = rowSectionDisplay(
    row({ section: "LABOR", sectionProvenance: "UPLOADER_DECLARED" }),
  );
  assert.equal(shown, "Kategori awal: Tenaga kerja");
});

test("CAT-UX-02b: a family the DOCUMENT proved is stated flatly, with nothing hedged", () => {
  assert.equal(
    rowSectionDisplay(
      row({ section: "MATERIAL", sectionProvenance: "SOURCE_ROW_CATEGORY" }),
    ),
    "Bahan",
  );
  assert.equal(
    rowSectionDisplay(
      row({ section: "LABOR", sectionProvenance: "SOURCE_SECTION_TITLE" }),
    ),
    "Tenaga kerja",
  );
});

test("CAT-UX-03: Batu Kali and Batu Belah read as Bahan once the reviewer has confirmed the Item SIMPROK", () => {
  // The resolver rewrites a weak hint to the confirmed catalog family; once a
  // catalog identity exists the family is a decided fact and must read as one.
  for (const name of ["Batu Kali", "Batu Belah"]) {
    const resolved = row({
      name,
      section: "MATERIAL",
      sectionProvenance: "UPLOADER_DECLARED",
      resourceCatalogId: "cat-1",
    });
    assert.equal(rowSectionDisplay(resolved), "Bahan");
  }
});

test("CAT-UX-04: an unknown family is still never rendered as one of the three known ones", () => {
  assert.match(
    rowSectionDisplay(row({ section: null, sectionProvenance: null })),
    /belum dapat dipastikan/,
  );
});

// ── REVIEW COUNTERS (§16) ───────────────────────────────────────────────────

test("COUNTER-01: the parent counter does not wear a child class's name", () => {
  const counters = reviewCounters(
    batch({ totalRows: 894, needsReviewRows: 894, identityPairProvenRows: 0 }),
  );
  const parent = counters.find((counter) => counter.key === "NEEDS_DECISION")!;
  assert.equal(parent.value, 894);
  assert.equal(parent.label, "Belum selesai");
  // "Perlu keputusan" belongs to the 222, and to nothing else on this screen.
  assert.ok(!counters.some((counter) => counter.label === "Perlu keputusan"));
});

test("COUNTER-02: every counter is still a field the server actually sent", () => {
  const counters = reviewCounters(
    batch({
      totalRows: 894,
      needsReviewRows: 222,
      identityPairProvenRows: 5,
      readyForSubmissionRows: 12,
    }),
  );
  assert.deepEqual(
    counters.map((counter) => counter.value),
    [894, 5, 222, 12],
  );
});

// ── STALE PROTECTION AND RECOVERY (§14) ─────────────────────────────────────

test("STALE-UX-01: the version is still sent and a stale write is still refused — no retry, no replay", () => {
  assert.match(review, /resolveBasicPriceImportRow\(batchId, row\.id, row\.version/);
  assert.match(review, /rejectBasicPriceImportRow\(batchId, row\.id, row\.version/);
  // Nothing may re-send a refused decision on the user's behalf.
  assert.doesNotMatch(reviewText, /setTimeout|retry|Retry/);
});

test("STALE-UX-02: a 409 refreshes the current truth itself instead of sending the reviewer to reload", () => {
  assert.match(review, /httpStatus !== 409/);
  assert.match(review, /recoverFromRowFailure/);
  const message = staleRowRecoveryMessage(8);
  assert.match(message, /^Baris 8 baru saja diperbarui/);
  assert.match(message, /SIMPROK sudah memuat versi terbaru/);
  assert.ok(!message.includes("muat ulang halaman"));
});

test("STALE-UX-02b: SIMPROK only claims to have loaded the newest version when the read actually succeeded", () => {
  // `loadBatch` handles its own failure and returns rather than throwing, so a
  // caller that merely awaited it could not tell a successful refresh from a
  // failed one — and would promise a newer version that was never fetched.
  assert.match(review, /const loadBatch = async \([^)]*\): Promise<boolean>/);
  assert.match(review, /const refreshed = await loadBatch\(false\)/);
  assert.match(review, /if \(!refreshed\) \{/);
  // The success sentence is reachable ONLY past that check.
  const recovery = review.slice(
    review.indexOf("const recoverFromRowFailure"),
    review.indexOf("const handleResolve"),
  );
  assert.ok(
    recovery.indexOf("if (!refreshed)") <
      recovery.indexOf("staleRowRecoveryMessage"),
  );
});

test("STALE-UX-03: the local selection survives as a draft and an explicit reconfirm is required", () => {
  const message = staleRowRecoveryMessage(8);
  assert.match(message, /masih tersimpan sebagai draf/);
  assert.match(message, /konfirmasi ulang/);
  // It must never claim the decision landed.
  assert.match(message, /belum tersimpan/);
  assert.ok(!/berhasil|tersimpan\./i.test(message.replace(/belum tersimpan/g, "")));
  // Only the SUCCESS path clears the draft; the failure path must not.
  const resolveBody = review.slice(
    review.indexOf("const handleResolve"),
    review.indexOf("const handleReject"),
  );
  const failureBranch = resolveBody.slice(resolveBody.indexOf("} catch (error)"));
  assert.ok(!failureBranch.includes("setDrafts"));
});

// ── ACTION CLARITY (§15) ────────────────────────────────────────────────────

test("ACTION-01: the row button names the act, not a finished outcome", () => {
  assert.match(reviewText, /Konfirmasi pilihan/);
  assert.doesNotMatch(reviewText, />\s*Selesaikan\s*</);
});

// ── PROGRESSIVE DISCLOSURE (§17 / §20) ──────────────────────────────────────

test("DISCLOSE-01: one instruction stays visible and the rest of the reasoning waits to be asked for", () => {
  const split = rowNoteDisclosure({
    human: [
      "Item belum dikenali. Pilih Item SIMPROK yang sesuai, atau tolak baris ini.",
      "Satuan belum dikenali.",
      "Ada lebih dari satu kandidat yang sama kuat.",
    ],
  });
  assert.equal(
    split.primary,
    "Item belum dikenali. Pilih Item SIMPROK yang sesuai, atau tolak baris ini.",
  );
  assert.equal(split.secondary.length, 2);
  // NOTHING IS DROPPED — the split is lossless.
  assert.equal([split.primary, ...split.secondary].filter(Boolean).length, 3);
});

test("DISCLOSE-02: a single note is never hidden behind a toggle", () => {
  const split = rowNoteDisclosure({ human: ["Satuan belum dikenali."] });
  assert.equal(split.primary, "Satuan belum dikenali.");
  assert.deepEqual(split.secondary, []);
});

test("DISCLOSE-03: the row card renders the split, under the one 'Mengapa?' wording", () => {
  assert.equal(WHY_DISCLOSURE_TITLE, "Mengapa?");
  assert.match(review, /rowNoteDisclosure\(notes\)/);
  assert.match(review, /noteDisclosure\.secondary\.length > 0/);
});

// ── DUPLICATED MESSAGING (§22) ──────────────────────────────────────────────

test("BANNER-01: an exact replay states the fact once, then says only what the heading cannot", () => {
  const view = reimportDecisionView({
    classification: "EXACT_EXISTING",
    existingBatchId: "b1",
    updateBatchId: null,
    difference: "NONE",
  })!;
  assert.equal(view.title, "Data ini sudah pernah diimpor.");
  assert.ok(!view.body.includes("sudah pernah diimpor"));
  assert.match(view.body, /Tidak ada perubahan yang terdeteksi/);
});

test("BANNER-02: an interpretation update names the axis without restating its own body", () => {
  const view = reimportDecisionView({
    classification: "INTERPRETATION_UPDATE",
    existingBatchId: "b1",
    updateBatchId: "b2",
    difference: "READING",
  })!;
  assert.match(view.body, /cara pembacaannya sekarang berbeda/);
  assert.equal(view.differenceNote, "Perbedaan: cara pembacaan");
  assert.notEqual(view.differenceNote, view.body);
});

// ── PRIVATE WORKFLOW / STEPPER (§24) ────────────────────────────────────────

test("STEPPER-01: the optional SIMPROK proposal is never drawn as required for private use", () => {
  // `optional: true` on PROPOSE, and a curation tail that says NOT_OFFERED
  // rather than UPCOMING when this batch will never take that path.
  assert.match(journey, /optional: boolean/);
  assert.match(journey, /'PROPOSE', 'NOT_OFFERED'/);
  assert.match(journey, /'VERIFY', 'NOT_OFFERED'/);
  assert.match(journey, /const curationApplies = proposed \|\| proposal\.offered/);
});

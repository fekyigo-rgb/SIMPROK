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
  isStaleRowConflict,
  rowNonStaleConflictMessage,
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
const importPage = readFileSync("src/pages/BasicPriceImportPage.tsx", "utf8");
const basicPriceCss = readFileSync("src/styles/basicPrice.css", "utf8");
const intakeQuestion = readFileSync(
  "src/components/basic-price/IntakeQuestion.tsx",
  "utf8",
);
const regionSelect = readFileSync(
  "src/components/basic-price/RegionSearchSelect.tsx",
  "utf8",
);
const regionHierarchy = readFileSync(
  "src/components/basic-price/RegionHierarchySelect.tsx",
  "utf8",
);
const journey = readFileSync("src/utils/basicPriceJourney.ts", "utf8");
/** Comments are design intent, not screen text — they must not satisfy a copy pin. */
const strip = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const reviewText = strip(review);
const intakeText = strip(intakeQuestion);
const regionSelectText = strip(`${regionSelect}\n${regionHierarchy}`);
const importPageText = strip(importPage);

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
  assert.match(intakeText, /Lokasi tempat harga berlaku dipilih terpisah pada langkah tersebut/);
  assert.doesNotMatch(intakeText, /Wilayah mana yang ingin Anda proses/);
  assert.match(regionSelectText, /contextLabel="Wilayah"/);
  assert.match(regionSelectText, /<legend[^>]*>\{contextLabel\}<\/legend>/);
});

test("BP-INTAKE-COPY-01: users see a clear choice and know its consequence", () => {
  assert.match(intakeText, /Daftar harga apa yang Anda unggah\?/u);
  assert.match(intakeText, /Setelah seluruh pertanyaan berkas dijawab, langkah berikutnya tetap Lengkapi Sumber/u);
  assert.match(intakeText, /Harga dari kolom mana yang ingin Anda gunakan\?/u);
  assert.match(intakeText, /value: label, label: `Gunakan harga: \$\{label\}`/u);
  assert.match(intakeText, /answerKey: 'selectedRegionLabel'/u);
  assert.match(intakeText, /Kolom mana yang berisi nama barang, tenaga kerja, atau peralatan\?/u);
  assert.match(intakeText, /Kolom mana yang berisi satuan\?/u);
  assert.match(intakeText, /Pilih satu jawaban untuk melanjutkan/u);
  assert.match(importPageText, /Berkas berhasil dibaca\. Pilih satu jawaban/u);
  assert.match(importPageText, /batch\.sourceRegionScopeLabel\?\.trim\(\)/u);
  assert.match(importPageText, /Harga yang dipilih dari berkas:/u);
  assert.match(importPageText, /SIMPROK menggunakan angka harga dari kolom ini/u);
  assert.doesNotMatch(intakeText, /Tentukan kolom nama item\. SIMPROK tidak menemukan judul kolom/u);
});

test("UI-RESTORE-01: five-level Region hierarchy exists only in Lengkapi Sumber", () => {
  assert.match(importPageText, /<RegionSearchSelect/);
  assert.match(regionSelectText, /<RegionHierarchySelect/);
  for (const label of [
    '"Negara"',
    '"Provinsi"',
    '"Kabupaten/Kota"',
    '"Kecamatan"',
    '"Desa/Kelurahan (opsional)"',
  ]) {
    assert.match(regionSelectText, new RegExp(label.replace(/[()/]/g, "\\$&"), "u"));
  }
  assert.match(regionSelectText, /<details[\s\S]*aria-label="Pilihan Desa\/Kelurahan"/u);
  assert.match(regionSelectText, /<select[\s\S]*required/u);
  assert.doesNotMatch(regionSelectText, /<details[^>]*required/u);
  assert.doesNotMatch(importPageText, /Peninjauan wilayah sumber|handleConfirmRegionScope/);
  assert.doesNotMatch(
    regionSelectText,
    /Hapus pilihan wilayah|Lengkapi wilayah sampai Kecamatan|Wilayah harga:/,
  );
  assert.match(importPageText, /Tercatat di SIMPROK/);
  assert.match(importPageText, /Simpan Konteks Sumber/);
  assert.match(importPageText, /Lanjut ke Peninjauan Baris/);
});

test("the two date explanations are hover/focus tooltips without a disclosure row", () => {
  assert.doesNotMatch(importPageText, /Apa maksud tanggal ini\?/u);
  assert.equal((importPageText.match(/role="tooltip"/gu) ?? []).length, 2);
  assert.match(importPageText, /id="simprok-effective-date-help"/u);
  assert.match(importPageText, /id="simprok-review-date-help"/u);
  assert.match(importPageText, /aria-describedby="simprok-effective-date-help"/u);
  assert.match(importPageText, /aria-describedby="simprok-review-date-help"/u);
  assert.match(basicPriceCss, /\.bp-date-help__tooltip \{[\s\S]*?position: absolute;/u);
  assert.match(basicPriceCss, /\.bp-date-help__tooltip \{[^}]*right: 0;[^}]*left: auto;/u);
  assert.match(basicPriceCss, /\.bp-date-help__trigger:hover ~ \.bp-date-help__tooltip/u);
  assert.match(basicPriceCss, /\.bp-date-help \.bp-input:hover ~ \.bp-date-help__tooltip/u);
  assert.match(basicPriceCss, /\.bp-date-help \.bp-input:focus ~ \.bp-date-help__tooltip/u);
  assert.match(
    basicPriceCss,
    /\.bp-date-help__tooltip \{[^}]*background: var\(--simprok-white\);/u,
  );
  assert.doesNotMatch(basicPriceCss, /var\(--simprok-trust-blue-50\)/u);
  assert.match(basicPriceCss, /pointer-events: none;/u);
});

test("a metadata identity collision reuses the server-owned existing-batch route", () => {
  assert.match(importPage, /metadataSaveExistingBatchId\(error\.httpStatus, error\.detail\)/u);
  assert.match(importPage, /reimportActionPath\('USE_EXISTING'/u);
  assert.match(importPage, /state: \{ usedExisting: true \}/u);
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

test("STALE-UX-02: only a confirmed stale version triggers automatic readback", () => {
  assert.match(review, /httpStatus !== 409/);
  assert.match(review, /recoverFromRowFailure/);
  const message = staleRowRecoveryMessage(8);
  assert.match(message, /^Baris 8 memiliki versi lebih baru/);
  assert.match(message, /SIMPROK sudah memuat versi terbaru/);
  assert.ok(!message.includes("muat ulang halaman"));
});

test("CONFLICT-UX: business-rule 409 does not claim another editor changed the row", () => {
  assert.equal(isStaleRowConflict('{"message":"ROW_VERSION_STALE"}'), true);
  assert.equal(isStaleRowConflict('{"message":"UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE"}'), false);
  assert.equal(isStaleRowConflict('{"message":"ROW_SOURCE_SECTION_UNRESOLVED"}'), false);
  assert.equal(isStaleRowConflict('{}'), false);
  assert.match(rowNonStaleConflictMessage(13, '{"message":"UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE"}'), /Satuan pilihan belum dapat dibuktikan/u);
  assert.match(rowNonStaleConflictMessage(13, '{"message":"ROW_SOURCE_SECTION_UNRESOLVED"}'), /Ubah Jenis dan Konfirmasi Jenis/u);
  assert.doesNotMatch(rowNonStaleConflictMessage(13, '{"message":"UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE"}'), /perubahan lain|versi lebih baru/u);
  assert.match(review, /!isStaleRowConflict\(error\.detail\)/u);
  assert.match(review, /rowNonStaleConflictMessage\(row\.sourceRowNumber, error\.detail\)/u);
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
  assert.match(reviewText, /Pilih Item yang Sesuai Padanan/);
  assert.match(reviewText, /Tetapkan sebagai Item Baru/);
  assert.match(reviewText, /Pilih Penyelesaian/);
  assert.match(reviewText, /Perlu Tinjauan/);
  assert.doesNotMatch(reviewText, />\s*Selesaikan\s*</);
});

test("ROW-GRID-01: expanded review retains original facts within the approved two-area layout", () => {
  for (const label of [
    "Data Item",
    "Jenis dan Satuan",
    "Pilih Penyelesaian",
  ]) {
    assert.match(reviewText, new RegExp(label.replace(/[().]/g, "\\$&"), "u"));
  }
  assert.match(reviewText, /Data asli Excel tetap utuh/);
  assert.match(reviewText, /Pencarian padanan dan penetapan item baru selalu memakai nama ini/);
  assert.match(reviewText, /Apa yang perlu ditinjau\?/);
  assert.doesNotMatch(reviewText, /Koreksi teks \(jika perlu\)|Hasil pencocokan|Kandidat yang ditemukan|Pratinjau sumber daya baru/);
});

// ── PROGRESSIVE DISCLOSURE (§17 / §20) ──────────────────────────────────────

test("DISCLOSE-01: one instruction stays visible and the rest of the reasoning waits to be asked for", () => {
  const split = rowNoteDisclosure({
    human: [
      "Item belum dikenali sebagai Resource Identity yang sudah ada. Pilih Item SIMPROK yang sesuai, sahkan sebagai item baru, atau tolak baris ini.",
      "Satuan belum dikenali.",
      "Ada lebih dari satu kandidat yang sama kuat.",
    ],
  });
  assert.equal(
    split.primary,
    "Item belum dikenali sebagai Resource Identity yang sudah ada. Pilih Item SIMPROK yang sesuai, sahkan sebagai item baru, atau tolak baris ini.",
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
  assert.match(review, /rowNoteDisclosure\(notes, row\.machineProposal\?\.identityPairProven === true\)/);
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
  // BP-SHARED-PROPOSAL-01 — curationApplies follows communityCurationPathApplies
  // (server family/reason), not only `offered`, so FIELD_PRICE not-ready is not
  // falsely labelled "tidak dirutekan".
  assert.match(journey, /optional: boolean/);
  assert.match(journey, /'PROPOSE', 'NOT_OFFERED'/);
  assert.match(journey, /'VERIFY', 'NOT_OFFERED'/);
  assert.match(journey, /communityCurationPathApplies\(proposal, proposed\)/);
});


test("OWNER-HORIZONTAL-01: desktop review uses a wide 35:65 data/action composition", () => {
  assert.match(basicPriceCss, /grid-template-columns:\s*minmax\(0, 35fr\) minmax\(0, 65fr\)/);
  assert.match(basicPriceCss, /\.bp-rowcard__actions \{\s*grid-column: 2;\s*grid-row: 3 \/ span 2;/);
  assert.match(basicPriceCss, /\.bp-rowcard__question \{\s*grid-column: 1 \/ -1;/);
  const decisions = reviewText.slice(reviewText.indexOf('<div className="bp-rowcard__actions bp-rowcard__resolution">'));
  assert.ok(decisions.indexOf("Pilih Item yang Sesuai Padanan") >= 0);
  assert.ok(decisions.indexOf('bp-rowcard__lookup--contextual') > decisions.indexOf("Pilih Item yang Sesuai Padanan"));
  assert.ok(decisions.indexOf("mode=\"resource\"") > decisions.indexOf('bp-rowcard__lookup--contextual'));
  assert.match(decisions, /aria-expanded=\{lookupRows\.has\(row\.id\)\}/);
  assert.match(decisions, /aria-expanded=\{draft\.admitOpen\}/);
  assert.match(basicPriceCss, /\.bp-rowcard__resolution > \.bp-rowcard__choice:hover:not\(:disabled\)/);
});

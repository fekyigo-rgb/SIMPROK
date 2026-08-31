import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * BASIC PRICE EXPLORER — OWNER-LOCKED SURFACE LAW (BP-UX-FINAL-01 §4–§7, §24).
 *
 * §24 fixes a set of product decisions the Owner does not want re-argued: which
 * six controls are visible, that the source column shows a REAL source name,
 * that the room lists currently usable prices rather than history, and that
 * there is one primary action. Every one of those is the kind of decision that
 * quietly erodes — a filter creeps back because it was easy, a family label
 * replaces a vendor name because it is shorter — so they are pinned at the
 * source, the same shape `basicPriceGovernanceDoorsLaw.test.ts` already uses
 * for the curation doors.
 *
 * This file guards the SURFACE. The behaviour behind it is pure and lives in
 * `utils/basicPriceFreshness.test.ts`.
 */

const page = readFileSync("src/pages/BasicPriceExplorerPage.tsx", "utf8");

/**
 * WHAT ACTUALLY REACHES A SCREEN.
 *
 * JSX comment blocks, ordinary block comments AND line comments are stripped.
 * The reasoning above a decision legitimately QUOTES the wording it removed —
 * the module header explains why no row repeats "Siap Digunakan" — and a guard
 * that reads its own explanation as a violation fails for the wrong reason.
 */
const renderable = page
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** The filter band only — "Satuan" and "Kesegaran" are legitimate COLUMN
 *  headings, and a naive whole-file search would confuse a column with a
 *  filter and fail for the wrong reason. */
const filterBand = (() => {
  const start = renderable.indexOf('className="bp-filters"');
  assert.ok(start > 0, "the filter band must exist");
  const end = renderable.indexOf("</section>", start);
  assert.ok(end > start, "the filter band must be closed");
  return renderable.slice(start, end);
})();

const tableHead = (() => {
  const start = renderable.indexOf("<thead>");
  assert.ok(start > 0, "the price table must have a header row");
  return renderable.slice(start, renderable.indexOf("</thead>", start));
})();

/* ── §4 Header ─────────────────────────────────────────────────────────── */

test("X-1. the room has exactly ONE primary call to action", () => {
  const primaries = renderable.match(/bp-btn--primary/g) ?? [];
  assert.equal(primaries.length, 1, "only Impor / Tambah Harga may be primary");
  // And it is the import door, not a reload or a curation room.
  const at = renderable.indexOf("bp-btn--primary");
  assert.match(renderable.slice(at, at + 400), /Impor \/ Tambah Harga/u);
});

test("X-2. Muat ulang stays a quiet secondary beside it", () => {
  assert.match(renderable, /className="bp-btn"[\s\S]{0,200}Muat ulang/u);
});

test("X-3. the curation doors survive, demoted to quiet links", () => {
  // They are real rooms behind real authority and
  // `basicPriceGovernanceDoorsLaw.test.ts` pins them to this header. §4 caps
  // the room at one primary CTA, so they must be links — never a third and
  // fourth button competing with Impor.
  for (const door of ["Pengajuan harga", "Siap diterbitkan"]) {
    const at = renderable.indexOf(door);
    assert.ok(at > 0, `${door} must still be reachable`);
    // The nearest className before the label is the link variant.
    const before = renderable.slice(Math.max(0, at - 400), at);
    assert.match(before, /bp-btn bp-btn--link/u, `${door} must be a quiet link`);
  }
});

/* ── §5 Filters ────────────────────────────────────────────────────────── */

test("X-4. exactly the six locked controls are visible", () => {
  for (const label of ["Cari", "Kategori", "Jenis sumber", "Nama sumber", "Berlaku pada"]) {
    assert.match(filterBand, new RegExp(label, "u"), `${label} must be a visible filter`);
  }
  // Wilayah is its own component, mounted in the same band.
  assert.match(filterBand, /<ExplorerRegionFilterSelect/u);
});

test("X-5. the removed filters stay removed", () => {
  // Each of these was a question put to a person before they had seen a single
  // price. Satuan and Kesegaran are COLUMNS now; Tahun collides with the date
  // filter on the same axis and the server 400s the pair; the range asked for
  // two dates where one is the real question.
  for (const gone of [/Satuan/u, /Kesegaran/u, /Tahun/u, /Tanggal awal/u, /Tanggal akhir/u]) {
    assert.doesNotMatch(filterBand, gone, `${gone} must not return to the filter band`);
  }
});

test("X-6. there is NO advanced filter panel, under any name", () => {
  assert.doesNotMatch(renderable, /Filter Lanjutan/iu);
  assert.doesNotMatch(renderable, /Advanced filter/iu);
});

test("X-7. the reset appears only when something is actually filtered", () => {
  // The old permanent "Bersihkan Filter" button held a filter slot on every
  // visit in order to say nothing at all.
  assert.match(renderable, /\{filtersActive \? \(/u);
  assert.doesNotMatch(filterBand, /Bersihkan Filter/u);
});

test("X-8. sorting lives with the table, not in the filter band", () => {
  assert.doesNotMatch(filterBand, /Urutkan|Urutan/u);
  assert.match(renderable, /className="bp-tablebar__sort"/u);
});

test("X-9. the date filter promises only what the query actually does", () => {
  // BP-UX-FINAL-01C GAP-C — RESTATED, BECAUSE THE QUERY GOT STRONGER.
  //
  // This control used to send `dateTo`, i.e. `effectiveDate <= D` alone, so the
  // help text could truthfully promise no more than "started on or before this
  // date". It now sends the canonical `asOf`, which the SERVER answers with the
  // whole temporal law (effectiveDate <= D, validUntil null or >= D, and
  // currentness evaluated AT D).
  //
  // The guard's intent is unchanged and is the important half: the LABEL and
  // the QUERY must mean the same thing, and none of that law may be
  // re-implemented in the browser.
  assert.match(renderable, /EFFECTIVE_ON_DATE_HELP/u);
  // Scoped to the request object: `year` is also a legitimate
  // `toLocaleDateString` option elsewhere on this page, and a whole-file search
  // would confuse a date FORMAT with a date FILTER.
  const requestObject = (() => {
    const at = renderable.indexOf("const filters: ExplorerFilters = {");
    assert.ok(at > 0, "the request object must exist");
    return renderable.slice(at, renderable.indexOf("};", at));
  })();
  assert.match(requestObject, /asOf: draft\.effectiveOn/u);
  // The range filters answer a DIFFERENT question (which prices started in a
  // window). Sending one alongside the as-of lens would narrow by something
  // nobody asked for.
  assert.doesNotMatch(requestObject, /dateTo:/u, "a second, invented bound must not be sent");
  assert.doesNotMatch(requestObject, /dateFrom:/u);
  assert.doesNotMatch(requestObject, /year:/u);
  // Freshness and unit are COLUMNS now, so they must not be sent as filters
  // either — a hidden filter is worse than a visible one.
  assert.doesNotMatch(requestObject, /freshnessStatus:/u);
  assert.doesNotMatch(requestObject, /unit:/u);
});

/* ── §7 Table ──────────────────────────────────────────────────────────── */

test("X-10. the table carries exactly the seven locked columns, in order", () => {
  // `<th\s` rather than `<th` — otherwise the opening `<thead>` matches the
  // same pattern and contributes a phantom empty column.
  const headers = [...tableHead.matchAll(/<th\s[^>]*>\s*([^<]+?)\s*</g)].map((m) => m[1].trim());
  assert.deepEqual(headers, [
    "Item",
    "Harga",
    "Satuan",
    "Wilayah",
    "Sumber",
    "Status",
    "Detail",
  ]);
});

test("X-11. SUMBER shows the real source name, never its family", () => {
  // "Pemerintah" / "Supplier" / "Survei" are internal groupings. A person
  // reading a price needs to know it came from Dinas PUPR Provinsi Maluku.
  assert.match(renderable, /data-label="Sumber"[\s\S]{0,320}item\.sourceName/u);
  const sumberCell = (() => {
    const at = renderable.indexOf('data-label="Sumber"');
    return renderable.slice(at, renderable.indexOf("</td>", at));
  })();
  assert.doesNotMatch(sumberCell, /sourceOriginLabel|sourceFamilyLabel|sourceTypeLabel/u);
  // A row with no provenance chain says so rather than borrowing a name.
  assert.match(sumberCell, /explorerSourceNameLabel/u);
});

test("X-12. a row never repeats that it is usable — presence already says it", () => {
  // Everything the Explorer serves has passed eligibility, precedence and
  // currentness in the database. Stamping "Siap Digunakan" on every row spends
  // a column to say something no row could contradict.
  assert.doesNotMatch(renderable, /Siap Digunakan/u);
});

/* ── §6 / §28.6 The rule that must live in exactly one place ───────────── */

test("X-13. the page holds NO copy of eligibility or currentness law", () => {
  // These are decided once, in the database, by the same fragments the AHSP
  // resolver and the Cost Kernel read. A second copy here would drift, and the
  // screen would start disagreeing with the money.
  for (const forbidden of [
    /supersededBy/u,
    /publicationAudits/u,
    /verificationStatus/u,
    /assetScope\s*===/u,
    /\.filter\([^)]*validUntil/u,
    /PUBLISHED/u,
  ]) {
    assert.doesNotMatch(renderable, forbidden, `${forbidden} is server law, not page law`);
  }
});

test("X-14. freshness reaches the row through the shared two-value chip", () => {
  assert.match(page, /import \{ FreshnessChip \}/u);
  assert.match(renderable, /<FreshnessChip/u);
  // The three-value backend vocabulary (Terkini / Akan Kedaluwarsa /
  // Kedaluwarsa) must not reach this screen beside the two-value one — two
  // competing status vocabularies on one row is worse than either alone.
  assert.doesNotMatch(renderable, /freshnessLabel/u);
});

test("X-15. Detail is a layered panel over the SAME projection the row used", () => {
  assert.match(page, /import \{ BasicPriceDetailPanel \}/u);
  // FED THE ROW, THEN ENRICHED — and the order matters. Ringkasan renders
  // instantly from the projection the table already holds, so Detail can never
  // disagree with the row it opened from. The lawful detail read
  // (GET /basic-prices/:id/detail) adds evidence and history on top of that,
  // inside the panel, on demand.
  //
  // What is still forbidden is re-fetching the PRICE ITSELF by id from
  // `GET /basic-prices/:id`, which returns a raw entity with no region, no
  // source name and no reverification state — a second read that would show
  // LESS than the list it came from.
  assert.match(renderable, /<BasicPriceDetailPanel\s+item=\{openDetailItem\}/u);
});

test("X-16. the list itself never fetches a detail — no N+1 on page load", () => {
  // The Explorer stays exactly ONE paginated request. History and evidence are
  // read only when a person opens a chip or the panel; prefetching twenty rows
  // nobody expanded would turn one request into twenty-one on every page load.
  assert.doesNotMatch(page, /fetchBasicPriceDetail/u);
  assert.doesNotMatch(page, /useBasicPriceDetail/u);
});

test("X-17. an as-of lens is announced, so it cannot be read as today's list", () => {
  // Once a date is chosen the table answers a different question, and every row
  // in it may be a historical truth rather than a current one.
  assert.match(page, /asOfContextLine/u);
  assert.match(renderable, /\{draft\.effectiveOn \? \(/u);
});

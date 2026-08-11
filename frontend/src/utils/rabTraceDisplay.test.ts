import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPriceTrace,
  resolveAhspIdentity,
  resolvePriceOrigin,
  NOT_LINKED_AHSP,
  PRICE_TRACE_ACTION,
  PRICE_TRACE_ROW_ACTION,
  PRICE_TRACE_TITLE,
  TECHNICAL_DETAIL_TITLE,
} from "./rabTraceDisplay.ts";

// ─────────────────────────────────────────────────────────────────────────────
// RAB-TRACE-01 — ORIGIN: only what the repository can prove
//
// Owner Law names four origins. SIMPROK persists one price-origin enum and no
// import provenance at all, so only two are emitted. The other two are absent
// rather than guessed.
// ─────────────────────────────────────────────────────────────────────────────

test("O-1. a Cost Kernel price is Auto SIMPROK, under Dari Akun Pengguna", () => {
  const origin = resolvePriceOrigin("SERVER_COST_KERNEL");
  assert.equal(origin.label, "Auto SIMPROK");
  assert.equal(origin.categoryLabel, "Dari Akun Pengguna");
  assert.equal(origin.category, "DARI_AKUN_PENGGUNA");
});

test("O-2. a hand-entered price is Input Pengguna, under Dari Akun Pengguna", () => {
  // The XLSX import writes rows with no price, so a MANUAL_CLIENT price can
  // only have been typed by a person inside SIMPROK.
  const origin = resolvePriceOrigin("MANUAL_CLIENT");
  assert.equal(origin.label, "Input Pengguna");
  assert.equal(origin.categoryLabel, "Dari Akun Pengguna");
});

test("O-3. no import origin is ever invented", () => {
  // Nothing persisted today can prove either import origin, so nothing may
  // emit them.
  for (const priceOrigin of ["SERVER_COST_KERNEL", "MANUAL_CLIENT", null] as const) {
    const origin = resolvePriceOrigin(priceOrigin);
    assert.doesNotMatch(origin.label, /import/i, `${priceOrigin} must not claim an import origin`);
    assert.doesNotMatch(origin.categoryLabel, /import/i);
  }
});

test("O-4. an unpriced row says so, and a structural row claims no origin", () => {
  assert.equal(resolvePriceOrigin(null).label, "Belum ada harga");
  assert.equal(resolvePriceOrigin(null).category, null);

  const folder = resolvePriceOrigin("SERVER_COST_KERNEL", { isWorkItem: false });
  assert.equal(folder.label, "");
  assert.equal(folder.category, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// AHSP IDENTITY — an AHSP has no code in this domain
// ─────────────────────────────────────────────────────────────────────────────

test("A-1. a linked AHSP is named by its own work type, method and version", () => {
  const identity = resolveAhspIdentity({
    workType: "Timbunan dan Pemadatan Sirtu",
    methodName: "Pemadatan secara Manual",
    versionNumber: 4,
    outputUnit: "m3",
  });

  assert.equal(identity.linked, true);
  assert.match(identity.fullLabel, /Timbunan dan Pemadatan Sirtu/);
  assert.match(identity.fullLabel, /Pemadatan secara Manual/);
  assert.match(identity.fullLabel, /v4/);
  assert.match(identity.fullLabel, /m3/);
});

test("A-2. a row with no AHSP is honest, never given an invented one", () => {
  for (const absent of [null, undefined, {}]) {
    const identity = resolveAhspIdentity(absent);
    assert.equal(identity.linked, false);
    assert.equal(identity.shortLabel, NOT_LINKED_AHSP);
    assert.equal(identity.fullLabel, NOT_LINKED_AHSP);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PRICE TRACE — one truth, shared by both rooms
// ─────────────────────────────────────────────────────────────────────────────

const R75 = {
  description: "Timbunan dan Pemadatan Sirtu",
  unit: "m3",
  quantityDisplay: "659",
  unitPriceDisplay: "Rp197.005",
  lineTotalDisplay: "Rp129.826.295",
  priceOrigin: "SERVER_COST_KERNEL" as const,
  isWorkItem: true,
  ahsp: {
    workType: "Timbunan dan Pemadatan Sirtu",
    methodName: "Pemadatan secara Manual",
    versionNumber: 4,
    outputUnit: "m3",
  },
  provenance: {
    calculationPolicyVersion: "RM03D1-KERNEL-V1",
    calculationAsOfDate: "2024-06-01",
    calculatedAt: "2026-08-06T02:00:00.000Z",
    calculationOccurrenceId: "d116b638-0000-4000-8000-000000000000",
  },
};

test("T-1. the trace explains the price without recomputing any money", () => {
  const trace = buildPriceTrace(R75);
  const value = (label: string) => trace.facts.find((f) => f.label === label)?.value;

  assert.equal(trace.title, PRICE_TRACE_TITLE);
  assert.equal(value("Asal Harga"), "Auto SIMPROK");
  assert.equal(value("Kategori Asal"), "Dari Akun Pengguna");
  // Persisted strings, echoed exactly.
  assert.equal(value("Volume"), "659");
  assert.equal(value("Harga Satuan"), "Rp197.005");
  assert.equal(value("Jumlah"), "Rp129.826.295");
  assert.equal(value("Harga berlaku per tanggal"), "2024-06-01");
  assert.match(value("Analisa AHSP") ?? "", /Pemadatan secara Manual/);
  assert.deepEqual(trace.unavailable, []);
});

test("T-2. technical identifiers stay under Detail Teknis, not in the first read", () => {
  const trace = buildPriceTrace(R75);
  const technicalLabels = trace.technicalFacts.map((f) => f.label);

  assert.equal(technicalLabels.some((label) => /ID Bukti/.test(label)), true);
  assert.equal(technicalLabels.some((label) => /Kebijakan/.test(label)), true);
  // The occurrence ID must not appear among the plain facts.
  assert.equal(
    trace.facts.some((f) => f.value.includes("d116b638")),
    false,
    "a technical identifier leaked into the primary facts",
  );
  assert.equal(TECHNICAL_DETAIL_TITLE, "Detail Teknis");
});

test("T-3. a manual price states what is unavailable instead of inventing it", () => {
  const trace = buildPriceTrace({
    ...R75,
    priceOrigin: "MANUAL_CLIENT",
    ahsp: null,
    provenance: null,
  });

  assert.equal(trace.facts.find((f) => f.label === "Asal Harga")?.value, "Input Pengguna");
  assert.equal(trace.unavailable.length >= 1, true);
  assert.match(trace.unavailable.join(" "), /tidak tercatat|tidak tersedia/i);
  // Nothing fabricated: no AHSP fact, no dates, no technical identifiers.
  assert.equal(trace.facts.some((f) => f.label === "Analisa AHSP"), false);
  assert.equal(trace.technicalFacts.length, 0);
});

test("T-4. both rooms use this one trace — the labels are shared constants", () => {
  // Ruang Hidup's control and Ruang Kerja's row action are different words for
  // the reader, but they resolve to the same evidence surface.
  assert.equal(PRICE_TRACE_ACTION, "Lihat Bukti Harga");
  assert.equal(PRICE_TRACE_ROW_ACTION, "Rincian Harga");
  assert.equal(PRICE_TRACE_TITLE, "Jejak Perhitungan Harga");
  // And neither is the word the Owner rejected.
  assert.doesNotMatch(PRICE_TRACE_ACTION, /provenance/i);
  assert.doesNotMatch(PRICE_TRACE_TITLE, /provenance/i);
});

test("T-5. building a trace is pure — it cannot mutate what it was given", () => {
  const input = JSON.parse(JSON.stringify(R75));
  const before = JSON.stringify(input);
  buildPriceTrace(input);
  assert.equal(JSON.stringify(input), before, "buildPriceTrace mutated its input");
});

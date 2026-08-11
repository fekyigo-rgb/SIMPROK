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
import { toPersistedRowDisplayList } from "./rabPersistedDraftDisplay.ts";

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

// The authoritative persisted-calculation proof, as the display authority
// returns it. Every figure below is a server string; nothing here is computed.
const PROOF = {
  kind: "verified" as const,
  badge: "Terbukti",
  message: "Harga tersimpan berhasil dibuktikan ulang dari provenance-nya sendiri.",
  storedUnitPriceDisplay: "Rp197.005",
  storedLineTotalDisplay: "Rp129.826.295",
  recomputedUnitPriceDisplay: "Rp197.005",
  recomputedLineTotalDisplay: "Rp129.826.295",
  volumeDisplay: "659",
  unit: "m3",
  reproduced: true,
  provenance: {
    asOfDate: "2024-06-01",
    calculatedAt: "2026-08-06T02:00:00.000Z",
    policyVersion: "RM03D1-KERNEL-V1",
    resolutionPolicyVersion: "RESOLUTION-V1",
    occurrenceId: "d116b638-0000-4000-8000-000000000000",
    ahspVersionId: "a0000000-0000-4000-8000-000000000001",
    ahspOutputUnit: "m3",
    regionName: "Kota Ambon",
    generation: "1",
  },
  resources: [
    {
      resolutionId: "res-1",
      name: "Pekerja",
      type: "LABOR",
      coefficientDisplay: "0,3000",
      ahspUnit: "OH",
      sourcePriceDisplay: "Rp120.000",
      adaptedPriceDisplay: "Rp120.000",
      resourceCostDisplay: "Rp36.000",
      basicPriceId: "bp-1",
      effectiveDate: "2024-01-01",
      sourceOrigin: "OFFICIAL",
      freshness: "CURRENT",
      status: "RESOLVED",
      reasonCodes: [],
    },
  ],
};

test("T-1. a kernel price is explained by the authoritative proof, not row fields", () => {
  const trace = buildPriceTrace({ ...R75, authoritative: PROOF });
  const value = (label: string) => trace.facts.find((f) => f.label === label)?.value;

  assert.equal(trace.status, "VERIFIED");
  assert.equal(trace.verdict, PROOF.message);
  assert.equal(value("Asal Harga"), "Auto SIMPROK");
  // The money comes from the proof, exactly as the server serialised it.
  assert.equal(value("Volume"), "659");
  assert.equal(value("Harga Satuan (tersimpan)"), "Rp197.005");
  assert.equal(value("Jumlah (tersimpan)"), "Rp129.826.295");
  assert.equal(value("Region harga"), "Kota Ambon");
  assert.equal(value("Harga berlaku per tanggal"), "2024-06-01");
  // And the components come from the proof too — never re-derived.
  assert.deepEqual(trace.resources, PROOF.resources);
});

test("T-1b. a kernel price with no readable proof is never shown as proven", () => {
  // The row still carries plausible-looking numbers. Using them here would
  // render exactly like a verified price while proving nothing.
  const trace = buildPriceTrace({ ...R75, authoritative: null });

  assert.equal(trace.status, "UNAVAILABLE");
  assert.equal(trace.facts.some((f) => /Harga Satuan|Jumlah/.test(f.label)), false);
  assert.equal(trace.unavailable.length >= 1, true);
  assert.match(trace.unavailable.join(" "), /belum dapat dibuktikan/i);

  // Before the fetch resolves it says so, rather than guessing.
  const loading = buildPriceTrace({ ...R75, authoritative: undefined });
  assert.equal(loading.status, "LOADING");
});

test("T-1c. a mismatch stays visible instead of being smoothed over", () => {
  const trace = buildPriceTrace({
    ...R75,
    authoritative: {
      ...PROOF,
      kind: "mismatch" as const,
      reproduced: false,
      message: "Harga tersimpan tidak sama dengan hasil hitung ulang.",
      recomputedUnitPriceDisplay: "Rp200.000",
    },
  });

  assert.equal(trace.status, "MISMATCH");
  assert.match(trace.verdict, /tidak sama/i);
  assert.equal(
    trace.facts.find((f) => f.label === "Hasil hitung ulang")?.value,
    "Rp200.000",
  );
});

test("T-2. technical identifiers stay under Detail Teknis, not in the first read", () => {
  const trace = buildPriceTrace({ ...R75, authoritative: PROOF });
  const technicalLabels = trace.technicalFacts.map((f) => f.label);

  assert.equal(technicalLabels.some((label) => /ID Bukti/.test(label)), true);
  assert.equal(technicalLabels.some((label) => /Kebijakan/.test(label)), true);
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
  assert.equal(PRICE_TRACE_ACTION, "Lihat Komponen Pembentuk Harga");
  assert.equal(PRICE_TRACE_ROW_ACTION, "Rincian Harga");
  assert.equal(PRICE_TRACE_TITLE, "Komponen Pembentuk Harga");
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

// ─────────────────────────────────────────────────────────────────────────────
// ROW IDENTITY — NO, KODE and AHSP are three different facts
//
// R75 is the row's own source/WBS code. It is lawful truth and stays visible,
// but it is not an AHSP identity and must never be shown as one.
// ─────────────────────────────────────────────────────────────────────────────

test("R-1. the row's code and its AHSP identity are independent facts", () => {
  const rows = toPersistedRowDisplayList([
    {
      id: "r75",
      parentId: null,
      sortOrder: 1,
      wbsCode: "R75",
      name: "Timbunan dan Pemadatan Sirtu",
      itemType: "WORK_ITEM",
      quantity: "659.000000",
      unit: "m3",
      unitPrice: "197005.00",
      lineTotal: "129826295.00",
      priceOrigin: "SERVER_COST_KERNEL",
      calculationOccurrenceId: null,
      calculationAsOfDate: null,
      calculatedAt: null,
      calculationPolicyVersion: null,
      ahsp: {
        workType: "Timbunan dan Pemadatan Sirtu",
        methodName: "Pemadatan secara Manual",
        versionNumber: 4,
        outputUnit: "m3",
      },
    },
  ]);

  const [row] = rows;
  // NO — structural position.
  assert.equal(row.number, "1");
  // KODE — preserved source truth.
  assert.equal(row.code, "R75");
  // AHSP — proven analysis identity, and never the row's code.
  assert.equal(row.ahsp.linked, true);
  assert.doesNotMatch(row.ahsp.shortLabel, /R75/);
  assert.doesNotMatch(row.ahsp.fullLabel, /R75/);
  assert.match(row.ahsp.shortLabel, /Pemadatan secara Manual/);
  // Three distinct values.
  assert.notEqual(row.number, row.code);
  assert.notEqual(row.code, row.ahsp.shortLabel);
});

test("R-2. a row with no AHSP keeps its code and fails honestly on identity", () => {
  const rows = toPersistedRowDisplayList([
    {
      id: "imported",
      parentId: null,
      sortOrder: 1,
      wbsCode: "TIMB-EXT-01",
      name: "Timbunan",
      itemType: "WORK_ITEM",
      quantity: "659.000000",
      unit: "m3",
      unitPrice: "200000.00",
      lineTotal: "131800000.00",
      priceOrigin: "MANUAL_CLIENT",
      calculationOccurrenceId: null,
      calculationAsOfDate: null,
      calculatedAt: null,
      calculationPolicyVersion: null,
      ahsp: null,
    },
  ]);

  const [row] = rows;
  // The source code survives even with no canonical linkage — this is the
  // shape an imported row will take.
  assert.equal(row.code, "TIMB-EXT-01");
  assert.equal(row.ahsp.linked, false);
  assert.equal(row.ahsp.shortLabel, NOT_LINKED_AHSP);
  // And no AHSP is invented from the code.
  assert.doesNotMatch(row.ahsp.fullLabel, /TIMB/);
});

test("R-3. a snapshot-backed AHSP is a legitimate identity, not 'belum terhubung'", () => {
  const identity = resolveAhspIdentity({
    workType: "Timbunan dan Pemadatan Sirtu",
    methodName: "Pemadatan secara Manual",
    versionNumber: 4,
    outputUnit: "m3",
  });
  assert.equal(identity.linked, true);
  assert.notEqual(identity.shortLabel, NOT_LINKED_AHSP);
});

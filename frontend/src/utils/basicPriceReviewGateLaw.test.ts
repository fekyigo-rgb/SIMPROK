import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  metadataGateView,
  REVIEW_GATE_UNKNOWN_REASON_MESSAGE,
  reviewGateCoherenceMessage,
  type BatchReviewGate,
  type MetadataCoherenceReason,
} from "./basicPriceImportDisplay.ts";

/**
 * THE REVIEW GATE, MIRRORED HONESTLY.
 *
 * THE DEFECT. `evaluateBatchReviewGate` asks the WRITER's own coherence
 * question, so it can refuse a batch whose four required facts are all present
 * but contradict each other. The browser's hand-written mirror knew only
 * BATCH_NOT_MUTABLE and REQUIRED_METADATA_INCOMPLETE, and had no
 * `metadataCoherent` field at all — so every coherence refusal fell through to
 * `Metadata belum lengkap menurut catatan SIMPROK.`
 *
 * A person with a COMPLETE form was therefore told to complete it. Review
 * stayed shut, Save stayed disabled because nothing was dirty, and the sentence
 * pointed at nothing they could do. A mirror nothing checks is a mirror that
 * compiles and lies, which is why the drift guard below reads the backend law
 * itself — the same convention `basicPriceIntakeErrors.ts` already follows for
 * the intake vocabulary.
 */

/** The backend's own coherence vocabulary, read so the two cannot drift. */
const declaredCoherenceCodes = (): string[] => {
  const source = readFileSync(
    "../backend/src/basic-price/basic-price-metadata-coherence.law.ts",
    "utf8",
  );
  const union = source.slice(
    source.indexOf("export type MetadataCoherenceIssue"),
    source.indexOf("*", source.indexOf("export type MetadataCoherenceIssue")),
  );
  return [...union.matchAll(/code:\s*'([A-Z0-9_]+)'/g)].map(
    (match) => match[1],
  );
};

/** Every code this build claims to translate, taken from the module itself. */
const KNOWN_COHERENCE_CODES: MetadataCoherenceReason[] = [
  "SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE",
  "SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE",
  "DERIVATION_RULE_REQUIRES_PROVENANCE",
  "SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE",
  "SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE",
  "DERIVATION_RULE_REQUIRED_FOR_DERIVED_DATE",
  "DERIVATION_RULE_NOT_PROVABLE",
  "DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE",
  "DERIVATION_RULE_FORBIDDEN_FOR_SOURCE_STATED",
];

const RAW_ENUM = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

const gateWith = (overrides: Partial<BatchReviewGate>): BatchReviewGate => ({
  requiredFacts: ["EFFECTIVE_DATE", "REGION", "SOURCE_ORIGIN", "SOURCE_TYPE"],
  missingRequiredFacts: [],
  metadataComplete: true,
  metadataCoherent: true,
  reviewAllowed: true,
  reasonCode: null,
  ...overrides,
});

const FULL_DRAFT = {
  effectiveDate: "2024-01-01",
  regionId: "region-1",
  sourceOrigin: "FIELD_REPORT",
  sourceType: "MARKET_SURVEY",
};

const viewFor = (gate: BatchReviewGate, isDirty = false) =>
  metadataGateView({ actions: { reviewGate: gate } }, FULL_DRAFT, isDirty, false);

/* ── CONTRACT PARITY ─────────────────────────────────────────────────────── */

test("G-1. every coherence code the backend can send is one this build translates", () => {
  const declared = declaredCoherenceCodes();
  assert.ok(
    declared.length >= 9,
    `expected the full backend vocabulary, saw ${declared.length}: ${declared.join(", ")}`,
  );
  for (const code of declared) {
    assert.ok(
      (KNOWN_COHERENCE_CODES as string[]).includes(code),
      `backend can refuse with ${code} and this build has no sentence for it`,
    );
  }
});

test("G-2. this build claims no coherence code the backend cannot send", () => {
  const declared = declaredCoherenceCodes();
  for (const code of KNOWN_COHERENCE_CODES) {
    assert.ok(
      declared.includes(code),
      `${code} is translated here but no longer exists in the backend law`,
    );
  }
});

/* ── STATE A — MISSING ───────────────────────────────────────────────────── */

test("G-3. a genuinely incomplete batch is still told what is missing", () => {
  const view = metadataGateView(
    {
      actions: {
        reviewGate: gateWith({
          missingRequiredFacts: ["REGION"],
          metadataComplete: false,
          reviewAllowed: false,
          reasonCode: "REQUIRED_METADATA_INCOMPLETE",
        }),
      },
    },
    { ...FULL_DRAFT, regionId: undefined },
    true,
    false,
  );
  assert.match(view.message, /Lengkapi dulu/u);
  assert.deepEqual(view.missingInDraft, ["Wilayah harga"]);
  assert.equal(view.reviewEnabled, false);
});

/* ── STATE B — COMPLETE BUT INCOHERENT ───────────────────────────────────── */

test("G-4. a complete-but-incoherent batch is NEVER called incomplete", () => {
  for (const code of KNOWN_COHERENCE_CODES) {
    const view = viewFor(
      gateWith({
        metadataComplete: true,
        metadataCoherent: false,
        reviewAllowed: false,
        reasonCode: code,
      }),
    );
    assert.doesNotMatch(
      view.message,
      /belum lengkap/iu,
      `${code} was reported as incomplete`,
    );
    // It says the opposite, plainly, before naming the mismatch.
    assert.match(view.message, /sudah lengkap/u, code);
    assert.equal(view.reviewEnabled, false, `${code} must not open review`);
  }
});

test("G-5. no coherence refusal leaks a raw code onto the screen", () => {
  for (const code of KNOWN_COHERENCE_CODES) {
    const message = reviewGateCoherenceMessage(code);
    assert.doesNotMatch(message, RAW_ENUM, `${code} leaked an enum`);
    assert.doesNotMatch(message, /undefined|null/u, code);
    assert.ok(message.length > 0, code);
  }
});

test("G-6. each refusal names a step the person can actually take", () => {
  for (const code of KNOWN_COHERENCE_CODES) {
    const message = reviewGateCoherenceMessage(code);
    assert.match(message, /simpan lagi/u, `${code} offers no way forward`);
  }
  // The source pair is repairable on this very form, so it says so.
  assert.match(
    reviewGateCoherenceMessage("SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE"),
    /Asal Sumber atau Jenis Sumber Harga/u,
  );
  // The provenance behind a derived date is SIMPROK's own bookkeeping and has
  // no editor in this product — so the sentence offers the date, and then a
  // bounded, honest way out instead of a dead end.
  assert.match(
    reviewGateCoherenceMessage("DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE"),
    /tanggal\/periode harga/u,
  );
  assert.match(
    reviewGateCoherenceMessage("DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE"),
    /kurator SIMPROK/u,
  );
});

/* ── STATE C — CLOSED ────────────────────────────────────────────────────── */

test("G-7. a closed batch is neither incomplete nor incoherent", () => {
  const view = viewFor(
    gateWith({ reviewAllowed: false, reasonCode: "BATCH_NOT_MUTABLE" }),
  );
  assert.match(view.message, /sudah ditutup/u);
  assert.doesNotMatch(view.message, /belum lengkap|belum cocok/iu);
});

/* ── COMPLETE AND COHERENT ───────────────────────────────────────────────── */

test("G-8. a lawful batch gets no warning of any kind", () => {
  const view = viewFor(gateWith({}));
  assert.match(view.message, /Peninjauan baris siap dibuka/u);
  assert.equal(view.reviewEnabled, true);
  assert.doesNotMatch(view.message, /belum lengkap|belum cocok|kurator/iu);
});

/* ── FAIL CLOSED ─────────────────────────────────────────────────────────── */

test("G-9. a reason this build has never heard of fails closed, truthfully", () => {
  const view = viewFor(
    gateWith({
      metadataCoherent: false,
      reviewAllowed: false,
      reasonCode: "A_REASON_FROM_A_LATER_DEPLOY" as never,
    }),
  );
  assert.equal(view.message, REVIEW_GATE_UNKNOWN_REASON_MESSAGE);
  assert.equal(view.reviewEnabled, false);
  assert.doesNotMatch(view.message, RAW_ENUM);
  assert.doesNotMatch(view.message, /undefined/u);
  // It never claims the form is incomplete, because it does not know that.
  assert.doesNotMatch(view.message, /belum lengkap/iu);
});

test("G-10. a refusal with no reason at all still refuses, and says only what is known", () => {
  const view = viewFor(gateWith({ reviewAllowed: false, reasonCode: null }));
  assert.equal(view.message, REVIEW_GATE_UNKNOWN_REASON_MESSAGE);
  assert.equal(view.reviewEnabled, false);
});

/* ── THE REPAIR PATH ─────────────────────────────────────────────────────── */

/**
 * A coherence refusal must not be a dead end. Nothing here bypasses the server:
 * the person edits a VISIBLE metadata control, the existing dirty-state law
 * re-opens Save, and the same backend law then decides again.
 */
test("G-11. editing visible metadata re-opens Save, and only Save", () => {
  const incoherent = gateWith({
    metadataCoherent: false,
    reviewAllowed: false,
    reasonCode: "DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE",
  });

  const stuck = viewFor(incoherent, false);
  assert.equal(stuck.saveEnabled, false);
  assert.equal(stuck.reviewEnabled, false);

  const edited = viewFor(incoherent, true);
  assert.equal(edited.saveEnabled, true, "the person must be able to try again");
  // Review stays shut until the SERVER says otherwise — the browser never
  // grants itself permission.
  assert.equal(edited.reviewEnabled, false);
  assert.match(edited.message, /belum tersimpan/u);
});

test("G-12. only the server re-opens review, after a coherent save", () => {
  const repaired = viewFor(gateWith({}), false);
  assert.equal(repaired.reviewEnabled, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  RESOURCE_TRUST_STATE,
  summariseResourceTrust,
  toResourceTrust,
  type ResourceTrustView,
} from "./rabResourceTrust.ts";

/**
 * Minimal Exception UX — trust classification.
 * TEST_ONLY_SYNTHETIC_FIXTURE=YES, PRODUCTION_TRUTH=NO.
 *
 * Every fixture below uses reason codes the BACKEND actually emits, so these
 * tests pin the translation to the real server vocabulary rather than to a
 * convenient invention.
 */

// ---------- CASE A — machine proven ----------

test("an exact machine match is proven automatically and asks for nothing", () => {
  const trust = toResourceTrust({
    status: "RESOLVED",
    reasonCodes: [
      "EXACT_RESOURCE_NAME_MATCH",
      "RESOURCE_TYPE_MATCH",
      "EXACT_UNIT_IDENTITY",
      "SINGLE_ELIGIBLE_BASIC_PRICE",
    ],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.MACHINE_PROVEN);
  assert.equal(trust.label, "Terbukti otomatis");
  assert.equal(trust.reason, null);
  assert.equal(trust.needsAttention, false);
  assert.equal(trust.decisionAvailable, false);
});

test("a unit-context machine match is still machine proven, not a human decision", () => {
  const trust = toResourceTrust({
    status: "RESOLVED",
    reasonCodes: [
      "EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT",
      "RESOURCE_TYPE_MATCH",
      "EXACT_UNIT_IDENTITY",
      "SINGLE_ELIGIBLE_BASIC_PRICE",
    ],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.MACHINE_PROVEN);
  assert.equal(trust.decisionAvailable, false);
});

// ---------- CASE D — governed human decision applied ----------

test("a reused governed human decision reads as settled, never as machine proven", () => {
  const trust = toResourceTrust({
    status: "RESOLVED",
    reasonCodes: [
      "VERIFIED_MAPPING_REUSED",
      "RESOURCE_TYPE_MATCH",
      "EXACT_UNIT_IDENTITY",
      "SINGLE_ELIGIBLE_BASIC_PRICE",
    ],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.HUMAN_SETTLED);
  assert.equal(trust.label, "Sudah ditetapkan");
  // Already settled: it must NOT prompt for the same decision again.
  assert.equal(trust.decisionAvailable, false);
  assert.equal(trust.needsAttention, false);
});

// ---------- CASE C — legitimate human ambiguity ----------

test("a genuine representation tie is the one state that may offer a decision", () => {
  const trust = toResourceTrust({
    status: "NEEDS_REVIEW",
    reasonCodes: [
      "MULTIPLE_CANDIDATES_NEEDS_REVIEW",
      "UNIT_CONTEXT_MULTIPLE_MATCHING_REPRESENTATIONS",
    ],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.NEEDS_HUMAN_DECISION);
  assert.equal(trust.label, "Perlu keputusan Anda");
  assert.equal(trust.decisionAvailable, true);
  assert.equal(trust.needsAttention, true);
});

test("an unproved specification can never become a chooser, even with candidates", () => {
  // The kernel's own law: SPECIFICATION_UNPROVED disqualifies human decision.
  const trust = toResourceTrust({
    status: "NEEDS_REVIEW",
    reasonCodes: [
      "MULTIPLE_CANDIDATES_NEEDS_REVIEW",
      "SPECIFICATION_UNPROVED",
    ],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.NOT_PROVABLE);
  assert.equal(trust.decisionAvailable, false);
  assert.equal(
    trust.reason,
    "Katalog menyebut spesifikasi yang tidak dinyatakan oleh sumber.",
  );
});

test("a strong single candidate needing review is not a choice between alternatives", () => {
  const trust = toResourceTrust({
    status: "NEEDS_REVIEW",
    reasonCodes: ["STRONG_CANDIDATE_NEEDS_REVIEW", "SPECIFICATION_UNPROVED"],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.NOT_PROVABLE);
  assert.equal(trust.decisionAvailable, false);
});

// ---------- CASE B — not yet provable, with one truthful reason ----------

test("a missing resource is stated as a fact and offers no fake choice", () => {
  const trust = toResourceTrust({
    status: "UNRESOLVED",
    reasonCodes: ["RESOURCE_NOT_FOUND"],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.NOT_PROVABLE);
  assert.equal(trust.label, "Belum dapat dipastikan");
  assert.equal(trust.reason, "Sumber daya ini belum dikenali di katalog.");
  assert.equal(trust.decisionAvailable, false);
  assert.equal(trust.needsAttention, true);
});

test("a specification conflict is reported as a conflict", () => {
  const trust = toResourceTrust({
    status: "UNRESOLVED",
    reasonCodes: ["SPECIFICATION_CONFLICT"],
  });
  assert.equal(
    trust.reason,
    "Spesifikasi sumber dan katalog saling bertentangan.",
  );
  assert.equal(trust.decisionAvailable, false);
});

test("an unprovable unit is a unit reason, never an identity choice", () => {
  const trust = toResourceTrust({
    status: "UNRESOLVED",
    reasonCodes: ["UNIT_NOT_SUPPORTED"],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.NOT_PROVABLE);
  assert.equal(trust.reason, "Satuan belum dapat dibuktikan oleh Kamus Unit.");
  assert.equal(trust.decisionAvailable, false);
});

test("a missing basic price is reported as a price fact", () => {
  const trust = toResourceTrust({
    status: "UNRESOLVED",
    reasonCodes: [
      "EXACT_RESOURCE_NAME_MATCH",
      "RESOURCE_TYPE_MATCH",
      "EXACT_UNIT_IDENTITY",
      "NO_BASIC_PRICE_CANDIDATE",
    ],
  });

  // Identity was proven, but price was not — the reason names the real gap and
  // does not pretend the identity is in doubt.
  assert.equal(trust.state, RESOURCE_TRUST_STATE.NOT_PROVABLE);
  assert.equal(
    trust.reason,
    "Belum ada harga dasar yang sah untuk sumber daya ini.",
  );
});

test("several eligible prices is a review fact, not an identity decision", () => {
  const trust = toResourceTrust({
    status: "NEEDS_REVIEW",
    reasonCodes: [
      "EXACT_RESOURCE_NAME_MATCH",
      "RESOURCE_TYPE_MATCH",
      "EXACT_UNIT_IDENTITY",
      "MULTIPLE_BASIC_PRICE_CANDIDATES",
    ],
  });

  assert.equal(trust.state, RESOURCE_TRUST_STATE.NOT_PROVABLE);
  assert.equal(trust.decisionAvailable, false);
  assert.equal(trust.reason, "Ada lebih dari satu harga dasar yang sama sah.");
});

// ---------- fail-closed behaviour ----------

test("an unknown status never passes as proven", () => {
  const trust = toResourceTrust({ status: "SOMETHING_NEW", reasonCodes: [] });
  assert.equal(trust.state, RESOURCE_TRUST_STATE.NOT_PROVABLE);
  assert.equal(trust.reason, "Bukti yang diperlukan belum tersedia.");
});

test("a malformed payload never passes as proven and never throws", () => {
  const trust = toResourceTrust({
    status: undefined as unknown as string,
    reasonCodes: undefined as unknown as string[],
  });
  assert.equal(trust.state, RESOURCE_TRUST_STATE.NOT_PROVABLE);
  assert.equal(trust.decisionAvailable, false);
});

test("the classifier reads ONLY status and reasonCodes", () => {
  // Two rows differing in every other conceivable field but sharing the server
  // verdict must classify identically. This is the one-truth guarantee: no
  // name, unit, price or catalog id may influence the verdict.
  const a = toResourceTrust({ status: "RESOLVED", reasonCodes: ["EXACT_RESOURCE_NAME_MATCH"] });
  const b = toResourceTrust({ status: "RESOLVED", reasonCodes: ["EXACT_RESOURCE_NAME_MATCH"] });
  assert.deepEqual(a, b);
});

// ---------- CASE F — exception-first summary at 20-50 resources ----------

const proven = (): ResourceTrustView =>
  toResourceTrust({ status: "RESOLVED", reasonCodes: ["EXACT_RESOURCE_NAME_MATCH"] });
const ambiguous = (): ResourceTrustView =>
  toResourceTrust({
    status: "NEEDS_REVIEW",
    reasonCodes: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
  });
const missing = (): ResourceTrustView =>
  toResourceTrust({ status: "UNRESOLVED", reasonCodes: ["RESOURCE_NOT_FOUND"] });

test("50 resources with 5 exceptions read as 5 things to look at", () => {
  const views = [
    ...Array.from({ length: 45 }, proven),
    ...Array.from({ length: 3 }, missing),
    ...Array.from({ length: 2 }, ambiguous),
  ];

  const summary = summariseResourceTrust(views);
  assert.equal(summary.total, 50);
  assert.equal(summary.settled, 45);
  assert.equal(summary.needsDecision, 2);
  assert.equal(summary.notProvable, 3);
  assert.equal(summary.attention, 5);
  assert.equal(summary.allClear, false);
  assert.equal(
    summary.headline,
    "SIMPROK sudah menyelesaikan 45 dari 50 komponen. 2 perlu keputusan Anda, 3 belum dapat dipastikan.",
  );
  // The 45 healthy rows are not attention items and must not dominate.
  assert.equal(views.filter((v) => v.needsAttention).length, 5);
});

test("a fully proven analysis stays quiet and asks for nothing", () => {
  const summary = summariseResourceTrust(Array.from({ length: 22 }, proven));
  assert.equal(summary.attention, 0);
  assert.equal(summary.allClear, true);
  assert.equal(
    summary.headline,
    "Seluruh 22 komponen sudah beres. Tidak ada yang perlu Anda lakukan.",
  );
});

test("a governed human decision counts as settled, not as attention", () => {
  const settled = toResourceTrust({
    status: "RESOLVED",
    reasonCodes: ["VERIFIED_MAPPING_REUSED"],
  });
  const summary = summariseResourceTrust([settled, proven(), missing()]);
  assert.equal(summary.settled, 2);
  assert.equal(summary.attention, 1);
});

test("an empty analysis says so honestly", () => {
  const summary = summariseResourceTrust([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.allClear, true);
  assert.equal(summary.headline, "Belum ada komponen untuk ditelusuri.");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUEST_CORRECTION_AVAILABLE,
  REVIEW_ACTIONS,
  acceptNeedsExplicitGeneralRegion,
  bannerAfterRefetch,
  banner,
  buildAcceptBody,
  buildReassignBody,
  buildRejectBody,
  canReject,
  errorMessageFromStatus,
  errorStateFromStatus,
  formatPrice,
  isReviewActionAvailable,
  regionLabel,
  regionOptionLabel,
  resourceLabel,
  reviewerLabel,
  successBanner,
  type PublicationQueueItem,
  type ReviewQueueItem,
} from "./basicPriceWorkflowDisplay.ts";

// ── Human-readable identity, never a raw UUID ────────────────────────────────

test("resourceLabel shows code — name, or just name when code is null", () => {
  assert.equal(resourceLabel({ id: "r1", code: "M.01", name: "Semen", type: "MATERIAL" }), "M.01 — Semen");
  assert.equal(resourceLabel({ id: "r1", code: null, name: "Kerikil", type: "MATERIAL" }), "Kerikil");
});

test("regionLabel shows code — name, and an honest label for a general region", () => {
  assert.equal(regionLabel({ id: "reg1", code: "ID-JK", name: "DKI Jakarta" }), "ID-JK — DKI Jakarta");
  assert.equal(regionLabel(null), "Umum (tanpa wilayah)");
});

test("regionOptionLabel never shows a bare UUID", () => {
  const label = regionOptionLabel({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", code: "ID-JB", name: "Jawa Barat" });
  assert.equal(label, "ID-JB — Jawa Barat");
  assert.ok(!label.includes("ffff"));
});

test("reviewerLabel shows fullName (email), or an honest unassigned label", () => {
  assert.equal(reviewerLabel({ userId: "u1", fullName: "Budi", email: "budi@x.co" }), "Budi (budi@x.co)");
  assert.equal(reviewerLabel(null), "Belum ditugaskan");
});

// ── Money is a decimal string, never a Number ────────────────────────────────

test("formatPrice groups a decimal string as Rupiah without Number conversion", () => {
  assert.equal(formatPrice("125000.00"), "Rp 125.000,00");
  assert.equal(formatPrice("0.10"), "Rp 0,10");
});

test("formatPrice preserves exactness beyond IEEE-754 safe-integer range", () => {
  // 9007199254740993 > Number.MAX_SAFE_INTEGER: a Number() round-trip would
  // corrupt this. The string path must keep every digit.
  assert.equal(formatPrice("9007199254740993.00"), "Rp 9.007.199.254.740.993,00");
});

test("formatPrice renders null as an honest em dash", () => {
  assert.equal(formatPrice(null), "—");
});

test("a queue item's currentPrice is consumed as a string, not a number", () => {
  const item: ReviewQueueItem = {
    reviewId: "review-1",
    priceSubmissionId: "sub-1",
    slaState: "OPEN",
    openedAt: "2026-07-20T00:00:00.000Z",
    escalatedAt: null,
    expiredAt: null,
    resolvedAt: null,
    submissionStatus: "UNDER_REVIEW",
    resource: { id: "r1", code: "M.01", name: "Semen", type: "MATERIAL" },
    region: { id: "reg1", code: "ID-JK", name: "DKI Jakarta" },
    currentPrice: "125000.00",
    effectiveDate: "2026-07-19T00:00:00.000Z",
    assignedReviewer: null,
  };
  assert.equal(typeof item.currentPrice, "string");
  assert.equal(formatPrice(item.currentPrice), "Rp 125.000,00");
});

test("a publication row's price is consumed as a string, not a number", () => {
  const row: PublicationQueueItem = {
    basicPriceId: "bp-1",
    resource: { id: "r1", code: "M.01", name: "Semen", type: "MATERIAL" },
    region: null,
    price: "125000.00",
    effectiveDate: "2026-07-19T00:00:00.000Z",
    status: "UNPUBLISHED",
    verificationStatus: "VERIFIED",
    createdAt: "2026-07-20T00:00:00.000Z",
  };
  assert.equal(typeof row.price, "string");
  assert.equal(formatPrice(row.price), "Rp 125.000,00");
});

// ── Accept / reject / reassign builders and preconditions ────────────────────

test("canReject requires a non-blank note", () => {
  assert.equal(canReject(""), false);
  assert.equal(canReject("   "), false);
  assert.equal(canReject("harga tidak wajar"), true);
});

test("buildRejectBody trims the note", () => {
  assert.deepEqual(buildRejectBody("  terlalu tinggi  "), { note: "terlalu tinggi" });
});

test("acceptNeedsExplicitGeneralRegion is true only when there is no region", () => {
  assert.equal(acceptNeedsExplicitGeneralRegion(null), true);
  assert.equal(acceptNeedsExplicitGeneralRegion({ id: "reg1", code: "ID-JK", name: "DKI Jakarta" }), false);
});

test("buildAcceptBody only sets explicitGeneralRegion when asked, and trims a note", () => {
  assert.deepEqual(buildAcceptBody({ explicitGeneralRegion: true, note: " ok " }), {
    explicitGeneralRegion: true,
    note: "ok",
  });
  assert.deepEqual(buildAcceptBody({ explicitGeneralRegion: false }), {});
});

test("buildReassignBody carries the chosen candidate id, and unassign is explicit null", () => {
  assert.deepEqual(buildReassignBody({ assignedToUserId: "u2", note: "ke Sari" }), {
    assignedToUserId: "u2",
    note: "ke Sari",
  });
  assert.deepEqual(buildReassignBody({ assignedToUserId: null }), { assignedToUserId: null });
});

// ── request-correction is NOT available in the D2A2 UI ────────────────────────

test("REVIEW_ACTIONS excludes request-correction entirely", () => {
  assert.deepEqual([...REVIEW_ACTIONS], ["accept", "reject", "reassign"]);
  assert.equal(isReviewActionAvailable("request-correction"), false);
  assert.equal(isReviewActionAvailable("request_correction"), false);
  assert.equal(REQUEST_CORRECTION_AVAILABLE, false);
});

// ── Honest error states ───────────────────────────────────────────────────────

test("errorStateFromStatus maps HTTP status to an honest UI state", () => {
  assert.equal(errorStateFromStatus(403), "FORBIDDEN");
  assert.equal(errorStateFromStatus(404), "NOT_FOUND");
  assert.equal(errorStateFromStatus(409), "CONFLICT");
  assert.equal(errorStateFromStatus(500), "SERVER_ERROR");
  assert.equal(errorStateFromStatus(503), "SERVER_ERROR");
  assert.equal(errorStateFromStatus(400), "ERROR");
});

test("every error state has a human message", () => {
  for (const status of [403, 404, 409, 500, 400]) {
    assert.ok(errorMessageFromStatus(status).length > 0);
  }
});

// ── A success message survives a refetch (no fake reset) ──────────────────────

test("a sticky success banner survives a follow-up refetch", () => {
  const success = successBanner("Harga berhasil diterbitkan.");
  const afterReload = bannerAfterRefetch(success, banner("ready", ""));
  assert.equal(afterReload.kind, "success");
  assert.equal(afterReload.text, "Harga berhasil diterbitkan.");
});

test("a non-sticky banner is replaced by the refetch outcome", () => {
  const loading = banner("loading", "Memuat...");
  const afterReload = bannerAfterRefetch(loading, banner("empty", "Antrean kosong."));
  assert.equal(afterReload.kind, "empty");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  regionScopeNoticeView,
  type BasicPriceImportBatchSummary,
  type PrivateUseBlockReason,
} from "./basicPriceImportDisplay.ts";

/**
 * BP-REGION-TRUTH-07S §8/§9 — WHAT THE IMPORT ROOM SAYS ABOUT A SOURCE'S OWN
 * GEOGRAPHY, AND WHEN IT SAYS NOTHING AT ALL.
 *
 * The room shows the two answers already: the file's own column wording, and
 * the canonical Wilayah. What this view adds is the sentence between them —
 * that SIMPROK cannot tell whether they name the same place — and it must
 * appear ONLY when the server says so.
 *
 * The silence is as load-bearing as the message. A product that raised this on
 * every parallel-column workbook would have traded one confusing import for a
 * warning nobody reads.
 */

const REGION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const batchWith = (
  regionScope: NonNullable<
    BasicPriceImportBatchSummary["actions"]["regionScope"]
  > | null,
  overrides: Partial<BasicPriceImportBatchSummary> = {},
): BasicPriceImportBatchSummary =>
  ({
    regionId: REGION_ID,
    region: { id: REGION_ID, code: "ID-MA-AMB-TAB", name: "Kecamatan Teluk Ambon Baguala" },
    sourceRegionScopeLabel: "SIRIMAU",
    actions: {
      privateUse: { offered: false, reasonCode: null },
      simprokProposal: { offered: false, reasonCode: null, sourceFamily: null },
      reviewGate: {
        requiredFacts: [],
        missingRequiredFacts: [],
        metadataComplete: true,
        metadataCoherent: true,
        reviewAllowed: true,
        reasonCode: null,
      },
      ...(regionScope ? { regionScope } : {}),
    },
    ...overrides,
  }) as unknown as BasicPriceImportBatchSummary;

const ownerCase = {
  sourceLabel: "SIRIMAU",
  geographicEvidence: "KECAMATAN",
  confirmedRegionId: null,
  compatibilityUnproven: true,
};

test("the Owner's pair is stated as two facts, and never merged into one", () => {
  const notice = regionScopeNoticeView(batchWith(ownerCase));

  assert.ok(notice, "an unproven geographic pair must be surfaced");
  // THE FILE'S OWN WORDS, and the canonical place, kept apart. Printing either
  // one under the other's name is the confusion this whole area exists to end.
  assert.equal(notice.sourceLabel, "SIRIMAU");
  assert.equal(notice.sourceEvidence, "KECAMATAN");
  assert.match(notice.regionLabel, /Kecamatan Teluk Ambon Baguala/);
  // ONE ACTION, and a statement that claims no disagreement — only that
  // agreement is unproven.
  assert.equal(notice.actionLabel, "Tinjau wilayah");
  assert.match(notice.message, /belum dapat dipastikan/);
  assert.ok(!/salah|tidak sesuai|keliru/i.test(notice.message));
});

test("the explanation is secondary, never a wall of text beside the form", () => {
  const notice = regionScopeNoticeView(batchWith(ownerCase));

  assert.ok(notice);
  // The message a person meets first is one sentence; the reasoning lives
  // behind the room's existing disclosure.
  assert.ok(notice.message.length < 120, "the primary line must stay short");
  assert.ok(notice.why.length > notice.message.length);
});

test("SOURCE-NONGEO-01: a non-geographic column choice renders nothing", () => {
  const notice = regionScopeNoticeView(
    batchWith(
      {
        sourceLabel: "GROSIR",
        geographicEvidence: null,
        confirmedRegionId: null,
        compatibilityUnproven: false,
      },
      { sourceRegionScopeLabel: "GROSIR" },
    ),
  );

  assert.equal(notice, null);
});

test("a confirmed pair stops asking", () => {
  const notice = regionScopeNoticeView(
    batchWith({ ...ownerCase, confirmedRegionId: REGION_ID, compatibilityUnproven: false }),
  );

  assert.equal(notice, null);
});

test("a response that predates this block says nothing rather than guessing", () => {
  // Every recorded response and fixture older than BP-REGION-TRUTH-07S carries
  // no `regionScope` at all. Absence must read as "not asked", never as a
  // verdict — the same rule the server applies to the facts themselves.
  assert.equal(regionScopeNoticeView(batchWith(null)), null);
});

test("the view refuses to render half a pair", () => {
  // The server only reports `compatibilityUnproven` when both facts exist, so
  // this state means the projection and this view disagree. Silence is the
  // honest response to a contradiction, not a half-drawn warning.
  assert.equal(
    regionScopeNoticeView(batchWith({ ...ownerCase, geographicEvidence: null })),
    null,
  );
  assert.equal(
    regionScopeNoticeView(batchWith(ownerCase, { regionId: null })),
    null,
  );
});

/**
 * THE MIRROR IS GUARDED, NOT TRUSTED — the same convention
 * `basicPriceReviewGateLaw.test.ts` follows. A hand-written copy of a server
 * vocabulary that nothing checks is a copy that compiles and lies.
 */
test("the new block reasons exist in the server's own law", () => {
  const policy = readFileSync(
    "../backend/src/basic-price/basic-price-batch-actions.policy.ts",
    "utf8",
  );

  assert.ok(
    policy.includes(
      "'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE'",
    ),
    "the private-use refusal must be a code the server actually throws",
  );
  assert.ok(
    policy.includes(
      "'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_SUBMISSION'",
    ),
    "the proposal refusal must be a code the server actually throws",
  );

  // And the browser's own union carries it, so a refused save has a sentence
  // rather than falling through to the generic line.
  const mirrored: PrivateUseBlockReason =
    "REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE";
  assert.equal(
    mirrored,
    "REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE",
  );
});

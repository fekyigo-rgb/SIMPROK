import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolvePriceOrigin } from "./rabTraceDisplay.ts";

/**
 * RAB-TRUTH-CLOSEOUT-01G GAP-B — PRICE ORIGIN HISTORICAL STABILITY.
 *
 * A persisted price origin describes HOW THIS PRICE WAS FORMED, not who owns
 * the source today. These pin the half of that law the frontend can guarantee
 * on its own, and record — in the suite, not only in a report — the exact
 * place where the other half is still missing.
 *
 * PROVEN AGAINST THE LIVE REHEARSAL (T1 → governance change → T2, no
 * recalculation): every calculation fact stayed identical — unitPrice
 * 72615.92, lineTotal 7007436.41, occurrence 7b4373aa…, calculatedAt
 * 2026-08-13T10:28:28.415Z — yet `ahspAuthoritative` flipped false → true, so
 * the displayed origin would move "Data Pengguna" → "Auto SIMPROK" with no
 * recalculation. See PRICE_ORIGIN_AUTHORITY_FREEZE_GAP.
 */

const USER_CHAIN = { ahspAuthoritative: false, privateBasicPriceCount: 0, catalogBasicPriceCount: 12 };
const AUTHORITATIVE_CHAIN = { ahspAuthoritative: true, privateBasicPriceCount: 0, catalogBasicPriceCount: 12 };

/**
 * The classifier is a pure function of the evidence it is HANDED. It reads no
 * clock, no global and no live record of its own, so whatever the read path
 * freezes is exactly what the label will say. That is the property the future
 * freeze depends on, and it must not regress.
 */
test("the origin is decided only by the evidence passed in", () => {
  const asRecorded = resolvePriceOrigin("SERVER_COST_KERNEL", {
    isWorkItem: true,
    authority: USER_CHAIN,
  });
  assert.equal(asRecorded.kind, "USER_DATA");
  assert.equal(asRecorded.label, "Data Pengguna");

  // Same call, same evidence, same answer — no hidden input can move it.
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      resolvePriceOrigin("SERVER_COST_KERNEL", { isWorkItem: true, authority: { ...USER_CHAIN } }).kind,
      "USER_DATA",
    );
  }

  // And the ONLY thing that turns it authoritative is authoritative evidence.
  assert.equal(
    resolvePriceOrigin("SERVER_COST_KERNEL", { isWorkItem: true, authority: AUTHORITATIVE_CHAIN }).kind,
    "AUTO_SIMPROK",
  );
});

test("a manual current value stays Ketik Manual whatever the sources became", () => {
  for (const authority of [USER_CHAIN, AUTHORITATIVE_CHAIN, null, undefined]) {
    const origin = resolvePriceOrigin("MANUAL_CLIENT", { isWorkItem: true, authority });
    assert.equal(origin.kind, "MANUAL_INPUT");
    assert.equal(origin.label, "Ketik Manual");
  }
});

test("a row with no price never acquires an origin from source governance", () => {
  for (const authority of [USER_CHAIN, AUTHORITATIVE_CHAIN]) {
    const origin = resolvePriceOrigin(null, { isWorkItem: true, authority });
    assert.equal(origin.kind, "NONE");
    assert.equal(origin.label, "Belum ada harga");
  }
});

/**
 * RAB-TRUTH-01H — the read paths must ask the FROZEN fact, not the live one.
 *
 * This replaces the earlier diagnostic test, which passed precisely because the
 * broken live-read path existed. A regression test has to assert the desired
 * behaviour, so it now asserts the opposite: the historical ownership comes
 * from the occurrence, and the live `ahsp.ownershipType` is no longer consulted
 * when describing a finished calculation.
 */
test("both read paths take source authority from the frozen occurrence fact", () => {
  const persisted = readFileSync(
    "src/../../backend/src/project/persisted-calculation.service.ts",
    "utf8",
  );
  assert.match(persisted, /ahspOwnership: occurrence\.ahspOwnershipAtCalculation/);
  assert.doesNotMatch(
    persisted,
    /ahspOwnership: item\.ahspVersion\?\.ahsp\?\.ownershipType/,
    "the live ownership read is back — history can drift again",
  );

  const project = readFileSync("src/../../backend/src/project/project.service.ts", "utf8");
  assert.match(project, /ahspOwnershipAtCalculation: true/, "the batched projection must select the frozen fact");
  assert.match(project, /const ownership = occurrence\.ahspOwnershipAtCalculation/);
  assert.doesNotMatch(
    project,
    /ahspVersion: \{ select: \{ ahsp: \{ select: \{ ownershipType: true \} \} \} \}/,
    "the batched projection is reading live ownership again",
  );
});

/**
 * The mutable fact is frozen; the immutable one is deliberately NOT duplicated.
 * `BasicPrice.assetScope` has no production writer that updates it, so
 * `selectedBasicPriceId` already points at stable evidence — copying it would
 * create a second truth to keep in step.
 */
test("only the mutable authority fact is frozen", () => {
  const schema = readFileSync("src/../../backend/prisma/schema.prisma", "utf8");
  const occurrence = schema.slice(
    schema.indexOf("model ProjectAhspOccurrence"),
    schema.indexOf("model ProjectAhspResourceResolution"),
  );
  // Typed with the domain's own enum, so the database refuses an ownership
  // that does not exist and the column compares directly against
  // `ahsps.ownershipType` without a cast.
  assert.match(
    occurrence,
    /ahspOwnershipAtCalculation\s+OwnershipType\?/,
    "the frozen ownership field must use the domain enum, not free text",
  );
  assert.doesNotMatch(occurrence, /ahspOwnershipAtCalculation\s+String\?/);

  const resolution = schema.slice(
    schema.indexOf("model ProjectAhspResourceResolution"),
    schema.indexOf("model ProjectAhspResourceResolution") + 2600,
  );
  assert.doesNotMatch(
    resolution,
    /assetScopeAtCalculation|frozenAssetScope/,
    "an immutable fact was duplicated instead of referenced",
  );
});

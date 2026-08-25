import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * WHAT "DITERBITKAN" MAY CLAIM.
 *
 * Publication moves exactly two states on a BasicPrice — `status` and
 * `verificationStatus` — and touches neither its workspace nor its scope. The
 * one canonical eligibility law then serves that row back to the workspace
 * that owns it, or to everyone if it belongs to no workspace at all. Nothing
 * in the product can produce the second kind, so today every published price
 * reaches exactly one workspace.
 *
 * The publisher room therefore may not let "Terbitkan" be read as a release to
 * SIMPROK at large. These tests pin the sentence that prevents it, and pin the
 * silence about the mechanism that produces it.
 */

const page = readFileSync("src/pages/BasicPricePublicationQueuePage.tsx", "utf8");
/**
 * JSX comments are stripped so an explanation of the OLD wording can never be
 * mistaken for the wording itself, and runs of whitespace are collapsed so a
 * sentence that happens to wrap across two source lines still reads as one
 * sentence. Without the collapse these tests would pin the line breaks rather
 * than the promise, and reformatting the page would turn them red for nothing.
 */
const renderable = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\s+/g, " ");

test("P-1 the room states what publication actually reaches", () => {
  assert.match(renderable, /tersedia untuk digunakan di ruang kerja ini/u);
  assert.match(renderable, /Setelah diterbitkan/u);
});

test("P-2 the confirmation carries the same reach as the promise", () => {
  const handler = page.slice(page.indexOf("const handlePublish"));
  assert.match(
    handler,
    /berhasil diterbitkan dan tersedia untuk digunakan di ruang kerja ini/u,
  );
});

test("P-1b it promises AVAILABILITY, never that the price is now in use", () => {
  // Publication decides eligibility only. Which price a calculation takes is a
  // separate question the eligibility law refuses to answer — resolveAhspResource
  // Price returns NEEDS_REVIEW whenever more than one compatible candidate
  // survives — so "dipakai" / "harga resmi" would be a promise SIMPROK cannot keep.
  assert.doesNotMatch(renderable, /harga resmi/iu);
  assert.doesNotMatch(renderable, /kini dipakai|yang dipakai|sudah dipakai/iu);
  // And the qualifier that keeps it honest must survive.
  assert.match(renderable, /sesuai konteks yang berlaku/u);
});

test("P-3 no claim of SIMPROK-wide or national reach is made", () => {
  // Every one of these would be a promise the architecture cannot keep: there
  // is no writer anywhere that can produce a price belonging to no workspace.
  assert.doesNotMatch(renderable, /nasional|seluruh Indonesia|semua ruang kerja/iu);
  assert.doesNotMatch(renderable, /katalog nasional|katalog SIMPROK|seluruh SIMPROK/iu);
});

test("P-4 the mechanism is never shown to the publisher", () => {
  // Rich inside, simple outside: the publisher needs the reach, never the field.
  assert.doesNotMatch(renderable, /workspaceId|assetScope|verificationStatus/u);
  assert.doesNotMatch(renderable, /SIMPROK_CATALOG|WORKSPACE_PRIVATE|UNPUBLISHED/u);
});

test("P-5 four-eyes is still stated, and still in ordinary words", () => {
  assert.match(renderable, /berbeda dari yang memverifikasi/u);
  assert.doesNotMatch(renderable, /four.?eyes|D-08|VERIFIER_CANNOT_PUBLISH/iu);
});

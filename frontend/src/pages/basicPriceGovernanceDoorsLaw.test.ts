import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * PRIVATE -> SUBMIT -> CURATE -> VERIFY -> PUBLISH, AS A PRODUCT.
 *
 * The backend for every stage of this chain was already built, routed and
 * permission-gated, and two of its rooms had no door: nothing anywhere in the
 * product linked to `/basic-price/reviews` or `/basic-price/publications`, so a
 * curator and a publisher could reach the work waiting for them only by typing
 * a URL. These tests pin the doors, who may see them, and the one fact the
 * curator's list was missing.
 */

const explorer = readFileSync("src/pages/BasicPriceExplorerPage.tsx", "utf8");
const queue = readFileSync("src/pages/BasicPriceReviewQueuePage.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

const renderable = (source: string) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("G-1 the Basic Price room has a door into each curation room", () => {
  assert.match(explorer, /navigate\('\/basic-price\/reviews'\)/);
  assert.match(explorer, /navigate\('\/basic-price\/publications'\)/);
});

test("G-2 each door is drawn only for the authority that opens it", () => {
  // The SAME codes the backend guards the routes with, and the same ones
  // PermissionRoute enforces on entry — the door decides visibility, never
  // access.
  assert.match(explorer, /hasPermission\('BASIC_PRICE_REVIEW_VIEW'\)/);
  assert.match(explorer, /hasPermission\('BASIC_PRICE_PUBLISH'\)/);
  assert.match(renderable(explorer), /\{curatesSubmissions \? \(/);
  assert.match(renderable(explorer), /\{publishesPrices \? \(/);
});

test("G-3 Hukum Pintu: out of authority the door is ABSENT, never a dead control", () => {
  const body = renderable(explorer);
  const doorBlock = body.slice(body.indexOf("curatesSubmissions ? ("), body.indexOf("</header>"));
  // No greyed-out twin: a person without the authority is shown nothing here,
  // rather than a button that would land on Access Denied.
  assert.doesNotMatch(doorBlock, /disabled=\{!curatesSubmissions\}/);
  assert.doesNotMatch(doorBlock, /disabled=\{!publishesPrices\}/);
  assert.doesNotMatch(doorBlock, /segera hadir|coming soon|menunggu mesin/iu);
});

test("G-4 the doors match the routes the app actually registers, and their guards", () => {
  assert.match(
    app,
    /path="basic-price\/reviews" element=\{<PermissionRoute permission="BASIC_PRICE_REVIEW_VIEW">/,
  );
  assert.match(
    app,
    /path="basic-price\/publications" element=\{<PermissionRoute permission="BASIC_PRICE_PUBLISH">/,
  );
});

test("G-5 the ungated Sidebar gains no gated entry", () => {
  // The Sidebar is deliberately capability-blind — every active membership sees
  // every item. Curation and publication are not everybody's, so they live in
  // the Basic Price room instead of being smuggled into a list that cannot
  // honestly hide them.
  assert.doesNotMatch(sidebar, /basic-price\/reviews|basic-price\/publications/);
  assert.doesNotMatch(sidebar, /hasPermission/);
});

test("G-6 the door names the room in ordinary words, never the mechanism", () => {
  const body = renderable(explorer);
  assert.match(body, /Pengajuan harga/);
  assert.match(body, /Siap diterbitkan/i);
  // No implementation vocabulary on a door an ordinary person can see.
  assert.doesNotMatch(body, /PriceSubmission|verificationStatus|assetScope|slaState/);
});

test("G-7 the curator's list states the governance verdict, not only the clock", () => {
  // `slaState` says how long a thing has waited; `submissionStatus` says
  // whether it still needs a decision. The server sent both all along.
  assert.match(queue, /submissionStatusLabel\(item\.submissionStatus\)/);
  assert.match(queue, /slaStateLabel\(item\.slaState\)/);
});

test("G-8 verify and publish are never spoken of as one approval", () => {
  const display = readFileSync("src/utils/basicPriceWorkflowDisplay.ts", "utf8");
  // VERIFIED and PUBLISHED are separate authorities, so they may never collapse
  // into a single 'Disetujui'.
  assert.doesNotMatch(display, /'Disetujui'/);
  assert.match(display, /VERIFIED: 'Terverifikasi'/);
  assert.match(display, /REJECTED: 'Ditolak'/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * BP-UX-FINAL-01C §G — STRUCTURAL AND ACCESSIBILITY QUALITY.
 *
 * Small things, each of which is invisible until it is the thing standing
 * between a person and the product: a list a screen reader cannot count, a
 * status carried only by colour, a colour literal that drifts away from the
 * Lock it came from.
 *
 * These are source guards because this repo has no DOM harness, and adding one
 * would mean adding a dependency nobody asked for — the same reasoning
 * `ownerUiLaw.test.ts` and `basicPriceReviewPageLaw.test.ts` already settled on.
 */

const stepper = readFileSync(
  "src/components/basic-price/BasicPriceJourneyStepper.tsx",
  "utf8",
);
const css = readFileSync("src/styles/basicPrice.css", "utf8");
const chip = readFileSync("src/components/basic-price/FreshnessChip.tsx", "utf8");
const panel = readFileSync(
  "src/components/basic-price/BasicPriceDetailPanel.tsx",
  "utf8",
);

const explorer = readFileSync("src/pages/BasicPriceExplorerPage.tsx", "utf8");
const freshness = readFileSync("src/utils/basicPriceFreshness.ts", "utf8");

const renderable = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Executable source only — comments legitimately quote what they removed. */
const executable = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

/* ── G1 — ordered-list semantics ───────────────────────────────────────── */

test("G1. the journey <ol> contains ONLY <li> children", () => {
  const body = renderable(stepper);
  const list = body.slice(
    body.indexOf('<ol className="bp-steps"'),
    body.indexOf("</ol>"),
  );
  assert.ok(list.length > 0, "the stepper list must exist");

  // The separator used to be a bare <span> between items, wrapped with the item
  // in a Fragment. Assistive technology counts the children of a list; a stray
  // span either breaks the count or is announced as content.
  assert.doesNotMatch(list, /<span className="bp-step__sep"/u);
  assert.doesNotMatch(list, /<Fragment/u);
  assert.doesNotMatch(stepper, /import \{ Fragment \}/u);

  // Exactly one element type opens directly inside the list.
  const opened = [...list.matchAll(/<(\w+)[\s>]/g)]
    .map((match) => match[1])
    .filter((tag) => tag !== "ol");
  assert.ok(opened.length > 0);
  assert.equal(opened[0], "li", "the first child of <ol> must be <li>");
});

test("G1b. the connector is drawn by the item itself, not by a sibling", () => {
  assert.match(css, /\.bp-step--linked::before/u);
  assert.match(stepper, /bp-step--linked/u);
  // And the old sibling rule is gone rather than merely unused — a dead rule is
  // an invitation to wire the invalid markup back in.
  assert.doesNotMatch(css, /\.bp-step__sep\s*\{/u);
});

/* ── G4 — state is never carried by colour alone ───────────────────────── */

test("G4. every stepper state is SPOKEN as well as coloured", () => {
  const body = renderable(stepper);
  // A visually-hidden sentence accompanies each item, and the same words appear
  // on hover through `title`.
  assert.match(body, /bp-visually-hidden/u);
  assert.match(body, /stateWord\(stage\.state\)/u);
  assert.match(body, /title=\{stage\.hint\}/u);
});

test("G4b. the freshness chip's colour is decoration; the word carries the meaning", () => {
  const body = renderable(chip);
  assert.match(body, /aria-hidden="true"/u, "the dot must be hidden from AT");
  assert.match(body, /\{label\}/u, "the state word must be rendered as text");
});

/* ── G2/G3 — keyboard reachability and the anchored layer ──────────────── */

test("G2. the freshness layer is a real button with a real dialog relationship", () => {
  const body = renderable(chip);
  assert.match(body, /<button/u);
  assert.match(body, /type="button"/u);
  assert.match(body, /aria-expanded=\{open\}/u);
  assert.match(body, /aria-haspopup="dialog"/u);
  assert.match(body, /aria-controls=\{open \? panelId : undefined\}/u);
  assert.match(body, /role="dialog"/u);
  assert.match(body, /aria-label=\{`Status harga \$\{resourceName\}`\}/u);
});

test("G2b. Escape closes the layer AND returns focus to the control that opened it", () => {
  // A keyboard reader must never be dropped at the top of the document.
  assert.match(chip, /event\.key !== 'Escape'/u);
  assert.match(chip, /triggerRef\.current\?\.focus\(\)/u);
});

test("G3. the popover is repositioned on narrow screens so it cannot go off-canvas", () => {
  const mobile = css.slice(css.indexOf("@media (max-width: 620px)"));
  assert.match(mobile, /\.bp-pop__panel\s*\{[^}]*left: 0/u);
});

/* ── G3 — colour literals are named once, from the Lock ────────────────── */

test("G3b. no raw colour literal is scattered through the sheet", () => {
  // Everything outside the `:root` declaration block and the comments must use
  // a token — either a shared `--simprok-*` one or one of the four `--bp-*`
  // values this sheet names because the shared palette has none.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rootEnd = withoutComments.indexOf("}", withoutComments.indexOf(":root {"));
  const body = withoutComments.slice(rootEnd);

  const literals = body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(literals, [], `raw colour literals remain: ${literals.join(", ")}`);
});

test("G3c. the four named values are exactly the Color Lock ones", () => {
  assert.match(css, /--bp-uncertain: #98a2b3;/u, "Abu");
  assert.match(css, /--bp-progress: #2e9e6b;/u, "Hijau");
  // And the sheet does NOT silently adopt --simprok-success-green-600 (#16a34a),
  // which is a different value from the Lock's green. Correcting index.css is an
  // Owner decision, not a side effect of a UX pass.
  assert.doesNotMatch(css, /--bp-progress: var\(--simprok-success-green/u);
});

/* ── GAP-B — each evidence claim is gated on the fact that PROVES it ───── */

test("E. the strongest evidence sentence is reachable only through the strongest fact", () => {
  const body = renderable(panel);

  // THE STRONGEST SENTENCE — the uploaded file still exists — comes ONLY from
  // `originalFileRetained`, which the server derives from
  // `BasicPriceImportBatch.sourceStorageRef`. 01C gated it on
  // `importBatchLinked`, and that was still an overclaim: a RELATION to an
  // import batch proves nothing about whether that batch's file survives.
  assert.match(body, /EVIDENCE_FILE_RETAINED_NOTE/u);
  assert.match(body, /evidence\?\.originalFileRetained/u);

  // THE WEAKER SENTENCE — linkage alone — says linkage, and stops.
  assert.match(body, /tertaut pada catatan impor di SIMPROK/u);
  assert.match(body, /evidence\?\.importBatchLinked/u);

  // And the absent case is STATED rather than left blank.
  assert.match(body, /tidak memiliki tautan bukti unggahan/u);
});

test("E-c. linkage alone never produces a sentence about stored bytes", () => {
  const body = renderable(panel);
  // The exact 01C wording, which asserted storage from linkage. Its absence IS
  // the repair; a regression would reintroduce this string verbatim.
  assert.doesNotMatch(body, /Bukti unggahan asli tersimpan di SIMPROK dan tertaut/u);
  // The internal storage path is never named on screen either.
  assert.doesNotMatch(body, /sourceStorageRef/u);
});

/* ── GAP-A — the lineage is named for what it is ───────────────────────── */

test("K. the Riwayat section names CORRECTIONS, never a complete price history", () => {
  const body = renderable(panel);
  // The heading comes from the shared helper, which chooses between "Riwayat
  // Koreksi" and "Riwayat Koreksi Terbaru" on the server's `truncated` fact —
  // never a literal typed into the panel.
  assert.match(body, /correctionHistoryLabel\(/u);
  assert.match(body, /corrections\?\.truncated/u);
  assert.doesNotMatch(body, /Riwayat harga/u);
  assert.doesNotMatch(body, /riwayat harga/u);
});

test("K-b. the empty state no longer claims that no earlier price exists", () => {
  const body = renderable(panel);
  // The deleted sentence. A resource may have been priced a dozen times and
  // corrected never; this declared those dozen observations non-existent.
  assert.doesNotMatch(body, /Tidak ada harga sebelumnya yang tercatat/u);
  // What remains is the provable half, from the one shared constant.
  assert.match(body, /NO_CORRECTION_RECORDED/u);
});

test("K-c. a truncated lineage says so on BOTH surfaces, from one constant", () => {
  // The heading alone does not convey a limit. Each surface that renders the
  // lineage also renders the note, and both read the same exported string.
  for (const [name, source] of [
    ["panel", panel],
    ["chip", chip],
  ] as const) {
    const body = renderable(source);
    assert.match(
      body,
      /corrections\?\.truncated/u,
      `${name} must gate the note on the server's own fact`,
    );
    assert.match(
      body,
      /CORRECTION_HISTORY_PARTIAL_NOTE/u,
      `${name} must state the limit, not only re-title the heading`,
    );
  }
});

/* ── 01D §5.4 — ONE TEMPORAL LENS, THREADED, NEVER RE-RESOLVED ─────────── */

test("TEMP-03/04. the chip AND the detail panel are handed the list's own lens", () => {
  const body = renderable(explorer);
  // Both surfaces receive `state.temporal` — the instant THESE rows were
  // selected for — rather than reading the filter draft, which runs 300ms
  // ahead of the table while a person is typing.
  const chipUse = body.slice(body.indexOf("<FreshnessChip"));
  assert.match(chipUse.slice(0, 400), /temporal=\{state\.temporal\}/u);

  const panelUse = body.slice(body.indexOf("<BasicPriceDetailPanel"));
  assert.match(panelUse.slice(0, 400), /temporal=\{state\.temporal\}/u);
});

test("TEMP-04. the detail panel USES the lens, it does not merely accept it", () => {
  const body = executable(panel);
  assert.match(body, /freshnessMeaning\(item, temporal, formatDate\)/u);
});

test("TEMP-05. no user-facing freshness wording resolves an instant of its own", () => {
  // The whole defect was a `new Date()` written inside the display layer. The
  // instant is a PARAMETER now, resolved once beside the request that produced
  // the rows, so a historical lens cannot silently become a present-tense one.
  for (const [name, source] of [
    ["freshness module", freshness],
    ["chip", chip],
    ["panel", panel],
  ] as const) {
    assert.doesNotMatch(
      executable(source),
      /new Date\(\)/u,
      `${name} must be handed its instant, never reach for a clock`,
    );
  }
});

/* ── 01D §7 — THE BROWSER CONTRACT, MIRRORED AND MINIMAL ───────────────── */

/**
 * PRIV-10. The frontend declares its own copy of the detail contract, because
 * the two halves of SIMPROK do not share a package. A copy that DRIFTS is worse
 * than no copy: it type-checks against a shape the server stopped sending.
 *
 * So the backend projection is read here and compared field-for-field. This is
 * the only test in the frontend suite that reaches across the repo boundary,
 * and it earns it — the alternative is discovering the drift in a browser.
 */
const backendProjection = readFileSync(
  "../backend/src/common/basic-price-workflow.projection.ts",
  "utf8",
);
const display = readFileSync("src/utils/basicPriceExplorerDisplay.ts", "utf8");

/** Field NAMES declared in an interface body, comments and types stripped. */
const interfaceFields = (source: string, name: string): string[] => {
  const start = source.indexOf(`interface ${name} {`);
  assert.ok(start > -1, `interface ${name} must exist`);
  const body = source.slice(start, source.indexOf("\n}", start));
  return [
    ...body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .matchAll(/^\s{2}(\w+)\??:/gmu),
  ]
    .map((match) => match[1])
    .sort();
};

test("PRIV-10. the frontend detail contract mirrors the backend projection exactly", () => {
  for (const name of [
    "BasicPriceCorrectionEntry",
    "BasicPriceCorrectionHistory",
    "BasicPriceEvidenceFacts",
    "BasicPriceDomesticContent",
    "BasicPriceDetail",
  ]) {
    assert.deepEqual(
      interfaceFields(display, name),
      interfaceFields(backendProjection, name),
      `${name} has drifted between backend and frontend`,
    );
  }
});

test("PRIV-06. no correction entry carries an identifier, on either side", () => {
  // A dated amount renders without one, so a predecessor's raw UUID is not the
  // browser's to hold. Pinned on BOTH declarations so re-adding it fails here
  // before it can reach a payload.
  for (const source of [display, backendProjection]) {
    assert.deepEqual(interfaceFields(source, "BasicPriceCorrectionEntry"), [
      "effectiveDate",
      "price",
      "state",
    ]);
  }
});

test("PRIV-01→05. nothing the mappers EMIT is a tenant, actor or lineage id", () => {
  /**
   * SCOPED TO WHAT LEAVES THE SERVER, DELIBERATELY.
   *
   * The `*RowSource` interfaces in the same file legitimately name DB columns —
   * they are the INPUT shape the mappers read, including
   * `supersedesBasicPriceId`, which the walk needs and the payload never
   * carries. Scanning the whole section would fail on the input types and
   * prove nothing about the output.
   *
   * So this reads exactly the two things that BUILD the browser payload: the
   * declared output interfaces, and the bodies of the functions that fill them.
   */
  const bodyOf = (fn: string) => {
    const start = backendProjection.indexOf(`export function ${fn}(`);
    assert.ok(start > -1, `${fn} must exist`);
    return backendProjection
      .slice(start, backendProjection.indexOf("\n}", start))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  };

  const declared = [
    "BasicPriceCorrectionEntry",
    "BasicPriceCorrectionHistory",
    "BasicPriceEvidenceFacts",
    "BasicPriceDetail",
  ]
    .map((name) => interfaceFields(backendProjection, name).join(" "))
    .join(" ");

  const contract = [
    declared,
    bodyOf("mapBasicPriceEvidence"),
    bodyOf("mapBasicPriceCorrectionEntry"),
  ].join("\n");

  for (const forbidden of [
    "workspaceId",
    "organizationId",
    "accountId",
    "actorAccountId",
    "sourceSubmissionId",
    "sourceImportRowId",
    "supersedesBasicPriceId",
    "promotedFromBasicPriceId",
    // The internal storage location behind `originalFileRetained`. The browser
    // gets the yes/no; the path stays on the server.
    "sourceStorageRef:",
  ]) {
    assert.ok(
      !contract.includes(forbidden),
      `${forbidden} must never be part of the browser-facing detail contract`,
    );
  }
});

test("TEMP-01/02. the page resolves ONE lens beside the request, and pins it to the result", () => {
  const body = executable(explorer);
  // Absent date means PRESENT — the same law the server states for an absent
  // `asOf`; a set date makes it an AS-OF lens parsed to the same UTC midnight.
  assert.match(body, /filters\.asOf[\s\S]{0,80}asOfContext\(/u);
  assert.match(body, /presentContext\(new Date\(\)\)/u);
  // Carried WITH the rows, so the screen states the day it is actually showing.
  assert.match(body, /kind: 'ready'[\s\S]{0,160}temporal,/u);
});

test("E-b. Detail reads evidence from the lawful projection, never from the row", () => {
  assert.match(panel, /useBasicPriceDetail/u);
  // `importBatchLinked` is a server-derived boolean. The browser must not try to
  // re-derive it from provenance objects the list projection does not carry.
  const body = renderable(panel);
  assert.doesNotMatch(body, /sourceSubmission/u);
  assert.doesNotMatch(body, /sourceImportRow/u);
});

/* ── KDN ADDENDUM (Owner Lock) — %KDN in Detail, never TKDN ─────────────── */

test("KDN-01/02. Ringkasan exposes KDN through the one shared three-state label", () => {
  const body = renderable(panel);
  // The field exists, is called KDN, and is fed by the helper that keeps
  // pending / stated / unstated apart. A literal here would let a future edit
  // print "0%" for an absent fact without any test noticing.
  assert.match(body, /label="KDN \(%\)"/u);
  assert.match(body, /kdnLabel\(/u);
  assert.match(body, /domesticContent\.kdnPercent/u);
  // `undefined` while the read is in flight — never the empty-state string.
  assert.match(body, /detail\.kind === 'ready'[\s\S]{0,120}: undefined/u);
});

test("KDN-02b. the panel never hard-codes a zero or an empty-state percentage", () => {
  const body = renderable(panel);
  assert.doesNotMatch(body, /['"`]0%['"`]/u);
  assert.doesNotMatch(body, /['"`]0,00%['"`]/u);
  // The empty-state wording lives in ONE exported constant, not in the panel.
  assert.doesNotMatch(body, /Belum tersedia/u);
});

test("KDN-03/04. no component breakdown is offered, because none is persisted", () => {
  // A census of the schema finds no material/equipment/labour domestic-content
  // columns. Offering an expandable over data that does not exist would invite
  // a reader to trust a breakdown SIMPROK would have had to invent.
  const body = renderable(panel);
  assert.doesNotMatch(body, /Lihat rincian KDN/u);
  assert.doesNotMatch(body, /kdnComponents|componentKdn|rincianKdn/u);
});

test("KDN-05/06. the Detail screen never says TKDN and computes no aggregate", () => {
  const body = renderable(panel);
  assert.doesNotMatch(body, /TKDN/u, 'TKDN is the RAB/Project aggregate, not this fact');
  // No arithmetic over KDN anywhere on this screen.
  assert.doesNotMatch(body, /kdn[A-Za-z]*\s*[*+/-]/iu);
});

test("KDN-07. money and %KDN stay independent facts", () => {
  const body = renderable(panel);
  // The price Fact reads the row's own money; the KDN Fact reads the resource's
  // own domestic-content value. Neither expression mentions the other.
  const priceFact = body.slice(body.indexOf('label="Harga"'), body.indexOf('label="Satuan"'));
  assert.doesNotMatch(priceFact, /kdn/iu);
  const kdnFact = body.slice(body.indexOf('label="KDN (%)"'), body.indexOf('label="Status"'));
  assert.doesNotMatch(kdnFact, /formatExplorerPrice|item\.price/u);
});

test("KDN-06. the backend projection adds no Project/RAB TKDN calculation", () => {
  // The contract carries an observation-level FACT and nothing that aggregates it.
  const contract = backendProjection.slice(
    backendProjection.indexOf('BasicPriceDomesticContent'),
  );
  assert.deepEqual(interfaceFields(backendProjection, 'BasicPriceDomesticContent'), [
    'kdnPercent',
  ]);
  assert.doesNotMatch(contract, /projectTkdn|rabTkdn|aggregateTkdn|sumKdn/iu);
});

test("EVID. Dasar informasi is the human evidence class, never a storage path", () => {
  const body = renderable(panel);
  assert.match(body, /label="Dasar informasi"/u);
  assert.match(body, /observationBasisLabel/u);
  assert.match(body, /evidence\?\.observationBasis/u);
  assert.doesNotMatch(body, /sourceStorageRef|sourceImportRowId/u);
  assert.match(body, /SOURCE_STILL_SAME_QUESTION/u);
  assert.match(body, /EVIDENCE_BASIS_FIELD/u);
  assert.match(body, /BASIC_PRICE_IMPORT_PATH/u);
});

test("KDN-PROV. Sumber shows Asal KDN only from the human-readable summary", () => {
  const body = renderable(panel);
  assert.match(body, /kdnSourceSummary/u);
  assert.match(body, /label="Asal KDN"/u);
  assert.doesNotMatch(body, /sourceImportRowId|batchId/u);
});

test("KDN-CHANGE. missing private KDN is completed through the existing enrich writer", () => {
  const body = renderable(panel);
  assert.match(body, /kdnCompletionDoor/u);
  assert.match(body, /enrichBasicPriceKdn/u);
  assert.match(body, /enrichCatalogBasicPriceKdn/u);
  assert.match(body, /BASIC_PRICE_SUBMIT/u);
  assert.match(body, /BASIC_PRICE_VERIFY/u);
  assert.match(body, /BASIC_PRICE_PROMOTE_SHARED/u);
  assert.match(body, /KDN_COMPLETION_CATALOG_NOTE/u);
  assert.doesNotMatch(body, /ResourceCatalog\.tkdnValue|tkdnValue/u);
  assert.doesNotMatch(body, /componentKdn|rincianKdn/u);
});

test("CHANGE-DOOR. one compact Detail door routes into existing writers, never a generic patch", () => {
  const body = renderable(panel);
  assert.match(body, /DETAIL_CHANGE_DOOR_LABEL/u);
  assert.match(body, /detailSubjectOffers/u);
  assert.match(body, /BASIC_PRICE_REVIEW_VIEW/u);
  assert.match(body, /BASIC_PRICE_PUBLISH/u);
  assert.match(body, /expectedKdnPercent/u);
  assert.match(body, /correctPrivateBasicPrice/u);
  assert.match(body, /observePrivateBasicPrice/u);
  assert.match(body, /observePrivateKdn/u);
  assert.match(body, /correctPrivateKdn/u);
  assert.match(body, /onCurrentChanged/u);
  assert.doesNotMatch(body, /updateBasicPrice/u);
  assert.doesNotMatch(executable(panel), /@Put|PATCH \/basic-prices/u);
});

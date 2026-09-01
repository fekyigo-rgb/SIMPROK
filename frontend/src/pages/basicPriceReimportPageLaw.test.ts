import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * SMART RE-IMPORT — the import page must render the server's decision, not
 * invent a second matcher, and must not print identity internals.
 */

const page = readFileSync("src/pages/BasicPriceImportPage.tsx", "utf8");
const body = page.slice(page.indexOf("export function BasicPriceImportPage"));
const renderable = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("the page reads the server's reimport relation and does not classify locally", () => {
  assert.match(page, /reimportDecisionView/);
  assert.doesNotMatch(page, /EXACT_EXISTING/);
  assert.doesNotMatch(page, /INTERPRETATION_UPDATE/);
  assert.doesNotMatch(page, /SOURCE_UPDATE/);
  assert.doesNotMatch(renderable, /importFingerprint/);
});

test("ordinary-user actions are the two product verbs, never Replace-as-delete", () => {
  assert.match(page, /reimportView\.primary\.label/);
  assert.match(page, /reimportSecondary\.label/);
  assert.match(page, /USE_EXISTING/);
  assert.match(page, /reimportActionPath/);
  assert.doesNotMatch(renderable, /Hapus batch|Overwrite|SUPERSEDED/);
});

test("UX-6 the second action is rendered only when the view actually offers one", () => {
  // An exact replay sets `secondary` to null, and the card must then show one
  // button rather than a disabled or decorative twin of the first. The removed
  // control also led somewhere this card had no right to send anyone: past the
  // metadata gate, into a room BASIC_PRICE_IMPORT alone cannot open.
  assert.match(renderable, /\{reimportSecondary \? \(/);
  assert.doesNotMatch(renderable, /Lihat impor sebelumnya/);
  assert.doesNotMatch(page, /VIEW_EXISTING/);
});

test("UX-2 the click leaves announced proof, and the next action is on the same screen", () => {
  assert.match(renderable, /usedExistingNotice \? <p aria-live="polite">\{USED_EXISTING_CONFIRMATION\}<\/p>/);
  assert.match(renderable, /Lanjut ke Peninjauan Baris/);
});

test("UX-5 no re-import action reaches past the batch's own room", () => {
  const handlerStart = body.indexOf("const handleReimportAction");
  const handler = body.slice(handlerStart, body.indexOf("return (", handlerStart));
  // The only /review navigation on this page is the gated door inside the
  // batch card, never a re-import decision.
  assert.doesNotMatch(handler, /\/review/);
});

test("identity internals are not rendered as copy", () => {
  assert.doesNotMatch(renderable, /\{batch\.importFingerprint\}/);
  assert.doesNotMatch(renderable, />\s*\{batch\.batchId\}\s*</);
  assert.doesNotMatch(renderable, /sourceSha256/);
  assert.doesNotMatch(renderable, /parserContract/);
});

test("UX-1 USE_EXISTING is a navigation of the server batch, never a second upload", () => {
  const handlerStart = body.indexOf("const handleReimportAction");
  const handler = body.slice(handlerStart, body.indexOf("return (", handlerStart));
  assert.match(page, /reimportActionPath/);
  assert.match(page, /USED_EXISTING_CONFIRMATION/);
  assert.doesNotMatch(handler, /previewBasicPriceImport|updateBasicPriceImportBatch/);
});

test("UX-3 the handler never searches history or recomputes an existing batch", () => {
  const handlerStart = body.indexOf("const handleReimportAction");
  const handler = body.slice(handlerStart, body.indexOf("return (", handlerStart));
  assert.match(handler, /reimportActionPath\(action, relation\)/);
  assert.doesNotMatch(handler, /findOwned|sourceSha256|siblings/);
});

test("BP-KDN-01 the KDN mapping question is non-blocking and never fail-stops price import", () => {
  assert.match(page, /kdnMappingQuestionOf/);
  assert.match(page, /selectedKdnColumn/);
  const handlerStart = body.indexOf("const handleAnswer");
  const handler = body.slice(handlerStart, body.indexOf("const handleSaveMetadata"));
  assert.match(handler, /key === 'selectedKdnColumn' && value === 'none'/);
  assert.match(handler, /setQuestion\(null\)/);
});

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  reimportDecisionView,
  reimportActionPath,
  USED_EXISTING_CONFIRMATION,
  type ReimportRelation,
} from "./basicPriceImportDisplay.ts";

const EXACT: ReimportRelation = {
  classification: "EXACT_EXISTING",
  existingBatchId: "owned-existing",
  updateBatchId: null,
  difference: "NONE",
};

const READING: ReimportRelation = {
  classification: "INTERPRETATION_UPDATE",
  existingBatchId: "owned-existing",
  updateBatchId: "owned-update",
  difference: "READING",
};

const SOURCE: ReimportRelation = {
  classification: "SOURCE_UPDATE",
  existingBatchId: "owned-existing",
  updateBatchId: "owned-update",
  difference: "SOURCE_CONTENT",
};

const forbidden = /fingerprint|sha-?256|digest|parser|database|batch id|UUID/iu;

test("R-1 EXACT: already identical, skip is primary, no fabricated diff", () => {
  const view = reimportDecisionView(EXACT);
  assert.ok(view);
  assert.equal(view.kind, "ALREADY_IDENTICAL");
  assert.equal(view.title, "Data ini sudah pernah diimpor.");
  // BP-VISUAL-TRUTH-07 §22 — the body no longer repeats the heading; it carries
  // only what the heading cannot say, which is what continuing would do.
  assert.doesNotMatch(view.body, /sudah pernah diimpor/u);
  assert.match(view.body, /Tidak ada perubahan yang terdeteksi/u);
  assert.equal(view.primary.action, "USE_EXISTING");
  assert.equal(view.primary.label, "Gunakan yang sudah ada");
  assert.equal(view.secondary, null);
  assert.equal(view.differenceNote, null);
  assert.doesNotMatch(view.body, forbidden);
  assert.doesNotMatch(view.title, forbidden);
});

test("R-2 INTERPRETATION_UPDATE: one decision, reading difference only", () => {
  const view = reimportDecisionView(READING);
  assert.ok(view);
  assert.equal(view.kind, "UPDATE_DETECTED");
  assert.equal(view.primary.action, "USE_UPDATE");
  assert.equal(view.primary.label, "Gunakan pembaruan ini");
  assert.equal(view.secondary?.action, "USE_EXISTING");
  assert.equal(view.secondary?.label, "Gunakan yang sudah ada");
  // §22 — the chip names the AXIS; the body keeps the explanation.
  assert.equal(view.differenceNote, "Perbedaan: cara pembacaan");
  assert.match(view.body, /cara pembacaannya sekarang berbeda/u);
  assert.equal(view.historyNote, "Data sebelumnya tetap tersimpan sebagai riwayat.");
  assert.doesNotMatch(view.body, /27|3 resources|harga berubah/u);
  assert.doesNotMatch(`${view.title}${view.body}${view.differenceNote}`, forbidden);
});

test("R-7 SOURCE_UPDATE copy names different source content, never a filename", () => {
  const view = reimportDecisionView(SOURCE);
  assert.ok(view);
  assert.equal(view.differenceNote, "Perbedaan: isi sumber");
  assert.match(view.body, /isi data sekarang berbeda/u);
  assert.doesNotMatch(view.body, /nama berkas|filename|\.xlsx/iu);
});

test("R-6 NEW_OR_UNPROVEN asks no decision", () => {
  assert.equal(
    reimportDecisionView({
      classification: "NEW_OR_UNPROVEN",
      existingBatchId: null,
      updateBatchId: null,
      difference: null,
    }),
    null,
  );
  assert.equal(reimportDecisionView(null), null);
  assert.equal(reimportDecisionView(undefined), null);
});

test("the view function has no filename parameter — filename is not identity", () => {
  assert.equal(reimportDecisionView.length, 1);
});

test("UX-1 USE_EXISTING opens the server-named existing batch, never another sibling", () => {
  const path = reimportActionPath("USE_EXISTING", {
    existingBatchId: "owned-existing",
    updateBatchId: "owned-update",
  });
  assert.equal(path, "/basic-price/import/owned-existing");
  assert.doesNotMatch(path ?? "", /owned-update/);
});

test("UX-2 USE_EXISTING is a real destination, not a same-card no-op", () => {
  const path = reimportActionPath("USE_EXISTING", EXACT);
  assert.ok(path);
  assert.match(path, /^\/basic-price\/import\/owned-existing$/);
  assert.equal(USED_EXISTING_CONFIRMATION, "Data yang sudah ada digunakan. Tidak ada impor baru dibuat.");
  assert.doesNotMatch(USED_EXISTING_CONFIRMATION, forbidden);
});

test("UX-3 frontend does not pick a historical sibling of its own", () => {
  const otherHistorical = "some-other-sibling";
  const path = reimportActionPath("USE_EXISTING", {
    existingBatchId: EXACT.existingBatchId,
    updateBatchId: otherHistorical,
  });
  assert.equal(path, `/basic-price/import/${EXACT.existingBatchId}`);
  assert.doesNotMatch(path ?? "", new RegExp(otherHistorical));
});

test("UX-6 an exact replay offers ONE action — no second label for the same batch", () => {
  const view = reimportDecisionView(EXACT);
  assert.ok(view);
  // One existing batch, one decision. A second control here could only send
  // the reader to the same batch by a different door.
  assert.equal(view.secondary, null);
  assert.equal(reimportActionPath(view.primary.action, EXACT), "/basic-price/import/owned-existing");
});

test("UX-6b an update keeps two actions, because it names two different batches", () => {
  for (const relation of [READING, SOURCE]) {
    const view = reimportDecisionView(relation);
    assert.ok(view);
    assert.ok(view.secondary);
    const primary = reimportActionPath(view.primary.action, relation);
    const secondary = reimportActionPath(view.secondary.action, relation);
    assert.equal(primary, "/basic-price/import/owned-update");
    assert.equal(secondary, "/basic-price/import/owned-existing");
    assert.notEqual(primary, secondary);
  }
});

test("UX-6c every offered action lands on the batch's own room, never past a gate", () => {
  // /basic-price/import/:batchId is gated by BASIC_PRICE_IMPORT — the authority
  // the uploader necessarily holds — and it is where the metadata gate decides
  // whether the review room may open. No re-import action may skip it.
  for (const relation of [EXACT, READING, SOURCE]) {
    const view = reimportDecisionView(relation);
    assert.ok(view);
    const offered = [view.primary, view.secondary].filter((a) => a !== null);
    for (const action of offered) {
      const path = reimportActionPath(action.action, relation);
      assert.ok(path);
      assert.match(path, /^\/basic-price\/import\/[a-z-]+$/u);
      assert.doesNotMatch(path, /\/review$/u);
    }
  }
});

test("a missing server target produces no invented path", () => {
  assert.equal(
    reimportActionPath("USE_EXISTING", {
      existingBatchId: null,
      updateBatchId: "owned-update",
    }),
    null,
  );
});

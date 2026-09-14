import assert from "node:assert/strict";
import test from "node:test";
import {
  NETWORK_FAILURE,
  describeBulkDelete,
  describeBulkPropose,
  explainAhspFailure,
  explainStatus,
  failureLines,
  nothingSavedNote,
  placeOutcomes,
  readApiFailure,
  withOutcome,
  type AnchoredOutcome,
} from "./ahspActionFeedback.ts";
import { USULKAN_MODAL_BODY_2 } from "./ahspProposalCopy.ts";

/**
 * ACG-01 OWNER BROWSER GAP — FINDING C. After an action a person must know it
 * was received, whether it saved, why not, and what to do — and see it where
 * they pressed. Nothing is claimed that the server did not answer.
 */

const fakeResponse = (status: number, body: unknown) => ({
  status,
  json: async () => {
    if (body instanceof Error) throw body;
    return body;
  },
});

test("C1: the server's own refusal code is read, and an unreadable body invents none", async () => {
  assert.deepEqual(
    await readApiFailure(fakeResponse(409, { statusCode: 409, message: "OBSERVATION_ALREADY_DECIDED", error: "Conflict" })),
    { status: 409, code: "OBSERVATION_ALREADY_DECIDED" },
  );
  assert.deepEqual(await readApiFailure(fakeResponse(500, new Error("not json"))), { status: 500, code: null });
  assert.deepEqual(await readApiFailure(fakeResponse(400, { message: ["a", "b"] })), { status: 400, code: null });
});

test("C2: a status alone yields only the category it really means", () => {
  assert.match(explainStatus({ status: 401, code: null }, "x").reason ?? "", /Sesi/u);
  assert.equal(explainStatus({ status: 403, code: null }, "DILARANG").reason, "DILARANG");
  assert.match(explainStatus({ status: 503, code: null }, "x").reason ?? "", /server/u);
  // An unexplained 4xx gets no invented reason — only a next step.
  const unknown = explainStatus({ status: 422, code: null }, "x");
  assert.equal(unknown.reason, null);
  assert.ok(unknown.next.length > 0);
  assert.match(explainStatus(NETWORK_FAILURE, "x").reason ?? "", /Sambungan/u);
});

test("C3: a failure always says what was saved, then why (if known), then what next", () => {
  const lines = failureLines("Gagal.", "Tidak ada perubahan yang tersimpan.", { reason: "Karena X.", next: "Coba lagi." });
  assert.deepEqual(lines.map((line) => line.tone), ["FAILURE", "NOTE", "NOTE", "NOTE"]);
  assert.deepEqual(
    failureLines("Gagal.", "Tidak ada.", { reason: null, next: "Coba lagi." }).map((line) => line.text),
    ["Gagal.", "Tidak ada.", "Coba lagi."],
  );
  // A lost connection is not told "nothing was saved" — that is not known.
  assert.match(nothingSavedNote(NETWORK_FAILURE), /Belum dapat dipastikan/u);
  assert.equal(nothingSavedNote({ status: 409, code: null }), "Tidak ada perubahan yang tersimpan.");
});

const outcome = (key: string, at: number): AnchoredOutcome => ({
  key,
  at,
  title: "Item " + key,
  outcome: { kind: "SUCCESS", lines: [{ tone: "SUCCESS", text: "ok" }] },
});

test("C4: a decided item's receipt takes the place the item had, so the reader's place never jumps", () => {
  // g1 was decided at position 1 and left the refreshed list.
  const placed = placeOutcomes(["g0", "g2", "g3"], (k) => k, [outcome("g1", 1)]);
  assert.deepEqual(
    placed.map((entry) => (entry.kind === "ITEM" ? entry.item : "receipt:" + entry.outcome.key)),
    ["g0", "receipt:g1", "g2", "g3"],
  );
  // An item still present carries its outcome beneath it instead.
  const attached = placeOutcomes(["g0", "g1"], (k) => k, [outcome("g1", 1)]);
  assert.equal(attached[1].kind, "ITEM");
  assert.equal(attached[1].kind === "ITEM" ? attached[1].outcome?.key : null, "g1");
  // Several receipts keep their own positions; a far one lands at the end.
  const many = placeOutcomes(["a"], (k) => k, [outcome("x", 9), outcome("y", 0)]);
  assert.deepEqual(
    many.map((entry) => (entry.kind === "ITEM" ? entry.item : entry.outcome.key)),
    ["y", "a", "x"],
  );
  // A newer outcome for the same item replaces the older one.
  assert.equal(withOutcome([outcome("g1", 1)], outcome("g1", 4)).length, 1);
});

test("C5: bulk Usulkan counts what the server accepted, and never calls a proposal an acceptance", () => {
  const done = describeBulkPropose({ succeeded: 3, failed: 0, notApplicable: 0, failure: null });
  assert.equal(done.kind, "SUCCESS");
  assert.match(done.lines[0].text, /3 AHSP berhasil diusulkan/u);
  assert.ok(done.lines.some((line) => line.text === USULKAN_MODAL_BODY_2));

  const partial = describeBulkPropose({
    succeeded: 1,
    failed: 2,
    notApplicable: 1,
    failure: { status: 403, code: "This AHSP has already been proposed and is under review." },
  });
  assert.equal(partial.kind, "PARTIAL");
  const texts = partial.lines.map((line) => line.text);
  assert.ok(texts.includes("2 AHSP belum berhasil diusulkan."));
  assert.ok(texts.includes("AHSP ini sudah diusulkan dan sedang ditinjau."));
  assert.ok(texts.some((text) => /1 AHSP terpilih tidak diusulkan/u.test(text)));
  // The English policy sentence never reaches the reader.
  assert.ok(!texts.some((text) => /already been proposed/u.test(text)));

  const failed = describeBulkDelete({ succeeded: 0, failed: 1, notApplicable: 0, failure: NETWORK_FAILURE });
  assert.equal(failed.kind, "FAILURE");
  assert.ok(!failed.lines.some((line) => line.tone === "SUCCESS"));
});

test("C6: an unknown AHSP refusal is not given a made-up reason", () => {
  assert.equal(explainAhspFailure({ status: 409, code: "SOMETHING_NEW" }).reason, null);
  assert.match(explainAhspFailure({ status: 403, code: "Something else" }).reason ?? "", /tidak diizinkan/u);
});

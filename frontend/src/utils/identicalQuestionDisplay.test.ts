import assert from "node:assert/strict";
import test from "node:test";
import {
  IQL_COPY,
  describeGovernanceFailure,
  describeGovernedQuestion,
  groupCanRemember,
  identicalQuestionLine,
  isGovernedQuestionShown,
  looksLikeInternalIdentifier,
  type CuratableObservationWire,
  type GovernedQuestionWire,
} from "./resourceObservationDisplay.ts";

/**
 * IQL-01 — the reader must always be able to tell three facts apart: a row was
 * decided; that decision was OFFERED as learning; the learning was APPROVED and
 * may be reused. A person offers, another person approves — the page never
 * pretends otherwise.
 */

test("the three facts are three different sentences", () => {
  assert.equal(IQL_COPY.rowDecided, "Keputusan baris ini sudah dibuat.");
  assert.equal(IQL_COPY.pending, "Keputusan ini sedang diajukan sebagai pembelajaran — menunggu persetujuan.");
  assert.equal(IQL_COPY.effective, "Pembelajaran ini sudah disetujui dan dapat digunakan kembali.");
  assert.equal(new Set([IQL_COPY.rowDecided, IQL_COPY.pending, IQL_COPY.effective]).size, 3);
  assert.match(IQL_COPY.remember, /persis sama/);
  assert.match(IQL_COPY.remember, /persetujuan orang lain/);
});

test("an open row names its exact-question state honestly, and says nothing when there is none", () => {
  assert.equal(identicalQuestionLine(null), null);
  assert.equal(identicalQuestionLine({ state: "NONE" }), null);
  assert.equal(
    identicalQuestionLine({ state: "PENDING", pendingAnswerName: "Kerikil / Agregat" }),
    IQL_COPY.pending + " Usulan: Kerikil / Agregat.",
  );
  assert.equal(identicalQuestionLine({ state: "INAPPLICABLE" }), IQL_COPY.inapplicable);
  assert.equal(identicalQuestionLine({ state: "REJECTED" }), IQL_COPY.rejected);
  assert.equal(identicalQuestionLine({ state: "REVOKED" }), IQL_COPY.revoked);
});

test("learning is offered for a grouped decision only when EVERY row carries its own signed context", () => {
  const row = (id: string, rememberable: boolean, token: string | null): CuratableObservationWire => ({
    id,
    rawName: "Agregat kasar",
    identicalQuestion: { state: "NONE", rememberable, decisionContextToken: token },
  });
  assert.equal(groupCanRemember([row("a", true, "t1"), row("b", true, "t2")]), true);
  assert.equal(groupCanRemember([row("a", true, "t1"), row("b", false, null)]), false);
  assert.equal(groupCanRemember([row("a", true, "")]), false);
  assert.equal(groupCanRemember([undefined]), false);
  assert.equal(groupCanRemember([]), false);
});

const governed = (over: Partial<GovernedQuestionWire> = {}): GovernedQuestionWire => ({
  questionKey: "k".repeat(64),
  rawName: "Agregat kasar",
  rawCode: "M03",
  rawUnit: "M3",
  state: "PENDING",
  answer: { resourceCatalogId: "6f2b1c4a-9d3e-4a71-b8c2-5e7f0a1d2b3c", name: "Kerikil / Agregat" },
  authoredByYou: false,
  canApprove: true,
  canReject: true,
  canRevoke: false,
  decisionContextToken: "signed",
  ...over,
});

test("a pending question shows the exact question, the proposed answer, and gold 'Menunggu persetujuan'", () => {
  const view = describeGovernedQuestion(governed());
  assert.equal(view.title, "Agregat kasar (M3) · kode M03");
  assert.equal(view.answerLine, "Padanan: Kerikil / Agregat");
  assert.equal(view.stateLabel, "Menunggu persetujuan");
  assert.equal(view.tone, "PENDING");
  assert.equal(view.canApprove, true);
  assert.equal(view.canReject, true);
});

test("the author NEVER gets an approve door, even if one were offered by mistake", () => {
  const view = describeGovernedQuestion(governed({ authoredByYou: true, canApprove: true }));
  assert.equal(view.canApprove, false);
  assert.match(view.guidance, /orang lain yang berwenang/);
});

test("no signed context means no door at all — never a door that lands nowhere", () => {
  const view = describeGovernedQuestion(governed({ decisionContextToken: null }));
  assert.equal(view.canApprove, false);
  assert.equal(view.canReject, false);
  assert.equal(view.canRevoke, false);
});

test("an effective question reads as approved and reusable, in navy; revoke is its only door", () => {
  const view = describeGovernedQuestion(
    governed({ state: "EFFECTIVE", canApprove: false, canReject: false, canRevoke: true }),
  );
  assert.equal(view.stateLabel, "Disetujui — dapat digunakan kembali");
  assert.equal(view.tone, "EFFECTIVE");
  assert.equal(view.guidance, IQL_COPY.effective);
  assert.equal(view.canRevoke, true);
  assert.equal(view.canApprove, false);
});

test("only pending, effective and inapplicable questions are listed; history stays on the server", () => {
  assert.equal(isGovernedQuestionShown(governed({ state: "PENDING" })), true);
  assert.equal(isGovernedQuestionShown(governed({ state: "EFFECTIVE" })), true);
  assert.equal(isGovernedQuestionShown(governed({ state: "INAPPLICABLE" })), true);
  assert.equal(isGovernedQuestionShown(governed({ state: "REJECTED" })), false);
  assert.equal(isGovernedQuestionShown(governed({ state: "REVOKED" })), false);
});

test("reader-facing copy never leaks an id or a reason code", () => {
  for (const state of ["PENDING", "EFFECTIVE", "INAPPLICABLE"]) {
    const view = describeGovernedQuestion(governed({ state }));
    for (const text of [view.title, view.answerLine ?? "", view.stateLabel, view.guidance]) {
      assert.equal(looksLikeInternalIdentifier(text), false, text);
    }
  }
  for (const text of Object.values(IQL_COPY)) assert.equal(looksLikeInternalIdentifier(text), false, text);
});

// ---------------------------------------------------------------------------
// GAP B — A PENDING TAUGHT UNDER A SUPERSEDED RULE.
//
// The server does not offer APPROVE for it, because approving could never make
// it effective. The reader must see the door shut AND the way out — otherwise
// the button simply vanishes and the page looks broken rather than honest.
// Shape taken from the real cohort: "Stamper" / E25 / Jam, taught under V1.
// ---------------------------------------------------------------------------

test("GAP-B: a pending taught under a superseded rule says so, and names REJECT as the way out", () => {
  const view = describeGovernedQuestion(
    governed({
      rawName: "Stamper",
      rawCode: "E25",
      rawUnit: "Jam",
      state: "PENDING",
      canApprove: false,
      canReject: true,
      approvalBlockedReason: "CANDIDATE_POLICY_SUPERSEDED",
    }),
  );
  assert.equal(view.canApprove, false);
  // REJECT is the lawful exit and must stay open.
  assert.equal(view.canReject, true);
  assert.equal(view.stateLabel, "Menunggu — aturannya sudah berubah");
  assert.match(view.guidance, /aturan penetapan identitas masih berbeda/u);
  assert.match(view.guidance, /Tolak usulan ini/u);
  assert.match(view.guidance, /ajukan ulang/u);
  // Never the ordinary "approve if correct" instruction for a door that is shut.
  assert.doesNotMatch(view.guidance, /setujui bila benar/u);
  // No internal vocabulary reaches the reader.
  for (const word of ["CANDIDATE_POLICY_SUPERSEDED", "policy", "V1", "V2"]) {
    assert.ok(!view.guidance.includes(word), word);
  }
});

test("GAP-B: an ordinary pending is unchanged — the new sentence does not leak", () => {
  const view = describeGovernedQuestion(governed());
  assert.equal(view.stateLabel, "Menunggu persetujuan");
  assert.match(view.guidance, /setujui bila benar/u);
  assert.doesNotMatch(view.guidance, /aturan penetapan identitas/u);
  assert.equal(view.canApprove, true);
});

test("GAP-B: even a server that wrongly offered canApprove gets no door once the rule is superseded", () => {
  // Belt and braces: the view refuses the door the server said it could not have.
  const view = describeGovernedQuestion(
    governed({ canApprove: true, approvalBlockedReason: "CANDIDATE_POLICY_SUPERSEDED" }),
  );
  assert.match(view.guidance, /Tolak usulan ini/u);
  assert.equal(view.canReject, true);
});

test("GAP-B: the superseded-policy refusal has its OWN words — never the generic authority fallback", () => {
  const outcome = describeGovernanceFailure({ status: 409, code: "CANDIDATE_POLICY_SUPERSEDED" });
  const text = outcome.lines.map((line) => line.text).join(" ");
  assert.match(text, /aturan penetapan identitas masih berbeda/u);
  assert.match(text, /Tolak pengajuan ini/u);
  // It must NOT accuse the reader of something that did not happen…
  assert.doesNotMatch(text, /wewenang/u);
  // …nor advise a reload, which would change nothing here.
  assert.doesNotMatch(text, /[Mm]uat ulang/u);
  // Nothing was written, and that is said.
  assert.match(text, /belum berhasil disimpan|tidak ada yang tersimpan|Tidak ada perubahan/u);
  for (const word of ["CANDIDATE_POLICY_SUPERSEDED", "policy", "V1", "V2"]) {
    assert.ok(!text.includes(word), word);
  }
});

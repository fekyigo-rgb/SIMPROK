import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  importRequestMessage,
  isIntakeRefusalCode,
} from "./basicPriceIntakeErrors.ts";

/** The backend's own vocabulary file, read so the two cannot drift apart. */
const declaredIntakeCodes = (): string[] => {
  const source = readFileSync(
    "../backend/src/universal-intake/intake-errors.ts",
    "utf8",
  );
  return [
    ...source.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*'([A-Z0-9_]+)',?$/gm),
  ].map((match) => match[2]);
};

/**
 * IntakeQuestion.tsx is a React component and cannot be imported by this
 * runner, so its COVERAGE is asserted against its source — the same convention
 * ownerUiLaw.test.ts already uses for page-level laws. What matters is
 * structural and is exactly what the source shows: does this code have a
 * `case` of its own, or does it fall to the generic ending?
 */
const intakeQuestionSource = readFileSync(
  "src/components/basic-price/IntakeQuestion.tsx",
  "utf8",
);
const hasOwnCase = (code: string): boolean =>
  intakeQuestionSource.includes(`case '${code}':`) ||
  intakeQuestionSource.includes(`case '${code}': {`);

/**
 * THE OWNER'S DEAD END, PINNED.
 *
 * The Basic Price import door failed for a reason no test could have caught,
 * because every test asked the backend and the backend was right. The defect
 * lived in how the BROWSER read a failure: `parseOrThrow` treated any string
 * `message` as a named intake refusal, so Nest's `{"message":"Forbidden
 * resource"}` became an "intake code", matched no question and no sentence, and
 * fell through to "Unggahan belum bisa dilanjutkan. SIMPROK menahan diri
 * daripada menebak."
 *
 * A reviewer with no BASIC_PRICE_IMPORT permission was therefore told SIMPROK
 * was being careful about their workbook. The workbook was never read at all.
 */

const RAW_ENUM = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

test("E-1. a framework failure is NOT an intake refusal", () => {
  // The exact strings Nest puts in `message` for the guards this route uses.
  for (const notIntake of [
    "Forbidden resource",
    "Unauthorized",
    "Batch not found",
    "Row not found",
    "Internal server error",
    "A source file is required",
  ]) {
    assert.equal(
      isIntakeRefusalCode(notIntake),
      false,
      `"${notIntake}" must never be read as an intake code`,
    );
  }
});

test("E-2. every code intake can actually emit IS recognised as an intake code", () => {
  const declared = declaredIntakeCodes();
  assert.ok(
    declared.length >= 14,
    `expected the full backend vocabulary, saw ${declared.length}`,
  );
  for (const code of declared) {
    assert.equal(
      isIntakeRefusalCode(code),
      true,
      `backend emits ${code} but the client does not know it is an intake code`,
    );
  }
});

test("E-3. NO actionable or terminal intake code falls to the generic ending", () => {
  // Every code the backend can emit must have its own branch in IntakeQuestion —
  // either a question to ask, or a sentence to end with. A code with neither is
  // exactly how the Owner's dead end was reached.
  for (const code of declaredIntakeCodes()) {
    assert.equal(
      hasOwnCase(code),
      true,
      `no question and no sentence for intake code: ${code}`,
    );
  }
});

test("E-4. the generic ending no longer claims SIMPROK is refusing to guess about the file", () => {
  // Read from source for the same reason as above; the wording is the law here.
  const generic = intakeQuestionSource.slice(
    intakeQuestionSource.lastIndexOf("default:"),
  );
  assert.doesNotMatch(generic, /menahan diri daripada menebak/);
  assert.match(generic, /tidak ada data yang diterka atau disimpan/i);
});

test("E-5. a denied permission says so, and never blames the workbook", () => {
  const forbidden = importRequestMessage(403);
  assert.match(forbidden, /kewenangan/i);
  assert.match(forbidden, /belum diperiksa/i);
  assert.doesNotMatch(forbidden, RAW_ENUM);
  // The sentence the Owner actually saw must not be reachable from here.
  assert.doesNotMatch(forbidden, /menahan diri daripada menebak/);
});

test("E-6. session, size and server faults are each named as themselves", () => {
  assert.match(importRequestMessage(401), /[Ss]esi/);
  assert.match(importRequestMessage(413), /ukuran/i);
  assert.match(importRequestMessage(500), /SIMPROK mengalami kendala/);
  for (const status of [401, 413, 500, 418]) {
    assert.doesNotMatch(importRequestMessage(status), RAW_ENUM);
  }
});

test("E-7. a status SIMPROK decided WITHOUT reading the file clears it of nothing", () => {
  // The truth ceiling, and it cuts both ways. A guard answers 401 and 403
  // before intake sees a byte, so neither sentence may report a verdict on the
  // document — not "your file is fine", and not "your file is the problem".
  // The 500 message is bound by the same rule: SIMPROK failed, and what it had
  // or had not concluded about the workbook when it failed is unknown.
  const EXONERATES = /tidak bermasalah|bukan pada berkas|berkas Anda (baik|aman)/i;
  const BLAMES = /berkas (Anda )?(rusak|salah|tidak valid|bermasalah)/i;

  for (const status of [401, 403, 500, 503]) {
    const message = importRequestMessage(status);
    assert.doesNotMatch(message, EXONERATES);
    assert.doesNotMatch(message, BLAMES);
  }

  // 401 and 403 go further: SIMPROK states plainly that it has not looked.
  assert.match(importRequestMessage(401), /[Ii]si berkas belum diperiksa/);
  assert.match(importRequestMessage(403), /[Ii]si berkas belum diperiksa/);

  // A server fault promises only what SIMPROK controls: nothing was guessed
  // into the record. It does NOT promise the file was innocent.
  assert.match(importRequestMessage(500), /tidak ada fakta yang diterka/i);
});

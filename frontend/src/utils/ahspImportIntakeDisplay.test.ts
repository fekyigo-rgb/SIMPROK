import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  IDENTITY_PENDING_ITEM_LINE,
  admissionOf,
  describeImportIntake,
  describeImportRecheck,
  describeImportRecheckFailure,
  describePreviewAttention,
  describeWaitingImports,
  previewIntakeLine,
} from "./ahspImportIntakeDisplay.ts";
import { describeSameness } from "./ahspSamenessDisplay.ts";

/**
 * IMPORT ACCEPTANCE BOUNDARY — B7. "Diterima" and "siap digunakan" are two
 * different truths, waiting for a fact is not a failure, and no internal code
 * ever reaches the reader.
 */

const INTERNAL = /[A-Z]{2,}_[A-Z_]{2,}|\bkernel\b|\bcanonical\b|\bdigest\b|\benum\b/u;
const everyText = (lines: readonly string[]) => {
  for (const line of lines) assert.doesNotMatch(line, INTERNAL, line);
};

test("an unrecognised admission is held — never promoted to saved or ready", () => {
  assert.equal(admissionOf({ admission: "PROVEN" }), "PROVEN");
  assert.equal(admissionOf({ admission: "IDENTITY_PENDING" }), "IDENTITY_PENDING");
  assert.equal(admissionOf({ admission: "HELD" }), "HELD");
  assert.equal(admissionOf({ admission: "SOMETHING_NEW" }), "HELD");
  assert.equal(admissionOf({}), "HELD");
});

test("the preview counts what SIMPROK understood, and says every recognised item will be received", () => {
  const line = previewIntakeLine([
    { admission: "PROVEN" },
    { admission: "IDENTITY_PENDING" },
    { admission: "IDENTITY_PENDING" },
    { admission: "HELD" },
  ]);
  assert.equal(
    line,
    "4 pekerjaan dikenali. 1 lengkap dan terbukti. 2 lengkap, tetapi identitas sebagian komponennya masih dilengkapi. 1 masih menunggu fakta atau keputusan. Saat disimpan, semua pekerjaan yang dikenali diterima SIMPROK.",
  );
  // Before saving, nothing is called ready to use or received yet.
  assert.doesNotMatch(line, /siap digunakan|sudah diterima/u);
  // A document with nothing recognisable promises nothing.
  assert.equal(previewIntakeLine([]), "Tidak ada pekerjaan yang dapat dikenali dari dokumen ini.");
  everyText([line, IDENTITY_PENDING_ITEM_LINE]);
});

test("B7: a saved document reports DITERIMA, SIAP DIGUNAKAN and MASIH DILENGKAPI — as three different numbers", () => {
  const view = describeImportIntake({ evaluated: 71, ready: 0, identityPending: 70, alreadyPresent: 0, held: 1, failed: 0 });
  assert.equal(view.headline, "Import selesai. 71 pekerjaan yang dikenali sudah diterima SIMPROK.");
  assert.deepEqual(view.figures, [
    { label: "Diterima", value: 71 },
    { label: "Siap digunakan", value: 0 },
    { label: "Masih dilengkapi", value: 71 },
  ]);
  // A held item is kept and can be continued — it is never called failed.
  assert.ok(view.details.some((line) => /1 pekerjaan belum dijadikan AHSP karena masih menunggu fakta/u.test(line)));
  assert.ok(view.details.some((line) => /tanpa mengunggah ulang/u.test(line)));
  assert.ok(!view.details.some((line) => /gagal|belum berhasil/u.test(line)));
  // Identity-pending AHSPs are saved, and their pricing stays closed until identity is sure.
  assert.ok(view.details.some((line) => /70 pekerjaan sudah disimpan sebagai AHSP/u.test(line)));
  assert.ok(view.details.some((line) => /Harganya belum dapat dihitung sampai identitas itu pasti/u.test(line)));
  everyText([view.headline, ...view.figures.map((figure) => figure.label), ...view.details]);
});

test("a failed write is its own figure and its own sentence — never folded into waiting", () => {
  const view = describeImportIntake({ evaluated: 3, ready: 1, identityPending: 0, alreadyPresent: 1, held: 0, failed: 1 });
  assert.deepEqual(view.figures.map((figure) => [figure.label, figure.value]), [
    ["Diterima", 3],
    ["Siap digunakan", 1],
    ["Masih dilengkapi", 0],
    ["Belum berhasil ditulis", 1],
  ]);
  assert.ok(view.details.includes("1 pekerjaan sudah ada di SIMPROK, jadi tidak disimpan dua kali."));
  assert.ok(view.details.some((line) => /belum berhasil ditulis karena gangguan/u.test(line)));
  // Nothing is said about a count that is zero.
  assert.equal(view.details.length, 2);
});

test("a document with no recognisable work item is not announced as a finished import", () => {
  const view = describeImportIntake({ evaluated: 0, ready: 0, identityPending: 0, alreadyPresent: 0, held: 0, failed: 0 });
  assert.equal(view.headline, "Tidak ada pekerjaan yang dapat dikenali dari dokumen ini.");
  assert.doesNotMatch(view.headline, /selesai/u);
  // A malformed count is never shown as a number the server did not send.
  assert.deepEqual(describeImportIntake({ evaluated: -2, ready: Number.NaN }).figures.slice(0, 2), [
    { label: "Diterima", value: 0 },
    { label: "Siap digunakan", value: 0 },
  ]);
});

test("only imports that still hold work items are listed, each waiting item with its true reason", () => {
  const views = describeWaitingImports([
    {
      importJobId: "job-done",
      sourceFileName: "selesai.xlsx",
      counts: { received: 4, represented: 4, waiting: 0 },
      waiting: [],
    },
    {
      importJobId: "job-1",
      sourceFileName: "AHSP BINA MARGA.xlsx",
      createdAt: "2026-09-15T08:00:00.000Z",
      counts: { received: 71, represented: 69, waiting: 2 },
      waiting: [
        { lineNumber: 70, status: "PENDING", reasonCodes: ["RESOURCE_UNRESOLVED", "MISSING_OUTPUT_UNIT"], workType: "B.83", methodName: "Pemasangan" },
        { lineNumber: 71, status: "FAILED", reasonCodes: ["CURRENTNESS_UNPROVEN"], workType: null, methodName: "Galian" },
      ],
    },
    null,
    { importJobId: "", waiting: [{ lineNumber: 1, status: "PENDING", reasonCodes: [] }] },
  ]);
  assert.equal(views.length, 1);
  const [job] = views;
  assert.equal(job.key, "job-1");
  assert.equal(job.title, "AHSP BINA MARGA.xlsx");
  assert.match(job.receivedLine, /^Diimpor .*2026\. 71 pekerjaan diterima; 69 sudah menjadi AHSP di SIMPROK\.$/u);
  assert.equal(job.waitingLine, "2 pekerjaan masih menunggu fakta atau keputusan.");
  assert.deepEqual(job.waitingItems, [
    // The missing output unit holds it — not the pending identity it also carries.
    // (closeout §5: "not found", never "not stated" — see ahspDocumentUserCopy.test.ts.)
    { key: "70", title: "B.83 — Pemasangan", reason: "Satuan hasil pekerjaan belum ditemukan pada dokumen.", sameness: null, decisionFor: null },
    {
      key: "71",
      title: "— — Galian",
      reason: "Penyimpanan sebelumnya belum berhasil; akan dicoba lagi saat diperiksa ulang.",
      sameness: null,
      decisionFor: null,
    },
  ]);
  assert.equal(job.moreWaitingLine, null);
  // Nothing here waits for the reader's own decision, so none is asked for.
  assert.equal(job.decisionLine, null);
  everyText([job.receivedLine, job.waitingLine, ...job.waitingItems.map((item) => item.reason)]);
});

test("a long waiting list is cut with an honest count, never silently", () => {
  const waiting = Array.from({ length: 8 }, (_, index) => ({
    lineNumber: index + 1,
    status: "PENDING",
    reasonCodes: ["MISSING_UNIT"],
    workType: "A." + (index + 1),
    methodName: "Uraian",
  }));
  const [job] = describeWaitingImports([{ importJobId: "job-2", sourceFileName: "  ", counts: { received: 8, represented: 0, waiting: 8 }, waiting }]);
  assert.equal(job.title, "Dokumen tanpa nama");
  // CHANGE NOTE (F02b): the LIST is no longer cut — every waiting line travels, and
  // the page shows `waitingShown` of them first and the rest on demand. What is
  // stored is reachable; what is shown first is a display choice, said with a count.
  // NEW_EXPECTATION: all 8 items, waitingShown 5, and the same honest line.
  // TEST_WEAKENING=NO — the old shape could not reach line 6 at all.
  assert.equal(job.waitingItems.length, 8);
  assert.equal(job.waitingShown, 5);
  assert.equal(job.moreWaitingLine, "dan 3 pekerjaan lainnya.");
  assert.deepEqual(
    job.waitingItems.map((item) => item.title),
    waiting.map((line) => line.workType + " — " + line.methodName),
  );
});

test("TASK 3: a possible twin kept from an earlier import offers the preview's own comparison and decisions, and is never cut from the list", () => {
  const match = { ahspId: "ahsp-existing", workType: "1.7.7.1.1.b (a)", methodName: "penggalian 1 m3 tanah biasa", code: null, deleted: false, signal: "NORMALIZED_NAME" };
  const possible = {
    lineNumber: 9,
    status: "PENDING",
    reasonCodes: ["IDENTITY_POSSIBLE_MATCH"],
    workType: "1.7.7.1.1.b (a)",
    methodName: "Penggalian 1 m3 tanah biasa",
    identityVerdict: "POSSIBLY_IDENTICAL",
    identityMatches: [match],
  };
  // Eight lines wait for a fact first; the possible twin comes last.
  const blocked = Array.from({ length: 8 }, (_, index) => ({
    lineNumber: index + 1,
    status: "PENDING",
    reasonCodes: ["MISSING_OUTPUT_UNIT"],
    workType: "B." + (index + 1),
    methodName: "Uraian",
  }));
  const [job] = describeWaitingImports([
    { importJobId: "job-3", sourceFileName: "AHSP.xlsx", counts: { received: 9, represented: 0, waiting: 9 }, waiting: [...blocked, possible] },
  ]);
  const decidable = job.waitingItems.filter((item) => item.sameness !== null);
  assert.equal(decidable.length, 1);
  const [twin] = decidable;
  // The SAME view the preview renders for the same verdict — one module, one truth.
  assert.deepEqual(twin.sameness, describeSameness({ identityVerdict: "POSSIBLY_IDENTICAL", identityMatches: [match] }));
  assert.equal(twin.sameness?.canUseExisting, true);
  assert.equal(twin.sameness?.canKeepSeparate, true);
  assert.deepEqual(twin.decisionFor, { workType: "1.7.7.1.1.b (a)", methodName: "Penggalian 1 m3 tanah biasa" });
  // Every line travels, the decision among them, and the count says how many of the
  // ordinary ones the detail holds back until the reader asks.
  assert.equal(job.waitingItems.length, 9);
  assert.equal(job.waitingShown, 5);
  assert.equal(job.moreWaitingLine, "dan 3 pekerjaan lainnya.");
  assert.equal(job.decisionLine, "Keputusan yang Anda pilih dijalankan saat pemeriksaan ulang.");
  everyText([job.decisionLine ?? "", twin.sameness?.title ?? "", twin.sameness?.guidance ?? ""]);
});

test("TASK 3: only an open possible twin asks — an exact twin, a distinct item or a failed write is settled by the re-check", () => {
  const line = (over: Record<string, unknown>) => ({
    lineNumber: 1,
    status: "PENDING",
    reasonCodes: ["IDENTITY_POSSIBLE_MATCH"],
    workType: "A.1",
    methodName: "Uraian",
    identityMatches: [{ ahspId: "a1", workType: "A.1", methodName: "uraian" }],
    ...over,
  });
  for (const waiting of [
    line({ identityVerdict: "IDENTICAL" }),
    line({ identityVerdict: "DISTINCT", identityMatches: [] }),
    line({ identityVerdict: undefined }),
    line({ identityVerdict: "POSSIBLY_IDENTICAL", status: "FAILED" }),
    line({ identityVerdict: "POSSIBLY_IDENTICAL", workType: null }),
  ]) {
    const [job] = describeWaitingImports([{ importJobId: "job-4", counts: { received: 1, represented: 0, waiting: 1 }, waiting: [waiting] }]);
    assert.equal(job.waitingItems[0].sameness, null);
    assert.equal(job.waitingItems[0].decisionFor, null);
    assert.equal(job.decisionLine, null);
  }
});

test("TRUST REPAIR: a re-check after 'Gunakan yang sudah ada' says the item uses that AHSP — never that SIMPROK found it", () => {
  // Browser proof, one KEEP_SEPARATE, one USE_EXISTING and one item still waiting.
  const decided = describeImportRecheck({ evaluated: 3, ready: 0, identityPending: 1, alreadyPresent: 1, held: 1, failed: 0 });
  assert.equal(decided.kind, "SUCCESS");
  assert.deepEqual(decided.lines.map((line) => line.text), [
    "Pemeriksaan ulang selesai tanpa mengunggah ulang dokumen.",
    "1 pekerjaan kini disimpan sebagai AHSP; 1 di antaranya masih dilengkapi identitas komponennya.",
    "1 pekerjaan menggunakan AHSP yang sudah ada.",
    "1 pekerjaan masih menunggu fakta atau keputusan.",
  ]);
  const many = describeImportRecheck({ evaluated: 2, ready: 0, identityPending: 0, alreadyPresent: 2, held: 0, failed: 0 });
  assert.ok(many.lines.some((line) => line.text === "2 pekerjaan menggunakan AHSP yang sudah ada."));
  for (const outcome of [decided, many]) {
    assert.ok(!outcome.lines.some((line) => /ternyata/u.test(line.text)));
    everyText(outcome.lines.map((line) => line.text));
  }
});

test("a re-check says what progressed, what still waits and what failed — from the server's own count", () => {
  const progressed = describeImportRecheck({ evaluated: 3, ready: 1, identityPending: 1, alreadyPresent: 0, held: 1, failed: 0 });
  assert.equal(progressed.kind, "SUCCESS");
  assert.deepEqual(progressed.lines.map((line) => line.text), [
    "Pemeriksaan ulang selesai tanpa mengunggah ulang dokumen.",
    "2 pekerjaan kini disimpan sebagai AHSP; 1 di antaranya masih dilengkapi identitas komponennya.",
    "1 pekerjaan masih menunggu fakta atau keputusan.",
  ]);

  const unchanged = describeImportRecheck({ evaluated: 1, ready: 0, identityPending: 0, alreadyPresent: 0, held: 1, failed: 0 });
  assert.equal(unchanged.kind, "SUCCESS");
  assert.equal(unchanged.lines[1].text, "Belum ada pekerjaan yang dapat disimpan sebagai AHSP dengan data saat ini.");

  const failed = describeImportRecheck({ evaluated: 2, ready: 0, identityPending: 0, alreadyPresent: 0, held: 0, failed: 2 });
  assert.equal(failed.kind, "FAILURE");
  assert.equal(failed.lines[0].tone, "FAILURE");

  const partial = describeImportRecheck({ evaluated: 2, ready: 1, identityPending: 0, alreadyPresent: 0, held: 0, failed: 1 });
  assert.equal(partial.kind, "PARTIAL");

  // A 2xx without a readable count is not dressed up as progress.
  const unread = describeImportRecheck(null);
  assert.equal(unread.kind, "SUCCESS");
  assert.doesNotMatch(unread.lines.map((line) => line.text).join(" "), /disimpan sebagai AHSP/u);
  everyText([...progressed.lines, ...failed.lines, ...unread.lines].map((line) => line.text));
});

test("a refused re-check names the server's reason in plain words and never claims a save", () => {
  const changed = describeImportRecheckFailure({ status: 409, code: "AHSP_IMPORT_KNOWLEDGE_CONTRACT_CHANGED" });
  const texts = changed.lines.map((line) => line.text);
  assert.equal(changed.kind, "FAILURE");
  assert.equal(texts[0], "Pemeriksaan ulang belum berhasil.");
  assert.equal(texts[1], "Tidak ada perubahan yang tersimpan.");
  assert.match(texts[2], /sudah diperbarui sejak dokumen ini diimpor/u);
  assert.equal(texts[3], "Unggah dan pahami ulang dokumen ini.");

  const missing = describeImportRecheckFailure({ status: 404, code: "AHSP_IMPORT_JOB_NOT_FOUND" });
  assert.match(missing.lines.map((line) => line.text).join(" "), /tidak ditemukan di workspace aktif/u);

  // The server failed part-way, or never answered: what was kept is unknown, and said so.
  for (const failure of [{ status: 500, code: null }, { status: null, code: null }]) {
    const lines = describeImportRecheckFailure(failure).lines.map((line) => line.text);
    assert.match(lines[1], /Belum dapat dipastikan/u);
    everyText(lines);
  }
  everyText([...texts, ...missing.lines.map((line) => line.text)]);
});

// ── AHSP COMPLETION — what an import still needs, one row per question ──

const bh = (lineNumber: number, uses: number, extra: Record<string, unknown> = {}) => ({
  lineNumber,
  status: "PENDING",
  reasonCodes: ["UNIT_UNRESOLVED"],
  workType: "B." + lineNumber,
  methodName: "Pekerjaan " + lineNumber,
  unknownUnits: [{ spelling: "Bh", uses }],
  ...extra,
});

test("§21 E: one unknown spelling used twenty times is ONE row — never twenty questions", () => {
  const waiting = Array.from({ length: 20 }, (_, index) => bh(index + 1, 1));
  const [job] = describeWaitingImports([
    {
      importJobId: "job-bh",
      sourceFileName: "AHSP BINA MARGA.xlsx",
      counts: { received: 71, represented: 51, waiting: 20 },
      completion: { complete: 51, awaitingIdentity: 0, identityQuestions: { questions: 0, uses: 0 } },
      waiting,
    },
  ]);
  const units = job.attention.filter((row) => row.tone === "UNIT");
  assert.equal(units.length, 1);
  assert.equal(units[0].title, "Satuan 'Bh' belum dikenali SIMPROK");
  assert.equal(units[0].detail, "Dipakai 20 kali dalam 20 pekerjaan.");
  // No button is invented for a vocabulary change SIMPROK has no governed door for.
  assert.equal(job.attention.length, 1);
  assert.equal(job.summaryLine, "71 pekerjaan diterima. 51 telah lengkap untuk tahap AHSP. 20 menunggu satuan yang belum dikenali.");
  assert.equal(job.canRecheck, true);
  // Nothing changed that is worth checking again: the re-check is offered, but not urged.
  assert.equal(job.recheckWarranted, false);
  everyText([job.summaryLine, ...job.attention.flatMap((row) => [row.title, row.detail])]);
});

test("§13/§21 F: identity is one row for every exact question — and a saved AHSP waiting for it is never called complete", () => {
  const wire = {
    importJobId: "job-identity",
    sourceFileName: "AHSP.xlsx",
    counts: { received: 71, represented: 70, waiting: 1 },
    completion: { complete: 61, awaitingIdentity: 9, identityQuestions: { questions: 3, uses: 100 } },
    waiting: [{ lineNumber: 71, status: "PENDING", reasonCodes: ["MISSING_OUTPUT_UNIT"], workType: "B.83", methodName: "Pipa" }],
  };
  const [job] = describeWaitingImports([wire], { canCurate: false });
  // CHANGE NOTE (closeout P3-A correction 1 + §5): "3 pertanyaan unik …; satu keputusan
  // berlaku untuk semuanya" read as one decision answering three different questions.
  // It says three different questions, grouped so none is answered per occurrence.
  // "menunggu kejelasan dari dokumen" → "menunggu fakta dari dokumen", and a unit not
  // found is no longer "belum tertera". TEST_WEAKENING=NO.
  assert.equal(
    job.summaryLine,
    "71 pekerjaan diterima. 61 telah lengkap untuk tahap AHSP. 9 masih menunggu identitas sumber daya. 1 menunggu fakta dari dokumen.",
  );
  assert.deepEqual(
    job.attention.map((row) => [row.tone, row.title, row.detail]),
    [
      [
        "IDENTITY",
        "Identitas sumber daya belum pasti",
        "Ada 3 pertanyaan berbeda dari 100 kemunculan. Pertanyaan yang sama dikelompokkan agar tidak perlu dijawab per kemunculan. Diputuskan oleh pemegang kewenangan identitas sumber daya.",
      ],
      ["SOURCE", "Satuan hasil pekerjaan belum ditemukan pada dokumen", "1 pekerjaan. SIMPROK tidak menebaknya."],
    ],
  );
  // A reader who may decide is pointed to where the decision is made.
  const [curator] = describeWaitingImports([wire], { canCurate: true });
  assert.match(curator.attention[0].detail, /Tinjau di bagian Sumber daya untuk ditinjau\.$/u);
  everyText([job.summaryLine, ...job.attention.flatMap((row) => [row.title, row.detail])]);
});

test("an import whose only remaining need is identity is still listed — and offers no re-check that would do nothing", () => {
  const [job] = describeWaitingImports([
    {
      importJobId: "job-saved",
      sourceFileName: "AHSP.xlsx",
      counts: { received: 4, represented: 4, waiting: 0 },
      completion: { complete: 2, awaitingIdentity: 2, identityQuestions: { questions: 1, uses: 6 } },
      waiting: [],
    },
  ]);
  assert.equal(job.canRecheck, false);
  assert.equal(job.summaryLine, "4 pekerjaan diterima. 2 telah lengkap untuk tahap AHSP. 2 masih menunggu identitas sumber daya.");
});

test("§15 scale: the Bina Marga card reads as five calm sentences and four rows — counts written as an Indonesian reader writes them", () => {
  const [job] = describeWaitingImports([
    {
      importJobId: "job-bm",
      sourceFileName: "AHSP BINA MARGA.xlsx",
      counts: { received: 71, represented: 61, waiting: 10 },
      completion: { complete: 0, awaitingIdentity: 61, identityQuestions: { questions: 95, uses: 1100 } },
      waiting: [
        { lineNumber: 13, status: "PENDING", reasonCodes: ["RESOURCE_UNRESOLVED", "UNIT_UNRESOLVED"], unknownUnits: [{ spelling: "Ton", uses: 1 }] },
        ...Array.from({ length: 8 }, (_, index) => bh(53 + index, 1, { reasonCodes: ["RESOURCE_UNRESOLVED", "UNIT_UNRESOLVED"] })),
        { lineNumber: 71, status: "PENDING", reasonCodes: ["MISSING_OUTPUT_UNIT", "RESOURCE_UNRESOLVED"] },
      ],
    },
  ]);
  assert.equal(
    job.summaryLine,
    "71 pekerjaan diterima. Belum ada yang lengkap untuk tahap AHSP. 61 masih menunggu identitas sumber daya. 9 menunggu satuan yang belum dikenali. 1 menunggu fakta dari dokumen.",
  );
  // CHANGE NOTE (closeout P3-A correction 1 + §5): the Owner's 95 questions are 95
  // DIFFERENT questions; grouping spares answering 1.100 occurrences one by one, it
  // never makes one decision answer all 95. TEST_WEAKENING=NO.
  assert.deepEqual(
    job.attention.map((row) => [row.title, row.detail]),
    [
      ["Satuan 'Bh' belum dikenali SIMPROK", "Dipakai 8 kali dalam 8 pekerjaan."],
      ["Satuan 'Ton' belum dikenali SIMPROK", "Dipakai 1 kali dalam 1 pekerjaan."],
      [
        "Identitas sumber daya belum pasti",
        "Ada 95 pertanyaan berbeda dari 1.100 kemunculan. Pertanyaan yang sama dikelompokkan agar tidak perlu dijawab per kemunculan. Diputuskan oleh pemegang kewenangan identitas sumber daya.",
      ],
      ["Satuan hasil pekerjaan belum ditemukan pada dokumen", "1 pekerjaan. SIMPROK tidak menebaknya."],
    ],
  );
  assert.equal(job.recheckWarranted, false);
});

test("§5/§17: a source conflict names both statements; a missing unit is never guessed; each item is counted once", () => {
  const [job] = describeWaitingImports([
    {
      importJobId: "job-source",
      sourceFileName: "Copy of AHSP ok(1).xlsx",
      counts: { received: 17, represented: 11, waiting: 6 },
      completion: { complete: 11, awaitingIdentity: 0, identityQuestions: { questions: 0, uses: 0 } },
      waiting: [
        { lineNumber: 7, status: "PENDING", reasonCodes: ["SOURCE_UNIT_CONFLICT"], statedOutputUnits: ["m3", "kg"] },
        { lineNumber: 12, status: "PENDING", reasonCodes: ["SOURCE_UNIT_CONFLICT"], statedOutputUnits: ["m3", "m2"] },
        { lineNumber: 13, status: "PENDING", reasonCodes: ["SOURCE_UNIT_CONFLICT"], statedOutputUnits: ["m3", "m2"] },
        // Waits for the document AND uses an unknown spelling: counted once, named in both rows.
        bh(4, 2, { reasonCodes: ["INVALID_COEFFICIENT", "UNIT_UNRESOLVED"] }),
        { lineNumber: 5, status: "FAILED", reasonCodes: [] },
        { lineNumber: 6, status: "PENDING", reasonCodes: ["UNIT_UNRESOLVED"], unitsKnownNow: true },
      ],
    },
  ]);
  // CHANGE NOTE (closeout P3-A correction 2): "Siap dilanjutkan … Periksa ulang untuk
  // melanjutkannya" promised that the check moves the item. A unit now known may not be
  // the only fact it lacks, so the row names what changed and leaves the result to the
  // check. TEST_WEAKENING=NO.
  assert.equal(
    job.summaryLine,
    "17 pekerjaan diterima. 11 telah lengkap untuk tahap AHSP. 4 menunggu fakta dari dokumen. 1 layak diperiksa ulang. 1 belum berhasil disimpan.",
  );
  assert.deepEqual(
    job.attention.map((row) => [row.tone, row.title, row.detail]),
    [
      [
        "RECHECK",
        "Layak diperiksa ulang",
        "1 pekerjaan: ada perubahan yang layak diperiksa kembali (satuan yang ditunggu kini dikenali). Hasilnya ditentukan saat pemeriksaan ulang.",
      ],
      ["UNIT", "Satuan 'Bh' belum dikenali SIMPROK", "Dipakai 2 kali dalam 1 pekerjaan."],
      ["SOURCE", "Dokumen menyatakan satuan hasil yang berbeda", "3 pekerjaan (m3 dan kg; m3 dan m2). SIMPROK tidak memilih salah satunya."],
      ["SOURCE", "Koefisien belum lengkap atau tidak sah", "1 pekerjaan."],
      ["FAILED", "Penyimpanan sebelumnya belum berhasil", "1 pekerjaan akan dicoba lagi saat diperiksa ulang."],
    ],
  );
  // Something worth checking again: this is where the one emphasized action belongs.
  assert.equal(job.recheckWarranted, true);
  everyText([job.summaryLine, ...job.attention.flatMap((row) => [row.title, row.detail])]);
});

test("§21 H: a possible twin is one decision row, and a twin that settled today is ready for the re-check", () => {
  const match = { ahspId: "ahsp-existing", workType: "A.1", methodName: "uraian", code: null, deleted: false, signal: "NORMALIZED_NAME" };
  const [job] = describeWaitingImports([
    {
      importJobId: "job-twin",
      counts: { received: 3, represented: 1, waiting: 2 },
      waiting: [
        { lineNumber: 1, status: "PENDING", reasonCodes: ["IDENTITY_POSSIBLE_MATCH"], workType: "A.1", methodName: "Uraian", identityVerdict: "POSSIBLY_IDENTICAL", identityMatches: [match] },
        { lineNumber: 2, status: "PENDING", reasonCodes: ["IDENTITY_POSSIBLE_MATCH"], workType: "A.2", methodName: "Lain", identityVerdict: "DISTINCT", identityMatches: [] },
      ],
    },
  ]);
  assert.deepEqual(job.attention.map((row) => row.tone), ["RECHECK", "DECISION"]);
  assert.match(job.attention[0].detail, /\(perbandingan dengan AHSP yang ada sudah berubah\)/u);
  assert.equal(job.attention[1].detail, "1 pekerjaan menunggu keputusan Anda.");
  // Without a completion from the server, the saved AHSPs are counted as they were saved.
  assert.equal(job.summaryLine, "3 pekerjaan diterima. 1 telah lengkap untuk tahap AHSP. 1 menunggu keputusan Anda. 1 layak diperiksa ulang.");
});

test("the preview says what a document will still need — grouped the same way, from the server's own reading", () => {
  const rows = describePreviewAttention(
    [
      { admission: "PROVEN", reasonCodes: [], resources: [{ group: "LABOR", rawName: "Pekerja", rawUnit: "OH", reasonCodes: [], resolvedResourceCatalogId: "cat-1" }] },
      {
        admission: "IDENTITY_PENDING",
        reasonCodes: ["RESOURCE_UNRESOLVED"],
        resources: [
          { group: "MATERIAL", rawName: "Pipa PVC", rawCode: null, rawUnit: "m'", reasonCodes: ["RESOURCE_UNRESOLVED"], resolvedResourceCatalogId: null },
          { group: "MATERIAL", rawName: "Pipa PVC", rawCode: null, rawUnit: "m'", reasonCodes: ["RESOURCE_UNRESOLVED"], resolvedResourceCatalogId: null },
        ],
      },
      {
        admission: "HELD",
        reasonCodes: ["UNIT_UNRESOLVED", "RESOURCE_CANDIDATES_FOUND"],
        outputUnitRaw: { raw: "m" },
        resolvedOutputUnit: "m",
        resources: [
          { group: "MATERIAL", rawName: "Pipa PVC", rawCode: null, rawUnit: "m'", reasonCodes: ["RESOURCE_CANDIDATES_FOUND"], resolvedResourceCatalogId: null },
          { group: "MATERIAL", rawName: "Paku", rawUnit: "Bh", reasonCodes: ["UNIT_UNRESOLVED"], resolvedResourceCatalogId: "cat-paku" },
          { group: "MATERIAL", rawName: "Baut", rawUnit: "Bh", reasonCodes: ["UNIT_UNRESOLVED"], resolvedResourceCatalogId: "cat-baut" },
        ],
      },
      {
        admission: "HELD",
        reasonCodes: ["SOURCE_UNIT_CONFLICT"],
        outputUnitRaw: null,
        outputUnitStatements: [{ raw: "m3" }, { raw: "M2" }],
        resources: [],
      },
      { admission: "PROVEN", reasonCodes: [], identityVerdict: "POSSIBLY_IDENTICAL", resources: [] },
    ],
    { canCurate: false },
  );
  assert.deepEqual(
    rows.map((row) => [row.tone, row.title, row.detail]),
    [
      ["DECISION", "Kemungkinan sama dengan AHSP yang sudah ada", "1 pekerjaan menunggu keputusan Anda."],
      ["UNIT", "Satuan 'Bh' belum dikenali SIMPROK", "Dipakai 2 kali dalam 1 pekerjaan."],
      [
        "IDENTITY",
        "Identitas sumber daya belum pasti",
        "Ada 1 pertanyaan berbeda dari 3 kemunculan. Pertanyaan yang sama dikelompokkan agar tidak perlu dijawab per kemunculan. Diputuskan oleh pemegang kewenangan identitas sumber daya.",
      ],
      ["SOURCE", "Dokumen menyatakan satuan hasil yang berbeda", "1 pekerjaan (m3 dan M2). SIMPROK tidak memilih salah satunya."],
    ],
  );
  // A document where everything is proven needs nothing.
  assert.deepEqual(describePreviewAttention([{ admission: "PROVEN", reasonCodes: [] }], { canCurate: true }), []);
  everyText(rows.flatMap((row) => [row.title, row.detail]));
});

// ── CLOSEOUT — complete is the server's proof; grouped is not resolved; worth checking is not a promise ──

test("closeout P1-A: a saved AHSP the consumer cannot identify is never complete — even when no question is open to answer", () => {
  const [job] = describeWaitingImports(
    [
      {
        importJobId: "job-curated",
        sourceFileName: "AHSP.xlsx",
        counts: { received: 3, represented: 3, waiting: 0 },
        // The queue is empty (a decision that taught nothing closed it), the recipe is still unproved.
        completion: { complete: 2, awaitingIdentity: 1, recipeNotUsable: 0, writtenUnitQuestions: [], identityQuestions: { questions: 0, uses: 0 } },
        waiting: [],
      },
    ],
    { canCurate: true },
  );
  assert.equal(job.summaryLine, "3 pekerjaan diterima. 2 telah lengkap untuk tahap AHSP. 1 masih menunggu identitas sumber daya.");
  assert.deepEqual(job.attention.map((row) => [row.tone, row.title, row.detail]), [
    [
      "IDENTITY",
      "Identitas sumber daya belum terbukti",
      "1 AHSP tersimpan masih memakai nama sumber daya dari dokumen, dan tidak ada pertanyaan terbuka untuk dijawab. Keputusan tinjauan saja belum membuktikan identitasnya.",
    ],
  ]);
  // Nothing waits, so no check is offered that would evaluate nothing.
  assert.equal(job.canRecheck, false);
  assert.equal(job.recheckWarranted, false);
  everyText([job.summaryLine, ...job.attention.flatMap((row) => [row.title, row.detail])]);
});

test("closeout P1-A/P1-B: a recipe that cannot be used and a saved unit the document questions are each listed — never counted complete, never corrected here", () => {
  const [job] = describeWaitingImports([
    {
      importJobId: "job-saved-questions",
      sourceFileName: "AHSP lama.xlsx",
      counts: { received: 5, represented: 5, waiting: 0 },
      completion: {
        complete: 2,
        awaitingIdentity: 0,
        recipeNotUsable: 1,
        writtenUnitQuestions: [
          { lineNumber: 1, statedOutputUnits: ["m3", "M2"], provenDifferent: true },
          { lineNumber: 2, statedOutputUnits: ["m1", "bh"], provenDifferent: false },
        ],
        identityQuestions: { questions: 0, uses: 0 },
      },
      waiting: [],
    },
  ]);
  assert.equal(
    job.summaryLine,
    "5 pekerjaan diterima. 2 telah lengkap untuk tahap AHSP. 2 tersimpan dengan satuan hasil yang dipertanyakan dokumennya. 1 terwakili AHSP yang belum dapat dipakai.",
  );
  assert.deepEqual(job.attention.map((row) => [row.tone, row.title, row.detail]), [
    [
      "SOURCE",
      "AHSP tersimpan, tetapi dokumennya menyatakan satuan hasil yang berbeda",
      "1 pekerjaan (m3 dan M2). Tidak dihitung lengkap; SIMPROK tidak mengubah AHSP yang sudah tersimpan.",
    ],
    [
      "SOURCE",
      "AHSP tersimpan, tetapi kesamaan satuan hasil dalam dokumennya belum dapat dipastikan",
      "1 pekerjaan (m1 dan bh). Tidak dihitung lengkap; SIMPROK tidak mengubah AHSP yang sudah tersimpan.",
    ],
    [
      "OTHER",
      "AHSP yang mewakili pekerjaan belum dapat dipakai",
      "1 pekerjaan sudah terwakili AHSP, tetapi resepnya belum lengkap atau tidak lagi berlaku. Tidak dihitung lengkap.",
    ],
  ]);
  // A spelling SIMPROK does not know is never called a different unit.
  assert.doesNotMatch(job.attention[1].title + job.attention[1].detail, /berbeda/u);
  // Without the server's own count, what is not complete is still never counted complete.
  const [older] = describeWaitingImports([
    {
      importJobId: "job-no-complete",
      counts: { received: 5, represented: 5, waiting: 0 },
      completion: { awaitingIdentity: 1, recipeNotUsable: 1, writtenUnitQuestions: [{ statedOutputUnits: ["m3", "M2"], provenDifferent: true }] },
      waiting: [],
    },
  ]);
  assert.match(older.summaryLine, /^5 pekerjaan diterima\. 2 telah lengkap untuk tahap AHSP\./u);
  everyText([job.summaryLine, ...job.attention.flatMap((row) => [row.title, row.detail])]);
});

test("closeout P3-A correction 1: grouped questions are counted as different questions — one group is never one answer for all", () => {
  const [job] = describeWaitingImports([
    {
      importJobId: "job-grouped",
      counts: { received: 71, represented: 61, waiting: 0 },
      completion: { complete: 0, awaitingIdentity: 61, identityQuestions: { questions: 95, uses: 1100 } },
      waiting: [],
    },
  ]);
  const [identity] = job.attention;
  assert.match(identity.detail, /^Ada 95 pertanyaan berbeda dari 1\.100 kemunculan\. Pertanyaan yang sama dikelompokkan agar tidak perlu dijawab per kemunculan\./u);
  assert.doesNotMatch(identity.detail, /satu keputusan berlaku untuk semua|pertanyaan unik/u);
  // Grouped is not resolved: the saved AHSPs still wait, and none is called complete.
  assert.match(job.summaryLine, /Belum ada yang lengkap untuk tahap AHSP\. 61 masih menunggu identitas sumber daya\./u);
});

test("closeout P3-A correction 2: worth checking again names what changed — a unit now known, a reading updated, a settled comparison — and never promises the result", () => {
  const [job] = describeWaitingImports([
    {
      importJobId: "job-causes",
      counts: { received: 4, represented: 0, waiting: 4 },
      waiting: [
        // A pre-title line whose kept title now states its output unit.
        { lineNumber: 1, status: "PENDING", reasonCodes: ["MISSING_OUTPUT_UNIT"], readingUpdated: true },
        // Both: its unit is known now AND its reading was updated.
        { lineNumber: 2, status: "PENDING", reasonCodes: ["UNIT_UNRESOLVED"], unitsKnownNow: true, readingUpdated: true },
        { lineNumber: 3, status: "PENDING", reasonCodes: ["IDENTITY_POSSIBLE_MATCH"], workType: "A.1", methodName: "Uraian", identityVerdict: "DISTINCT", identityMatches: [] },
        // Units known, but the document itself still owes a fact: not worth checking again.
        { lineNumber: 4, status: "PENDING", reasonCodes: ["UNIT_UNRESOLVED", "INVALID_COEFFICIENT"], unitsKnownNow: true },
      ],
    },
  ]);
  const [recheck] = job.attention;
  assert.deepEqual([recheck.tone, recheck.title], ["RECHECK", "Layak diperiksa ulang"]);
  assert.equal(
    recheck.detail,
    "3 pekerjaan: ada perubahan yang layak diperiksa kembali (satuan yang ditunggu kini dikenali; judul pekerjaannya kini ikut dibaca; perbandingan dengan AHSP yang ada sudah berubah). Hasilnya ditentukan saat pemeriksaan ulang.",
  );
  assert.doesNotMatch(recheck.title + recheck.detail, /siap|pasti|akan disimpan|melanjutkannya/u);
  assert.equal(job.recheckWarranted, true);
  // The check stays offered where nothing is warranted, too — never disabled on a forecast.
  const [quiet] = describeWaitingImports([
    { importJobId: "job-quiet", counts: { received: 1, represented: 0, waiting: 1 }, waiting: [{ lineNumber: 1, status: "PENDING", reasonCodes: ["MISSING_OUTPUT_UNIT"] }] },
  ]);
  assert.equal(quiet.canRecheck, true);
  assert.equal(quiet.recheckWarranted, false);
  everyText([job.summaryLine, recheck.title, recheck.detail]);
});

test("the module formats only — no endpoint, no request, no decision", () => {
  const source = readFileSync("src/utils/ahspImportIntakeDisplay.ts", "utf8");
  assert.ok(!source.includes("apiFetch"));
  assert.ok(!source.includes("fetch("));
});

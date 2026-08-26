import assert from "node:assert/strict";
import test from "node:test";
import {
  batchStatusLabel,
  collisionWarningLabel,
  formatBatchProgress,
  formatPrivateUseOutcome,
  lifecycleActionFailureMessage,
  metadataSaveFailureMessage,
  privateUseBlockSentence,
  proposalBlockSentence,
  blockingFactLabel,
  completionBlockReason,
  humanFact,
  HUMAN_FACT_FALLBACK,
  resourceOptionLabel,
  rowActionFailureMessage,
  rowMachineNarrative,
  rowNoteLines,
  savedMetadataLines,
  unitDimensionLabel,
  unitKindLabel,
  unitOptionLabel,
  countRowMachineStates,
  formatMachineFirstSummary,
  isRowMutable,
  machinePickedResource,
  machinePickedUnit,
  rowMachineState,
  rowSectionDisplay,
  rowSectionLabel,
  rowStatusLabel,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
  type PrivateUseBlockReason,
  type ProposalNotOfferedReason,
  type RowMachineProposal,
} from "./basicPriceImportDisplay.ts";
import { buildLookupPath, createLatestRequestGate } from "./catalogSearch.ts";

const baseRow = (overrides: Partial<BasicPriceImportRowSummary> = {}): BasicPriceImportRowSummary => ({
  id: "row-1",
  status: "NEEDS_REVIEW",
  resolutionStatus: "UNRESOLVED",
  code: null,
  name: "Pekerja",
  unit: "OH",
  rawPriceDisplayText: "158,333.33",
  proposedCanonicalPrice: "158333.33",
  section: "LABOR",
  sectionProvenance: "SOURCE_SECTION_TITLE",
  sourceCategoryCode: null,
  sourceCategoryName: null,
  sourceRowNumber: 9,
  collisionType: "NONE",
  collisionOfRowId: null,
  resourceCatalogId: null,
  unitDefinitionId: null,
  reasonCodes: [],
  version: 0,
  machineProposal: null,
  ...overrides,
});

const baseBatch = (overrides: Partial<BasicPriceImportBatchSummary> = {}): BasicPriceImportBatchSummary => ({
  batchId: "batch-1",
  status: "NEEDS_REVIEW",
  importFingerprint: "FINGERPRINT",
  effectiveDate: null,
  regionId: null,
  sourceType: null,
  sourceOrigin: null,
  sourceOrganizationName: null,
  // The server's verdict on what this batch may do next. The default mirrors
  // the honest starting state of a freshly previewed batch: nothing is offered
  // yet, and each half already names the first reason why.
  actions: {
    privateUse: { offered: false, reasonCode: "EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE" },
    simprokProposal: { offered: false, reasonCode: "BATCH_NOT_READY_FOR_REVIEW", sourceFamily: null },
    // The review door, from the same server verdict. A freshly previewed batch
    // has stated none of the four required facts, so the room is honestly shut
    // and NAMES which facts are missing rather than only that something is.
    reviewGate: {
      requiredFacts: ["EFFECTIVE_DATE", "REGION", "SOURCE_ORIGIN", "SOURCE_TYPE"],
      missingRequiredFacts: ["EFFECTIVE_DATE", "REGION", "SOURCE_ORIGIN", "SOURCE_TYPE"],
      metadataComplete: false,
      metadataCoherent: true,
      reviewAllowed: false,
      reasonCode: "REQUIRED_METADATA_INCOMPLETE",
    },
  },
  version: 0,
  totalRows: 3,
  needsReviewRows: 1,
  readyForSubmissionRows: 1,
  rejectedRows: 1,
  submittedRows: 0,
  identityPairProvenRows: 0,
  rows: [],
  ...overrides,
});

test("batchStatusLabel names the destination whenever it says diajukan", () => {
  assert.equal(batchStatusLabel("NEEDS_REVIEW"), "Perlu ditinjau");
  // A bare "Diajukan" left the reader to guess where. The curation path is
  // the ONLY destination this word has, so it is said out loud.
  assert.equal(batchStatusLabel("SUBMITTED"), "Sudah diusulkan ke SIMPROK");
});

test("rowStatusLabel says what a row means, not what its table column holds", () => {
  // READY_FOR_SUBMISSION means the identity is settled and one Simpan &
  // Gunakan press would store it. It never meant "heading for curation".
  assert.equal(rowStatusLabel("READY_FOR_SUBMISSION"), "Siap disimpan");
  assert.equal(rowStatusLabel("REJECTED"), "Ditolak");
  // Curation is named only where a real submission record exists.
  assert.equal(rowStatusLabel("SUBMISSION_CREATED"), "Sudah diusulkan ke SIMPROK");
});

test("rowSectionLabel translates workbook sections", () => {
  assert.equal(rowSectionLabel("LABOR"), "Upah");
  assert.equal(rowSectionLabel("MATERIAL"), "Bahan");
  assert.equal(rowSectionLabel("EQUIPMENT"), "Peralatan");
});

test("collisionWarningLabel is null for NONE — callers render no badge", () => {
  assert.equal(collisionWarningLabel("NONE"), null);
});

test("collisionWarningLabel surfaces a same-value collision distinctly from a different-value one", () => {
  const sameValue = collisionWarningLabel("SAME_IDENTITY_SAME_VALUE");
  const differentValue = collisionWarningLabel("SAME_IDENTITY_DIFFERENT_VALUE");
  assert.ok(sameValue && sameValue.length > 0);
  assert.ok(differentValue && differentValue.length > 0);
  assert.notEqual(sameValue, differentValue);
});

test("formatBatchProgress reports zero rows honestly", () => {
  const batch = baseBatch({ totalRows: 0, needsReviewRows: 0, readyForSubmissionRows: 0, rejectedRows: 0 });
  assert.equal(formatBatchProgress(batch), "Tidak ada baris pada batch ini.");
});

test("formatBatchProgress counts reviewed rows as total minus still-pending", () => {
  const batch = baseBatch({ totalRows: 10, needsReviewRows: 4, readyForSubmissionRows: 5, rejectedRows: 1 });
  // The destinationless "5 siap diajukan" is gone: how far the REVIEW has got
  // is what this line is for, and it kept claiming those rows were pending
  // long after they had been stored.
  assert.equal(formatBatchProgress(batch), "6 dari 10 baris sudah ditinjau (1 ditolak).");
});

// ---------------------------------------------------------------------------
// LIFECYCLE ACTIONS — WHAT REPLACED `canSubmitBatch`.
//
// That function was this page's OWN copy of the server's preconditions, and it
// returned a bare boolean. Both halves of that were the defect: a copy can
// disagree with the server, and a boolean has no reason inside it, so a `false`
// could only ever be rendered as a disabled button — which the browser makes
// inert. The Owner pressed `Ajukan Batch (6 siap)` and received no request, no
// message and no outcome, because there was nothing left to render.
//
// So the tests below no longer assert a DECISION. They assert that the server's
// decision reaches a person as a sentence they can act on.
// ---------------------------------------------------------------------------

/**
 * THE LIST IS NOW EXHAUSTIVENESS-CHECKED BY THE COMPILER, not maintained by
 * hand. It was a bare array literal annotated PrivateUseBlockReason[], and
 * TypeScript does not check an array literal against its element union — so
 * when ALL_READY_ROWS_ALREADY_PRIVATE joined the union, this guard compiled
 * clean and silently stopped covering the one code it was added to cover.
 *
 * Keyed on a Record instead: omit a member and the build fails.
 */
const ALL_PRIVATE_USE_BLOCK_REASONS: Record<PrivateUseBlockReason, true> = {
  BATCH_NOT_MUTABLE: true,
  EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE: true,
  REGION_REQUIRED_BEFORE_PRIVATE_USE: true,
  SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE: true,
  SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE: true,
  NO_ROWS_READY_FOR_PRIVATE_USE: true,
  ALL_READY_ROWS_ALREADY_PRIVATE: true,
};

test("every private-use block reason the server can send has an Indonesian sentence", () => {
  const reasons = Object.keys(
    ALL_PRIVATE_USE_BLOCK_REASONS,
  ) as PrivateUseBlockReason[];
  for (const reason of reasons) {
    const sentence = privateUseBlockSentence(reason);
    assert.ok(sentence && sentence.length > 0, `${reason} has no sentence`);
    assert.doesNotMatch(sentence, /[A-Z]{3,}_[A-Z]/, `${reason} leaks an enum onto the screen`);
  }
});

test("every proposal reason the server can send has an Indonesian sentence", () => {
  const reasons: ProposalNotOfferedReason[] = [
    "ALREADY_PROPOSED",
    "SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION",
    "BATCH_NOT_READY_FOR_REVIEW",
    "EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION",
    "REGION_REQUIRED_BEFORE_SUBMISSION",
    "SOURCE_ORIGIN_REQUIRED_BEFORE_SUBMISSION",
    "SOURCE_TYPE_REQUIRED_BEFORE_SUBMISSION",
    "NO_ROWS_READY_FOR_SUBMISSION",
  ];
  for (const reason of reasons) {
    const sentence = proposalBlockSentence(reason);
    assert.ok(sentence && sentence.length > 0, `${reason} has no sentence`);
    assert.doesNotMatch(sentence, /[A-Z]{3,}_[A-Z]/, `${reason} leaks an enum onto the screen`);
  }
});

test("no block sentence is produced when nothing is blocking", () => {
  assert.equal(privateUseBlockSentence(null), null);
  assert.equal(proposalBlockSentence(null), null);
});

test("the reason the button shows beforehand is the reason a failure shows afterwards", () => {
  // One map, two moments. If these ever diverge a person is told one thing
  // before acting and a different thing after — which is how a room stops
  // being trustworthy even while every individual sentence is true.
  const body = JSON.stringify({ statusCode: 409, message: "NO_ROWS_READY_FOR_PRIVATE_USE" });
  assert.equal(
    lifecycleActionFailureMessage("PRIVATE_USE", 409, body),
    privateUseBlockSentence("NO_ROWS_READY_FOR_PRIVATE_USE"),
  );
});

test("a failure with no named reason never blames the workbook and never claims a partial save", () => {
  for (const status of [401, 403, 404, 409, 500, 0]) {
    for (const kind of ["PRIVATE_USE", "PROPOSAL"] as const) {
      const message = lifecycleActionFailureMessage(kind, status, "not json at all");
      assert.doesNotMatch(message, /berkas|workbook|dokumen/i, `status ${status} blamed the document`);
      assert.ok(message.length > 0);
    }
  }
});

test("a 403 says the authority is missing, not that the data was bad", () => {
  const message = lifecycleActionFailureMessage("PRIVATE_USE", 403, "");
  assert.match(message, /kewenangan/);
  assert.match(message, /Tidak ada yang tersimpan/);
});

test("formatPrivateUseOutcome counts from the server, and a second press is not a second success", () => {
  assert.match(
    formatPrivateUseOutcome({ createdCount: 6, alreadyPrivateCount: 0 }),
    /^6 harga tersimpan dan siap dipakai/,
  );
  // Pressing again over unchanged rows: the writer is idempotent, so nothing
  // was created. Reporting "6 harga tersimpan" a second time would be a lie
  // about work that did not happen.
  const repeat = formatPrivateUseOutcome({ createdCount: 0, alreadyPrivateCount: 6 });
  assert.match(repeat, /sudah tersimpan sebelumnya/);
  assert.match(repeat, /Tidak ada yang berubah/);
  assert.equal(
    formatPrivateUseOutcome({ createdCount: 0, alreadyPrivateCount: 0 }),
    "Tidak ada baris yang tersimpan.",
  );
  assert.match(
    formatPrivateUseOutcome({ createdCount: 2, alreadyPrivateCount: 4 }),
    /^2 harga tersimpan .* 4 harga sudah tersimpan sebelumnya\.$/,
  );
});

test("isRowMutable is true only for NEEDS_REVIEW rows", () => {
  assert.equal(isRowMutable(baseRow({ status: "NEEDS_REVIEW" })), true);
  assert.equal(isRowMutable(baseRow({ status: "READY_FOR_SUBMISSION" })), false);
  assert.equal(isRowMutable(baseRow({ status: "REJECTED" })), false);
  assert.equal(isRowMutable(baseRow({ status: "SUBMISSION_CREATED" })), false);
});

test("lookup paths target the dedicated routes and preserve explicit filters", () => {
  assert.equal(
    buildLookupPath("resources", { q: "Kawat BRC", type: "MATERIAL", page: 2, limit: 20 }),
    "/basic-price-import-lookups/resources?q=Kawat+BRC&type=MATERIAL&page=2&limit=20",
  );
  assert.equal(
    buildLookupPath("units", { q: "M3", dimension: "VOLUME", kind: "CANONICAL" }),
    "/basic-price-import-lookups/units?q=M3&dimension=VOLUME&kind=CANONICAL",
  );
});

test("latest request gate prevents an older search response from replacing a newer result", () => {
  const gate = createLatestRequestGate();
  const older = gate.begin();
  const newer = gate.begin();
  assert.equal(gate.isLatest(older), false);
  assert.equal(gate.isLatest(newer), true);
  gate.invalidate();
  assert.equal(gate.isLatest(newer), false);
});

// ---------------------------------------------------------------------------
// INT-CONNECT-01 — the review room's side of the contract.
//
// These guard BEHAVIOUR, not wording: that a proven answer reaches the form,
// that an unproven one never does, that an unknown category is never renamed
// into a known one, and that a disabled action always says why.
// ---------------------------------------------------------------------------

const provenProposal = (over: Partial<RowMachineProposal> = {}): RowMachineProposal => ({
  rowId: "row-1",
  unit: {
    rawUnit: "ltr",
    status: "RESOLVED",
    unitDefinitionId: "unit-liter",
    unitCode: "LITER",
    unitDisplayName: "Litre",
    unitSymbol: "liter",
    unitDimension: "VOLUME",
    unitKind: "CANONICAL",
    reasonCode: "EXACT_UNIT_IDENTITY",
    contextScoped: false,
    trustedContext: null,
    policyVersion: "KAMUS_UNIT_KERNEL_01A_V1",
  },
  resource: {
    status: "RESOLVED",
    authority: "EXACT_CANONICAL_MATCH",
    resourceCatalogId: "cat-air",
    resourceName: "Air",
    resourceCode: null,
    resourceType: "MATERIAL",
    resourceBaseUnit: "Liter",
    candidates: [],
    reasonCodes: ["EXACT_CANONICAL_MATCH"],
    policyVersion: "RM03D2_RESOURCE_IDENTITY_EVIDENCE_V2",
    admissibleForResolve: true,
  },
  identityPairProven: true,
  blockingFacts: [],
  ...over,
});

test("BP-INT-16: a proven row hands the reviewer the answer instead of two empty boxes", () => {
  const row = baseRow({ machineProposal: provenProposal() });
  const resource = machinePickedResource(row);
  const unit = machinePickedUnit(row);
  assert.ok(resource);
  assert.ok(unit);
  assert.equal(resource.id, "cat-air");
  assert.equal(resource.name, "Air");
  assert.equal(unit.id, "unit-liter");
  assert.equal(unit.displayName, "Litre");
  assert.equal(unit.dimension, "VOLUME");
});

test("BP-INT-06/07: an unproven resource is never pre-filled, however strong it looks", () => {
  const base = provenProposal();
  const ambiguous: RowMachineProposal = {
    ...base,
    identityPairProven: false,
    blockingFacts: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
    resource: {
      ...base.resource,
      status: "NEEDS_REVIEW",
      authority: "EVIDENCE_CANDIDATE",
      resourceCatalogId: null,
      reasonCodes: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
    },
  };
  assert.equal(machinePickedResource(baseRow({ machineProposal: ambiguous })), null);
  // And a row nobody asked about is not a row with no answer.
  assert.equal(machinePickedResource(baseRow({ machineProposal: null })), null);
  assert.equal(machinePickedUnit(baseRow({ machineProposal: null })), null);
});

test("a proven unit still reaches the reviewer when the resource beside it is open", () => {
  // The whole point of judging the two legs separately: on the Owner's workbook
  // the Unit authority proves far more rows than Resource Identity does, and
  // withholding those units would recreate the busywork this slice removes.
  const base = provenProposal();
  const unitOnly: RowMachineProposal = {
    ...base,
    identityPairProven: false,
    blockingFacts: ["RESOURCE_NOT_FOUND"],
    resource: {
      ...base.resource,
      status: "UNRESOLVED",
      authority: null,
      resourceCatalogId: null,
      resourceName: null,
      reasonCodes: ["RESOURCE_NOT_FOUND"],
    },
  };
  const row = baseRow({ machineProposal: unitOnly });
  assert.equal(machinePickedResource(row), null);
  assert.equal(machinePickedUnit(row)?.code, "LITER");
});

test("an identified unit whose canonical code did not round-trip is never offered", () => {
  const base = provenProposal();
  // The backend leaves unitDefinitionId null exactly when the resolve endpoint
  // would refuse the pair. Offering it anyway would pre-fill a rejection.
  const notRepresentable: RowMachineProposal = {
    ...base,
    identityPairProven: false,
    blockingFacts: ["UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY"],
    unit: {
      ...base.unit,
      unitDefinitionId: null,
      reasonCode: "UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY",
    },
  };
  assert.equal(machinePickedUnit(baseRow({ machineProposal: notRepresentable })), null);
});

test("a payload that claims a verdict but omits a fact pre-fills nothing", () => {
  const broken = provenProposal();
  const incomplete: RowMachineProposal = {
    ...broken,
    unit: { ...broken.unit, unitKind: null },
  };
  // Better a reviewer who must pick by hand than a selection SIMPROK invented.
  assert.equal(machinePickedUnit(baseRow({ machineProposal: incomplete })), null);
  // The other leg is untouched by its neighbour's broken payload.
  assert.ok(machinePickedResource(baseRow({ machineProposal: incomplete })));
});

test("rowMachineState separates proven, needs-attention, unknown and never-asked", () => {
  assert.equal(rowMachineState(baseRow({ machineProposal: provenProposal() })), "PROVEN");
  assert.equal(
    rowMachineState(
      baseRow({
        machineProposal: provenProposal({
          identityPairProven: false,
          resource: { ...provenProposal().resource, status: "NEEDS_REVIEW", resourceCatalogId: null, candidates: [{ resourceCatalogId: "c1", name: "Semen", code: null, type: "MATERIAL", baseUnit: "Kg", evidence: [], specificationUnproved: false, unprovedSpecificationFacts: [], hasPriorHumanDecision: false }] },
        }),
      }),
    ),
    "ATTENTION",
  );
  assert.equal(
    rowMachineState(
      baseRow({
        machineProposal: provenProposal({
          identityPairProven: false,
          unit: { ...provenProposal().unit, status: "NEEDS_REVIEW", unitDefinitionId: null, unitCode: null },
          resource: { ...provenProposal().resource, status: "UNRESOLVED", resourceCatalogId: null, candidates: [] },
        }),
      }),
    ),
    "UNKNOWN",
  );
  assert.equal(rowMachineState(baseRow({ machineProposal: null })), "NOT_ASKED");
});

test("BP-INT-14: a disabled Selesaikan always names what is still missing", () => {
  const row = baseRow({
    machineProposal: provenProposal({
      identityPairProven: false,
      resource: { ...provenProposal().resource, status: "UNRESOLVED", resourceCatalogId: null, candidates: [], reasonCodes: ["RESOURCE_NOT_FOUND"] },
      blockingFacts: ["RESOURCE_NOT_FOUND"],
    }),
  });
  const reason = completionBlockReason(row, { resource: false, unit: true, busy: false });
  assert.ok(reason);
  assert.match(reason, /^1 hal lagi diperlukan: /);
  assert.match(reason, /katalog/);
});

test("BP-INT-13: a reviewer holding both selections sees no block at all", () => {
  const row = baseRow({ machineProposal: provenProposal() });
  assert.equal(completionBlockReason(row, { resource: true, unit: true, busy: false }), null);
  // Busy is a different silence from a missing fact, and says so.
  assert.equal(
    completionBlockReason(row, { resource: true, unit: true, busy: true }),
    "Sedang memproses...",
  );
});

test("a fact SIMPROK proved but the reviewer cleared is reported as unpicked, not unknown", () => {
  // The machine proved the unit. If the human deletes it, telling them "satuan
  // belum dikenali" would be false — SIMPROK knows it perfectly well.
  const row = baseRow({ machineProposal: provenProposal() });
  const reason = completionBlockReason(row, { resource: true, unit: false, busy: false });
  assert.equal(reason, "1 hal lagi diperlukan: Satuan belum ditentukan.");
});

test("both legs missing are counted and named together, never duplicated", () => {
  const row = baseRow({
    machineProposal: provenProposal({
      identityPairProven: false,
      blockingFacts: ["ROW_SOURCE_SECTION_UNRESOLVED", "UNIT_REQUIRED"],
    }),
  });
  const reason = completionBlockReason(row, { resource: false, unit: false, busy: false });
  assert.equal(
    reason,
    "2 hal lagi diperlukan: Kategori sumber daya belum dapat dipastikan. Dokumen sumber tidak mencantumkan satuan pada baris ini.",
  );
});

test("an unnamed code still reaches the reviewer rather than vanishing", () => {
  assert.equal(blockingFactLabel("SOME_FUTURE_CODE"), "SOME_FUTURE_CODE");
  assert.equal(blockingFactLabel("UNKNOWN_UNIT_ALIAS"), "Satuan belum dikenali.");
});

test("BP-INT-09: an unknown category is never renamed into one SIMPROK knows", () => {
  const unknown = baseRow({ section: null, sourceCategoryName: "ALAT BANTU", sectionProvenance: null });
  const shown = rowSectionDisplay(unknown);
  assert.match(shown, /belum dapat dipastikan/);
  assert.match(shown, /ALAT BANTU/);
  // Not one of the three known families.
  assert.doesNotMatch(shown, /^(Bahan|Upah|Peralatan)$/);
  // And a known family still reads normally.
  assert.equal(rowSectionDisplay(baseRow({ section: "MATERIAL" })), "Bahan");
});

test("an unknown category with no source words says so plainly rather than guessing", () => {
  const bare = baseRow({ section: null, sourceCategoryName: null, sourceCategoryCode: null });
  assert.equal(rowSectionDisplay(bare), "Kategori belum dapat dipastikan");
});

test("BP-INT-15: the batch summary counts the rows it was given, and predicts nothing", () => {
  // Deliberately COUNTED FROM ROWS, not from the batch-level integers. The
  // earlier version of this test asserted `needsReviewRows - proven` arithmetic,
  // which is exactly the flattening that made a "belum dikenali" row read as a
  // decision waiting. Counting rows is what makes the summary agree with the
  // labels rendered beside them.
  const summary = formatMachineFirstSummary(
    baseBatch({
      totalRows: 3,
      needsReviewRows: 3,
      readyForSubmissionRows: 0,
      rejectedRows: 0,
      identityPairProvenRows: 1,
      rows: [
        baseRow({ id: "p", machineProposal: provenProposal() }),
        baseRow({ id: "a", machineProposal: attentionProposal() }),
        baseRow({ id: "u", machineProposal: unknownProposal() }),
      ],
    }),
  );
  assert.match(summary, /3 baris terbaca/);
  assert.match(summary, /1 dikenali otomatis/);
  assert.match(summary, /1 perlu keputusan Anda/);
  assert.match(summary, /1 belum dikenali/);
});

test("a batch whose rows were never asked about claims no open questions at all", () => {
  const summary = formatMachineFirstSummary(
    baseBatch({
      totalRows: 5,
      needsReviewRows: 0,
      readyForSubmissionRows: 5,
      rejectedRows: 0,
      identityPairProvenRows: 0,
      rows: Array.from({ length: 5 }, (_unused, index) =>
        baseRow({ id: `done-${index}`, status: "READY_FOR_SUBMISSION", machineProposal: null }),
      ),
    }),
  );
  assert.match(summary, /0 perlu keputusan Anda/);
  assert.match(summary, /0 belum dikenali/);
  // THE INTERNAL ROW STATE IS NOT A SUMMARY SEGMENT ANY MORE. It used to read
  // "5 siap diajukan" — a curation word for a row heading nowhere — and it went
  // on saying it after those rows were stored. What is stored is reported as
  // stored; nothing else claims to know what happens next.
  assert.doesNotMatch(summary, /siap diajukan/);
  assert.doesNotMatch(summary, /diajukan/);
});

test("GATE A: an identity SIMPROK proved but this workspace may not select is never pre-filled", () => {
  const base = provenProposal();
  // The shared authority resolved it — truthfully — against a GLOBAL catalog row.
  // The Basic Price resolve endpoint demands strict workspace equality, so
  // pre-filling it would hand the reviewer a selection that then 409s.
  const global: RowMachineProposal = {
    ...base,
    identityPairProven: false,
    blockingFacts: ["RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE"],
    resource: { ...base.resource, admissibleForResolve: false },
  };
  const row = baseRow({ machineProposal: global });

  assert.equal(machinePickedResource(row), null);
  // The unit leg is untouched by the resource leg's inadmissibility.
  assert.equal(machinePickedUnit(row)?.code, "LITER");
});

test("GATE A: the reviewer is told why in Indonesian, never in an UPPER_SNAKE code", () => {
  const label = blockingFactLabel("RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE");
  assert.notEqual(label, "RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE");
  assert.match(label, /katalog global/);
});

test("every blocking fact the backend can emit has a human sentence", () => {
  // The seam's own vocabulary, taken from its compose() and unit legs. A code
  // without a sentence falls through to itself, which is honest but reads as a
  // leak — so the set the backend can actually produce is pinned here.
  const emitted = [
    "ROW_SOURCE_SECTION_UNRESOLVED",
    "RESOURCE_TYPE_MISMATCH",
    "RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE",
    "RESOURCE_NOT_FOUND",
    "MULTIPLE_CANDIDATES_NEEDS_REVIEW",
    "STRONG_CANDIDATE_NEEDS_REVIEW",
    "SPECIFICATION_UNPROVED",
    "SPECIFICATION_CONFLICT",
    "UNIT_REQUIRED",
    "UNKNOWN_UNIT_ALIAS",
    "AMBIGUOUS_UNIT_ALIAS",
    "CONTEXT_REQUIRED_UNIT_ALIAS",
    "FOREIGN_CONTEXT_UNIT_ALIAS",
    "UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY",
  ];
  for (const code of emitted) {
    assert.notEqual(blockingFactLabel(code), code, `no sentence for ${code}`);
  }
});

// ---------------------------------------------------------------------------
// GATE E — "perlu keputusan Anda" and "belum dikenali" are two different asks.
// ---------------------------------------------------------------------------

const attentionProposal = (): RowMachineProposal => {
  const base = provenProposal();
  return {
    ...base,
    identityPairProven: false,
    blockingFacts: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
    resource: {
      ...base.resource,
      status: "NEEDS_REVIEW",
      authority: "EVIDENCE_CANDIDATE",
      resourceCatalogId: null,
      resourceName: null,
      admissibleForResolve: false,
      reasonCodes: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
      candidates: [
        { resourceCatalogId: "c1", name: "Semen A", code: null, type: "MATERIAL", baseUnit: "Kg", evidence: ["NAME_TOKEN_CONTAINMENT"], specificationUnproved: false, unprovedSpecificationFacts: [], hasPriorHumanDecision: false },
        { resourceCatalogId: "c2", name: "Semen B", code: null, type: "MATERIAL", baseUnit: "Kg", evidence: ["NAME_TOKEN_CONTAINMENT"], specificationUnproved: false, unprovedSpecificationFacts: [], hasPriorHumanDecision: false },
      ],
    },
  };
};

const unknownProposal = (): RowMachineProposal => {
  const base = provenProposal();
  return {
    ...base,
    identityPairProven: false,
    blockingFacts: ["UNKNOWN_UNIT_ALIAS", "RESOURCE_NOT_FOUND"],
    unit: { ...base.unit, status: "NEEDS_REVIEW", unitDefinitionId: null, unitCode: null, reasonCode: "UNKNOWN_UNIT_ALIAS" },
    resource: {
      ...base.resource,
      status: "UNRESOLVED",
      authority: null,
      resourceCatalogId: null,
      resourceName: null,
      admissibleForResolve: false,
      candidates: [],
      reasonCodes: ["RESOURCE_NOT_FOUND"],
    },
  };
};

test("GATE E: the batch counts attention and unknown SEPARATELY, never lumped", () => {
  const batch = baseBatch({
    totalRows: 4,
    needsReviewRows: 3,
    readyForSubmissionRows: 1,
    rejectedRows: 0,
    identityPairProvenRows: 1,
    rows: [
      baseRow({ id: "r1", machineProposal: provenProposal() }),
      baseRow({ id: "r2", machineProposal: attentionProposal() }),
      baseRow({ id: "r3", machineProposal: unknownProposal() }),
      baseRow({ id: "r4", status: "READY_FOR_SUBMISSION", machineProposal: null }),
    ],
  });

  const tally = countRowMachineStates(batch);
  assert.equal(tally.proven, 1);
  assert.equal(tally.attention, 1);
  assert.equal(tally.unknown, 1);
  assert.equal(tally.notAsked, 1);

  const summary = formatMachineFirstSummary(batch);
  assert.match(summary, /1 dikenali otomatis/);
  assert.match(summary, /1 perlu keputusan Anda/);
  assert.match(summary, /1 belum dikenali/);
});

test("GATE E: row label and batch tally obey ONE law and cannot disagree", () => {
  // The defect this replaces: the batch computed `needsReviewRows - proven`, so a
  // row rendered "Belum dikenali" was simultaneously counted as a decision
  // waiting. Both levels now run through rowMachineState, so the counts ARE the
  // labels.
  const rows = [
    baseRow({ id: "a", machineProposal: provenProposal() }),
    baseRow({ id: "b", machineProposal: attentionProposal() }),
    baseRow({ id: "c", machineProposal: unknownProposal() }),
    baseRow({ id: "d", machineProposal: unknownProposal() }),
  ];
  const batch = baseBatch({ totalRows: 4, needsReviewRows: 4, readyForSubmissionRows: 0, rejectedRows: 0, identityPairProvenRows: 1, rows });
  const tally = countRowMachineStates(batch);

  const labelled = rows.map((r) => rowMachineState(r));
  assert.equal(labelled.filter((s) => s === "PROVEN").length, tally.proven);
  assert.equal(labelled.filter((s) => s === "ATTENTION").length, tally.attention);
  assert.equal(labelled.filter((s) => s === "UNKNOWN").length, tally.unknown);
});

test("GATE E: a row already decided is reported by its status, not as an open question", () => {
  const batch = baseBatch({
    totalRows: 2,
    needsReviewRows: 0,
    readyForSubmissionRows: 1,
    rejectedRows: 1,
    identityPairProvenRows: 0,
    rows: [
      baseRow({ id: "done", status: "READY_FOR_SUBMISSION", machineProposal: null }),
      baseRow({ id: "no", status: "REJECTED", machineProposal: null }),
    ],
  });
  const tally = countRowMachineStates(batch);
  assert.equal(tally.attention, 0);
  assert.equal(tally.unknown, 0);
  assert.equal(tally.notAsked, 2);
  assert.match(formatMachineFirstSummary(batch), /0 perlu keputusan Anda/);
  assert.match(formatMachineFirstSummary(batch), /0 belum dikenali/);
});

test("GATE B: nothing in the display claims a row is finished, only that its identity pair is proven", () => {
  // `identityPairProven` is about the two legs. The backend still decides the
  // row's fate from price and collision facts no proposal sees, so the summary
  // must not say "selesai".
  const batch = baseBatch({
    totalRows: 1,
    needsReviewRows: 1,
    readyForSubmissionRows: 0,
    rejectedRows: 0,
    identityPairProvenRows: 1,
    rows: [baseRow({ machineProposal: provenProposal() })],
  });
  const summary = formatMachineFirstSummary(batch);
  assert.match(summary, /dikenali otomatis/);
  assert.doesNotMatch(summary, /selesai/i);
  // And a proven pair is still a NEEDS_REVIEW row until a human acts.
  assert.equal(isRowMutable(batch.rows[0]), true);
});

test("PRIVACY: the candidate contract carries only the EXISTENCE of a prior human decision", () => {
  // The outward contract is a bare boolean by design. If it ever grows back into
  // an object carrying who/when/why, this fails — the browser is the wrong place
  // for another person's private record, even inside one workspace.
  const base = provenProposal();
  const withHistory: RowMachineProposal = {
    ...base,
    identityPairProven: false,
    blockingFacts: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
    resource: {
      ...base.resource,
      status: "NEEDS_REVIEW",
      resourceCatalogId: null,
      admissibleForResolve: false,
      candidates: [
        { resourceCatalogId: "c1", name: "Semen A", code: null, type: "MATERIAL", baseUnit: "Kg", evidence: ["REVIEWED_MAPPING_NAME_MATCH"], specificationUnproved: false, unprovedSpecificationFacts: [], hasPriorHumanDecision: true },
        { resourceCatalogId: "c2", name: "Semen B", code: null, type: "MATERIAL", baseUnit: "Kg", evidence: ["NAME_TOKEN_CONTAINMENT"], specificationUnproved: false, unprovedSpecificationFacts: [], hasPriorHumanDecision: false },
      ],
    },
  };
  const row = baseRow({ machineProposal: withHistory });

  const candidates = row.machineProposal!.resource.candidates;
  assert.equal(candidates[0].hasPriorHumanDecision, true);
  assert.equal(candidates[1].hasPriorHumanDecision, false);
  // The signal is a boolean and nothing more — no who, no when, no why.
  for (const candidate of candidates) {
    assert.equal(typeof candidate.hasPriorHumanDecision, "boolean");
    assert.ok(!("priorHumanDecision" in candidate));
    assert.ok(!("reviewerAccountId" in candidate));
    assert.ok(!("decidedAt" in candidate));
    assert.ok(!("reason" in candidate));
  }
  // Nothing private survives serialization either.
  const payload = JSON.stringify(row.machineProposal);
  assert.doesNotMatch(payload, /reviewerAccountId|decidedAt|priorHumanDecision/);
});

// ---------------------------------------------------------------------------
// RICH INSIDE, SIMPLE OUTSIDE — the human surface carries no internal identity.
//
// The fixtures carry the REAL catalog ids the canonical database uses. The
// authorities' `explanation` strings no longer appear here at all — the outward
// contract does not have that field, which is the durable half of the repair.
// What these tests hold is the other half: that every sentence a reviewer reads
// is composed from the structured facts below, and that an id which is lawfully
// present as a KEY never becomes text.
// ---------------------------------------------------------------------------

/** Two ResourceCatalog ids of the shape the canonical database actually uses. */
const CAT_A = "9f2b1c4e-7d3a-4b8e-9c1f-2a6d8e0b3c47";
const CAT_B = "1c7e5a90-42bd-4f16-8a03-b5d9e7412f88";

/** Anything a normal reviewer must never be shown, in one place. */
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** An UPPER_SNAKE token — the shape every raw reason/blocking code takes. */
const RAW_ENUM_SHAPE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const FORBIDDEN_WORDS = [
  "resourceCatalogId",
  "unitDefinitionId",
  "ResourceCatalog",
  "UnitDefinition",
  "Service",
  "policyVersion",
  "candidateContextDigest",
  "matchedAliasIds",
  "reviewerAccountId",
  "decidedAt",
  "acct-",
  "KAMUS_UNIT_KERNEL",
  "RM03D2",
];

/** Assert one string is fit for an ordinary human screen. */
const assertHumanSafe = (text: string, where: string) => {
  assert.doesNotMatch(text, UUID_SHAPE, `${where}: a database id reached the screen`);
  assert.doesNotMatch(text, RAW_ENUM_SHAPE, `${where}: a raw code reached the screen`);
  for (const word of FORBIDDEN_WORDS) {
    assert.equal(text.includes(word), false, `${where}: leaked "${word}"`);
  }
};

/** Every human-visible string of a row's machine block, flattened. */
const visibleText = (narrative: ReturnType<typeof rowMachineNarrative>): string[] => {
  assert.ok(narrative, "expected a narrative");
  return [
    narrative.stateLabel,
    narrative.unit,
    narrative.resource,
    ...narrative.candidates.map((c) => c.text),
  ];
};

// --- CASE A — an ambiguous resource whose candidates carry real ids --------

const ambiguousWithRealIds = (): RowMachineProposal => {
  const base = provenProposal();
  return {
    ...base,
    identityPairProven: false,
    blockingFacts: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
    resource: {
      ...base.resource,
      status: "NEEDS_REVIEW",
      authority: "EVIDENCE_CANDIDATE",
      resourceCatalogId: null,
      resourceName: null,
      resourceCode: null,
      admissibleForResolve: false,
      reasonCodes: ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"],
      candidates: [
        { resourceCatalogId: CAT_A, name: "Semen Portland 40 kg", code: "M-101", type: "MATERIAL", baseUnit: "Zak", evidence: ["NAME_TOKEN_CONTAINMENT"], specificationUnproved: false, unprovedSpecificationFacts: [], hasPriorHumanDecision: false },
        { resourceCatalogId: CAT_B, name: "Semen Portland 50 kg", code: null, type: "MATERIAL", baseUnit: "Zak", evidence: ["NAME_TOKEN_CONTAINMENT"], specificationUnproved: true, unprovedSpecificationFacts: ["50 kg"], hasPriorHumanDecision: false },
      ],
    },
  };
};

test("CASE A: an ambiguous resource is explained without ever printing a catalog id", () => {
  const row = baseRow({ machineProposal: ambiguousWithRealIds() });
  const narrative = rowMachineNarrative(row);
  assert.ok(narrative);

  // The reviewer keeps everything they can act on...
  assert.equal(narrative.state, "ATTENTION");
  assert.match(narrative.resource, /2 pilihan/);
  assert.equal(narrative.candidates.length, 2);
  assert.match(narrative.candidates[0].text, /Semen Portland 40 kg/);
  assert.match(narrative.candidates[0].text, /M-101/);
  assert.match(narrative.candidates[0].text, /Zak/);
  assert.match(narrative.candidates[1].text, /Tanpa kode/);
  assert.match(narrative.candidates[1].text, /belum ditegaskan: 50 kg/);

  // ...and none of the machinery behind it.
  for (const text of visibleText(narrative)) assertHumanSafe(text, "case A");

  // The id survives as a KEY, which is lawful and is exactly where it stops.
  assert.equal(narrative.candidates[0].key, CAT_A);
  assert.equal(narrative.candidates[1].key, CAT_B);
  // Both ids ARE in the payload the browser received — that is the decision
  // surface. Neither is in anything the reviewer reads.
  assert.equal(JSON.stringify(row.machineProposal).includes(CAT_A), true);
  assert.doesNotMatch(narrative.candidates[0].text, UUID_SHAPE);
});

// --- CASE B — a resolved resource ----------------------------------------

test("CASE B: a recognised row says so concisely, with no internal identity", () => {
  const row = baseRow({ machineProposal: provenProposal() });
  const narrative = rowMachineNarrative(row);
  assert.ok(narrative);

  assert.equal(narrative.state, "PROVEN");
  assert.match(narrative.resource, /dikenali otomatis: Air/);
  assert.match(narrative.unit, /dikenali sebagai Litre/);
  // A proven row is not asked to choose between anything.
  assert.equal(narrative.candidates.length, 0);
  for (const text of visibleText(narrative)) assertHumanSafe(text, "case B");
});

test("CASE B: a proven context-scoped unit names the WORK, not the enum", () => {
  const base = provenProposal();
  const row = baseRow({
    machineProposal: {
      ...base,
      unit: {
        ...base.unit,
        rawUnit: "jam",
        unitDisplayName: "Jam",
        contextScoped: true,
        trustedContext: "LABOR",
        reasonCode: "CONTEXT_SCOPED_UNIT_ALIAS",
      },
    },
  });
  const narrative = rowMachineNarrative(row);
  assert.ok(narrative);
  assert.match(narrative.unit, /untuk pekerjaan Upah/);
  assert.doesNotMatch(narrative.unit, /LABOR/);
  for (const text of visibleText(narrative)) assertHumanSafe(text, "case B scoped");
});

test("CASE B: an identity SIMPROK proved but this workspace may not select is not sold as recognised", () => {
  const base = provenProposal();
  const row = baseRow({
    machineProposal: {
      ...base,
      identityPairProven: false,
      blockingFacts: ["RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE"],
      resource: { ...base.resource, admissibleForResolve: false },
    },
  });
  const narrative = rowMachineNarrative(row);
  assert.ok(narrative);
  assert.doesNotMatch(narrative.resource, /dikenali otomatis/);
  assert.match(narrative.resource, /katalog global/);
  for (const text of visibleText(narrative)) assertHumanSafe(text, "case B inadmissible");
});

// --- CASE C — nothing found ----------------------------------------------

test("CASE C: an unrecognised row says so honestly, invents no candidate, blames no one", () => {
  const base = provenProposal();
  const row = baseRow({
    machineProposal: {
      ...base,
      identityPairProven: false,
      blockingFacts: ["UNKNOWN_UNIT_ALIAS", "RESOURCE_NOT_FOUND"],
      unit: { ...base.unit, status: "NEEDS_REVIEW", unitDefinitionId: null, unitCode: null, unitDisplayName: null, reasonCode: "UNKNOWN_UNIT_ALIAS" },
      resource: {
        ...base.resource,
        status: "UNRESOLVED",
        authority: null,
        resourceCatalogId: null,
        resourceName: null,
        resourceCode: null,
        admissibleForResolve: false,
        candidates: [],
        reasonCodes: ["RESOURCE_NOT_FOUND"],
      },
    },
  });
  const narrative = rowMachineNarrative(row);
  assert.ok(narrative);

  assert.equal(narrative.state, "UNKNOWN");
  assert.match(narrative.resource, /belum menemukan sumber daya yang dapat dibuktikan/);
  assert.match(narrative.resource, /katalog/); // it still says WHY
  assert.equal(narrative.candidates.length, 0, "nothing may be invented");
  assert.match(narrative.unit, /belum dikenali/i);
  for (const text of visibleText(narrative)) assertHumanSafe(text, "case C");
});

test("CASE C: a source that stated no unit at all is told that, not told the unit is unknown", () => {
  const base = provenProposal();
  const row = baseRow({
    machineProposal: {
      ...base,
      identityPairProven: false,
      blockingFacts: ["UNIT_REQUIRED"],
      unit: { ...base.unit, rawUnit: null, status: "NOT_STATED", unitDefinitionId: null, unitCode: null, unitDisplayName: null, reasonCode: "UNIT_REQUIRED" },
    },
  });
  const narrative = rowMachineNarrative(row);
  assert.ok(narrative);
  assert.match(narrative.unit, /tidak mencantumkan satuan/);
  for (const text of visibleText(narrative)) assertHumanSafe(text, "case C unstated");
});

// --- CASE D — a prior human decision, as existence and nothing more -------

test("CASE D: the prior-human signal survives, and carries no who / when / why", () => {
  const base = ambiguousWithRealIds();
  const row = baseRow({
    machineProposal: {
      ...base,
      resource: {
        ...base.resource,
        candidates: base.resource.candidates.map((c, i) =>
          i === 0 ? { ...c, hasPriorHumanDecision: true } : c,
        ),
      },
    },
  });
  const narrative = rowMachineNarrative(row);
  assert.ok(narrative);

  assert.match(narrative.candidates[0].text, /pernah dipilih manusia sebelumnya/);
  assert.doesNotMatch(narrative.candidates[1].text, /pernah dipilih manusia/);

  const visible = visibleText(narrative).join("\n");
  for (const secret of ["acct-andi", "2026-05-04", "sesuai brosur pabrik", "generasi 1"]) {
    assert.equal(visible.includes(secret), false, `a private fact leaked: ${secret}`);
  }
  for (const text of visibleText(narrative)) assertHumanSafe(text, "case D");
});

// --- the authorities were not asked --------------------------------------

test("a row nobody asked about produces NO narrative, rather than an empty verdict", () => {
  assert.equal(rowMachineNarrative(baseRow({ machineProposal: null })), null);
});

// --- the disabled action explains itself in language ----------------------

test("a disabled Selesaikan never falls back to an UPPER_SNAKE code", () => {
  const base = provenProposal();
  const row = baseRow({
    machineProposal: {
      ...base,
      identityPairProven: false,
      // A code no label table has a sentence for — the case the old fallback
      // would have printed raw onto the reviewer's screen.
      blockingFacts: ["SOME_FUTURE_CODE_NOBODY_LABELLED"],
    },
  });
  const reason = completionBlockReason(row, { resource: false, unit: true, busy: false });
  assert.ok(reason);
  assert.doesNotMatch(reason, RAW_ENUM_SHAPE);
  assert.match(reason, /belum dapat dibuktikan/);
});

test("humanFact NEVER answers with the code itself, however new the code is", () => {
  // The one difference from blockingFactLabel, pinned. The diagnostic reader
  // still gets the code; the reviewer gets language either way.
  assert.equal(blockingFactLabel("A_CODE_WITH_NO_SENTENCE"), "A_CODE_WITH_NO_SENTENCE");
  assert.equal(humanFact("A_CODE_WITH_NO_SENTENCE"), HUMAN_FACT_FALLBACK);
  assert.doesNotMatch(humanFact("A_CODE_WITH_NO_SENTENCE"), RAW_ENUM_SHAPE);
  // Where a sentence exists, both accessors agree — one table, one truth.
  assert.equal(humanFact("RESOURCE_NOT_FOUND"), blockingFactLabel("RESOURCE_NOT_FOUND"));
});

test("a labelled blocking fact still gets its OWN sentence, not the generic one", () => {
  const base = provenProposal();
  const row = baseRow({
    machineProposal: { ...base, identityPairProven: false, blockingFacts: ["RESOURCE_NOT_FOUND"] },
  });
  const reason = completionBlockReason(row, { resource: false, unit: true, busy: false });
  assert.ok(reason);
  assert.match(reason, /belum ditemukan di katalog/);
  assert.equal(reason.includes(HUMAN_FACT_FALLBACK), false);
});

// --- the row's own notes --------------------------------------------------

test("row notes are said in words, and an untranslated code is COUNTED, never printed", () => {
  const row = baseRow({
    reasonCodes: ["PRICE_CELL_IS_TEXT_NOT_NUMBER", "RESOURCE_CODE_MISSING", "UNIT_REQUIRED", "SOMETHING_NEW_FROM_INTAKE"],
  });
  const notes = rowNoteLines(row);

  assert.equal(notes.human.length, 3);
  for (const line of notes.human) assert.doesNotMatch(line, RAW_ENUM_SHAPE);
  assert.ok(notes.human.some((n) => /teks, bukan angka/.test(n)));
  assert.ok(notes.human.some((n) => /tidak mencantumkan kode/.test(n)));
  // UNIT_REQUIRED is NOT restated in the row table — it falls through to the
  // one shared sentence, so a code never has two spellings.
  assert.ok(notes.human.some((n) => n === blockingFactLabel("UNIT_REQUIRED")));

  // The unexplained fact is neither dropped nor spelled out.
  assert.equal(notes.untranslatedCount, 1);
  assert.ok(notes.technicalNotice);
  assert.match(notes.technicalNotice, /1 informasi teknis tambahan/);
  assert.doesNotMatch(notes.technicalNotice, RAW_ENUM_SHAPE);
  assert.equal(JSON.stringify(notes).includes("SOMETHING_NEW_FROM_INTAKE"), false);
});

test("Detail Teknis is not a place where enums become acceptable — it counts them", () => {
  // The correction this pins: moving programmer vocabulary down the page does
  // not make it readable. Two unexplained codes produce ONE sentence naming a
  // number, and neither code appears anywhere in what a reviewer can read.
  const notes = rowNoteLines(
    baseRow({ reasonCodes: ["FUTURE_CODE_ONE", "FUTURE_CODE_TWO", "FUTURE_CODE_ONE"] }),
  );
  assert.deepEqual(notes.human, []);
  assert.equal(notes.untranslatedCount, 2, "de-duplicated, then counted");
  assert.ok(notes.technicalNotice);
  assert.match(notes.technicalNotice, /^2 informasi teknis tambahan/);
  const everythingVisible = [...notes.human, notes.technicalNotice].join(" | ");
  assert.doesNotMatch(everythingVisible, RAW_ENUM_SHAPE);
  for (const code of ["FUTURE_CODE_ONE", "FUTURE_CODE_TWO"]) {
    assert.equal(everythingVisible.includes(code), false);
  }
});

test("a rejected row shows its own reason as a sentence, not as a code with a colon", () => {
  const notes = rowNoteLines(baseRow({ status: "REJECTED", reasonCodes: ["REJECTED:harga jauh di atas pasar"] }));
  assert.deepEqual(notes.human, ["Ditolak: harga jauh di atas pasar"]);
  assert.equal(notes.untranslatedCount, 0);
  assert.equal(notes.technicalNotice, null);
});

test("a row with no notes produces no note lines and no technical disclosure", () => {
  const notes = rowNoteLines(baseRow({ reasonCodes: [] }));
  assert.deepEqual(notes.human, []);
  assert.equal(notes.untranslatedCount, 0);
  assert.equal(notes.technicalNotice, null);
});

// ---------------------------------------------------------------------------
// THE OUTWARD CONTRACT ITSELF — no authority prose reaches this side at all.
// ---------------------------------------------------------------------------

test("the browser contract carries NO explanation on either proposal leg", () => {
  // The backend proves its half (see the proposal service spec's data
  // minimization suite). This is the frontend half of the same law: the type
  // has no such field, and a payload that smuggled one in would still never be
  // read — every sentence comes from the structured facts.
  const proposal = provenProposal();
  assert.equal("explanation" in proposal.unit, false);
  assert.equal("explanation" in proposal.resource, false);
  for (const alias of ["rawExplanation", "internalExplanation", "debugExplanation", "machineExplanation"]) {
    assert.equal(alias in proposal.unit, false, `unit leg grew ${alias}`);
    assert.equal(alias in proposal.resource, false, `resource leg grew ${alias}`);
  }
});

// ---------------------------------------------------------------------------
// WHAT SIMPROK HAS ON RECORD — the half that made metadata persistence
// provable through the product instead of only in the database.
// ---------------------------------------------------------------------------

test("savedMetadataLines reports the server's values, and says so when a fact is unset", () => {
  const lines = savedMetadataLines(
    baseBatch({
      sourceOrigin: "GOVERNMENT",
      sourceType: "REGULATION",
      effectiveDate: "2024-01-01T00:00:00.000Z",
      regionId: "region-01",
      region: { id: "region-01", code: "8171", name: "Kota Ambon" },
      // The SERVER decides which temporal question this source answers; the
      // browser never re-derives it from sourceType. A regulation is asked,
      // and read back, as the one source that states its own start.
      temporal: {
        effectiveDateQuestion: "SOURCE_STATED_START",
        reverification: "RECOMMENDED",
      },
    }),
  );
  // READ BACK UNDER THE NAME IT WAS ASKED FOR. This batch is a REGULATION, and
  // a regulation is the one source that genuinely states when it begins — so
  // both the form and this block call it that. A survey batch would read
  // "Tanggal / periode harga" in both places, because that is what was asked.
  assert.deepEqual(lines, [
    "Asal sumber: Pemerintah",
    "Nama sumber: belum diisi",
    "Jenis sumber: Regulasi",
    "Mulai berlaku menurut sumber: 2024-01-01",
    "Wilayah: Kota Ambon",
  ]);
});

test("savedMetadataLines never leaves an unset fact looking like a value", () => {
  for (const line of savedMetadataLines(baseBatch())) {
    assert.match(line, /belum diisi$|belum diisi \(/);
  }
});

test("a chosen region is never reported as missing just because this response omitted it", () => {
  // `region` rides only the read path. Collapsing "no region chosen" into
  // "response did not carry the region" would tell a person to redo work that
  // is already saved.
  const lines = savedMetadataLines(baseBatch({ regionId: "region-01" }));
  assert.ok(lines.some((line) => line === "Wilayah: sudah dipilih"));
  assert.ok(!lines.some((line) => line === "Wilayah: belum diisi"));
});

test("no saved-metadata line prints a raw enum at a person", () => {
  const lines = savedMetadataLines(
    baseBatch({ sourceOrigin: "COMMUNITY_REPORT", sourceType: "MARKET_SURVEY", regionId: null }),
  );
  for (const line of lines) assert.doesNotMatch(line, /[A-Z]{3,}_[A-Z]/);
});

// ---------------------------------------------------------------------------
// THE METADATA SAVE — the one door the region travels through, and the one
// place a silent failure costs a person their whole batch.
// ---------------------------------------------------------------------------

test("a metadata-save failure names its own cause instead of guessing at the batch", () => {
  // The old line said the batch "mungkin sudah berubah" for EVERY failure. It
  // is the wrong cause for all three of these, and each has a different remedy.
  assert.match(
    metadataSaveFailureMessage(401, ""),
    /Sesi Anda sudah berakhir/,
  );
  assert.doesNotMatch(metadataSaveFailureMessage(401, ""), /sudah berubah/);
  assert.match(metadataSaveFailureMessage(403, ""), /kewenangan/);
  assert.doesNotMatch(metadataSaveFailureMessage(403, ""), /sudah berubah/);
  assert.match(metadataSaveFailureMessage(404, ""), /tidak ditemukan/);
});

test("the server's own named refusal is what the person reads", () => {
  assert.match(
    metadataSaveFailureMessage(409, JSON.stringify({ message: "BATCH_VERSION_STALE" })),
    /sudah berubah sejak halaman dimuat/,
  );
  assert.match(
    metadataSaveFailureMessage(409, JSON.stringify({ message: "BATCH_NOT_MUTABLE" })),
    /sudah ditutup/,
  );
});

test("no metadata-save failure ever claims a partial save, and none prints a raw code", () => {
  const cases: [number, string][] = [
    [401, ""],
    [403, ""],
    [404, ""],
    [409, JSON.stringify({ message: "BATCH_VERSION_STALE" })],
    [409, JSON.stringify({ message: "BATCH_NOT_MUTABLE" })],
    [500, "not json at all"],
    [418, ""],
  ];
  for (const [status, body] of cases) {
    const message = metadataSaveFailureMessage(status, body);
    // Every one of these ends by saying nothing was stored — true because the
    // PATCH is a single transaction.
    assert.match(message, /Tidak ada yang tersimpan/);
    assert.doesNotMatch(message, /[A-Z]{3,}_[A-Z]/);
  }
});

test("the SAVE response carries the region too, so the record line names a place", () => {
  // PATCH :batchId returns the region alongside its id, exactly as GET does.
  // Without it the save could only be acknowledged as "sudah dipilih" — a
  // vaguer claim than the product's own law allows for a fact just stored.
  const lines = savedMetadataLines(
    baseBatch({
      regionId: "region-01",
      region: { id: "region-01", code: "8171030", name: "Kecamatan Teluk Ambon Baguala, Kota Ambon" },
    }),
  );
  // The NAME, and only the name — the same words the selector offered. A
  // provisioning code bolted to the front is the implementation talking.
  assert.ok(
    lines.some(
      (line) => line === "Wilayah: Kecamatan Teluk Ambon Baguala, Kota Ambon",
    ),
  );
});

// ---------------------------------------------------------------------------
// ROW DECISIONS — a failure names its own cause, or claims nothing.
// ---------------------------------------------------------------------------

test("a row failure only blames a stale row when the status actually means that", () => {
  assert.match(rowActionFailureMessage("RESOLVE", 9, 409), /sudah berubah/);
  // The old message said "Baris mungkin sudah berubah" for EVERY failure. A
  // reviewer whose session had expired reloaded and lost their work.
  assert.doesNotMatch(rowActionFailureMessage("RESOLVE", 9, 401), /sudah berubah/);
  assert.match(rowActionFailureMessage("RESOLVE", 9, 401), /Sesi Anda sudah berakhir/);
  assert.doesNotMatch(rowActionFailureMessage("REJECT", 9, 403), /sudah berubah/);
  assert.match(rowActionFailureMessage("REJECT", 9, 403), /kewenangan/);
});

test("a row failure always names the row and never claims the decision was saved", () => {
  for (const status of [0, 401, 403, 404, 409, 500]) {
    for (const action of ["RESOLVE", "REJECT"] as const) {
      const message = rowActionFailureMessage(action, 42, status);
      assert.match(message, /^Gagal /, "a failure must open as a failure");
      assert.match(message, /baris 42/, "the reviewer must know WHICH row");
      // Never a success word. "belum tersimpan" is the truthful opposite and is
      // deliberately allowed.
      assert.doesNotMatch(message, /berhasil|diperbarui/);
    }
  }
});

// ---------------------------------------------------------------------------
// CATALOG VOCABULARY — the reviewer chooses between candidates without being
// asked to read the database's enums.
// ---------------------------------------------------------------------------

test("a resource candidate reads as words, not as an enum", () => {
  assert.equal(
    resourceOptionLabel({ code: "SMN-01", name: "SEMEN PC", type: "MATERIAL", baseUnit: "Zak" }),
    "SMN-01 — SEMEN PC — Bahan — Zak",
  );
  assert.match(
    resourceOptionLabel({ code: null, name: "Pekerja", type: "LABOR", baseUnit: "OH" }),
    /^Tanpa kode — Pekerja — Upah — OH$/,
  );
});

test("a unit candidate reads as words, and keeps every fact that distinguishes it", () => {
  const label = unitOptionLabel({
    code: "M3",
    displayName: "Meter Kubik",
    symbol: "m³",
    dimension: "VOLUME",
    kind: "CANONICAL",
  });
  assert.equal(label, "M3 — Meter Kubik — m³ — Volume — satuan dasar");
  assert.doesNotMatch(label, /[A-Z]{3,}/);
});

test("every unit dimension and kind has a word — none falls through to its enum", () => {
  const dimensions = ["COUNT", "MASS", "LENGTH", "AREA", "VOLUME", "TIME", "PERSON_TIME", "EQUIPMENT_TIME"] as const;
  for (const dimension of dimensions) {
    assert.doesNotMatch(unitDimensionLabel(dimension), /[A-Z]{3,}/, `${dimension} has no word`);
  }
  for (const kind of ["CANONICAL", "COMMERCIAL_PACKAGE", "CONTEXTUAL"] as const) {
    assert.doesNotMatch(unitKindLabel(kind), /[A-Z]{3,}/, `${kind} has no word`);
  }
});

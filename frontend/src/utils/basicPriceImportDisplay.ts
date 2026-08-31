// Pure display/derivation helpers for the RM-02 Basic Price import journey.
// Mirrors the shape returned by backend BasicPriceImportService#summarize().

// The one place this app already settled on for how a CHOSEN region reads.
// Imported rather than re-spelled: two spellings of one place is how a person
// ends up picking a name and being shown a code.
import { regionChosenLabel } from './basicPriceWorkflowDisplay.ts';
import { REVERIFICATION_LABEL } from './basicPriceExplorerDisplay.ts';

/**
 * The catalog and unit vocabularies, declared ONCE for the whole frontend.
 *
 * They used to live in `api/basicPriceImport.ts`, which imports this module —
 * so a value derived here could not be typed with them without a cast. They are
 * defined at the bottom of the dependency chain instead and re-exported from
 * the API module, so every existing importer is unaffected and there is still
 * exactly one spelling of each vocabulary.
 */
export type ResourceType = 'MATERIAL' | 'LABOR' | 'EQUIPMENT';
export type UnitDimension =
  | 'COUNT'
  | 'MASS'
  | 'LENGTH'
  | 'AREA'
  | 'VOLUME'
  | 'TIME'
  | 'PERSON_TIME'
  | 'EQUIPMENT_TIME';
export type UnitKind = 'CANONICAL' | 'COMMERCIAL_PACKAGE' | 'CONTEXTUAL';

/**
 * INT-CONNECT-01 — what the canonical Unit authority proved about one row's raw
 * unit spelling, as the backend's Basic Price proposal projects it. Every field
 * is copied from that proposal as-is: the frontend never re-derives a unit
 * meaning, and there is no unit logic on this side at all.
 *
 * The proposal is itself a PROJECTION of the authority's verdict rather than a
 * byte-for-byte copy — it adds workflow-specific state and omits the prose, as
 * the seam's own note explains. What is guaranteed on THIS side is narrower and
 * exact: nothing here is added, and nothing here is changed.
 *
 * STRUCTURED FACTS ONLY, AND NO PROSE. Neither leg of a proposal carries the
 * authority's `explanation`. That sentence exists — richly — inside the engine,
 * where it names catalog ids, model vocabulary, alias provenance and, on the
 * governed-decision path, a reviewer's account and private note. None of it is
 * deleted; it is simply not projected here, because Basic Price needs the facts
 * below and not an auditor's paragraph. The reviewer's sentence is composed from
 * exactly these fields by `rowMachineNarrative`.
 */
export interface RowUnitProposal {
  rawUnit: string | null;
  status: 'RESOLVED' | 'NEEDS_REVIEW' | 'NOT_STATED';
  unitDefinitionId: string | null;
  unitCode: string | null;
  unitDisplayName: string | null;
  unitSymbol: string | null;
  unitDimension: UnitDimension | null;
  unitKind: UnitKind | null;
  reasonCode: string;
  contextScoped: boolean;
  trustedContext: string | null;
  policyVersion: string;
}

export interface RowResourceCandidate {
  resourceCatalogId: string;
  name: string;
  code: string | null;
  type: string;
  baseUnit: string;
  evidence: string[];
  specificationUnproved: boolean;
  unprovedSpecificationFacts: string[];
  /**
   * ONLY the existence of a prior human decision reaches the browser. The
   * reviewer's identity, the moment they decided, and their free-text note stay
   * inside the engine: a batch is user-owned, so one person's private note must
   * not appear on a colleague's screen even within the same workspace.
   */
  hasPriorHumanDecision: boolean;
}

/** What the canonical Resource Identity authority proved about one row. */
export interface RowResourceProposal {
  status: 'RESOLVED' | 'NEEDS_REVIEW' | 'UNRESOLVED';
  authority: string | null;
  resourceCatalogId: string | null;
  resourceName: string | null;
  resourceCode: string | null;
  resourceType: ResourceType | null;
  resourceBaseUnit: string | null;
  candidates: RowResourceCandidate[];
  reasonCodes: string[];
  policyVersion: string;
  /**
   * Whether Basic Price may ACT on the identity above — narrower than whether
   * the authority proved it, because the shared authority also sees globally
   * scoped catalog rows this workflow's resolve endpoint will not accept.
   */
  admissibleForResolve: boolean;
}

export interface RowMachineProposal {
  rowId: string;
  unit: RowUnitProposal;
  resource: RowResourceProposal;
  /**
   * The resource leg and the unit leg required by an identity SELECTION are both
   * proven and admissible.
   *
   * NOT "the row is finished". The backend still decides the row's final status
   * from a canonical price being present and from same-identity collisions
   * within the batch — facts no proposal judges.
   */
  identityPairProven: boolean;
  blockingFacts: string[];
}

export interface BasicPriceImportRowSummary {
  id: string;
  status: 'PARSED' | 'NEEDS_REVIEW' | 'READY_FOR_SUBMISSION' | 'REJECTED' | 'SUBMISSION_CREATED';
  resolutionStatus: string;
  code: string | null;
  name: string;
  unit: string | null;
  rawPriceDisplayText: string | null;
  proposedCanonicalPrice: string | null;
  /**
   * USI-01R — NULL when the source stated a resource family SIMPROK could not
   * safely map. The backend has allowed null since USI-01R while this contract
   * still promised one of three values, which let the review room read an
   * unknown category as a known one. It is nullable here because it is nullable
   * there: one truth, stated the same way on both sides.
   */
  section: 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | null;
  /** Which authority decided `section`. Null for pre-USI-01R rows. */
  sectionProvenance:
    | 'SOURCE_ROW_CATEGORY'
    | 'SOURCE_SECTION_TITLE'
    | 'UPLOADER_DECLARED'
    | null;
  /** The source's OWN category words, kept whether or not they could be mapped. */
  sourceCategoryCode: string | null;
  sourceCategoryName: string | null;
  sourceRowNumber: number;
  collisionType: 'NONE' | 'EXACT_DUPLICATE' | 'SAME_IDENTITY_SAME_VALUE' | 'SAME_IDENTITY_DIFFERENT_VALUE' | 'CODE_COLLISION' | 'NAME_COLLISION' | 'UNIT_COLLISION';
  collisionOfRowId: string | null;
  resourceCatalogId: string | null;
  unitDefinitionId: string | null;
  reasonCodes: string[];
  version: number;
  /**
   * Does a WORKSPACE_PRIVATE price already exist for this row? The row status
   * cannot express it — a stored row stays READY_FOR_SUBMISSION forever — so
   * the server answers it directly. Optional because only the review read path
   * asks; absent reads as not-stored, which is what every other path renders.
   */
  savedAsPrivatePrice?: boolean;
  /**
   * INT-CONNECT-01 — what the canonical authorities already proved about this
   * row, or NULL when they were not consulted (any non-review read path, and
   * any row that is no longer mutable).
   *
   * NULL MEANS "NOT ASKED", NEVER "FOUND NOTHING". Collapsing the two would let
   * a screen report silence as a verdict.
   */
  machineProposal: RowMachineProposal | null;
}

/**
 * The three human-facing source families, exactly as the server groups them.
 * NEVER derived here — this module is TOLD which family a batch belongs to.
 */
export type SourceFamily = 'GOVERNMENT' | 'STORE_SUPPLIER' | 'FIELD_PRICE';

export type PrivateUseBlockReason =
  | 'BATCH_NOT_MUTABLE'
  | 'EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE'
  | 'REGION_REQUIRED_BEFORE_PRIVATE_USE'
  | 'SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE'
  | 'SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE'
  | 'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE'
  | 'NO_ROWS_READY_FOR_PRIVATE_USE'
  | 'ALL_READY_ROWS_ALREADY_PRIVATE';

export type ProposalNotOfferedReason =
  | 'ALREADY_PROPOSED'
  | 'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION'
  | 'BATCH_NOT_READY_FOR_REVIEW'
  | 'EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION'
  | 'REGION_REQUIRED_BEFORE_SUBMISSION'
  | 'SOURCE_ORIGIN_REQUIRED_BEFORE_SUBMISSION'
  | 'SOURCE_TYPE_REQUIRED_BEFORE_SUBMISSION'
  | 'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_SUBMISSION'
  | 'NO_ROWS_READY_FOR_SUBMISSION';

/**
 * WHAT THIS BATCH MAY DO NEXT — decided by the server, rendered here.
 *
 * This page used to decide it itself, and could only ever answer yes or no. So
 * when it said no it rendered a disabled button, the browser swallowed the
 * click, and the reason stayed on the server as an exception code nobody would
 * ever see. That is the whole story of a real click on `Ajukan Batch (6 siap)`
 * producing no request, no message and no outcome.
 */
/**
 * THE REQUIRED-METADATA VOCABULARY, mirrored from the server's own list.
 *
 * This page does NOT decide which facts are required. The server sends
 * `reviewGate.requiredFacts`, and this type only names the values that can
 * arrive. Which INPUT holds each fact is presentation knowledge and lives in
 * `draftStatesFact` below — a different question from whether the fact is
 * required at all, and only the second one is law.
 */
export type RequiredMetadataFact =
  | 'EFFECTIVE_DATE'
  | 'REGION'
  | 'SOURCE_ORIGIN'
  | 'SOURCE_TYPE';

/**
 * WHY THE WRITER WOULD REFUSE METADATA THAT IS COMPLETE.
 *
 * Mirrors `MetadataCoherenceIssue['code']` in
 * `backend/src/basic-price/basic-price-metadata-coherence.law.ts`. Every one of
 * these is reachable through `reviewGate.reasonCode`, because the review gate
 * asks the WRITER's own coherence question rather than a softer one of its own.
 *
 * MEMBERSHIP, NOT SHAPE — and the list is guarded rather than trusted:
 * `basicPriceReviewGateLaw.test.ts` reads the backend file and fails if the two
 * ever drift, the same convention `basicPriceIntakeErrors.ts` already follows
 * for the intake vocabulary. A hand-written mirror that nothing checks is a
 * mirror that compiles and lies, which is exactly how a COMPLETE batch came to
 * be told its metadata was "belum lengkap".
 */
export type MetadataCoherenceReason =
  | 'SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE'
  | 'SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE'
  | 'DERIVATION_RULE_REQUIRES_PROVENANCE'
  | 'SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE'
  | 'SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE'
  | 'DERIVATION_RULE_REQUIRED_FOR_DERIVED_DATE'
  | 'DERIVATION_RULE_NOT_PROVABLE'
  | 'DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE'
  | 'DERIVATION_RULE_FORBIDDEN_FOR_SOURCE_STATED';

export type ReviewGateReason =
  | 'BATCH_NOT_MUTABLE'
  | 'REQUIRED_METADATA_INCOMPLETE'
  | MetadataCoherenceReason;

export interface BatchReviewGate {
  requiredFacts: RequiredMetadataFact[];
  missingRequiredFacts: RequiredMetadataFact[];
  metadataComplete: boolean;
  /**
   * Would the WRITER accept this metadata? A batch can state all four required
   * facts and still be refused because those facts contradict each other — and
   * that is a DIFFERENT thing from an incomplete form. This field was missing
   * from the mirror entirely, so the room had no way to tell the two apart and
   * reported both as "belum lengkap".
   */
  metadataCoherent: boolean;
  reviewAllowed: boolean;
  reasonCode: ReviewGateReason | null;
}

export interface BatchLifecycleActions {
  privateUse: {
    offered: boolean;
    reasonCode: PrivateUseBlockReason | null;
    /** Rows one press would actually store. Null when not measured. */
    actionableRows?: number | null;
  };
  simprokProposal: {
    offered: boolean;
    reasonCode: ProposalNotOfferedReason | null;
    sourceFamily: SourceFamily | null;
  };
  reviewGate: BatchReviewGate;
  /**
   * BP-REGION-TRUTH-07S — the two region answers and the server's verdict about
   * whether anyone has said they are the same place.
   *
   * OPTIONAL ON THE WAY IN, because every fixture and every older recorded
   * response in this codebase predates it, and an absent block must read as
   * "nothing to say" rather than as a missing field. `regionScopeNoticeView`
   * below is the only thing that reads it.
   */
  regionScope?: {
    sourceLabel: string | null;
    geographicEvidence: string | null;
    confirmedRegionId: string | null;
    compatibilityUnproven: boolean;
  };
}

export interface BasicPriceImportBatchSummary {
  batchId: string;
  status: 'PREVIEWED' | 'READY_FOR_REVIEW' | 'NEEDS_REVIEW' | 'APPROVED_FOR_SUBMISSION' | 'PARTIALLY_SUBMITTED' | 'SUBMITTED' | 'REJECTED' | 'SUPERSEDED';
  importFingerprint: string;
  effectiveDate: string | null;
  /** Soft re-verification, human-stated. Null is the ordinary case. */
  reviewDate?: string | null;
  regionId: string | null;
  /**
   * The region ITSELF, on the two paths a person actually watches a region
   * through: the metadata SAVE (PATCH :batchId) and the RELOAD (GET :batchId).
   * `regionId` alone is a UUID no room may print at a person, so a response
   * that carries the id and not the place can only be reported vaguely.
   *
   * Still optional, because `preview` does not carry it — that response is
   * about a file SIMPROK has just read, not about a region anyone has chosen.
   */
  region?: { id: string; code: string; name: string } | null;
  /**
   * BP-VISUAL-TRUTH-07 §7 — the PRICE COLUMN this batch was read from, in the
   * source document's own wording ("TELUK AMBON"). It is NOT `region`, and the
   * two must never be printed under one word: `region` is the canonical place
   * SIMPROK files the price under, this is the column of the workbook the
   * numbers were actually taken from. Null whenever the source offered only
   * one column and nobody had to choose.
   */
  sourceRegionScopeLabel?: string | null;
  sourceType: 'VENDOR_QUOTE' | 'MARKET_SURVEY' | 'REGULATION' | 'SYSTEM_ESTIMATE' | null;
  /** WHO published the price. What the Explorer's source line reads. */
  sourceOrganizationName: string | null;
  sourceOrigin: 'GOVERNMENT' | 'SUPPLIER' | 'STORE' | 'DISTRIBUTOR' | 'FIELD_REPORT' | 'COMMUNITY_REPORT' | null;
  actions: BatchLifecycleActions;
  version: number;
  totalRows: number;
  needsReviewRows: number;
  readyForSubmissionRows: number;
  rejectedRows: number;
  submittedRows: number;
  /**
   * How many rows SIMPROK proved a complete, admissible IDENTITY PAIR for.
   * Counted server-side from the proposals, never derived here — and it is not
   * a count of finished rows.
   */
  identityPairProvenRows: number;
  /**
   * How many FINISHED rows already exist as workspace-private prices, or null
   * when this path did not measure it. Null is not zero: a projection that
   * never asked is no evidence that nothing has been stored.
   */
  alreadyPrivateRows?: number | null;
  /**
   * Which temporal question is true for THIS source — codes, not prose, so the
   * words stay here where the tests can pin them.
   */
  temporal?: BatchTemporalQuestions | null;
  /**
   * SMART RE-IMPORT — server-named relation of this intake to history the
   * caller already owns. Absent on GET/PATCH. The browser never classifies.
   */
  reimport?: ReimportRelation | null;
  /**
   * BP-KDN-01 — optional KDN column mapping. NEEDS_REVIEW never fail-stops
   * a lawful price import.
   */
  kdnMapping?: {
    status: 'ABSENT' | 'ESTABLISHED' | 'NEEDS_REVIEW' | string;
    confirmedColumn: number | null;
    candidates: Array<{ columnNumber: number; headerText: string; kind?: string }>;
  };
  rows: BasicPriceImportRowSummary[];
}

export type ReimportClassification =
  | 'EXACT_EXISTING'
  | 'INTERPRETATION_UPDATE'
  | 'SOURCE_UPDATE'
  | 'NEW_OR_UNPROVEN';

export type ReimportDifference = 'NONE' | 'READING' | 'SOURCE_CONTENT' | null;

export interface ReimportRelation {
  classification: ReimportClassification;
  existingBatchId: string | null;
  updateBatchId: string | null;
  difference: ReimportDifference;
}

/**
 * THE TWO PRODUCT VERBS, AND ONLY TWO.
 *
 * `VIEW_EXISTING` used to be a third, and it was never a third decision. On
 * EXACT_EXISTING the "previous import" and the "existing batch to continue
 * with" are the SAME batch — the server returns one id for both — so the two
 * buttons named one object twice and differed only in how deep they landed.
 * The deeper landing was also the less lawful one: it jumped past the metadata
 * gate this page enforces before the review room, and for an actor holding
 * BASIC_PRICE_IMPORT without BASIC_PRICE_RESOLVE it ended on Access Denied. A
 * decision card must not offer a door that can refuse.
 */
export type ReimportDecisionAction = 'USE_EXISTING' | 'USE_UPDATE';

/**
 * Visible proof that "Gunakan yang sudah ada" did something. Not a fingerprint,
 * not a batch id, and not a claim that a write occurred — none did.
 */
export const USED_EXISTING_CONFIRMATION =
  'Data yang sudah ada digunakan. Tidak ada impor baru dibuat.';

/**
 * WHERE A RE-IMPORT ACTION GOES — the batch's own room, never a deeper one.
 *
 * The server already named the batch; this only maps the product verb onto
 * `/basic-price/import/:batchId`, which is where the batch states what SIMPROK
 * stored and offers "Lanjut ke Peninjauan Baris" under the metadata gate. A
 * re-import decision therefore never lands anyone past a gate they have not
 * satisfied, and never on a route their authority cannot open. The frontend
 * must not choose a sibling of its own.
 */
export function reimportActionPath(
  action: ReimportDecisionAction,
  relation: Pick<ReimportRelation, 'existingBatchId' | 'updateBatchId'>,
): string | null {
  if (action === 'USE_EXISTING' && relation.existingBatchId) {
    return `/basic-price/import/${relation.existingBatchId}`;
  }
  if (action === 'USE_UPDATE' && relation.updateBatchId) {
    return `/basic-price/import/${relation.updateBatchId}`;
  }
  return null;
}

export interface ReimportDecisionView {
  shown: true;
  kind: 'ALREADY_IDENTICAL' | 'UPDATE_DETECTED';
  title: string;
  body: string;
  historyNote: string | null;
  differenceNote: string | null;
  primary: { action: ReimportDecisionAction; label: string };
  /**
   * ABSENT WHEN THERE IS ONLY ONE TRUTHFUL CHOICE. An update names two
   * different batches, so it genuinely asks which one to work from; an exact
   * replay names one, so a second button could only repeat the first.
   */
  secondary: { action: ReimportDecisionAction; label: string } | null;
}

/**
 * ONE compact decision for an ordinary user. The server already named the
 * relation; this only puts it into Indonesian. Filename, fingerprint and
 * batch identity are not inputs and must not become copy.
 */
export const reimportDecisionView = (
  reimport: ReimportRelation | null | undefined,
): ReimportDecisionView | null => {
  if (!reimport || reimport.classification === 'NEW_OR_UNPROVEN') return null;
  if (reimport.classification === 'EXACT_EXISTING') {
    return {
      shown: true,
      kind: 'ALREADY_IDENTICAL',
      /**
       * BP-VISUAL-TRUTH-07 §22 — ONE FACT, SAID ONCE.
       *
       * The body used to reopen by repeating the title almost word for word:
       * "Data ini sudah pernah diimpor." above "Daftar harga ini sudah pernah
       * diimpor dan tidak ada perubahan yang terdeteksi." Someone who has read
       * the heading is made to read it a second time to reach the single clause
       * that was new. The heading states the relation; the body now carries
       * only what the heading cannot — that nothing differs, and therefore what
       * continuing would and would not do.
       */
      title: 'Data ini sudah pernah diimpor.',
      body: 'Tidak ada perubahan yang terdeteksi, jadi tidak ada data baru yang akan ditambahkan.',
      historyNote: null,
      differenceNote: null,
      primary: { action: 'USE_EXISTING', label: 'Gunakan yang sudah ada' },
      secondary: null,
    };
  }
  const reading = reimport.classification === 'INTERPRETATION_UPDATE';
  return {
    shown: true,
    kind: 'UPDATE_DETECTED',
    title: 'SIMPROK menemukan data sebelumnya.',
    body: reading
      ? 'File ini pernah diimpor, tetapi cara pembacaannya sekarang berbeda.'
      : 'SIMPROK menemukan data sebelumnya dari sumber yang sama, tetapi isi data sekarang berbeda.',
    historyNote: 'Data sebelumnya tetap tersimpan sebagai riwayat.',
    /**
     * §22 — and this line no longer restates the body either. `differenceNote`
     * exists to name WHAT differs in as few words as a chip can hold; saying
     * "Cara pembacaan berbeda." under a body that has just said the reading is
     * now different is the same sentence twice in two type sizes. It names the
     * axis, and the body keeps the explanation.
     */
    differenceNote: reading ? 'Perbedaan: cara pembacaan' : 'Perbedaan: isi sumber',
    primary: { action: 'USE_UPDATE', label: 'Gunakan pembaruan ini' },
    secondary: { action: 'USE_EXISTING', label: 'Gunakan yang sudah ada' },
  };
};

const BATCH_STATUS_LABELS: Record<BasicPriceImportBatchSummary['status'], string> = {
  PREVIEWED: 'Preview',
  READY_FOR_REVIEW: 'Siap ditinjau',
  NEEDS_REVIEW: 'Perlu konfirmasi',
  // THE CURATION PATH, NAMED. These three are the only batch states that mean
  // the SIMPROK curation door was actually used, and each one now says so —
  // a bare 'Diajukan' left the reader to guess the destination.
  APPROVED_FOR_SUBMISSION: 'Sedang diusulkan ke SIMPROK',
  PARTIALLY_SUBMITTED: 'Sebagian diusulkan ke SIMPROK',
  SUBMITTED: 'Sudah diusulkan ke SIMPROK',
  REJECTED: 'Ditolak',
  SUPERSEDED: 'Digantikan daftar baru',
};

export const batchStatusLabel = (status: BasicPriceImportBatchSummary['status']): string =>
  BATCH_STATUS_LABELS[status] ?? status;

/**
 * WHAT HAS HAPPENED TO THIS ROW — in the reader's terms, never the table's.
 *
 * `READY_FOR_SUBMISSION` USED TO RENDER AS `Siap diajukan`, and that one
 * translation carried two separate falsehoods. First, "diajukan ke mana?" — the
 * word belongs to the SIMPROK curation path, which is a different, optional
 * act, and nothing about this row was heading there. Second, a row keeps that
 * internal status forever after `Simpan & Gunakan` stores it, so the Owner's
 * row `Air` announced it was ready to be sent somewhere while its price was
 * already sitting usable in the workspace.
 *
 * An internal state is not a sentence. `rowStatusLabel` therefore answers what
 * the row's CURRENT human meaning is, and the already-stored case is decided by
 * the server's own `savedAsPrivatePrice` rather than inferred from a status
 * that cannot express it.
 */
const ROW_STATUS_LABELS: Record<BasicPriceImportRowSummary['status'], string> = {
  PARSED: 'Terbaca',
  NEEDS_REVIEW: 'Perlu konfirmasi',
  /**
   * DECIDED, AND NOT YET STORED. The row's identity is settled and one press of
   * `Simpan & Gunakan` would turn it into a usable price — which is what "siap"
   * means here, and the only thing it means.
   */
  READY_FOR_SUBMISSION: 'Siap disimpan',
  REJECTED: 'Ditolak',
  /** A REAL submission record exists. This is the one place curation is named. */
  SUBMISSION_CREATED: 'Sudah diusulkan ke SIMPROK',
};

/** The row is already a WORKSPACE_PRIVATE price. Nothing is pending for it. */
export const ROW_SAVED_PRIVATE_LABEL = 'Tersimpan di ruang kerja';

export const rowStatusLabel = (status: BasicPriceImportRowSummary['status']): string =>
  ROW_STATUS_LABELS[status] ?? status;

/**
 * THE TWO ROW STATUSES THAT RECORD SOMETHING WHICH ALREADY HAPPENED.
 *
 * `REJECTED` is a person's explicit decision; `SUBMISSION_CREATED` means a real
 * curation record exists. Neither is a pending internal step SIMPROK is still
 * working through, and neither is undone by an opinion — which is why they
 * outrank a proposal in the sentence a row prints. Every other status IS such a
 * pending step, so none of them belongs here.
 */
const HUMAN_TERMINAL_ROW_STATUSES: ReadonlySet<
  BasicPriceImportRowSummary['status']
> = new Set(['REJECTED', 'SUBMISSION_CREATED']);

/**
 * THE ROW'S CURRENT MEANING, which is not always its stored status.
 *
 * FOUR FACTS, STRONGEST FIRST.
 *
 *   1. THE PRICE EXISTS.       `savedAsPrivatePrice` — the most recent and most
 *      useful fact there is. Nothing is left for this person to do to that row,
 *      so calling it `Siap disimpan` would invite work that already happened.
 *
 *   2. A HUMAN OR THE WORLD ALREADY DECIDED. `REJECTED` and `SUBMISSION_CREATED`
 *      are not SIMPROK's reading of the row — they record an act that has
 *      already taken place. A machine proof attached to such a row is at best
 *      what SIMPROK understood BEFORE that act, and printing it would resurrect
 *      a superseded recommendation over the decision which replaced it. AN
 *      EXPLICIT HUMAN DECISION IS STRONGER THAN AN EARLIER MACHINE
 *      RECOMMENDATION, and a completed real-world state is stronger than a
 *      pending internal one.
 *
 *   3. SIMPROK UNDERSTANDS IT. `identityPairProven` — the canonical Resource
 *      and Unit authorities have both answered, so no repetitive `Selesaikan`
 *      click is required. THIS LEVEL DID NOT EXIST, and its absence is the
 *      defect: a proven row fell straight through to its raw status and
 *      rendered `Perlu ditinjau` — "SIMPROK needs your attention" — beside a
 *      summary saying `13 dikenali otomatis` and a button offering to save
 *      those very thirteen. One screen, three readings, and the one a person
 *      trusts is the one on the row in front of them.
 *
 *   4. ANYTHING ELSE.          The raw status, unchanged, because for a row
 *      SIMPROK could NOT prove, `Perlu ditinjau` is exactly true.
 *
 * LEVEL 2 GUARDS A STATE THE SERVER DOES NOT CURRENTLY EMIT, and that is the
 * point. `getBatch` asks the authorities only about `NEEDS_REVIEW` rows, so a
 * rejected or submitted row reaches this function with a null proposal today
 * and levels 2 and 4 agree on the answer. Nothing in the row's TYPE says they
 * must — the combination is expressible, one upstream filter away — and a
 * presentation rule that holds only because of a filter it cannot see is a rule
 * waiting to lie. The precedence is therefore stated where the sentence is
 * built, so it survives whatever arrives.
 *
 * IT CLAIMS NOTHING MORE THAN PROOF. `Dikenali otomatis` is deliberately modest:
 * not `Selesai`, not `Disetujui`, not `Tersimpan`, not `Sudah diverifikasi`.
 * SIMPROK understands the row; it has not decided anything for anyone, and the
 * person may still inspect or correct it.
 *
 * NO ROW LIFECYCLE MOVED. `status` still says exactly what it always said and
 * every writer still reads it unchanged; only the SENTENCE derived from it
 * changed. Both new inputs are the SERVER's own answers — one `@unique`
 * relation hop and the proposal authority's verdict — never a guess assembled
 * here.
 */
export const rowStateLabel = (
  row: Pick<
    BasicPriceImportRowSummary,
    'status' | 'savedAsPrivatePrice' | 'machineProposal'
  >,
): string => {
  if (row.savedAsPrivatePrice) return ROW_SAVED_PRIVATE_LABEL;
  // Read through the SAME table the fallback uses, so `Ditolak` and `Sudah
  // diusulkan ke SIMPROK` keep exactly one spelling each. This branch decides
  // WHICH fact wins; it does not get a vocabulary of its own.
  if (HUMAN_TERMINAL_ROW_STATUSES.has(row.status)) {
    return rowStatusLabel(row.status);
  }
  // The ONE existing spelling of this fact, reused rather than restated — the
  // row narrative and the batch summary already say `Dikenali otomatis`, and a
  // second literal is how two places start disagreeing.
  if (row.machineProposal?.identityPairProven === true) {
    return rowMachineStateLabel('PROVEN');
  }
  return rowStatusLabel(row.status);
};

/**
 * Only the three families SIMPROK actually knows. `section` is nullable — see
 * the field's own note — and an unknown family deliberately has NO entry here:
 * naming it would mean naming a family the source never proved. `rowSectionDisplay`
 * is what callers use when null is possible.
 */
export type KnownRowSection = Exclude<BasicPriceImportRowSummary['section'], null>;

const SECTION_LABELS: Record<KnownRowSection, string> = {
  LABOR: 'Tenaga kerja',
  MATERIAL: 'Bahan',
  EQUIPMENT: 'Peralatan',
};

export const rowSectionLabel = (section: KnownRowSection): string =>
  SECTION_LABELS[section] ?? section;

const COLLISION_LABELS: Record<BasicPriceImportRowSummary['collisionType'], string | null> = {
  NONE: null,
  EXACT_DUPLICATE: 'Duplikat persis baris lain',
  SAME_IDENTITY_SAME_VALUE: 'Identitas sama, nilai sama dengan baris lain',
  SAME_IDENTITY_DIFFERENT_VALUE: 'Identitas sama, nilai BERBEDA dengan baris lain',
  CODE_COLLISION: 'Kode bentrok dengan baris lain',
  NAME_COLLISION: 'Nama bentrok dengan baris lain',
  UNIT_COLLISION: 'Satuan bentrok dengan baris lain',
};

/** null when there is nothing to warn about — callers render no badge. */
export const collisionWarningLabel = (collisionType: BasicPriceImportRowSummary['collisionType']): string | null =>
  COLLISION_LABELS[collisionType];

/**
 * Batch-level progress line for the review page header. Never claims
 * completeness while any row is still NEEDS_REVIEW.
 */
export const formatBatchProgress = (batch: BasicPriceImportBatchSummary): string => {
  if (batch.totalRows === 0) return 'Tidak ada baris pada batch ini.';
  const reviewed = batch.totalRows - batch.needsReviewRows;
  /**
   * SAME DESTINATIONLESS WORD, SAME REPAIR. This line said `N siap diajukan`
   * about `readyForSubmissionRows` — an internal row state wearing a curation
   * word — and it went on saying it after those very rows had been stored. What
   * a person needs here is how far the REVIEW has got, so that is all it now
   * reports; what is stored, and what one press would store, are each said
   * exactly once by the summary and the button.
   */
  return `${reviewed} dari ${batch.totalRows} baris sudah ditinjau (${batch.rejectedRows} ditolak).`;
};

/**
 * WHY AN ACTION IS NOT AVAILABLE, IN WORDS A SITE ENGINEER CAN ACT ON.
 *
 * This replaces `canSubmitBatch`, which held this page's OWN copy of the
 * server's preconditions and returned a bare boolean. Two consequences, both
 * real: the copy could disagree with the server, and — because a boolean has
 * no reason inside it — a false answer could only be rendered as a disabled
 * button. A natively disabled button fires no click, so the Owner pressed
 * `Ajukan Batch (6 siap)` and got no request, no message and no outcome.
 *
 * Nothing here DECIDES anything. `batch.actions` is the server's verdict, from
 * the same law its two writers enforce; these maps only put it into Indonesian.
 * A code with no sentence returns null, and callers fall back to the generic
 * line rather than printing UPPER_SNAKE at a person.
 */
const PRIVATE_USE_BLOCK_SENTENCES: Record<PrivateUseBlockReason, string> = {
  BATCH_NOT_MUTABLE:
    'Batch ini sudah ditutup, jadi barisnya tidak bisa disimpan lagi dari sini.',
  EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE:
    'Tanggal berlaku harga belum diisi. Lengkapi dulu di halaman Impor.',
  REGION_REQUIRED_BEFORE_PRIVATE_USE:
    'Wilayah harga belum dipilih. Lengkapi dulu di halaman Impor.',
  SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE:
    'Asal sumber harga belum diisi. Lengkapi dulu di halaman Impor.',
  SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE:
    'Jenis sumber harga belum tercatat. Lengkapi dulu di halaman Impor.',
  /**
   * NOT AN ACCUSATION, AND NOT A CLAIM THAT THE TWO DISAGREE. SIMPROK holds no
   * fact by which a source's own place name can be shown to be inside or
   * outside a canonical Wilayah, so it says exactly that and asks once. The two
   * facts themselves are shown side by side by `regionScopeNoticeView` — this
   * sentence is only the reason the save is waiting.
   */
  REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE:
    'Wilayah pada sumber belum dapat dipastikan sesuai dengan Wilayah SIMPROK. Tinjau wilayah dulu di halaman Impor.',
  NO_ROWS_READY_FOR_PRIVATE_USE:
    'Belum ada baris yang siap disimpan. Konfirmasi pilihan pada setidaknya satu baris untuk melanjutkan.',
  // NOT A REFUSAL. The work is done, and the room says so instead of offering
  // to repeat it. The count that belongs beside this sentence is rendered by
  // the page, which knows how many prices are actually stored.
  ALL_READY_ROWS_ALREADY_PRIVATE:
    'Semua baris yang selesai sudah tersimpan dan bisa dipakai. Tidak ada yang perlu disimpan lagi untuk saat ini.',
};

const PROPOSAL_BLOCK_SENTENCES: Record<ProposalNotOfferedReason, string> = {
  ALREADY_PROPOSED: 'Batch ini sudah diusulkan ke SIMPROK.',
  // The routing sentence. It says what SIMPROK does with this family, not that
  // the family is worth less — an official list and a supplier quote are
  // recorded with their own source, not put to community verification.
  SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION:
    'Harga dari sumber ini disimpan apa adanya beserta sumbernya, bukan diusulkan untuk diperiksa bersama. Usulan bersama hanya untuk harga lapangan atau komunitas.',
  BATCH_NOT_READY_FOR_REVIEW:
    'Masih ada baris yang belum diputuskan. Usulan ke SIMPROK menutup batch ini, jadi semua baris harus selesai dulu.',
  EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION:
    'Tanggal berlaku harga belum diisi. Lengkapi dulu di halaman Impor.',
  REGION_REQUIRED_BEFORE_SUBMISSION:
    'Wilayah harga belum dipilih. Lengkapi dulu di halaman Impor.',
  SOURCE_ORIGIN_REQUIRED_BEFORE_SUBMISSION:
    'Asal sumber harga belum diisi. Lengkapi dulu di halaman Impor.',
  SOURCE_TYPE_REQUIRED_BEFORE_SUBMISSION:
    'Jenis sumber harga belum tercatat. Lengkapi dulu di halaman Impor.',
  // The same unproven pair as the private door, in the proposal's own words.
  // An unreconciled geography must not reach SIMPROK's curation either.
  REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_SUBMISSION:
    'Wilayah pada sumber belum dapat dipastikan sesuai dengan Wilayah SIMPROK. Tinjau wilayah dulu di halaman Impor.',
  NO_ROWS_READY_FOR_SUBMISSION:
    'Belum ada baris yang siap diusulkan.',
};

export const privateUseBlockSentence = (
  reasonCode: PrivateUseBlockReason | null,
): string | null => (reasonCode ? (PRIVATE_USE_BLOCK_SENTENCES[reasonCode] ?? null) : null);

export const proposalBlockSentence = (
  reasonCode: ProposalNotOfferedReason | null,
): string | null => (reasonCode ? (PROPOSAL_BLOCK_SENTENCES[reasonCode] ?? null) : null);

/**
 * CATALOG VOCABULARY — the words for the three enums the search selector shows.
 *
 * The reviewer was reading rows like `SEMEN PC — MATERIAL — Zak` and
 * `M3 — Meter Kubik — m³ — VOLUME — CANONICAL`. Those last tokens are database
 * enums; a site engineer choosing which resource a workbook line means should
 * not have to know that `CANONICAL` is SIMPROK's word for a base unit. The
 * facts stay — they are exactly what distinguishes two similar candidates — and
 * only the spelling changes.
 *
 * `rowSectionLabel` above already owns the three resource families and is
 * reused for them rather than restated here.
 */
const UNIT_DIMENSION_LABELS: Record<UnitDimension, string> = {
  COUNT: 'Jumlah',
  MASS: 'Massa',
  LENGTH: 'Panjang',
  AREA: 'Luas',
  VOLUME: 'Volume',
  TIME: 'Waktu',
  PERSON_TIME: 'Waktu Orang',
  EQUIPMENT_TIME: 'Waktu Alat',
};

const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  CANONICAL: 'satuan dasar',
  COMMERCIAL_PACKAGE: 'satuan kemasan',
  CONTEXTUAL: 'satuan kontekstual',
};

export const unitDimensionLabel = (dimension: UnitDimension): string =>
  UNIT_DIMENSION_LABELS[dimension] ?? dimension;

export const unitKindLabel = (kind: UnitKind): string => UNIT_KIND_LABELS[kind] ?? kind;

/** One catalog resource, as a person reads it — name first, metadata second. */
export const resourceOptionMeta = (item: {
  code: string | null;
  type: ResourceType;
  baseUnit: string;
}): string =>
  [rowSectionLabel(item.type), item.baseUnit, item.code ?? 'Kode tidak tersedia'].join(' • ');

export const resourceOptionLabel = (item: {
  code: string | null;
  name: string;
  type: ResourceType;
  baseUnit: string;
}): string => `${item.name} — ${resourceOptionMeta(item)}`;

/** Soften English unit display names that still leak from catalog data. */
const humanUnitDisplayName = (displayName: string): string => {
  if (/^cubic\s*metr[ey]$/i.test(displayName.trim())) return 'meter kubik';
  return displayName;
};

/** One canonical unit, as a person reads it. */
export const unitOptionLabel = (item: {
  code: string;
  displayName: string;
  symbol: string;
  dimension: UnitDimension;
  kind: UnitKind;
}): string => {
  const name = humanUnitDisplayName(item.displayName);
  // Prefer "meter kubik (m³)" over English "Cubic metre".
  const named =
    name === 'meter kubik' ? `meter kubik (${item.symbol || 'm³'})` : `${name} — ${item.symbol}`;
  return `${item.code} — ${named} — ${unitDimensionLabel(item.dimension)} — ${unitKindLabel(item.kind)}`;
};

/**
 * Row card facts line — one price spelling, ordinary Indonesian absences.
 */
export const rowReviewFactsLine = (row: BasicPriceImportRowSummary): string => {
  const code = row.code?.trim() ? row.code : 'Kode tidak tersedia';
  const unit = row.unit?.trim()
    ? `Satuan dari berkas: ${row.unit}`
    : 'Satuan dari berkas: tidak tercantum';
  const priceSource = row.proposedCanonicalPrice ?? row.rawPriceDisplayText;
  const price = priceSource ? `Harga Rp ${priceSource}` : 'Harga tidak tercantum';
  return `${code} · ${unit} · ${price}`;
};

/**
 * SOURCE VOCABULARY, IN ONE PLACE.
 *
 * The import page held its own two option arrays. Moving the words here is not
 * tidying: `savedMetadataLines` below has to print the same origin with the
 * same word the selector offered, and two lists drift. Keeping them as one
 * record also means the selector is DERIVED from the vocabulary rather than
 * maintained beside it.
 */
export const SOURCE_ORIGIN_LABELS: Record<
  NonNullable<BasicPriceImportBatchSummary['sourceOrigin']>,
  string
> = {
  GOVERNMENT: 'Pemerintah',
  SUPPLIER: 'Pemasok',
  STORE: 'Toko',
  DISTRIBUTOR: 'Distributor',
  FIELD_REPORT: 'Laporan Lapangan',
  COMMUNITY_REPORT: 'Laporan Komunitas',
};

/**
 * What each source TYPE means in words. SIMPROK derives the type from the
 * origin, so these are never offered as a choice — they are only ever read
 * back, to show what was recorded.
 */
export const SOURCE_TYPE_LABELS: Record<
  NonNullable<BasicPriceImportBatchSummary['sourceType']>,
  string
> = {
  VENDOR_QUOTE: 'Penawaran Vendor',
  MARKET_SURVEY: 'Survei Pasar',
  REGULATION: 'Regulasi',
  SYSTEM_ESTIMATE: 'Estimasi Sistem',
};

/**
 * The FOUR source types, offered as the independent question they are. The
 * import form briefly stopped asking this — on the theory that an origin
 * implies one type — which made a government-published market survey
 * undescribable. Owner law keeps the axes separate
 * (BASIC-PRICE-MASTER-DECISION §10), so the question is asked and the answer is
 * stored verbatim.
 */
export const SOURCE_TYPE_OPTIONS: { value: NonNullable<BasicPriceImportBatchSummary['sourceType']>; label: string }[] =
  (Object.keys(SOURCE_TYPE_LABELS) as NonNullable<BasicPriceImportBatchSummary['sourceType']>[]).map(
    (value) => ({ value, label: SOURCE_TYPE_LABELS[value] }),
  );

export const SOURCE_ORIGIN_OPTIONS: { value: NonNullable<BasicPriceImportBatchSummary['sourceOrigin']>; label: string }[] =
  (Object.keys(SOURCE_ORIGIN_LABELS) as NonNullable<BasicPriceImportBatchSummary['sourceOrigin']>[]).map(
    (value) => ({ value, label: SOURCE_ORIGIN_LABELS[value] }),
  );

const NOT_YET_STATED = 'belum diisi';

/**
 * BP-VISUAL-TRUTH-07 §19 — A CALENDAR DAY, WRITTEN THE WAY THIS AUDIENCE
 * WRITES ONE.
 *
 * SIMPROK stores and transports a date as ISO `YYYY-MM-DD` and that does not
 * change here: this is PRESENTATION ONLY, applied at the moment a stored date
 * becomes a sentence a person reads. `08/29/2026` and `2026-08-29` are the same
 * fact; only one of them is the fact an Indonesian reader recognises at a
 * glance, and a screen that mixes the two teaches nobody which is which.
 *
 * NOTHING IS PARSED AND NOTHING IS SHIFTED. The ISO head is split on its own
 * hyphens and the three pieces are reordered — no `new Date()`, so no time zone
 * can move the day, which is the exact failure `toLocalDateOnlyString` exists
 * to prevent one file over. A value that is not an ISO date head is returned
 * untouched rather than guessed at.
 */
export const formatIsoDateAsIndonesian = (isoDate: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
};

/**
 * WHAT SIMPROK ACTUALLY HAS ON RECORD FOR THIS BATCH.
 *
 * Every line reads from the SERVER's answer, never from the form's local
 * state — which is the whole point. Metadata used to be writable and readable
 * nowhere: a person pressed "Simpan Metadata", was told "tersimpan", and had no
 * way to see what had been stored, so persistence was unprovable through the
 * product itself.
 *
 * An unset fact says "belum diisi". It is never filled in, never inferred from
 * what is on screen, and never left blank in a way that could pass for a value.
 *
 * The SAVE and the RELOAD both carry the region now, so the region line names a
 * PLACE on both — which is what makes "I chose Kota Ambon and SIMPROK kept it"
 * something a person can read rather than take on trust. The three-way branch
 * stays: `preview` legitimately carries no region, and "a region IS chosen and
 * this response did not carry it" must never collapse into "belum diisi".
 */
export const savedMetadataLines = (batch: BasicPriceImportBatchSummary): string[] => {
  const origin = batch.sourceOrigin ? SOURCE_ORIGIN_LABELS[batch.sourceOrigin] : NOT_YET_STATED;
  const type = batch.sourceType ? SOURCE_TYPE_LABELS[batch.sourceType] : NOT_YET_STATED;
  // ONE SPELLING OF A REGION, and it is the selector's. This line used to
  // compose `${code} — ${name}` of its own, so the place a person had just
  // picked as "Kecamatan Teluk Ambon Baguala, Kota Ambon" was read back to them
  // with a provisioning code bolted to the front. `regionChosenLabel` already
  // owns that question — a chosen region has nothing left to be told apart
  // from, so the code is noise — and this now asks it rather than disagreeing.
  const region = batch.regionId
    ? (batch.region ? regionChosenLabel(batch.region) : 'sudah dipilih')
    : NOT_YET_STATED;
  const publisher = batch.sourceOrganizationName?.trim();
  /**
   * READ BACK UNDER THE SAME NAME IT WAS ASKED FOR. A person who answered
   * "Tanggal / periode harga" and is then shown "Tanggal berlaku" has no way to
   * tell whether SIMPROK stored their answer or something else.
   */
  const dateLabel = effectiveDateCopy(batch.temporal?.effectiveDateQuestion).label;
  /**
   * AND THE SOFT DATE IS READ BACK TOO — it was writable here and visible
   * nowhere until the price reached the Explorer, which is the same
   * unprovable-persistence gap the rest of this block exists to close. Omitted
   * entirely when nobody stated one: an absent line is honest, an empty value
   * would read as a fact SIMPROK lost.
   */
  const reverification = batch.reviewDate
    ? [`${REVERIFICATION_LABEL}: ${formatIsoDateAsIndonesian(batch.reviewDate)}`]
    : [];
  /**
   * BP-VISUAL-TRUTH-07 §7 — THE COLUMN AND THE PLACE ARE TWO ANSWERS, AND THIS
   * IS WHERE THEY STOPPED BEING TOLD APART.
   *
   * A regional-matrix workbook is asked one question at intake — which of its
   * price columns to read — and the answer is the document's own heading, e.g.
   * "TELUK AMBON". The canonical Region is a SEPARATE question answered in this
   * very form, e.g. "Kecamatan Teluk Ambon Baguala, Kota Ambon". Both were
   * stored correctly and always have been; only the Region was ever read back,
   * under the word "Wilayah" — the same word the column question used. A person
   * who answered "TELUK AMBON" and was shown "Wilayah: Kecamatan Teluk Ambon
   * Baguala, Kota Ambon" had no way to learn they had answered two questions,
   * and every reason to conclude SIMPROK had substituted one region for another.
   *
   * So the column fact is now stated, in its own words, under its own name, and
   * ONLY when the source actually offered a choice — a single-column source
   * gains no line, because nobody chose anything.
   */
  const priceColumn = batch.sourceRegionScopeLabel?.trim()
    ? [`Kolom harga pada berkas: ${batch.sourceRegionScopeLabel.trim()}`]
    : [];
  return [
    `Asal data: ${origin}`,
    `Nama sumber: ${publisher ? publisher : NOT_YET_STATED}`,
    `Metode perolehan: ${type}`,
    `${dateLabel}: ${batch.effectiveDate ? formatIsoDateAsIndonesian(batch.effectiveDate) : NOT_YET_STATED}`,
    ...reverification,
    `Wilayah: ${region}`,
    ...priceColumn,
  ];
};

/**
 * BP-REGION-TRUTH-07S §8 — THE ONE THING A PERSON HAS TO DECIDE, AND NOTHING
 * ELSE.
 *
 * The two facts are already on screen: `savedMetadataLines` prints the file's
 * own column wording and the canonical Wilayah under their own separate names.
 * What was missing is the sentence BETWEEN them — that SIMPROK cannot tell
 * whether they describe the same place — and one action to settle it.
 *
 * CALM, NOT LOUD. A short statement and a single button. The reasoning belongs
 * behind the room's existing disclosure, not in a paragraph beside the form:
 * `Region` is a flat code/name table with no hierarchy, so there is no
 * authoritative fact by which "SIRIMAU" could be shown to sit inside "Kecamatan
 * Teluk Ambon Baguala", and inventing one from the spelling would be a guess
 * with a proof's confidence.
 *
 * NULL MEANS SAY NOTHING, and that is the ordinary case: every source that
 * wrote no region word of its own, every source that offered only one place,
 * and every pair a person has already reconciled.
 */
export interface RegionScopeNotice {
  /** The source's own wording for the column that was read. */
  sourceLabel: string;
  /** The source's own word proving that column names a place. */
  sourceEvidence: string;
  /** The canonical Wilayah, in the words this app already uses for one. */
  regionLabel: string;
  message: string;
  actionLabel: string;
  /** The secondary explanation, for the room's existing disclosure pattern. */
  why: string;
}

export const regionScopeNoticeView = (
  batch: BasicPriceImportBatchSummary,
): RegionScopeNotice | null => {
  const scope = batch.actions?.regionScope;
  if (!scope?.compatibilityUnproven) return null;
  // Never invent either half. The server said this pair is unproven, which it
  // only ever does when both facts are present; a missing one here would mean
  // the projection and this view disagree, and the honest response is silence.
  if (!scope.sourceLabel || !scope.geographicEvidence) return null;
  if (!batch.regionId) return null;

  return {
    sourceLabel: scope.sourceLabel,
    sourceEvidence: scope.geographicEvidence,
    regionLabel: batch.region ? regionChosenLabel(batch.region) : 'sudah dipilih',
    message:
      'Wilayah pada sumber belum dapat dipastikan sesuai dengan Wilayah SIMPROK.',
    actionLabel: 'Tinjau wilayah',
    why:
      'Berkas ini menuliskan sendiri bahwa kolom harganya adalah wilayah, dan SIMPROK belum memiliki dasar untuk memastikan wilayah pada berkas sama dengan Wilayah yang Anda pilih. SIMPROK tidak menebak — Anda yang memutuskan.',
  };
};

/**
 * WHY ONE ROW'S DECISION DID NOT LAND.
 *
 * Both row handlers used to answer every failure with "Baris mungkin sudah
 * berubah — muat ulang dan coba lagi." That is one plausible cause out of
 * several, stated as though it were known. A reviewer whose session had expired
 * reloaded and lost their work; a reviewer without BASIC_PRICE_RESOLVE reloaded
 * forever. The stale-version guess is now made only where the status actually
 * means it.
 */
export const rowActionFailureMessage = (
  action: 'RESOLVE' | 'REJECT',
  sourceRowNumber: number,
  httpStatus: number,
): string => {
  const what = action === 'RESOLVE' ? 'menyelesaikan' : 'menolak';
  const lead = `Gagal ${what} baris ${sourceRowNumber}.`;
  if (httpStatus === 401) return `${lead} Sesi Anda sudah berakhir — masuk kembali lalu ulangi.`;
  if (httpStatus === 403)
    return `${lead} Akun Anda belum memiliki kewenangan memutuskan baris di workspace ini.`;
  if (httpStatus === 404) return `${lead} Baris ini tidak ditemukan lagi. Muat ulang halaman.`;
  if (httpStatus === 409)
    return `${lead} Baris ini sudah berubah sejak halaman dimuat — muat ulang lalu putuskan lagi.`;
  if (httpStatus >= 500) return `${lead} SIMPROK mengalami kendala. Keputusan Anda belum tersimpan.`;
  return `${lead} Keputusan Anda belum tersimpan.`;
};

/**
 * BP-VISUAL-TRUTH-07 §14 — WHAT A REVIEWER READS ONCE SIMPROK HAS ALREADY
 * REPAIRED WHAT IT COULD.
 *
 * The sentence in `rowActionFailureMessage` for 409 ends "muat ulang lalu
 * putuskan lagi" — it asks the person to perform the recovery. That sentence
 * remains correct for the one case where the refresh itself failed, but it is
 * the wrong thing to say when SIMPROK has just fetched the newest state on
 * their behalf: it would send someone to reload a page that is already current,
 * discarding the selections still sitting in the boxes.
 *
 * THREE FACTS, IN THE ORDER A PERSON NEEDS THEM: the row moved, SIMPROK has
 * the new version on screen, and the decision is still theirs to make. It does
 * NOT say "berhasil" about anything, because nothing was written — the write
 * was refused, and the next one will be a deliberate press against the version
 * now displayed.
 */
export const staleRowRecoveryMessage = (sourceRowNumber: number): string =>
  `Baris ${sourceRowNumber} baru saja diperbarui oleh perubahan lain, jadi keputusan Anda belum tersimpan. ` +
  `SIMPROK sudah memuat versi terbaru baris ini — pilihan Anda masih tersimpan sebagai draf. ` +
  `Periksa kembali, lalu konfirmasi ulang untuk menyimpan.`;

/** The server's own named code, if this body carries one. Never a guess. */
const namedCodeOf = (rawBody: string): string | null => {
  try {
    const parsed = JSON.parse(rawBody) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : null;
  } catch {
    return null; // Not JSON. The status below is still more honest than a guess.
  }
};

/**
 * WHY A LIFECYCLE ACTION FAILED — said as the fact it actually is.
 *
 * Same discipline as `importRequestMessage`, and deliberately not that
 * function: those sentences are about an UPLOAD ("isi berkas belum
 * diperiksa"), and none of these actions involves a file at all. Saying
 * anything about a workbook here would be the same fluent falsehood in a new
 * place.
 *
 * WHEN THE SERVER NAMED A REASON, THAT REASON IS WHAT THE PERSON READS — the
 * very same sentence the button would have shown them beforehand, because both
 * come from the one map above. The generic lines below are only for what has no
 * name: an expired session, a missing authority, a fault. None of them invents
 * a cause, and none of them claims success.
 */
export const lifecycleActionFailureMessage = (
  kind: 'PRIVATE_USE' | 'PROPOSAL',
  httpStatus: number,
  rawBody: string,
): string => {
  const code = namedCodeOf(rawBody);
  if (code) {
    const named =
      kind === 'PRIVATE_USE'
        ? privateUseBlockSentence(code as PrivateUseBlockReason)
        : proposalBlockSentence(code as ProposalNotOfferedReason);
    if (named) return named;
  }
  if (httpStatus === 401)
    return 'Sesi Anda sudah berakhir. Masuk kembali lalu ulangi. Tidak ada yang tersimpan.';
  if (httpStatus === 403)
    return 'Akun Anda belum memiliki kewenangan melakukan tindakan ini di workspace ini. Tidak ada yang tersimpan.';
  if (httpStatus === 404)
    return 'Batch ini tidak ditemukan lagi. Muat ulang halaman.';
  if (httpStatus === 409)
    return 'Data baris ini telah berubah. Muat data terbaru sebelum melanjutkan. Tidak ada yang tersimpan sebagian.';
  if (httpStatus >= 500)
    return 'SIMPROK mengalami kendala. Tidak ada fakta yang diterka atau disimpan sebagian.';
  return kind === 'PRIVATE_USE'
    ? 'Harga belum tersimpan. Tidak ada yang disimpan sebagian.'
    : 'Usulan belum terkirim. Tidak ada yang dikirim sebagian.';
};

/**
 * WHY THE METADATA SAVE DID NOT LAND — the one door the region travels through.
 *
 * `handleSaveMetadata` used to catch everything and print one line: "Gagal
 * menyimpan metadata. Batch mungkin sudah berubah". That names a cause SIMPROK
 * has not established — "mungkin" is the page guessing — and it is the WRONG
 * guess for every case that actually stops a person: an expired session, a
 * missing authority, a batch that has been closed. This is the save that carries
 * the REGION, the date and the source, so a person who cannot save cannot use
 * their prices at all; being told a maybe is being told nothing.
 *
 * Same discipline as `lifecycleActionFailureMessage`, and deliberately not that
 * function: those sentences are about ACTING on a batch, these about DESCRIBING
 * one. Every line ends the same way, because that is the one fact always true
 * here — the PATCH is a single transaction, so nothing was stored in part.
 */
export const metadataSaveFailureMessage = (
  httpStatus: number,
  rawBody: string,
): string => {
  const code = namedCodeOf(rawBody);
  if (code === 'BATCH_VERSION_STALE')
    return 'Data baris ini telah berubah. Muat data terbaru sebelum melanjutkan. Tidak ada yang tersimpan.';
  if (code === 'BATCH_NOT_MUTABLE')
    return 'Batch ini sudah ditutup, jadi keterangannya tidak bisa diubah lagi. Tidak ada yang tersimpan.';
  if (httpStatus === 401)
    return 'Sesi Anda sudah berakhir. Masuk kembali lalu simpan lagi. Tidak ada yang tersimpan.';
  if (httpStatus === 403)
    return 'Akun Anda belum memiliki kewenangan mengubah keterangan batch ini. Tidak ada yang tersimpan.';
  if (httpStatus === 404)
    return 'Batch ini tidak ditemukan lagi. Muat ulang halaman. Tidak ada yang tersimpan.';
  if (httpStatus >= 500)
    return 'SIMPROK mengalami kendala saat menyimpan keterangan batch. Tidak ada yang tersimpan.';
  return 'Keterangan batch belum tersimpan. Tidak ada yang tersimpan sebagian.';
};

/**
 * What actually happened after a save, counted from the server's own answer.
 * Never predicted, and it distinguishes "kept just now" from "already kept" so
 * a second press reads as truthful rather than as a second success.
 */
export const formatPrivateUseOutcome = (result: {
  createdCount: number;
  alreadyPrivateCount: number;
}): string => {
  const { createdCount, alreadyPrivateCount } = result;
  const total = createdCount + alreadyPrivateCount;
  if (total === 0) return 'Tidak ada baris yang tersimpan.';
  if (createdCount === 0) {
    return `${alreadyPrivateCount} harga sudah tersimpan sebelumnya dan tetap siap dipakai. Tidak ada yang berubah.`;
  }
  const repeat =
    alreadyPrivateCount > 0
      ? ` ${alreadyPrivateCount} harga sudah tersimpan sebelumnya.`
      : '';
  return `${createdCount} harga tersimpan dan siap dipakai di Basic Price milik ruang kerja Anda.${repeat}`;
};

export const isRowMutable = (row: BasicPriceImportRowSummary): boolean => row.status === 'NEEDS_REVIEW';

// ---------------------------------------------------------------------------
// INT-CONNECT-01 — VISIBLE ACCOUNTABILITY
//
// Everything below is PRESENTATION over verdicts the backend already reached.
// Not one function here decides what a unit means, what a resource is, or
// whether a row may be completed: they translate named facts into sentences a
// site engineer can act on. If a rule ever needs to CHANGE an outcome, it
// belongs behind the canonical authorities, never in this file.
// ---------------------------------------------------------------------------

/**
 * Where a row stands, from the reviewer's point of view rather than the
 * database's.
 *
 *   PROVEN     BOTH identity legs — resource and unit — are proven and
 *              admissible. It is the presentation face of `identityPairProven`
 *              and it carries exactly that meaning and no more: the price
 *              lifecycle, same-identity collisions within the batch and
 *              READY_FOR_SUBMISSION are decided by the backend from facts no
 *              proposal judges. "Every fact proved" was too broad a claim.
 *   ATTENTION  SIMPROK found something real but may not choose between them.
 *   UNKNOWN    SIMPROK honestly found nothing safe to offer.
 *   NOT_ASKED  the authorities were not consulted for this row.
 */
export type RowMachineState = 'PROVEN' | 'ATTENTION' | 'UNKNOWN' | 'NOT_ASKED';

export const rowMachineState = (row: BasicPriceImportRowSummary): RowMachineState => {
  const proposal = row.machineProposal;
  if (!proposal) return 'NOT_ASKED';
  if (proposal.identityPairProven) return 'PROVEN';
  // Something to look at is a different invitation from nothing at all: one
  // asks the reviewer to choose, the other asks them to supply.
  const hasSomethingToShow =
    proposal.resource.candidates.length > 0 || proposal.unit.unitCode !== null;
  return hasSomethingToShow ? 'ATTENTION' : 'UNKNOWN';
};

const MACHINE_STATE_LABELS: Record<RowMachineState, string> = {
  PROVEN: 'Dikenali otomatis',
  ATTENTION: 'Perlu keputusan Anda',
  UNKNOWN: 'Belum dikenali',
  NOT_ASKED: '',
};

export const rowMachineStateLabel = (state: RowMachineState): string =>
  MACHINE_STATE_LABELS[state];

/**
 * One named missing fact, said in words.
 *
 * The KEYS are the engines' and the resolve endpoint's own codes, never a
 * vocabulary invented here — so a code that arrives without a sentence falls
 * back to itself rather than being silently swallowed. A reviewer seeing a raw
 * code is a prompt to add the sentence; a reviewer seeing nothing is a lie.
 */
const BLOCKING_FACT_LABELS: Record<string, string> = {
  ROW_SOURCE_SECTION_UNRESOLVED: 'Kategori sumber daya belum dapat dipastikan.',
  UNIT_REQUIRED: 'Dokumen sumber tidak mencantumkan satuan pada baris ini.',
  UNKNOWN_UNIT_ALIAS: 'Satuan belum dikenali.',
  AMBIGUOUS_UNIT_ALIAS: 'Satuan punya lebih dari satu arti yang sama kuat.',
  CONTEXT_REQUIRED_UNIT_ALIAS: 'Satuan hanya bermakna di dalam kategori tertentu.',
  FOREIGN_CONTEXT_UNIT_ALIAS: 'Satuan itu dikenal, tetapi untuk kategori lain.',
  UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY:
    'Satuan kanonik itu belum dapat dibuktikan oleh otoritas satuan.',
  RESOURCE_NOT_FOUND:
    'Item belum dikenali. Pilih Item SIMPROK yang sesuai, atau tolak baris ini.',
  MULTIPLE_CANDIDATES_NEEDS_REVIEW: 'Ada lebih dari satu kandidat yang sama kuat.',
  STRONG_CANDIDATE_NEEDS_REVIEW: 'Ada satu kandidat kuat yang masih perlu ditegaskan.',
  SPECIFICATION_UNPROVED: 'Entri katalog menyebut hal yang tidak disebut sumber.',
  SPECIFICATION_CONFLICT: 'Spesifikasi sumber dan katalog bertentangan.',
  RESOURCE_TYPE_MISMATCH: 'Jenis sumber daya tidak cocok dengan kategori baris.',
  RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE:
    'Sumber daya itu dikenali SIMPROK, tetapi berada di katalog global — bukan katalog workspace ini.',
  REVIEWED_MAPPING_CONFLICT: 'Keputusan manusia terdahulu saling bertentangan.',
  UNIT_CONTEXT_SOURCE_UNIT_UNSTATED:
    'Sumber tidak menyebut satuan untuk memilah kandidat.',
  UNIT_CONTEXT_SOURCE_UNIT_UNPROVED:
    'Satuan sumber belum terbukti, jadi kandidat tidak dapat dipilah.',
  UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED: 'Satuan salah satu kandidat belum terbukti.',
  UNIT_CONTEXT_NO_MATCHING_REPRESENTATION:
    'Tidak ada kandidat yang bersatuan sama dengan sumber.',
  UNIT_CONTEXT_MULTIPLE_MATCHING_REPRESENTATIONS:
    'Beberapa kandidat bersatuan sama dengan sumber.',
};

/**
 * THE DIAGNOSTIC ACCESSOR. Falls back to the CODE, and is therefore for logs,
 * audit output and developer tooling — never for a reviewer's screen. Nothing
 * on the Basic Price review page reads it; `humanFact` is what the screen uses.
 */
export const blockingFactLabel = (code: string): string =>
  BLOCKING_FACT_LABELS[code] ?? code;

/**
 * THE SAME TABLE, READ UNDER THE HUMAN-SURFACE RULE.
 *
 * `blockingFactLabel` falls back to the CODE, which is the right answer for a
 * diagnostic reader: an untranslated code is a visible prompt to add its
 * sentence. It is the wrong answer for an ordinary reviewer, for whom
 * UPPER_SNAKE is not language at all.
 *
 * So the human surface reads the one table through this accessor instead. No
 * second vocabulary is introduced — only a second FALLBACK POLICY, and the
 * fallback still says that something is unproven rather than pretending
 * nothing is. Which codes exist remains a fact of the engines; how an
 * untranslated one degrades is a fact of the screen.
 */
export const HUMAN_FACT_FALLBACK =
  'Ada satu hal yang belum dapat dibuktikan SIMPROK pada baris ini.';

/** The sentence for a code, or null when this table has none for it. */
const knownFact = (code: string): string | null => BLOCKING_FACT_LABELS[code] ?? null;

export const humanFact = (code: string): string => knownFact(code) ?? HUMAN_FACT_FALLBACK;

/** Which leg of the decision a named fact belongs to. Prefixes, not guesses. */
const isUnitFact = (code: string): boolean =>
  code === 'UNIT_REQUIRED' ||
  code === 'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY' ||
  code.endsWith('_UNIT_ALIAS');

/**
 * PHASE 8 / BP-INT-14 — why "Selesaikan" is not available, in one sentence.
 *
 * Returns null when the action IS available. Two different silences are kept
 * apart deliberately: a fact SIMPROK could not prove is named as that fact,
 * while a fact SIMPROK proved and the reviewer then cleared is reported as
 * simply unpicked. Telling a reviewer "satuan belum dikenali" about a unit they
 * just deleted themselves would be false.
 *
 * The count leads the sentence because "1 hal lagi diperlukan" is a shape a
 * reviewer can plan around; a bare list is not.
 *
 * Every named fact is read through `humanFact`, never `blockingFactLabel`:
 * this sentence is rendered on the reviewer's screen, and a code that has not
 * been given a sentence yet must degrade into language rather than into
 * UPPER_SNAKE. The companion test still pins that every code the backend can
 * actually emit has its OWN sentence, so the generic fallback stays a safety
 * net rather than a habit.
 */
export const completionBlockReason = (
  row: BasicPriceImportRowSummary,
  picked: { resource: boolean; unit: boolean; busy: boolean },
): string | null => {
  if (picked.busy) return 'Sedang memproses...';

  const facts = row.machineProposal?.blockingFacts ?? [];
  const missing: string[] = [];

  if (!picked.resource) {
    const own = facts.filter((code) => !isUnitFact(code));
    missing.push(
      ...(own.length > 0 ? own.map(humanFact) : ['Sumber daya belum ditentukan.']),
    );
  }
  if (!picked.unit) {
    const own = facts.filter(isUnitFact);
    missing.push(
      ...(own.length > 0 ? own.map(humanFact) : ['Satuan belum ditentukan.']),
    );
  }

  if (missing.length === 0) return null;
  const unique = [...new Set(missing)];
  return unique.length + ' hal lagi diperlukan: ' + unique.join(' ');
};

export interface RowMachineStateTally {
  total: number;
  proven: number;
  attention: number;
  unknown: number;
  notAsked: number;
  readyForSubmission: number;
}

/**
 * THE ONE CLASSIFICATION LAW, APPLIED TO A WHOLE BATCH.
 *
 * The batch line used to be computed by arithmetic — `needsReviewRows - proven`
 * — while each row was labelled by `rowMachineState`. Two laws for one truth,
 * and they disagreed: a row SIMPROK honestly could not recognise was rendered
 * "Belum dikenali" and simultaneously counted under "perlu keputusan Anda". A
 * reviewer told there are decisions waiting, who then finds rows with nothing to
 * decide, has been misdirected by the summary.
 *
 * So the batch counts every row through the SAME `rowMachineState` the row
 * itself is labelled with. The two levels cannot drift, because there is only
 * one law left.
 */
export const countRowMachineStates = (
  batch: BasicPriceImportBatchSummary,
): RowMachineStateTally => {
  const tally: RowMachineStateTally = {
    total: batch.totalRows,
    proven: 0,
    attention: 0,
    unknown: 0,
    notAsked: 0,
    readyForSubmission: batch.readyForSubmissionRows,
  };
  for (const row of batch.rows) {
    switch (rowMachineState(row)) {
      case 'PROVEN':
        tally.proven += 1;
        break;
      case 'ATTENTION':
        tally.attention += 1;
        break;
      case 'UNKNOWN':
        tally.unknown += 1;
        break;
      default:
        // Already resolved, rejected or submitted — nothing was asked about it,
        // and it is reported through its own status, never as an open question.
        tally.notAsked += 1;
    }
  }
  return tally;
};

/**
 * PHASE 9 / BP-INT-15 — the batch line that points attention at what is left.
 *
 * Every number is COUNTED from the payload through the shared classification
 * law. Nothing is predicted, nothing is hard-coded, and "perlu keputusan Anda"
 * is kept distinct from "belum dikenali" because they ask the reviewer for two
 * different things: one to CHOOSE, the other to SUPPLY.
 */
export const formatMachineFirstSummary = (batch: BasicPriceImportBatchSummary): string => {
  if (batch.totalRows === 0) return 'Tidak ada baris pada batch ini.';
  const tally = countRowMachineStates(batch);

  /**
   * ONE SCREEN, ONE STORY — AND THIS LINE TOLD THREE.
   *
   * The Owner's post-save screen read:
   *
   *   `86 baris terbaca · 0 identitas terbukti · 61 perlu keputusan Anda ·
   *    12 belum dikenali · 13 siap diajukan · 13 sudah tersimpan`
   *
   * Every number was individually true and the sentence as a whole misled three
   * separate ways:
   *
   *   `0 identitas terbukti`  counts rows still AWAITING a decision that
   *                           SIMPROK has proven. After a save none are still
   *                           awaiting, so it collapses to zero — and a person
   *                           reads "SIMPROK proved nothing", the exact
   *                           opposite of what just happened.
   *   `13 siap diajukan`      is `readyForSubmissionRows`, an INTERNAL row
   *                           state wearing a curation word. Diajukan ke mana?
   *   `13 sudah tersimpan`    the truth — contradicted by both of the above.
   *
   * SO THE LINE NOW ANSWERS THE THREE QUESTIONS A PERSON ACTUALLY HAS: how much
   * is already usable, how much still needs them, how much SIMPROK could not
   * identify. The internal row state is not one of those questions and no
   * longer appears at all. A count with nothing to say stays silent rather than
   * printing a zero that reads as a verdict.
   */
  const segments = [`${tally.total} baris terbaca`];

  const stored =
    typeof batch.alreadyPrivateRows === 'number' ? batch.alreadyPrivateRows : 0;
  if (stored > 0) segments.push(`${stored} sudah tersimpan`);

  // MACHINE KNOWLEDGE, NAMED AS KNOWLEDGE. Before a save this is the thirteen
  // rows nobody has to confirm one by one; after it, it is zero because those
  // rows are STORED — and a stored row is reported as stored, above, never as
  // a proof that evaporated.
  if (tally.proven > 0) segments.push(`${tally.proven} dikenali otomatis`);

  // HIERARCHY, NOT PEERS. "Perlu keputusan" on the counter is the PARENT of
  // attention + unknown; spelling both as siblings of that total contradicted
  // the chip (e.g. 894 vs 222 + 672).
  const waiting = tally.attention + tally.unknown;
  if (waiting > 0) {
    segments.push(
      `${waiting} masih menunggu (${tally.attention} perlu keputusan Anda · ${tally.unknown} belum dikenali)`,
    );
  }
  return segments.join(' · ');
};

export interface MachinePickedResource {
  id: string;
  code: string | null;
  name: string;
  type: ResourceType;
  baseUnit: string;
  status: 'ACTIVE';
}

export interface MachinePickedUnit {
  id: string;
  code: string;
  displayName: string;
  symbol: string;
  dimension: UnitDimension;
  kind: UnitKind;
}

/**
 * THE TWO LEGS ARE PROVEN SEPARATELY, SO THEY ARE OFFERED SEPARATELY.
 *
 * A row's canonical unit and its resource identity are two independent facts
 * decided by two independent authorities. On the Owner's own workbook the Unit
 * authority proves 66 of 86 rows while Resource Identity proves 13 — so gating
 * BOTH pre-fills on `identityPairProven` would have made a reviewer re-search 53
 * units SIMPROK had already proved, purely because the resource beside them was
 * still open. That is exactly the busywork this slice exists to remove, and it
 * is also the "one unresolved item does not stop safe siblings" law applied
 * inside a single row rather than only across rows.
 *
 * Offering a proven unit next to an unproven resource is SAFE, and provably so
 * rather than by assumption: the resolve endpoint proves a chosen unit by
 * resolving the source spelling against the chosen unit's own canonical code,
 * and when those denote the SAME UnitDefinition the kernel returns identity
 * before it ever reads a conversion rule — including a resource-specific one.
 * Which resource is eventually chosen therefore cannot change the verdict on a
 * unit derived from the row's own spelling.
 *
 * What is NEVER pre-filled is anything short of proven: a candidate, a strong
 * match awaiting confirmation, an ambiguous alias. A pre-filled guess is worse
 * than an empty field, because it invites a confirmation nobody actually made.
 */
export const machinePickedResource = (
  row: BasicPriceImportRowSummary,
): MachinePickedResource | null => {
  const resource = row.machineProposal?.resource;
  // BOTH conditions, and they are different questions. `status === 'RESOLVED'`
  // is the shared authority saying it knows which catalog row this is;
  // `admissibleForResolve` is Basic Price saying this workspace may select it.
  // A globally scoped identity satisfies the first and fails the second, and
  // pre-filling it would hand the reviewer a choice the endpoint then refuses.
  if (!resource || resource.status !== 'RESOLVED' || !resource.admissibleForResolve)
    return null;
  if (
    resource.resourceCatalogId === null ||
    resource.resourceName === null ||
    resource.resourceType === null ||
    resource.resourceBaseUnit === null
  ) {
    // RESOLVED promised these. If any is absent the payload is not what it
    // claims, so nothing is pre-filled and the reviewer picks by hand — a
    // degraded screen, never a fabricated selection.
    return null;
  }
  return {
    id: resource.resourceCatalogId,
    code: resource.resourceCode,
    name: resource.resourceName,
    type: resource.resourceType,
    baseUnit: resource.resourceBaseUnit,
    status: 'ACTIVE',
  };
};

export const machinePickedUnit = (
  row: BasicPriceImportRowSummary,
): MachinePickedUnit | null => {
  const unit = row.machineProposal?.unit;
  // `unitDefinitionId` is populated ONLY when the authority both identified the
  // unit AND its canonical code round-tripped — the same pair the resolve
  // endpoint will demand. A merely identified unit leaves it null.
  if (!unit || unit.unitDefinitionId === null) return null;
  if (unit.unitCode === null || unit.unitDimension === null || unit.unitKind === null) {
    return null;
  }
  return {
    id: unit.unitDefinitionId,
    code: unit.unitCode,
    displayName: unit.unitDisplayName ?? unit.unitCode,
    symbol: unit.unitSymbol ?? unit.unitCode,
    dimension: unit.unitDimension,
    kind: unit.unitKind,
  };
};

/**
 * USI-01R / PHASE 7 — how to name a row's resource family, including when
 * SIMPROK genuinely does not know it.
 *
 * An unknown family is NEVER rendered as one of the three known ones, and the
 * source's own words are offered instead whenever it wrote any: "the source
 * said ALAT and SIMPROK has no mapping for it" is a fact a human can act on,
 * while printing "Bahan" there would simply be false.
 */
export const rowSectionDisplay = (row: BasicPriceImportRowSummary): string => {
  if (row.section !== null) {
    const label = rowSectionLabel(row.section);
    /**
     * BP-VISUAL-TRUTH-07 §12 — A WEAK HINT MUST NOT BE DRESSED AS A FACT.
     *
     * `UPLOADER_DECLARED` means nobody proved this row's family: the document
     * was silent, so a person answered one batch-wide question and every
     * evidence-free row was stamped with that answer. The Owner watched Batu
     * Kali and Batu Belah — plainly Bahan — sit on screen reading "Tenaga
     * kerja" in exactly the same type as a family the source had actually
     * stated. The hint was doing its job; the SCREEN was overstating it.
     *
     * So a batch hint says it is a starting point until something stronger
     * confirms it, and `resourceCatalogId` is that something: once a human has
     * chosen the Item SIMPROK, the family is theirs and the resolver has
     * already corrected the row to the catalog's own type (see
     * `basic-price-row-resolution.service.ts` — a weak hint never defeats a
     * confirmed catalog identity). That is why the resolved Batu Kali reads
     * "Bahan" flat, with nothing hedged about it: by then it IS the fact.
     *
     * The two document-proven provenances are untouched and never hedged.
     */
    const unconfirmedBatchHint =
      row.sectionProvenance === 'UPLOADER_DECLARED' && row.resourceCatalogId === null;
    return unconfirmedBatchHint ? `Kategori awal: ${label}` : label;
  }
  const stated = row.sourceCategoryName ?? row.sourceCategoryCode;
  return stated === null
    ? 'Kategori belum dapat dipastikan'
    : 'Kategori belum dapat dipastikan (sumber menulis "' + stated + '")';
};

// ---------------------------------------------------------------------------
// INT-CONNECT-01 — RICH INSIDE, SIMPLE OUTSIDE
//
// THE DEFECT THIS CLOSES. The review room used to render the authorities' own
// `explanation` strings straight onto the page. Those strings are legitimate
// INTERNAL explanation — they are built to be read by an auditor and they name
// what an auditor needs: ResourceCatalog row ids, the model's own name, raw
// reason codes, and — on the governed-decision branch — the account, the
// moment and the free-text note of the human who decided. Printing them handed
// a site engineer a UUID and, on that one branch, another person's record.
//
// THE REPAIR WAS COMPLETED ON BOTH SIDES OF THE SEAM. First here: every
// sentence below is derived from the proposal's STRUCTURED fields — status,
// candidate list, named reason codes, the resource's own name and code, the
// unit's own display name — so there is no sanitising pass to outwit and no
// regex deciding what a UUID looks like. Then on the wire: the outward Basic
// Price contract no longer HAS an `explanation` field on either leg, so the
// prose that carried those ids and that private note is not merely unread, it
// is not sent. A field that does not exist cannot leak.
//
// NOTHING WAS TAKEN FROM THE ENGINES. Both authorities still build their full
// explanation and still hold the reviewer, the moment and the note behind
// `hasPriorHumanDecision`. Privacy here is a narrower PROJECTION, never a
// smaller memory — an audit surface that earns its own law can still read all
// of it, from the authorities, where it lives.
//
// WHAT IS DELIBERATELY KEPT. Simple is not vague. The reviewer is still told
// which of the two legs is open, how many real choices exist, what a candidate
// entry claims that the source never said, and that a colleague once chose one
// of them. Removing THAT would trade a leak for a different dishonesty.
// ---------------------------------------------------------------------------

/**
 * One candidate, split so that its identity can key a list without ever being
 * printed. `key` is a React key and nothing else; `text` is the whole of what a
 * human sees. The closure allows an internal id to remain a key — the split is
 * what makes "allowed as a key, never as text" checkable rather than intended.
 */
export interface RowCandidateLine {
  key: string;
  text: string;
}

/**
 * EVERY human-visible string of a row's machine block, in one value.
 *
 * The page renders these fields and derives no sentence of its own, which is
 * what lets a pure test stand in for a DOM: what this function returns IS what
 * the reviewer reads. Null when the authorities were not consulted — silence
 * reported as silence, never as a verdict.
 */
export interface RowMachineNarrative {
  state: RowMachineState;
  stateLabel: string;
  /** What SIMPROK understood about the unit leg, in one sentence. */
  unit: string;
  /** What SIMPROK understood about the resource leg, in one sentence. */
  resource: string;
  /** Empty unless the reviewer actually has something to choose between. */
  candidates: RowCandidateLine[];
}

/**
 * A governed unit context named in ordinary words, reusing the ONE section
 * vocabulary rather than spelling MATERIAL/LABOR/EQUIPMENT at a human.
 */
const contextLabel = (context: string | null): string | null => {
  if (context === 'LABOR' || context === 'MATERIAL' || context === 'EQUIPMENT') {
    return rowSectionLabel(context);
  }
  return null;
};

/**
 * The named reasons behind a verdict, as sentences, without repetition. An
 * untranslated code is DROPPED here rather than printed: the state sentence it
 * accompanies already says what is true, so nothing is silently claimed.
 */
const reasonSentences = (codes: ReadonlyArray<string>): string[] => [
  ...new Set(codes.map(knownFact).filter((s): s is string => s !== null)),
];

const unitNarrative = (unit: RowUnitProposal): string => {
  if (unit.status === 'NOT_STATED') return humanFact('UNIT_REQUIRED');
  // Proven is exactly `unitDefinitionId !== null` — the same round-tripped pair
  // the resolve endpoint demands, and the same one `machinePickedUnit` offers.
  if (unit.unitDefinitionId !== null) {
    const readable = unit.unitDisplayName ?? unit.unitCode;
    const spelled = unit.rawUnit === null ? '' : '"' + unit.rawUnit + '" ';
    const scope = unit.contextScoped ? contextLabel(unit.trustedContext) : null;
    return (
      `Satuan ${spelled}dikenali sebagai ${readable}` +
      (scope === null ? '.' : ` untuk pekerjaan ${scope}.`)
    );
  }
  return humanFact(unit.reasonCode);
};

const resourceNarrative = (resource: RowResourceProposal): string => {
  const why = reasonSentences(resource.reasonCodes);
  if (resource.status === 'RESOLVED' && resource.resourceName !== null) {
    // Admissibility is a SECOND question — see `machinePickedResource`. An
    // identity SIMPROK proved but this workspace may not select is reported as
    // exactly that, never as a recognition the reviewer can act on.
    if (!resource.admissibleForResolve) {
      return humanFact('RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE');
    }
    const code = resource.resourceCode === null ? '' : ` (${resource.resourceCode})`;
    return `Sumber daya dikenali otomatis: ${resource.resourceName}${code}.`;
  }

  const count = resource.candidates.length;
  const head =
    count === 0
      ? 'SIMPROK belum menemukan sumber daya yang dapat dibuktikan.'
      : count === 1
        ? 'SIMPROK menemukan satu pilihan yang sesuai dengan bukti yang tersedia. Tegaskan bila memang itu yang dimaksud sumber.'
        : `SIMPROK menemukan ${count} pilihan yang sesuai dengan bukti yang tersedia. Pilih yang paling tepat.`;
  return why.length === 0 ? head : `${head} ${why.join(' ')}`;
};

const candidateLine = (candidate: RowResourceCandidate): RowCandidateLine => ({
  // Internal, and internal only. It keys the list; it is not part of `text`.
  key: candidate.resourceCatalogId,
  text:
    `${candidate.code ?? 'Tanpa kode'} — ${candidate.name} — ${candidate.baseUnit}` +
    (candidate.specificationUnproved && candidate.unprovedSpecificationFacts.length > 0
      ? ` · belum ditegaskan: ${candidate.unprovedSpecificationFacts.join(', ')}`
      : '') +
    // The EXISTENCE of a prior decision, and nothing about the person who made
    // it. The projection that guarantees this lives on the backend; the screen
    // simply has nothing more to print.
    (candidate.hasPriorHumanDecision ? ' · pernah dipilih manusia sebelumnya' : ''),
});

export const rowMachineNarrative = (
  row: BasicPriceImportRowSummary,
): RowMachineNarrative | null => {
  const proposal = row.machineProposal;
  const state = rowMachineState(row);
  if (!proposal || state === 'NOT_ASKED') return null;
  return {
    state,
    stateLabel: rowMachineStateLabel(state),
    unit: unitNarrative(proposal.unit),
    resource: resourceNarrative(proposal.resource),
    // A proven row has nothing left to choose between, so offering a list would
    // invite a decision nobody is being asked to make.
    candidates:
      state === 'PROVEN' ? [] : proposal.resource.candidates.map(candidateLine),
  };
};

/**
 * THE ROW'S OWN NOTES, IN LANGUAGE OR NOT AT ALL.
 *
 * `reasonCodes` is the intake and resolution vocabulary a row accumulated. It
 * was previously joined with semicolons and printed whole, so the first thing a
 * reviewer read under a row could be `PRICE_CELL_IS_TEXT_NOT_NUMBER;
 * RESOURCE_CODE_MISSING`. Those are real facts and they must not be dropped —
 * but they are not language.
 *
 * A first repair moved untranslated codes under Detail Teknis. That was still
 * wrong, and the correction is worth stating: Detail Teknis is a place for
 * DETAIL, not a place where programmer vocabulary becomes acceptable. Moving an
 * enum down the page does not turn it into something a site engineer can read.
 *
 * So the law is now positional in neither direction — a raw code simply never
 * reaches this surface. What has a sentence is said. What does not is COUNTED
 * and reported as a count, which is truthful in both directions at once: the
 * reviewer is not shown `SOMETHING_NEW_FROM_INTAKE`, and neither is the fact
 * of it silently dropped. The codes themselves remain exactly where they always
 * were — on the row, in the payload, available to logs, audit and any future
 * developer surface that earns its own law.
 */
export interface RowNoteLines {
  /** Sentences, ready to render. */
  human: string[];
  /** How many notes have no user-facing sentence yet. Never their codes. */
  untranslatedCount: number;
  /**
   * The single line Detail Teknis may show, or null when there is nothing to
   * disclose. Naming the count is the whole of what it says.
   */
  technicalNotice: string | null;
}

/**
 * The intake and rejection vocabulary a Basic Price ROW can carry, which is a
 * different set from the identity/unit facts in BLOCKING_FACT_LABELS. A code
 * shared by both — UNIT_REQUIRED — is NOT restated here: the lookup falls
 * through, so there is exactly one sentence for one code.
 */
const ROW_NOTE_LABELS: Record<string, string> = {
  // --- how the price CELL read ---
  PRICE_CELL_EMPTY: 'Sel harga kosong.',
  PRICE_CELL_IS_TEXT_NOT_NUMBER: 'Sel harga berisi teks, bukan angka.',
  PRICE_CELL_IS_ERROR: 'Sel harga berisi nilai kesalahan dari lembar kerja.',
  PRICE_CELL_IS_DATE: 'Sel harga berisi tanggal, bukan angka.',
  PRICE_CELL_IS_BOOLEAN: 'Sel harga berisi nilai benar/salah, bukan angka.',
  PRICE_CELL_IS_RICH_TEXT: 'Sel harga berisi teks berformat yang tidak terbaca sebagai angka.',
  PRICE_CELL_IS_HYPERLINK: 'Sel harga berisi tautan, bukan angka.',
  UNRECOGNIZED_CELL_SHAPE: 'Bentuk sel harga tidak dikenali SIMPROK.',
  UNRECOGNIZED_FORMULA_SHAPE: 'Bentuk rumus pada sel harga tidak dikenali SIMPROK.',
  UNRECOGNIZED_FORMULA_RESULT_SHAPE: 'Bentuk hasil rumus pada sel harga tidak dikenali SIMPROK.',
  FORMULA_NO_CACHED_RESULT: 'Rumus pada sel harga belum menyimpan hasil hitungnya.',
  FORMULA_RESULT_IS_TEXT_NOT_NUMBER: 'Hasil rumus pada sel harga berupa teks, bukan angka.',
  FORMULA_ERROR: 'Rumus pada sel harga menghasilkan kesalahan.',
  // --- how the price TEXT read ---
  PRICE_TEXT_EMPTY: 'Teks harga kosong.',
  PRICE_TEXT_NOT_NUMERIC: 'Teks harga tidak terbaca sebagai angka.',
  PRICE_TEXT_WHITESPACE_GROUPING_UNSUPPORTED:
    'Teks harga memakai spasi sebagai pemisah ribuan, yang belum didukung.',
  PRICE_TEXT_NUMERIC_LOCALE_AMBIGUOUS:
    'Titik dan koma pada teks harga dapat dibaca dua cara, dan SIMPROK tidak menebak.',
  PRICE_TEXT_MALFORMED_GROUPING: 'Pemisah ribuan pada teks harga tidak konsisten.',
  PRICE_TEXT_MALFORMED_MIXED_SEPARATORS:
    'Teks harga mencampur pemisah desimal dan ribuan dengan cara yang tidak sah.',
  PRICE_NORMALIZED_FROM_TEXT: 'Harga dibaca dari teks sel, bukan dari angka asli lembar kerja.',
  PRICE_TEXT_DECIMAL_SEPARATOR_DOT: 'Titik dibaca sebagai pemisah desimal.',
  PRICE_TEXT_DECIMAL_SEPARATOR_COMMA: 'Koma dibaca sebagai pemisah desimal.',
  PRICE_TEXT_GROUPING_SEPARATOR_DOT: 'Titik dibaca sebagai pemisah ribuan.',
  PRICE_TEXT_GROUPING_SEPARATOR_COMMA: 'Koma dibaca sebagai pemisah ribuan.',
  // --- what the source said about the row itself ---
  RESOURCE_CODE_MISSING: 'Dokumen sumber tidak mencantumkan kode pada baris ini.',
  ROW_KIND_AMBIGUOUS: 'Jenis baris ini tidak dapat dipastikan dari dokumen sumber.',
  SOURCE_CATEGORY_CONFLICT:
    'Kategori yang ditulis baris ini berbeda dengan kategori judul bagiannya.',
  SOURCE_CATEGORY_UNRECOGNIZED: 'Kategori yang ditulis sumber belum dikenali SIMPROK.',
  SECTION_DECLARED_BY_UPLOADER:
    'Kategori belum tercantum di berkas dan masih perlu dipastikan.',
  UNIT_TEXT_FROM_SIMPROK_UNIT_CANDIDATE:
    'Satuan diambil dari kolom yang ditunjuk saat impor, bukan dari kolom satuan bertajuk.',
};

/**
 * A row REJECTED by a human carries the reason as `REJECTED:<free text>`.
 *
 * That text is not another person's private record: a batch is user-owned, and
 * this is the note written on this very row, in this very room, by the person
 * reading it back. It stays — with its code turned into a word.
 */
const REJECTED_PREFIX = 'REJECTED:';

export const rowNoteLines = (row: BasicPriceImportRowSummary): RowNoteLines => {
  const human: string[] = [];
  const untranslated = new Set<string>();
  for (const code of row.reasonCodes) {
    if (code.startsWith(REJECTED_PREFIX)) {
      const reason = code.slice(REJECTED_PREFIX.length).trim();
      human.push(reason === '' ? 'Baris ini ditolak.' : `Ditolak: ${reason}`);
      continue;
    }
    // ROW vocabulary first, then the shared identity/unit table — one sentence
    // per code, and never two spellings of the same fact.
    const sentence = ROW_NOTE_LABELS[code] ?? knownFact(code);
    // The code goes into a SET, and the set is only ever counted. It is held
    // rather than pushed to a list so that no accidental `.join()` downstream
    // can ever put it on a screen.
    if (sentence === null || sentence === undefined) untranslated.add(code);
    else human.push(sentence);
  }
  const untranslatedCount = untranslated.size;
  return {
    human: [...new Set(human)],
    untranslatedCount,
    technicalNotice:
      untranslatedCount === 0
        ? null
        : `${untranslatedCount} informasi teknis tambahan belum memiliki penjelasan pengguna.`,
  };
};

/**
 * BP-VISUAL-TRUTH-07 §17/§20 — CALM OUTSIDE, RICH INSIDE, AND NOTHING DELETED.
 *
 * WHAT THE OWNER SAW. One unresolved row said its single problem four times
 * over: a "Belum dikenali" chip, then "Satuan belum dikenali", then "Item belum
 * dikenali. Pilih Item SIMPROK yang sesuai…", then "Sumber daya: SIMPROK belum
 * menemukan sumber daya yang dapat dibuktikan…" — every one of them true, and
 * together an unreadable wall on a workbook with hundreds of such rows.
 *
 * THE REPAIR IS NOT DELETION. §20 is explicit that truthful information is not
 * removed to make a screen sparse, and every sentence here is a distinct named
 * fact a reviewer may need. So the FIRST note stays on the card — it is the one
 * that names what to do — and the rest move behind "Mengapa?", which is exactly
 * where a reason belongs relative to an instruction.
 *
 * ORDER IS THE SERVER'S, NOT A RANKING INVENTED HERE. `reasonCodes` arrives in
 * the engines' own order and `rowNoteLines` preserves it; this takes the head
 * and the tail of that list and reorders nothing. When there is only one note
 * there is no disclosure at all, because a single sentence hidden behind a
 * toggle is worse than a single sentence.
 */
export interface RowNoteDisclosure {
  /** Always shown. Null only when the row has no notes at all. */
  primary: string | null;
  /** Shown on demand under "Mengapa?" — never dropped, never auto-expanded. */
  secondary: string[];
}

export const rowNoteDisclosure = (notes: Pick<RowNoteLines, 'human'>): RowNoteDisclosure => ({
  primary: notes.human[0] ?? null,
  secondary: notes.human.slice(1),
});

/** The one wording for the on-demand reason toggle, so it reads the same everywhere. */
export const WHY_DISCLOSURE_TITLE = 'Mengapa?';

/**
 * THE METADATA DOOR — what the import page may offer, and why not.
 *
 * WHAT WENT WRONG. A person could fill the metadata form, walk straight into
 * the review room without saving, resolve rows, and only discover at
 * `Simpan & Gunakan` that the batch had no region and no effective date. The
 * work was not lost, but the trust was: the product had let them spend effort
 * behind a door it knew was locked.
 *
 * THE FIX IS NOT "VALIDATE HARDER IN THE BROWSER". Which facts are required is
 * SOURCE LAW, and this file must not own a second copy of it — that is the
 * shadow-path defect the server's own action policy exists to prevent. So the
 * server sends `reviewGate`, and everything below is arithmetic on top of it:
 *
 *   requiredFacts        the server's list. Never edited here.
 *   reviewAllowed        the server's verdict about PERSISTED truth.
 *   isDirty              a browser-only fact the server cannot know.
 *
 * PERSISTENCE, NOT APPEARANCE, OPENS THE DOOR. `reviewAllowed` is computed from
 * the stored batch, so a form that merely LOOKS complete proves nothing. And
 * because an edit after a successful save makes the screen disagree with the
 * database again, `isDirty` re-locks the door until the next save succeeds —
 * otherwise a person would carry an unsaved region into the review room and be
 * refused at the very end, which is exactly the defect this repairs.
 */
export type MetadataFactPresence = Record<RequiredMetadataFact, boolean>;

/**
 * WHICH INPUT HOLDS WHICH FACT — presentation knowledge, not law.
 *
 * The server says a fact is required; this says where the person types it. The
 * distinction matters: adding a required fact is a server decision, and this
 * map would simply not know where to look, which fails visibly rather than
 * silently letting the browser invent a rule.
 */
export const draftStatesFact = (
  draft: {
    effectiveDate?: string;
    regionId?: string;
    sourceOrigin?: string;
    sourceType?: string;
  },
  fact: RequiredMetadataFact,
): boolean => {
  switch (fact) {
    case 'EFFECTIVE_DATE':
      return Boolean(draft.effectiveDate);
    case 'REGION':
      return Boolean(draft.regionId);
    case 'SOURCE_ORIGIN':
      return Boolean(draft.sourceOrigin);
    case 'SOURCE_TYPE':
      return Boolean(draft.sourceType);
    default:
      return false;
  }
};

/** One human sentence per fact. Never a code, never a field name. */
const REQUIRED_FACT_LABEL: Record<RequiredMetadataFact, string> = {
  EFFECTIVE_DATE: 'Tanggal berlaku harga',
  REGION: 'Wilayah harga',
  SOURCE_ORIGIN: 'Asal harga (siapa yang mengeluarkan)',
  SOURCE_TYPE: 'Jenis sumber harga',
};


/**
 * A COMPLETE FORM THAT DISAGREES WITH ITSELF IS NOT AN INCOMPLETE FORM.
 *
 * THE DEFECT THIS BLOCK EXISTS FOR. The review gate asks the WRITER's own
 * coherence question, so it can refuse a batch whose four required facts are
 * all present but contradict one another — a date claiming to be derived from a
 * period that derivation does not actually produce, a derivation rule with no
 * provenance to explain it. The browser's mirror knew only two reason codes, so
 * every one of those refusals fell through to
 * `Metadata belum lengkap menurut catatan SIMPROK.`
 *
 * That sentence is false, and falsely actionable: the person is told to fill
 * something in, finds every field already filled, and has nothing left to try —
 * Review stays shut, and Save stays disabled because nothing is dirty.
 *
 * PRESENTATION ONLY. Not one line here decides anything. The server has already
 * ruled; this turns its verdict into a sentence a site engineer can act on, and
 * never re-derives, softens or second-guesses it.
 *
 * NO RAW CODE EVER REACHES A PERSON. `DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE`
 * is a fact about SIMPROK's bookkeeping; what the reader needs is which of THEIR
 * facts to look at again.
 */
interface CoherenceCopy {
  /** What is wrong, in the reader's own terms. */
  sentence: string;
  /**
   * WHICH VISIBLE CONTROL CAN REPAIR IT.
   *
   * `SOURCE` — the origin/type selects on this very form.
   * `TEMPORAL` — the date field is editable, but the provenance columns behind
   * it are SIMPROK's own bookkeeping and this product has no editor for them.
   * So the hint points at the fact a person actually holds, and then stops
   * honestly rather than inventing a provenance console.
   */
  repair: 'SOURCE' | 'TEMPORAL';
}

const SOURCE_REPAIR_HINT =
  'Perbaiki pilihan Asal Sumber atau Jenis Sumber Harga di atas, lalu simpan lagi.';

/**
 * THE BOUNDED FALLBACK. A person can correct the date they entered; they cannot
 * correct how SIMPROK recorded where that date came from, and this task does not
 * invent a control for it. So the sentence offers the step they CAN take and
 * names the way out when it does not help — rather than pretending the door is
 * open or leaving them at a dead end.
 */
const TEMPORAL_REPAIR_HINT =
  'Periksa kembali tanggal/periode harga di atas, lalu simpan lagi. Jika tetap tidak bisa disimpan, minta kurator SIMPROK meninjau sumber ini.';

/**
 * `satisfies` RATHER THAN AN ANNOTATED LITERAL, deliberately. The previous
 * guard of this kind was an array typed `PrivateUseBlockReason[]`, and
 * TypeScript does not check an array literal against its element union — so a
 * new code joined the union, the list silently stopped covering it, and the
 * test that existed to prevent exactly that went on passing. A `Record` keyed
 * on the union fails the BUILD when a member is missing.
 */
const COHERENCE_COPY = {
  SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE: {
    sentence: 'Asal harga belum tercatat, jadi SIMPROK belum bisa memastikan sumbernya.',
    repair: 'SOURCE',
  },
  SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE: {
    sentence: 'Jenis sumber harga belum tercatat, jadi SIMPROK belum bisa memastikan sumbernya.',
    repair: 'SOURCE',
  },
  DERIVATION_RULE_REQUIRES_PROVENANCE: {
    sentence:
      'Ada keterangan cara tanggal harga diperoleh, tetapi asal keterangan itu belum tercatat.',
    repair: 'TEMPORAL',
  },
  SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE: {
    sentence:
      'SIMPROK memerlukan periode sumber untuk menjelaskan tanggal harga ini.',
    repair: 'TEMPORAL',
  },
  SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE: {
    sentence:
      'Periode sumber belum cukup jelas untuk menjelaskan tanggal harga ini.',
    repair: 'TEMPORAL',
  },
  DERIVATION_RULE_REQUIRED_FOR_DERIVED_DATE: {
    sentence:
      'SIMPROK belum punya dasar yang cukup untuk menjelaskan bagaimana tanggal harga ini diperoleh dari periode sumber.',
    repair: 'TEMPORAL',
  },
  DERIVATION_RULE_NOT_PROVABLE: {
    sentence:
      'Tanggal harga belum dapat dibuktikan dari periode sumber yang tercatat.',
    repair: 'TEMPORAL',
  },
  DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE: {
    sentence:
      'Tanggal harga yang tersimpan tidak sesuai dengan periode sumber yang tercatat.',
    repair: 'TEMPORAL',
  },
  DERIVATION_RULE_FORBIDDEN_FOR_SOURCE_STATED: {
    sentence:
      'Tanggal ini sudah dinyatakan langsung oleh sumber, jadi tidak perlu diturunkan lagi dari periode lain.',
    repair: 'TEMPORAL',
  },
} satisfies Record<MetadataCoherenceReason, CoherenceCopy>;

/**
 * WHEN THE SERVER IS AHEAD OF THIS BUILD.
 *
 * A tab open since before a deploy can receive a reason code it has never heard
 * of. It may not guess, may not print the code, and may not quietly let a
 * person through — so it says the one true thing it knows and names the way
 * out. Review stays shut, because the server said so.
 */
export const REVIEW_GATE_UNKNOWN_REASON_MESSAGE =
  'SIMPROK menemukan ketidaksesuaian metadata yang belum bisa dijelaskan oleh versi aplikasi ini. Muat ulang halaman, atau minta kurator SIMPROK meninjau sumber ini.';

/** The lead-in that keeps STATE B from ever being read as STATE A. */
const COHERENCE_LEAD_IN =
  'Metadata sudah lengkap, tetapi isinya belum cocok satu sama lain.';

const isKnownCoherenceReason = (
  code: string | null | undefined,
): code is MetadataCoherenceReason =>
  code !== null && code !== undefined && code in COHERENCE_COPY;

/**
 * One truthful sentence for a coherence refusal, or the fail-closed sentence
 * when this build does not recognise the code.
 *
 * IT ALWAYS SAYS "LENGKAP" FIRST. The single most misleading thing the old
 * message did was call complete data incomplete, so every sentence here opens
 * by correcting that, then names the mismatch, then names the step to take.
 */
export const reviewGateCoherenceMessage = (
  code: string | null | undefined,
): string => {
  if (!isKnownCoherenceReason(code)) return REVIEW_GATE_UNKNOWN_REASON_MESSAGE;
  const copy: CoherenceCopy = COHERENCE_COPY[code];
  const hint =
    copy.repair === 'SOURCE' ? SOURCE_REPAIR_HINT : TEMPORAL_REPAIR_HINT;
  return `${COHERENCE_LEAD_IN} ${copy.sentence} ${hint}`;
};

export interface MetadataGateView {
  /** Enabled only when saving would actually change something AND could succeed. */
  saveEnabled: boolean;
  /** Enabled only when the SERVER says the stored batch is complete. */
  reviewEnabled: boolean;
  /** Human sentences for the facts the DRAFT still does not state. */
  missingInDraft: string[];
  /** One calm sentence describing the current state. */
  message: string;
}

export const metadataGateView = (
  batch: {
    actions?: { reviewGate?: BatchReviewGate };
    temporal?: BatchTemporalQuestions | null;
  } | null,
  draft: {
    effectiveDate?: string;
    regionId?: string;
    sourceOrigin?: string;
    sourceType?: string;
  },
  isDirty: boolean,
  isBusy: boolean,
): MetadataGateView => {
  const gate = batch?.actions?.reviewGate;
  const temporal = batch?.temporal;
  /**
   * NAME THE CONTROL THE PAGE ACTUALLY RENDERS.
   *
   * The effective-date input is labelled by the SOURCE-AWARE question the
   * server chose, so a fixed 'Tanggal berlaku harga' here would tell a person
   * to fill in a field that appears nowhere on their screen — a survey batch
   * shows 'Tanggal / periode harga' and a regulation shows 'Mulai berlaku
   * menurut sumber'. The completion instruction and the field must be the same
   * words, or the instruction is a false statement about the form.
   */
  const requiredFactLabels: Record<string, string | undefined> = {
    ...REQUIRED_FACT_LABEL,
    EFFECTIVE_DATE: effectiveDateCopy(temporal?.effectiveDateQuestion).label,
  };
  // FAIL CLOSED. A server that did not send the gate has not said "yes", and a
  // missing verdict must never read as permission.
  if (!gate) {
    return {
      saveEnabled: false,
      reviewEnabled: false,
      missingInDraft: [],
      message: 'Menunggu SIMPROK memeriksa kelengkapan metadata.',
    };
  }

  // A FACT THIS BUILD DOES NOT KNOW IS A FACT IT CANNOT COLLECT.
  //
  // `requiredFacts` is the SERVER's list, and a server that adds a fifth
  // required fact is ahead of a browser tab that has been open since before the
  // deploy. The old code mapped every code straight through the label table and
  // rendered the misses, so an unknown code printed literally as
  // "Lengkapi dulu: undefined" — the worst of both worlds: it told the person
  // nothing, and it did not stop them either.
  //
  // Both halves are honest now. An unknown fact is counted separately and FAILS
  // CLOSED — this build has no input that could ever satisfy it, so the draft
  // can never be complete while one exists — and the person is told plainly
  // that something cannot be displayed, never shown a JavaScript value.
  const knownMissing: string[] = [];
  let unknownRequiredFacts = 0;
  for (const fact of gate.requiredFacts) {
    const label = requiredFactLabels[fact];
    if (label === undefined) {
      unknownRequiredFacts += 1;
      continue;
    }
    if (!draftStatesFact(draft, fact)) knownMissing.push(label);
  }
  const missingInDraft = knownMissing;
  const draftComplete = knownMissing.length === 0 && unknownRequiredFacts === 0;

  // STATE A — the draft cannot succeed yet, so saving is not offered.
  // STATE B — complete but unsaved: saving is the ONLY thing offered.
  // STATE C — saved and unchanged: the room opens.
  // STATE D — edited after saving: the room closes until the next save.
  const saveEnabled = !isBusy && draftComplete && isDirty;
  const reviewEnabled = !isBusy && gate.reviewAllowed && !isDirty;

  /**
   * THREE REFUSALS THAT ARE NOT THE SAME REFUSAL.
   *
   * A missing fact, a contradicting fact and a closed batch are three different
   * things, and this room used to end all of them at one sentence:
   * `Metadata belum lengkap menurut catatan SIMPROK.` For a batch that was
   * COMPLETE but incoherent that sentence was simply false — and falsely
   * actionable too, because the person went looking for an empty field, found
   * none, and had nothing left to try.
   *
   * ORDER IS DELIBERATE. The named coherence code is read FIRST, because it is
   * the most specific thing the server said. `metadataCoherent` is read next,
   * so a server reporting incoherence with a code this build has never seen
   * still produces a truthful sentence rather than the wrong one. Only then
   * does `REQUIRED_METADATA_INCOMPLETE` keep the "belum lengkap" wording, which
   * is the one case it is true for. Anything left over fails closed.
   */
  const refusalMessage = (): string => {
    if (gate.reasonCode === 'BATCH_NOT_MUTABLE') {
      return 'Batch ini sudah ditutup, jadi metadata tidak dapat diubah lagi.';
    }
    if (isKnownCoherenceReason(gate.reasonCode)) {
      return reviewGateCoherenceMessage(gate.reasonCode);
    }
    if (gate.metadataCoherent === false) {
      return REVIEW_GATE_UNKNOWN_REASON_MESSAGE;
    }
    if (gate.reasonCode === 'REQUIRED_METADATA_INCOMPLETE') {
      return 'Metadata belum lengkap menurut catatan SIMPROK.';
    }
    // The server withheld review without naming a reason this build can read.
    // It is still the server's verdict, so the door stays shut and the sentence
    // claims only what is actually known.
    return REVIEW_GATE_UNKNOWN_REASON_MESSAGE;
  };

  const message =
    unknownRequiredFacts > 0
      ? UNKNOWN_REQUIRED_FACT_MESSAGE
      : !draftComplete
        ? `Lengkapi dulu: ${missingInDraft.join(', ')}.`
        : isDirty
          ? 'Metadata belum tersimpan. Simpan dulu sebelum meninjau baris.'
          : gate.reviewAllowed
            ? 'Metadata tersimpan. Peninjauan baris siap dibuka.'
            : refusalMessage();

  return { saveEnabled, reviewEnabled, missingInDraft, message };
};

/**
 * What a person is told when the server requires something this build cannot
 * render. No code, no field name, no `undefined` — and an action they can take.
 */
export const UNKNOWN_REQUIRED_FACT_MESSAGE =
  'Ada metadata wajib yang belum dapat ditampilkan dengan benar. Muat ulang halaman atau hubungi admin SIMPROK.';

/**
 * The outcome of ONE `Simpan & Gunakan` press, in the user's own words.
 *
 * COUNTED FROM THE SERVER'S OWN ANSWER, never predicted from the button label,
 * and it keeps the two halves of the command distinguishable: rows the machine
 * bound on this press, and prices that now exist. Pressing twice must not read
 * as two successes, so prices that were already kept are named as such.
 */
export const smartSaveOutcomeMessage = (outcome: {
  accepted: { acceptedCount: number; remainingEligible: number };
  kept: { createdCount: number; alreadyPrivateCount: number };
}): string => {
  const parts: string[] = [];
  if (outcome.accepted.acceptedCount > 0) {
    parts.push(
      `${outcome.accepted.acceptedCount} baris yang dikenali otomatis diterima.`,
    );
  }
  if (outcome.kept.createdCount > 0) {
    parts.push(
      `${outcome.kept.createdCount} harga tersimpan dan siap dipakai di ruang kerja ini.`,
    );
  }
  if (outcome.kept.createdCount === 0 && outcome.kept.alreadyPrivateCount > 0) {
    parts.push(
      `${outcome.kept.alreadyPrivateCount} harga memang sudah tersimpan sebelumnya, jadi tidak ada yang digandakan.`,
    );
  }
  if (outcome.accepted.remainingEligible > 0) {
    // An honest instruction, not an error: the request stopped at its own work
    // ceiling and pressing again continues from what is already saved.
    parts.push(
      `Masih ada ${outcome.accepted.remainingEligible} baris siap diterima — tekan sekali lagi untuk melanjutkan.`,
    );
  }
  if (parts.length === 0) {
    return 'Belum ada baris yang bisa disimpan. Konfirmasi pilihan pada minimal satu baris di bawah, lalu coba lagi.';
  }
  return parts.join(' ');
};

/**
 * WHY A `Simpan & Gunakan` PRESS DID NOT FINISH — and what is now in the
 * database because of it.
 *
 * DELIBERATELY NOT `lifecycleActionFailureMessage`. That function's sentences
 * end `Tidak ada yang tersimpan.` and `Tidak ada yang tersimpan sebagian.`,
 * which are true of the actions it was written for: a metadata PATCH is one
 * transaction, and a proposal either closes the batch or does not. Smart-save
 * is neither. It is ONE product command over TWO independently durable steps —
 * bindings commit in bounded chunks, prices materialize in a transaction of
 * their own — so a failure in the second step happens after the first step's
 * commits are already permanent.
 *
 * Pointing this page at the private-use vocabulary therefore printed a fluent
 * falsehood at the worst possible moment: thirteen rows bound, and the reviewer
 * told nothing was saved. They would either redo work SIMPROK had already
 * decided, or walk away from a batch that was one press from done.
 *
 * SO CERTAINTY IS NOW SOMETHING THE SERVER HAS TO SEND. Every smart-save
 * failure carries `smartSave.persistence`, which the backend derives by
 * counting the same two facts before the command and again after it fails —
 * see `basic-price-smart-save-failure.law.ts`. This function may say "nothing
 * was saved" ONLY for `NONE`, must state the surviving progress for `PARTIAL`,
 * and must admit it does not know for `UNKNOWN`.
 *
 * NO INTERNALS LEAK. Transactions, chunks, row versions, Prisma and status
 * codes stay on the server. What reaches a person is what happened to their
 * work and what pressing again will do.
 */
export type SmartSavePersistence = 'NONE' | 'PARTIAL' | 'UNKNOWN';

export interface SmartSaveFailureEnvelope {
  persistence: SmartSavePersistence;
  boundRowsDelta?: number;
  keptPricesDelta?: number;
}

/**
 * The envelope, or null when the response did not carry one.
 *
 * Shape-checked rather than trusted: a body that merely happens to have a
 * `smartSave` key must not be able to claim `NONE` — the one verdict that
 * licenses the sentence this whole function exists to stop.
 */
const smartSaveEnvelopeOf = (rawBody: string): SmartSaveFailureEnvelope | null => {
  try {
    const parsed = JSON.parse(rawBody) as { smartSave?: unknown };
    const envelope = parsed.smartSave as SmartSaveFailureEnvelope | undefined;
    if (!envelope || typeof envelope !== 'object') return null;
    if (
      envelope.persistence !== 'NONE' &&
      envelope.persistence !== 'PARTIAL' &&
      envelope.persistence !== 'UNKNOWN'
    )
      return null;
    return envelope;
  } catch {
    return null; // Not JSON. Silence is not evidence of an empty database.
  }
};

/**
 * WHAT IS KNOWN WITHOUT AN ENVELOPE.
 *
 * A 400, a 401 and a 403 are decided by the validation pipe or a guard BEFORE
 * the smart-save handler runs, so for those the empty database is a fact about
 * the request rather than a hope. Everything else — a 404 the handler itself
 * can raise, a 500, a dropped connection reported as no status at all — could
 * have happened on either side of a commit, and the honest answer there is that
 * SIMPROK does not know.
 */
const persistenceWithoutEnvelope = (httpStatus: number): SmartSavePersistence =>
  httpStatus === 400 || httpStatus === 401 || httpStatus === 403
    ? 'NONE'
    : 'UNKNOWN';

/** WHY it stopped — never mixed with a claim about what was stored. */
const smartSaveCauseSentence = (httpStatus: number, rawBody: string): string => {
  const named = privateUseBlockSentence(namedCodeOf(rawBody) as PrivateUseBlockReason);
  if (named) return named;
  if (httpStatus === 401) return 'Sesi Anda sudah berakhir. Masuk kembali lalu coba lagi.';
  if (httpStatus === 403)
    return 'Akun Anda belum memiliki kewenangan melakukan tindakan ini di workspace ini.';
  if (httpStatus === 404) return 'Batch ini tidak ditemukan lagi. Muat ulang halaman.';
  if (httpStatus === 409)
    return 'Keadaan batch sudah berubah sejak halaman ini dimuat. Muat ulang lalu coba lagi.';
  return 'Proses penyimpanan belum selesai.';
};

/**
 * WHAT IS IN THE DATABASE NOW — the half of the message that may not be guessed.
 *
 * `PARTIAL` names only the counts that are genuinely non-zero, because "0 harga
 * tersimpan" is noise a reviewer has to decode rather than a fact that helps
 * them. What always follows is the part that removes the fear: pressing again
 * continues from what is stored and duplicates nothing.
 */
const smartSaveProgressSentence = (envelope: SmartSaveFailureEnvelope): string => {
  if (envelope.persistence === 'NONE') return 'Tidak ada yang tersimpan.';
  if (envelope.persistence === 'UNKNOWN')
    return 'Sebagian keputusan mungkin sudah tersimpan. SIMPROK akan membaca keadaan terakhir dan melanjutkan dengan aman saat Anda mencoba lagi, tanpa membuat duplikasi.';
  const stored: string[] = [];
  if ((envelope.boundRowsDelta ?? 0) > 0)
    stored.push(`${envelope.boundRowsDelta} keputusan baris sudah tersimpan`);
  if ((envelope.keptPricesDelta ?? 0) > 0)
    stored.push(`${envelope.keptPricesDelta} harga sudah tersimpan`);
  const kept =
    stored.length > 0
      ? `${stored.join(' dan ')}.`
      : 'Sebagian pekerjaan sudah tersimpan.';
  return `${kept} Silakan coba lagi; SIMPROK melanjutkan dari yang sudah tersimpan dan tidak akan membuat duplikasi.`;
};

export const smartSaveFailureMessage = (httpStatus: number, rawBody: string): string => {
  const envelope =
    smartSaveEnvelopeOf(rawBody) ??
    ({ persistence: persistenceWithoutEnvelope(httpStatus) } as SmartSaveFailureEnvelope);
  return `${smartSaveCauseSentence(httpStatus, rawBody)} ${smartSaveProgressSentence(envelope)}`;
};

/**
 * WHAT ONE PRESS OF `Simpan & Gunakan` WILL ACTUALLY DO.
 *
 * THE OLD NUMBER WAS TRUE AND USELESS. It counted `readyForSubmissionRows`,
 * which on a freshly reviewed batch is zero — so the Owner met
 * `Simpan & Gunakan (0 siap)` sitting beside thirteen rows SIMPROK had already
 * proven, and the only way to move the number was thirteen `Selesaikan`
 * clicks. The rows the server can bind on this press are part of what the press
 * saves, so they belong in the count.
 *
 * ROWS A HUMAN HAS TOUCHED ARE NOT COUNTED, and are not sent. An unsaved manual
 * correction is a decision in progress; the machine's earlier proposal must not
 * silently win it.
 *
 * OFFERED-NESS IS STILL THE SERVER'S. The only reason this may overrule
 * `privateUse.offered` is the single code that says "nothing is ready yet" —
 * which is precisely the condition the accept half of the press removes. Every
 * other refusal (missing metadata, a closed batch) still closes the door,
 * because accepting rows would not fix any of them.
 */
export interface OneActionAcceptanceView {
  /** Machine-proven rows this press would bind, excluding human-touched ones. */
  machineProvenCount: number;
  /** Rows one press would actually store: still-unstored finished rows + the above. */
  rowCount: number;
  offered: boolean;
  /**
   * Finished rows that are ALREADY stored, or null when the server did not
   * measure it. Rendered as reassurance when there is nothing left to press.
   */
  alreadyStoredCount: number | null;
}

export const oneActionAcceptanceView = (
  batch: {
    readyForSubmissionRows: number;
    alreadyPrivateRows?: number | null;
    rows: Array<{
      id: string;
      machineProposal: RowMachineProposal | null;
      proposedCanonicalPrice: string | null;
      collisionType: BasicPriceImportRowSummary['collisionType'];
    }>;
    actions: {
      privateUse: {
        offered: boolean;
        reasonCode: PrivateUseBlockReason | null;
        actionableRows?: number | null;
      };
    };
  },
  touchedRowIds: ReadonlySet<string>,
): OneActionAcceptanceView => {
  /**
   * A PROVEN IDENTITY IS NOT YET A PRICE.
   *
   * `identityPairProven` is the two AUTHORITIES' verdict — this name is that
   * resource, this spelling is that unit — and it says nothing about the row
   * having a readable price or being the only row claiming that identity in
   * this batch. Binding such a row succeeds and then leaves it at NEEDS_REVIEW,
   * so the keep half never stores it: the press would promise a price and
   * deliver none.
   *
   * BOTH EXTRA FACTS ARE THE SERVER'S OWN, already on the row projection. This
   * is not the browser re-deriving a precondition — it is counting rows by
   * facts SIMPROK published, exactly as the identity filter beside it does.
   */
  const machineProvenCount = batch.rows.filter(
    (row) =>
      row.machineProposal?.identityPairProven === true &&
      row.proposedCanonicalPrice !== null &&
      row.collisionType === 'NONE' &&
      !touchedRowIds.has(row.id),
  ).length;

  /**
   * THE COUNT IS WHAT ONE PRESS WOULD ACHIEVE — and a row already stored
   * achieves nothing.
   *
   * IT USED TO ADD `readyForSubmissionRows`, and that is the whole defect. A
   * kept row never leaves READY_FOR_SUBMISSION, so after a successful save the
   * first term stayed 13 while the second collapsed to 0 — the server stops
   * asking the identity authorities about rows no longer awaiting a decision.
   * The label therefore printed the same 13 it had printed before the work
   * happened, beside its own status line announcing those thirteen prices
   * already existed.
   *
   * THE FIX IS A SERVER FACT, NOT BROWSER ARITHMETIC. `actionableRows` is
   * `readyForSubmissionRows − alreadyPrivateRows`, computed by the same policy
   * that decides whether the action is offered at all, so the number on the
   * button and the verdict behind it can never disagree. Null means that path
   * did not measure, and then the old sum is the honest best answer — an
   * unmeasured question must not silently become a zero.
   */
  const actionableReady =
    batch.actions.privateUse.actionableRows ?? batch.readyForSubmissionRows;
  const rowCount = actionableReady + machineProvenCount;

  /**
   * OFFERED-NESS IS STILL THE SERVER'S, with the one narrow overrule this room
   * has always had: the server counts only rows a human already finished, so a
   * batch of machine-proven-but-unbound rows legitimately reads as "nothing
   * ready yet" until this very press binds them.
   *
   * `ALL_READY_ROWS_ALREADY_PRIVATE` joins that overrule for the same reason
   * and no other: everything FINISHED may indeed be stored while rows this
   * press could still bind are sitting right there. When there is nothing left
   * to bind either, the door stays shut and the room says so in words.
   */
  const offered =
    batch.actions.privateUse.offered ||
    ((batch.actions.privateUse.reasonCode === 'NO_ROWS_READY_FOR_PRIVATE_USE' ||
      batch.actions.privateUse.reasonCode ===
        'ALL_READY_ROWS_ALREADY_PRIVATE') &&
      machineProvenCount > 0);

  return {
    machineProvenCount,
    rowCount,
    offered,
    alreadyStoredCount: batch.alreadyPrivateRows ?? null,
  };
};

/**
 * WHAT THE ROOM SAYS WHEN THERE IS NOTHING LEFT TO PRESS.
 *
 * A person who has just stored thirteen prices should be told that, not shown a
 * greyed-out button and left to work out why. Returns null whenever the action
 * IS still worth offering, so the caller renders the button or this sentence,
 * never both and never neither.
 */
export const alreadyStoredNotice = (
  view: OneActionAcceptanceView,
): string | null => {
  if (view.offered || view.rowCount > 0) return null;
  if (view.alreadyStoredCount === null || view.alreadyStoredCount <= 0) {
    return null;
  }
  return `${view.alreadyStoredCount} harga sudah tersimpan dan bisa dipakai di ruang kerja ini.`;
};

/* ── SOURCE-AWARE TEMPORAL COPY ──────────────────────────────────────────── */

/**
 * THE SAME REQUIRED DAY, ASKED IN THE WORDS THAT ARE TRUE FOR THIS SOURCE.
 *
 * `Tanggal Berlaku` was one label for every price that has ever existed, and
 * for most of the Owner's data it is a false claim: a market survey does not
 * BECOME effective on a day, it was OBSERVED on one. Nobody decreed anything.
 *
 * WHAT DID NOT CHANGE. The persisted column, its meaning, and the fact that it
 * is required. A `BasicPrice` genuinely cannot exist without a calendar day to
 * apply from — AHSP and the Cost Kernel resolve candidates by it — so this is a
 * truer question, never a smaller one.
 *
 * THE SERVER DECIDES WHICH, THE BROWSER OWNS THE WORDS. `batch.temporal
 * .effectiveDateQuestion` is a code from `basic-price-temporal-question.law.ts`,
 * derived from the source TYPE (what kind of document this is) and never from
 * the source ORIGIN (who produced it) — a government body running a price
 * survey still states an observation, not a decree.
 */
export type EffectiveDateQuestion =
  | 'OBSERVED_PRICE_DATE'
  | 'SOURCE_STATED_START'
  | 'PRICE_DATE_UNSPECIFIED';

export type ReverificationApplicability =
  | 'RECOMMENDED'
  | 'FOLLOWS_SOURCE_UPDATES';

export interface BatchTemporalQuestions {
  effectiveDateQuestion: EffectiveDateQuestion;
  reverification: ReverificationApplicability;
}

interface TemporalCopy {
  label: string;
  help: string;
}

const EFFECTIVE_DATE_COPY: Record<EffectiveDateQuestion, TemporalCopy> = {
  OBSERVED_PRICE_DATE: {
    label: 'Tanggal / periode harga',
    help: 'Kapan harga ini berlaku menurut sumbernya — misalnya tanggal survei, tanggal pengamatan harga, atau tanggal penawaran. Isi tanggal yang paling mewakili kapan harga ini benar di lapangan.',
  },
  SOURCE_STATED_START: {
    label: 'Mulai berlaku menurut sumber',
    help: 'Tanggal yang disebut sendiri oleh dokumen sumber sebagai awal berlakunya harga. Boleh tanggal yang sudah lewat maupun tanggal di masa depan — SIMPROK menyimpan apa yang tertulis, bukan menebak.',
  },
  PRICE_DATE_UNSPECIFIED: {
    label: 'Tanggal harga',
    help: 'Tanggal yang mewakili kapan harga ini berlaku. Setelah Jenis Sumber Harga dipilih, SIMPROK akan menanyakannya dengan istilah yang lebih tepat untuk sumber tersebut.',
  },
};

/**
 * FAILS CLOSED ON A CODE THIS BUILD HAS NEVER HEARD OF, exactly as the required
 * metadata labels do. A newer server teaching an older tab a sharper question
 * must not produce a blank label; the neutral wording is always true.
 */
export const effectiveDateCopy = (
  question: EffectiveDateQuestion | null | undefined,
): TemporalCopy =>
  (question && EFFECTIVE_DATE_COPY[question]) ??
  EFFECTIVE_DATE_COPY.PRICE_DATE_UNSPECIFIED;

/**
 * BP-VISUAL-TRUTH-07 §20/§21 — the way to ASK for the date explanation, rather
 * than being handed it permanently.
 *
 * Deliberately the same words the reverification field already uses for its own
 * disclosure (`REVERIFICATION_HELP_TRIGGER`) — two date fields sitting in one
 * form should offer their explanations under one phrasing, not two. It is a
 * separate constant rather than an import of that one because that name is
 * about reverification, and a shared literal under a misleading name is how the
 * next person changes one and silently changes the other.
 */
export const TEMPORAL_HELP_TRIGGER = 'Apa maksud tanggal ini?';

/**
 * WHEN THE SOFT DATE IS WORTH ASKING FOR, AND WHAT TO SAY WHEN IT IS NOT.
 *
 * A live system-to-system feed's freshness is a fact about actual
 * synchronisation. Asking a person to PREDICT when a machine-updated price goes
 * stale manufactures precision nobody has, so the field is not offered — and
 * the reason is said out loud rather than left as a missing control.
 */
export const REVERIFICATION_NOT_NEEDED_NOTE =
  'Harga dari sumber ini diperbarui langsung oleh sistem, jadi SIMPROK mengikuti waktu pembaruan yang sebenarnya. Tanggal verifikasi ulang tidak perlu diisi.';

export const reverificationIsOffered = (
  applicability: ReverificationApplicability | null | undefined,
): boolean => applicability !== 'FOLLOWS_SOURCE_UPDATES';

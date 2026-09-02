import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma, PriceSourceOrigin, PriceSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BasicPriceImportKnowledgeObject,
  BasicPriceIntakeSelection,
  BasicPriceUniversalIntakeAdapter,
} from './basic-price-universal-intake.adapter';
import { INTAKE_ERRORS, IntakeError } from '../universal-intake/intake-errors';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { UNIT_RESOLUTION_STATUS } from '../unit-kernel/unit-kernel.contracts';
import {
  MAX_ENVELOPE_BYTES,
  SourceEnvelope,
  sealSourceEnvelope,
  sourceObservationIdentityOf,
} from '../universal-intake/source-envelope';
import { ReaderRegistry } from '../universal-intake/readers/reader-registry';
import { BasicPriceSourceArchiveService } from './basic-price-source-archive.service';
import { PreviewBasicPriceImportDto } from './dto/preview-basic-price-import.dto';
import { UpdateBasicPriceImportBatchDto } from './dto/update-basic-price-import-batch.dto';
import { PriceSubmissionReviewService } from '../reality-intake/price-submission-review.service';
import { assertBatchOwnedByCaller } from './basic-price-import-ownership.util';
import { toDecimalString2 } from '../common/money';
import { batchTemporalQuestions } from './basic-price-temporal-question.law';
import {
  assertTemporalProvenanceCoherent,
  isSameUtcDay,
} from './basic-price-private-asset.service';
import {
  evaluateBatchLifecycleActions,
  proposalBlockReason,
} from './basic-price-batch-actions.policy';
import {
  BasicPriceRowMachineProposal,
  BasicPriceRowResolutionProposalService,
} from './basic-price-row-resolution-proposal.service';
import {
  classifyReimport,
  INTERPRETATION_SIBLING_ORDER_BY,
  selectInterpretationSibling,
  type InterpretationIdentity,
} from './basic-price-reimport.law';

export const MAX_UPLOAD_BYTES = MAX_ENVELOPE_BYTES;

/**
 * How many import rows are written per INSERT.
 *
 * Bounded by PostgreSQL's 65535-parameter ceiling per statement, not by taste:
 * this table writes about thirty columns per row, so 500 rows is roughly
 * 15 000 parameters — comfortably inside the limit at every source size the
 * readers admit, while keeping the whole 20 000-row ceiling to forty round
 * trips rather than twenty thousand.
 */
const IMPORT_ROW_INSERT_CHUNK = 500;

type UploadedSourceFile = {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype?: string;
};

// Every mutable batch field is a fingerprint input (schema contract §5):
// same workbook + different region/date/source/coverage MUST produce a
// different fingerprint, never silently reuse an existing batch.
const FINGERPRINT_METADATA_KEYS = [
  'regionId',
  'effectiveDate',
  'sourceType',
  'sourceOrigin',
  'sourceOrganizationName',
  'sourceVendorName',
  // RM-03D1: temporal provenance is a mutable batch fact, so it belongs in the
  // fingerprint for the same reason the date does — the same workbook described
  // with a different provenance claim is a different batch, never a silent reuse
  // of one that claimed something else.
  'sourcePeriodLabel',
  'sourcePeriodGranularity',
  'effectiveDateProvenance',
  'effectiveDateDerivationRule',
  'priceCoverageDeclared',
  'transportIncluded',
  'loadingIncluded',
  'unloadingIncluded',
  'deliveredToProject',
] as const;

type FingerprintMetadataKey = (typeof FINGERPRINT_METADATA_KEYS)[number];

/**
 * Every shape an identity-bearing metadata value actually arrives in. `Date` is
 * here for exactly one reason: `effectiveDate` is an ISO string on a preview
 * DTO and a `Date` on the stored row, and both must hash identically.
 *
 * Stated as a closed union rather than `unknown` so a value with no meaningful
 * string form can never be silently interpolated into an identity.
 */
type FingerprintMetadataValue = string | number | boolean | Date | null;

/**
 * The identity-bearing metadata, from EITHER side of the batch's life: a
 * preview DTO or the stored row.
 */
type FingerprintMetadata = Partial<
  Record<FingerprintMetadataKey, FingerprintMetadataValue | undefined>
>;

/**
 * THE UTC DAY A DATE FACT NAMES — the ONE spelling of `effectiveDate` inside a
 * fingerprint, whichever shape it arrived in.
 *
 * WHY THIS IS NOT COSMETIC. The fingerprint used to be computed only from the
 * preview DTO, where the date is a string, and was interpolated raw. Once the
 * SAME fingerprint must also be recomputable from the STORED row — which is
 * what makes identity describe final facts rather than preview-time ones — the
 * two shapes have to agree by construction. `String(new Date(...))` would
 * produce "Fri Aug 28 2026 ..." against the DTO's "2026-08-28" and mint a
 * different batch for a date nobody changed.
 *
 * A calendar day is also the honest granularity: an effective date is a day, so
 * the same day described as "2026-08-28" and as an instant within it is one
 * fact, not two. Every DTO in this repository already sends the plain day form,
 * so this is a no-op for existing callers and changes no stored fingerprint.
 *
 * An unparseable value is passed through verbatim rather than silently becoming
 * "Invalid Date": validation rejects those at the boundary, and a serializer is
 * the wrong place to start inventing verdicts about them.
 */
function fingerprintUtcDay(value: FingerprintMetadataValue): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toISOString().slice(0, 10);
}

/**
 * The metadata half of the fingerprint string, in the ONE declared order.
 *
 * Absent and null are both the empty string, exactly as before: a fact nobody
 * stated reads the same whether it was omitted or explicitly cleared.
 */
function fingerprintMetadataPart(metadata: FingerprintMetadata): string {
  return FINGERPRINT_METADATA_KEYS.map((key) => {
    const value = metadata[key];
    if (value === null || value === undefined) return `${key}:`;
    // A FACT SITTING AT ITS COLUMN DEFAULT IS NOT A STATED FACT.
    //
    // `priceCoverageDeclared` is the one key here whose column is NOT NULL with
    // a default, so intake writes `false` both when a caller says false and
    // when a caller says nothing. Once stored, those two are indistinguishable
    // — the database kept no record of which happened.
    //
    // The fingerprint must therefore read `false` the same way it reads absent,
    // or the SAME batch would hash one way from a preview DTO (where unstated
    // is undefined) and another from its own stored row (where unstated became
    // false). That divergence is not hypothetical: it is exactly what made a
    // finalized batch's identity fail to equal the identity a direct read of
    // the same facts mints.
    //
    // No stored fingerprint moves. Every caller in this repository omits the
    // key, which already hashed as empty, and `true` is untouched — only the
    // unrepresentable middle collapses onto the absence it is stored as.
    if (key === 'priceCoverageDeclared' && value === false) return `${key}:`;
    if (key === 'effectiveDate') return `${key}:${fingerprintUtcDay(value)}`;
    return `${key}:${String(value)}`;
  }).join('|');
}

/**
 * USI-01 intake identity, stated as FLAT FACTS rather than as a reading.
 *
 * Every one of these is persisted on the batch, which is the property that lets
 * a finalized batch recompute its own identity without re-reading a single byte
 * of the source. `intakeIdentitySegments` below maps a live reading onto this
 * same shape, so there is exactly ONE segment builder and no second engine.
 */
interface IntakeIdentityFacts {
  regionScopeLabel: string | null;
  ingestionChannel: string;
  connectorId: string | null;
  externalSourceId: string | null;
  externalRecordId: string | null;
  externalVersion: string | null;
  interpretationResourceNameColumn: number | null;
  interpretationSourceUnitColumn: number | null;
  interpretationDeclaredSection: string | null;
  interpretationKdnColumn: number | null;
}

/**
 * USI-01 — INTAKE IDENTITY BEYOND THE WORKBOOK.
 *
 * These segments join the fingerprint ONLY when they say something, and they
 * are appended AFTER every pre-existing segment. That is load-bearing, not
 * tidiness: a legacy browser upload of a sectioned workbook produces a
 * byte-identical fingerprint string to the one it produced before USI-01
 * existed, so an exact replay still finds its own batch (test I6) and no
 * historical batch is orphaned.
 *
 * Each one is here because it makes two intakes DIFFERENT FACTS (test I7): the
 * same matrix read at its SIRIMAU column is not the batch read at its BAGUALA
 * column, and a supplier-sent artifact is not the same arrival as the identical
 * bytes a human uploaded.
 */
function intakeIdentitySegmentsOf(facts: IntakeIdentityFacts): string[] {
  const segments: string[] = [];
  if (facts.regionScopeLabel !== null)
    segments.push(`regionScopeLabel:${facts.regionScopeLabel}`);
  if (facts.ingestionChannel !== 'USER_UPLOAD')
    segments.push(`ingestionChannel:${facts.ingestionChannel}`);
  if (facts.connectorId !== null)
    segments.push(`ingestionConnectorId:${facts.connectorId}`);

  // USI-01R §11 — SOURCE OBSERVATION IDENTITY, NOT DELIVERY IDENTITY.
  //
  // `deliveryId` is deliberately ABSENT from this list. A retried delivery of
  // the same observation must land on the same batch (OBS-01); including the
  // request id would have manufactured a brand-new price every time a network
  // hiccup caused a resend.
  //
  // `externalVersion` IS present, and is what makes a supplier's genuinely
  // newer price a new observation rather than a rejected duplicate (OBS-02,
  // LAW 2.5).
  if (facts.externalSourceId !== null)
    segments.push(`externalSourceId:${facts.externalSourceId}`);
  if (facts.externalRecordId !== null)
    segments.push(`externalRecordId:${facts.externalRecordId}`);
  if (facts.externalVersion !== null)
    segments.push(`externalVersion:${facts.externalVersion}`);

  /**
   * THE SAME BYTES READ WITH A DIFFERENT LAWFUL INTERPRETATION ARE NOT THE SAME
   * IMPORT TRUTH.
   *
   * WHY THIS HAD TO JOIN IDENTITY. The Owner's workbook was accepted once with
   * its resource-name column answered as the unit column: 934 poisoned rows,
   * every row wearing its own name as a unit. Answered honestly the SAME file
   * yields 894 truthful ones. Nothing above can tell those apart — same digest,
   * same sheet, same contract, same region, same metadata — so the corrected
   * import matched the poisoned batch's fingerprint and was handed the poison
   * back as a replay. A person could not fix their own import.
   *
   * WHY IT IS READ FROM THE READING AND NOT FROM THE REQUEST. `knowledge
   * .interpretation` is null wherever the DOCUMENT decided a fact, so a stray
   * `selectedNameColumn` sent alongside a workbook that states its own headers
   * changes nothing here. Identity must fork on different TRUTH, never on a
   * different way of asking for the same truth, or SIMPROK would mint duplicate
   * batches instead of preventing them.
   *
   * WHY LEGACY FINGERPRINTS SURVIVE. These segments are appended LAST and only
   * when something is actually stated, exactly like every segment above. A
   * sectioned workbook depends on no human answer at all, so its fingerprint
   * string is byte-identical to the one it produced before this existed and its
   * replay still finds its own batch.
   *
   * A CORRECTED INTERPRETATION IS A NEW BATCH, NEVER AN EDIT OF AN OLD ONE. The
   * poisoned batch keeps its rows, its fingerprint and its history untouched;
   * retiring it is a separate Owner decision and nothing here performs one.
   */
  // A FIXED ORDER, NOT THE OBJECT'S. Two identical interpretations must
  // produce one identical string, so the sequence is written out rather than
  // inherited from however the fields happen to be declared.
  //
  // FLAT, AND EQUIVALENT TO THE READING IT REPLACED. The reading's
  // `interpretation` is null wherever the document decided everything, and each
  // field below is pushed only when it says something — so "no interpretation"
  // and "an interpretation that states nothing" produce the same empty result,
  // exactly as before. That equivalence is what lets the stored columns stand in
  // for the reading when a finalized batch recomputes its own identity.
  if (facts.interpretationResourceNameColumn !== null)
    segments.push(
      `resourceNameColumn:${facts.interpretationResourceNameColumn}`,
    );
  if (facts.interpretationSourceUnitColumn !== null)
    segments.push(`sourceUnitColumn:${facts.interpretationSourceUnitColumn}`);
  if (facts.interpretationDeclaredSection !== null)
    segments.push(`declaredSection:${facts.interpretationDeclaredSection}`);
  if (facts.interpretationKdnColumn !== null)
    segments.push(`kdnColumn:${facts.interpretationKdnColumn}`);
  return segments;
}

/** The same segments, read off a LIVE reading rather than a stored batch. */
function intakeIdentitySegments(
  knowledge: BasicPriceImportKnowledgeObject,
  envelope: SourceEnvelope,
): string[] {
  return intakeIdentitySegmentsOf({
    regionScopeLabel: knowledge.regionScopeLabel,
    ingestionChannel: envelope.ingestionChannel,
    connectorId: envelope.connectorId,
    externalSourceId: envelope.externalSourceId,
    externalRecordId: envelope.externalRecordId,
    externalVersion: envelope.externalVersion,
    interpretationResourceNameColumn:
      knowledge.interpretation?.resourceNameColumn ?? null,
    interpretationSourceUnitColumn:
      knowledge.interpretation?.sourceUnitColumn ?? null,
    interpretationDeclaredSection:
      knowledge.interpretation?.declaredSection ?? null,
    interpretationKdnColumn: knowledge.interpretation?.kdnColumn ?? null,
  });
}

/**
 * THE FINGERPRINT STRING — ONE ENGINE, TWO CALLERS.
 *
 * `preview` hashes a reading; `updateBatchMetadata` re-hashes a finalized batch.
 * Both go through here, so a batch that finalizes its Region computes the SAME
 * identity a fresh read of the same file under the same facts would — which is
 * the entire invariant, and one a second implementation could not hold.
 */
function fingerprintOf(input: {
  workspaceId: string;
  organizationId: string;
  sourceSha256: string;
  sheetName: string;
  parserContractVersion: string;
  metadata: FingerprintMetadata;
  intakeSegments: string[];
}): string {
  return createHash('sha256')
    .update(
      [
        input.workspaceId,
        input.organizationId,
        input.sourceSha256,
        input.sheetName,
        input.parserContractVersion,
        fingerprintMetadataPart(input.metadata),
        ...input.intakeSegments,
      ].join('|'),
    )
    .digest('hex')
    .toUpperCase();
}

/**
 * USI-01R2 §6C — HOW TWO SOURCE VERSIONS COMPARE, HONESTLY.
 *
 * Most version strings in the world are not orderable, and pretending otherwise
 * is how an old price silently becomes "the latest". A lexical comparison would
 * happily rank "v10" before "v9" and "REV-B" before "REV-a".
 *
 * So ordering is claimed only where it is PROVEN:
 *   - a purely numeric version compares numerically;
 *   - an ISO-8601 timestamp compares chronologically;
 *   - identical strings are EQUAL;
 *   - everything else is ORDER_UNKNOWN, and SIMPROK says so.
 */
export type SourceVersionOrder = 'OLDER' | 'NEWER' | 'EQUAL' | 'ORDER_UNKNOWN';

const NUMERIC_VERSION = /^\d+(?:\.\d+)*$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function compareSourceVersions(
  incoming: string,
  existing: string,
): SourceVersionOrder {
  if (incoming === existing) return 'EQUAL';

  if (NUMERIC_VERSION.test(incoming) && NUMERIC_VERSION.test(existing)) {
    // Segment-wise, so 1.10 is correctly newer than 1.9.
    const left = incoming.split('.').map(Number);
    const right = existing.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const a = left[i] ?? 0;
      const b = right[i] ?? 0;
      if (a !== b) return a > b ? 'NEWER' : 'OLDER';
    }
    return 'EQUAL';
  }

  if (ISO_TIMESTAMP.test(incoming) && ISO_TIMESTAMP.test(existing)) {
    const a = Date.parse(incoming);
    const b = Date.parse(existing);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (a === b) return 'EQUAL';
      return a > b ? 'NEWER' : 'OLDER';
    }
  }

  // An opaque vendor token. SIMPROK does not rank what it cannot read.
  return 'ORDER_UNKNOWN';
}

/**
 * BP-REGION-TRUTH-07U — THE VERDICT TRAVELS OUT OF THE TRANSACTION; THE QUERY
 * THAT NAMES THE WINNER DOES NOT TRAVEL INTO IT.
 *
 * WHAT WENT WRONG. `workspaceId_importFingerprint` refuses a second batch that
 * finalizes onto an identity another batch already holds — correctly, and by
 * the database rather than by a check that could be raced past. But the moment
 * PostgreSQL raises that error the whole transaction is ABORTED: every further
 * statement on the same connection is refused with SQLSTATE 25P02, "current
 * transaction is aborted, commands ignored until end of transaction block". A
 * JavaScript `catch` does not undo that — it catches the exception, not the
 * server-side transaction state. So the recovery read that existed to tell the
 * person WHICH batch already holds this identity was itself the statement that
 * turned a lawful 409 into a 500.
 *
 * WHAT THIS IS. A sentinel that carries the one fact the recovery needs — the
 * identity that lost — up past the transaction boundary, so the read happens on
 * a fresh connection AFTER the failed transaction has rolled back and ended.
 * The refusal is unchanged: still one statement, still one verdict, still no
 * retry and no merge. Only the place the winner's name is fetched from moves.
 */
class BatchIdentityCollision extends Error {
  constructor(readonly importFingerprint: string) {
    super('BATCH_IDENTITY_ALREADY_EXISTS');
    this.name = 'BatchIdentityCollision';
  }
}

@Injectable()
export class BasicPriceImportService {
  private readonly adapter = new BasicPriceUniversalIntakeAdapter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewService: PriceSubmissionReviewService,
    // USI-01R2 §5 — retains the ORIGINAL BYTES for this vertical-local intake.
    // Not a platform evidence model: moving arrivals onto Reality Intake is
    // RM-12 work by name, and this slice must not close that debt early.
    private readonly sourceArchive: BasicPriceSourceArchiveService,
    /**
     * INT-CONNECT-01 — the seam that asks the EXISTING Unit and Resource
     * Identity authorities what they already know about this batch's rows.
     * Consulted on the review READ path only (see `getBatch`), never during
     * preview: an import must not become slower to make a later screen smarter,
     * and nothing it returns is ever written.
     */
    private readonly proposals: BasicPriceRowResolutionProposalService,
    /**
     * USI-01R2 §10 / COLUMN INTELLIGENCE — the SAME canonical Unit authority
     * every other seam asks, used here for one narrow job: to disprove a column
     * before a human is asked to choose it. See
     * `pruneDisprovenColumnCandidates`.
     */
    private readonly units: UnitKernelService,
  ) {}

  /**
   * DO NOT ASK A HUMAN WHAT SIMPROK CAN ALREADY DISPROVE.
   *
   * The structure detector removes what a document proves on its own — the
   * resource-CLASS column, a column repeating one value on every row. It cannot
   * remove the UNIT column, because "is this spelling a unit?" is not a
   * structural fact: it is the Unit authority's question, and that authority
   * lives behind a database the pure detector deliberately cannot reach.
   *
   * So the last elimination happens here, where the authority IS reachable. A
   * column whose every sampled value the Unit Kernel resolves to a canonical
   * unit is the unit column. Offering it as a candidate for "which column holds
   * the resource NAME" invites a wrong click on an option that was never
   * possible — which is exactly what a real workbook did, offering a column
   * reading "Org/hr / m3" beside the real names.
   *
   * NO SECOND UNIT DICTIONARY IS INTRODUCED, and none may be: the one authority
   * answers, or the column stays on the list.
   *
   * FAIL OPEN. Every refusal below leaves the candidate list untouched — an
   * authority that cannot answer must never shrink a human's options, and a
   * pruning that removed everything would replace a confusing question with an
   * unanswerable one.
   *
   * ---------------------------------------------------------------------------
   * THIS AUTHORITY PRUNES IN ONE DIRECTION ONLY, AND THE ASYMMETRY IS THE LAW.
   *
   * The reply may be read as "every value in this column IS a canonical unit,
   * so this is not the NAME column". It may NOT be read backwards. A mirror
   * once stood here that dropped a column from the UNIT list when the Kernel
   * resolved NOT ONE of its values, and that inference is invalid: ABSENCE OF
   * PROOF IS NOT PROOF OF ABSENCE. "I know none of these spellings" describes
   * the reach of SIMPROK's dictionary. It says nothing whatever about what the
   * document means.
   *
   * A REAL UNIT COLUMN SPELLED IN VOCABULARY SIMPROK HAS NOT LEARNED YET IS
   * THE ORDINARY CASE, not the exotic one — `sac`, `bundle`, `roll`, a regional
   * abbreviation, any foreign source. Removing it left a person unable to state
   * a true fact about their own document, and converted SIMPROK's ignorance
   * into the user's dead end. That is the one thing this seam must never do.
   *
   * WHAT KEEPS THE UNIT QUESTION SAFE IS UPSTREAM AND UNCHANGED: the intake
   * adapter refuses Name == Unit outright, and removes the chosen name column
   * from the unit list unconditionally. Narrowing belongs to facts a document
   * proves — never to gaps in a dictionary.
   * ---------------------------------------------------------------------------
   */
  private async pruneDisprovenColumnCandidates(
    details: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    /** Strips the server-side proof evidence off every candidate list. */
    const withoutProofValues = (value: unknown): unknown =>
      Array.isArray(value)
        ? (value as unknown[]).map((candidate): unknown => {
            if (candidate === null || typeof candidate !== 'object')
              return candidate;
            const rest: Record<string, unknown> = {
              ...(candidate as Record<string, unknown>),
            };
            delete rest.proofValues;
            return rest;
          })
        : value;

    /** The browser never receives `proofValues`, whatever this method decides. */
    const published = (
      nameCandidates: unknown,
      unitCandidates: unknown,
    ): Record<string, unknown> => ({
      ...details,
      nameCandidates: withoutProofValues(nameCandidates),
      unitCandidates: withoutProofValues(unitCandidates),
    });

    const provable = (candidate: unknown): string[] | null => {
      const record = candidate as {
        proofValues?: unknown;
        distinctValues?: unknown;
      };
      if (!Array.isArray(record.proofValues)) return null;
      // The detector truncates at a bound. A verdict over a truncated set would
      // describe a prefix rather than the column, so no verdict is reached.
      if (
        typeof record.distinctValues === 'number' &&
        record.distinctValues > record.proofValues.length
      ) {
        return null;
      }
      const stated = record.proofValues.filter(
        (value): value is string =>
          typeof value === 'string' && value.trim() !== '',
      );
      return stated.length === 0 ? null : stated;
    };

    const nameCandidates = details.nameCandidates;
    const unitCandidates = details.unitCandidates;
    const nameList = Array.isArray(nameCandidates) ? nameCandidates : [];

    // A LIST OF ONE IS NOT A CHOICE. Eliminating from it could only ever leave
    // the human with nothing, so this does not reason over it at all.
    const nameProofs = nameList.length >= 2 ? nameList.map(provable) : null;

    // ONE BATCHED QUESTION FOR THE WHOLE SCREEN, NOT ONE PER COLUMN AND NEVER
    // ONE PER ROW. Every distinct spelling the NAME candidates state is asked
    // about exactly once, through the authority's own batch entry point, so the
    // cost is bounded by the number of DISTINCT spellings rather than by the
    // sheet's height. The unit list asks nothing, because no answer it could
    // receive would lawfully shorten it.
    const allValues = [
      ...new Set((nameProofs ?? []).flatMap((values) => values ?? [])),
    ];
    if (allValues.length === 0)
      return published(nameCandidates, unitCandidates);

    const answers = await this.units.resolveCanonicalUnitIdentities(allValues);
    const proven = new Set(
      answers
        .filter((answer) => answer.status === UNIT_RESOLUTION_STATUS.RESOLVED)
        .map((answer) => answer.rawUnit),
    );

    // A column is the UNIT column only when EVERY value it states is a proven
    // canonical unit. One ambiguous or unknown spelling and the proof fails —
    // and failing means keeping the human's choice, never narrowing it.
    const keptNames =
      nameProofs === null
        ? nameList
        : nameList.filter((_, index) => {
            const values = nameProofs[index];
            if (values === null) return true;
            return !values.every((value) => proven.has(value));
          });

    // THE UNIT LIST LEAVES THIS METHOD EXACTLY AS IT ARRIVED — not because it
    // could not be filtered, but because the only filter available here is the
    // invalid inference documented above. A column this Kernel cannot read is
    // still a column a person can read.
    //
    // FAIL OPEN ON THE NAME SIDE TOO. Removing everything would replace a
    // confusing question with an unanswerable one, and removing nothing is
    // simply the honest outcome.
    return published(
      keptNames.length > 0 ? keptNames : nameCandidates,
      unitCandidates,
    );
  }

  private validateFile(
    file: UploadedSourceFile | undefined,
  ): asserts file is UploadedSourceFile {
    if (!file?.buffer)
      throw new BadRequestException('A source file is required');
    if (file.size > MAX_UPLOAD_BYTES)
      throw new PayloadTooLargeException('Source file exceeds 10 MiB');
  }

  /**
   * §17 ERROR HONESTY. Every intake refusal reaches the caller as its OWN
   * diagnostic, carrying the evidence needed to act — which tables were
   * examined, which structures were plausible, which jurisdictions were found.
   * "Invalid file" is never the answer, and SIMPROK's own reader limitations
   * are never dressed up as a fault in the sender's document.
   */
  private translateIntakeError(error: unknown): never {
    if (!(error instanceof IntakeError)) throw error;
    const body = { message: error.code, ...(error.details ?? {}) };
    switch (error.code) {
      case INTAKE_ERRORS.SOURCE_EXCEEDS_MAX_BYTES:
      case INTAKE_ERRORS.SOURCE_ROW_LIMIT_EXCEEDED:
        throw new PayloadTooLargeException(body);
      case INTAKE_ERRORS.SOURCE_TABLE_AMBIGUOUS:
      case INTAKE_ERRORS.SOURCE_STRUCTURE_AMBIGUOUS:
      case INTAKE_ERRORS.REGION_COLUMN_SELECTION_REQUIRED:
      case INTAKE_ERRORS.SECTION_DECLARATION_REQUIRED:
      case INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED:
        // A human decision is genuinely outstanding. This is not a failure of
        // the file and not a failure of SIMPROK — it is the one question only a
        // person can answer, asked exactly once.
        throw new ConflictException(body);
      default:
        throw new BadRequestException(body);
    }
  }

  private async parse(
    envelope: SourceEnvelope,
    selection: BasicPriceIntakeSelection,
  ): Promise<BasicPriceImportKnowledgeObject> {
    try {
      return await this.adapter.parse(envelope, selection);
    } catch (error) {
      // The ONE question SIMPROK can still narrow before asking it. Everything
      // else is translated unchanged.
      if (
        error instanceof IntakeError &&
        error.code === INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED
      ) {
        throw new ConflictException({
          message: error.code,
          ...(await this.pruneDisprovenColumnCandidates(error.details ?? {})),
        });
      }
      this.translateIntakeError(error);
    }
  }

  private fingerprint(
    workspaceId: string,
    organizationId: string,
    knowledge: BasicPriceImportKnowledgeObject,
    metadata: PreviewBasicPriceImportDto,
    envelope: SourceEnvelope,
  ): string {
    return fingerprintOf({
      workspaceId,
      organizationId,
      sourceSha256: knowledge.sourceSha256,
      sheetName: knowledge.sheetName,
      // The knowledge object's OWN contract, not a module constant: each
      // structure has its own parser contract, and two structures read out
      // of one file are two different readings of it.
      parserContractVersion: knowledge.parserContractVersion,
      metadata,
      intakeSegments: intakeIdentitySegments(knowledge, envelope),
    });
  }

  /**
   * USI-01R2 §6 — WHICH OBSERVATION OF A SOURCE STREAM IS THIS?
   *
   * Returns the atomic observation key plus an honest ordering verdict against
   * whatever is already on record. It NO LONGER decides uniqueness by reading
   * first: two concurrent deliveries can both read "nothing exists", so the
   * decision belongs to the unique index and the insert below it. What this
   * does is compute identity and give the caller a truthful late-arrival
   * verdict.
   *
   * OBS-05 — IDENTITY MAY BE INCOMPLETE, AND THAT IS SAID OUT LOUD. A source
   * that names a record but neither a version nor an observation time cannot
   * distinguish a future changed price from this one. SIMPROK will not invent
   * the missing axis from its own clock, so such a source gets no observation
   * key and falls back to the file-content fingerprint law — which means a
   * genuinely changed payload is a new batch, and an identical one is a replay.
   */
  private async resolveObservation(envelope: SourceEnvelope): Promise<{
    observationKey: string | null;
    identityComplete: boolean;
    versionOrder: SourceVersionOrder | null;
    lateArrivingSourceVersion: boolean;
  }> {
    const identity = sourceObservationIdentityOf(envelope);
    const observationKey = identity?.key ?? null;
    if (identity === null) {
      // A manual upload, or a source that stated no record identity at all.
      return {
        observationKey: null,
        identityComplete: envelope.externalRecordId === null,
        versionOrder: null,
        lateArrivingSourceVersion: false,
      };
    }

    const identityComplete = identity.complete;

    let versionOrder: SourceVersionOrder | null = null;
    let lateArrivingSourceVersion = false;
    if (envelope.externalVersion) {
      const siblings = await this.prisma.basicPriceImportBatch.findMany({
        where: {
          workspaceId: envelope.workspaceId,
          ingestionConnectorId: envelope.connectorId,
          ingestionExternalSourceId: envelope.externalSourceId,
          ingestionExternalRecordId: envelope.externalRecordId,
          ingestionExternalVersion: { not: null },
        },
        select: { ingestionExternalVersion: true },
      });

      for (const sibling of siblings) {
        const order = compareSourceVersions(
          envelope.externalVersion,
          sibling.ingestionExternalVersion!,
        );
        if (versionOrder === null || order !== 'EQUAL') versionOrder = order;
        // OBS-04/OBS-06 — only a PROVEN ordering may mark a late arrival. An
        // opaque token yields ORDER_UNKNOWN and no claim is made either way.
        if (order === 'OLDER') lateArrivingSourceVersion = true;
      }
    }

    return {
      observationKey,
      identityComplete,
      versionOrder,
      lateArrivingSourceVersion,
    };
  }

  /**
   * USI-01R2 §6B — the unique index has spoken. Translate it into the truth.
   *
   * Reaching here means another batch already holds this observation key. If it
   * carries the SAME bytes it is the same observation and the caller is handed
   * the winner (a retry, OBS-01). If it carries DIFFERENT bytes the source has
   * contradicted itself under one stated version, and SIMPROK refuses rather
   * than storing two truths (OBS-03).
   */
  private async settleObservationCollision(
    workspaceId: string,
    observationKey: string,
    incomingSourceSha256: string,
  ) {
    const winner = await this.prisma.basicPriceImportBatch.findUnique({
      where: {
        workspaceId_sourceObservationKey: {
          workspaceId,
          sourceObservationKey: observationKey,
        },
      },
    });
    if (!winner) return null;

    if (winner.sourceSha256 !== incomingSourceSha256) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'SOURCE_OBSERVATION_CONFLICT',
        sourceObservationKey: observationKey,
        existingBatchId: winner.id,
        existingSourceSha256: winner.sourceSha256,
        incomingSourceSha256,
      });
    }
    return winner;
  }

  /** The part of an observation verdict a caller is told about. */
  private observationVerdict(observation: {
    identityComplete: boolean;
    versionOrder: SourceVersionOrder | null;
    lateArrivingSourceVersion: boolean;
  }) {
    return {
      lateArrivingSourceVersion: observation.lateArrivingSourceVersion,
      sourceVersionOrder: observation.versionOrder,
      // OBS-05 — false means the source named a record but gave no version and
      // no observation time, so a future changed price for it could not be told
      // apart from this one by identity alone.
      sourceObservationIdentityComplete: observation.identityComplete,
    };
  }

  /**
   * SMART RE-IMPORT — product naming of a relation intake already proved.
   *
   * Not a second identity engine. Exact replay still is the fingerprint unique
   * index; a corrected reading still is a different fingerprint. This only
   * decides whether the ordinary user is offered SKIP / USE UPDATE, and it
   * never mutates the batch it names.
   *
   * UNAUTHORIZED HISTORY IS INDISTINGUISHABLE FROM ABSENCE. A fingerprint or
   * observation match belonging to another account is not returned, not
   * described, and not used as a re-import option.
   */
  private assertIntakeBatchOwned(
    batch: { uploadedByAccountId: string },
    actorAccountId: string,
  ): void {
    if (batch.uploadedByAccountId !== actorAccountId) {
      throw new NotFoundException('Batch not found');
    }
  }

  /**
   * Comparable-sibling lookup uses the EXISTING source-envelope axes already
   * stored on the batch — never filename, never a second identity hash.
   *
   * Same bytes + same owner is not enough: a different selected sheet or a
   * different source region scope is a different logical source. Parser
   * contract is already an identity axis on the fingerprint and is matched
   * here so two structures read out of one file cannot update each other.
   */
  private async findOwnedInterpretationSibling(params: {
    workspaceId: string;
    uploadedByAccountId: string;
    sourceSha256: string;
    regionId: string | null;
    selectedSheetName: string;
    sourceRegionScopeLabel: string | null;
    parserContractVersion: string;
    incoming: InterpretationIdentity;
    excludeBatchId: string;
  }): Promise<string | null> {
    const siblings = await this.prisma.basicPriceImportBatch.findMany({
      where: {
        workspaceId: params.workspaceId,
        uploadedByAccountId: params.uploadedByAccountId,
        sourceSha256: params.sourceSha256,
        regionId: params.regionId,
        selectedSheetName: params.selectedSheetName,
        sourceRegionScopeLabel: params.sourceRegionScopeLabel,
        parserContractVersion: params.parserContractVersion,
        id: { not: params.excludeBatchId },
      },
      select: {
        id: true,
        interpretationResourceNameColumn: true,
        interpretationSourceUnitColumn: true,
        interpretationDeclaredSection: true,
        interpretationKdnColumn: true,
        createdAt: true,
      },
      orderBy: INTERPRETATION_SIBLING_ORDER_BY,
      take: 20,
    });
    return selectInterpretationSibling(
      siblings.map((sibling) => ({
        id: sibling.id,
        createdAt: sibling.createdAt,
        resourceNameColumn: sibling.interpretationResourceNameColumn,
        sourceUnitColumn: sibling.interpretationSourceUnitColumn,
        declaredSection: sibling.interpretationDeclaredSection,
        kdnColumn: sibling.interpretationKdnColumn,
      })),
      params.incoming,
    );
  }

  private async findOwnedSourceStreamSibling(params: {
    workspaceId: string;
    uploadedByAccountId: string;
    connectorId: string | null;
    externalSourceId: string | null;
    externalRecordId: string;
    incomingSourceSha256: string;
    excludeBatchId: string;
  }): Promise<string | null> {
    const siblings = await this.prisma.basicPriceImportBatch.findMany({
      where: {
        workspaceId: params.workspaceId,
        uploadedByAccountId: params.uploadedByAccountId,
        ingestionConnectorId: params.connectorId,
        ingestionExternalSourceId: params.externalSourceId,
        ingestionExternalRecordId: params.externalRecordId,
        sourceSha256: { not: params.incomingSourceSha256 },
        id: { not: params.excludeBatchId },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    return siblings[0]?.id ?? null;
  }

  private async presentIntake(
    batch: Parameters<BasicPriceImportService['summarize']>[0] & {
      uploadedByAccountId: string;
    },
    rows: Parameters<BasicPriceImportService['summarize']>[1],
    observation: {
      identityComplete: boolean;
      versionOrder: SourceVersionOrder | null;
      lateArrivingSourceVersion: boolean;
    },
    options: {
      actorAccountId: string;
      exactReplay: boolean;
      envelope: SourceEnvelope;
      knowledge: BasicPriceImportKnowledgeObject;
      regionId: string | null;
    },
  ) {
    this.assertIntakeBatchOwned(batch, options.actorAccountId);

    let interpretationSiblingId: string | null = null;
    let sourceStreamSiblingId: string | null = null;
    if (!options.exactReplay) {
      const incoming: InterpretationIdentity = {
        resourceNameColumn:
          options.knowledge.interpretation?.resourceNameColumn ?? null,
        sourceUnitColumn:
          options.knowledge.interpretation?.sourceUnitColumn ?? null,
        declaredSection:
          options.knowledge.interpretation?.declaredSection ?? null,
        kdnColumn: options.knowledge.interpretation?.kdnColumn ?? null,
      };
      interpretationSiblingId = await this.findOwnedInterpretationSibling({
        workspaceId: options.envelope.workspaceId,
        uploadedByAccountId: options.actorAccountId,
        sourceSha256: options.knowledge.sourceSha256,
        regionId: options.regionId,
        selectedSheetName: options.knowledge.sheetName,
        sourceRegionScopeLabel: options.knowledge.regionScopeLabel,
        parserContractVersion: options.knowledge.parserContractVersion,
        incoming,
        excludeBatchId: batch.id,
      });
      if (!interpretationSiblingId && options.envelope.externalRecordId) {
        sourceStreamSiblingId = await this.findOwnedSourceStreamSibling({
          workspaceId: options.envelope.workspaceId,
          uploadedByAccountId: options.actorAccountId,
          connectorId: options.envelope.connectorId,
          externalSourceId: options.envelope.externalSourceId,
          externalRecordId: options.envelope.externalRecordId,
          incomingSourceSha256: options.knowledge.sourceSha256,
          excludeBatchId: batch.id,
        });
      }
    }

    return {
      ...this.summarize(batch, rows),
      ...this.observationVerdict(observation),
      reimport: classifyReimport({
        exactOwnedBatchId: options.exactReplay ? batch.id : null,
        interpretationSiblingId,
        sourceStreamSiblingId,
        incomingBatchId: batch.id,
      }),
    };
  }

  /** The formats SIMPROK can read today, for honest client-facing messaging. */
  supportedSourceExtensions(): string[] {
    return ReaderRegistry.default().supportedExtensions();
  }

  private async resolveOrganizationId(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace.organizationId;
  }

  private summarize(
    batch: {
      id: string;
      status: string;
      importFingerprint: string;
      effectiveDate: Date | null;
      /** Soft re-verification, human-stated. Optional on the way in so every
       * existing caller and fixture keeps compiling unchanged. */
      reviewDate?: Date | null;
      /** Temporal provenance, read so the review gate can ask the WRITER's
       * coherence question. Optional for the same compile-compatibility reason. */
      sourcePeriodLabel?: string | null;
      sourcePeriodGranularity?: string | null;
      effectiveDateProvenance?: string | null;
      effectiveDateDerivationRule?: string | null;
      regionId: string | null;
      /**
       * WHICH price column of a multi-jurisdiction source this batch read —
       * the source's own wording, never a canonical Region name. Optional on
       * the way in so every existing caller and fixture keeps compiling; a
       * caller that does not carry it projects null, which is the honest
       * answer for a source that offered only one column.
       */
      sourceRegionScopeLabel?: string | null;
      /**
       * BP-REGION-TRUTH-07S — whether the SOURCE called that scope a place, and
       * which canonical Region a human has reconciled it against.
       *
       * Optional for the same compile-compatibility reason as the label above,
       * and absent reads as "not stated" all the way down to the action law —
       * so a fixture that carries neither raises no question, which is the
       * correct verdict for a source that proved no geography.
       */
      sourceRegionScopeGeographicEvidence?: string | null;
      regionScopeConfirmedRegionId?: string | null;
      /**
       * THE SOURCE CLASSIFICATION, ON THE WAY OUT AS WELL AS IN.
       *
       * These two were writable through `PATCH :batchId` and readable nowhere.
       * A user could therefore set them, be told "tersimpan", and have no way
       * to see afterwards what SIMPROK had actually stored — so metadata
       * persistence was unprovable through the product itself. They are also
       * what decides the whole source-policy route below, and the review room
       * cannot honestly explain a routing decision it cannot see.
       */
      sourceType: string | null;
      sourceOrigin: string | null;
      /**
       * WHO published the price. Read by the Basic Price Explorer for its
       * source line, and returned here so a reopened batch can show what was
       * saved instead of the person retyping it.
       */
      sourceOrganizationName: string | null;
      version: number;
      /** Transport fact, server-set. Says nothing about origin or trust. */
      ingestionChannel?: string | null;
      kdnMappingStatus?: string | null;
      interpretationKdnColumn?: number | null;
      kdnMappingCandidates?: unknown;
    },
    rows: Array<{
      id: string;
      status: string;
      resolutionStatus: string;
      rawResourceCodeText?: string | null;
      rawResourceNameText: string;
      rawUnitText?: string | null;
      rawPriceDisplayText?: string | null;
      proposedCanonicalPrice?: { toString(): string } | null;
      proposedCanonicalKdn?: { toString(): string } | null;
      kdnReasonCode?: string | null;
      sourceKdnHeaderText?: string | null;
      // USI-01R — null when the source stated a category SIMPROK could not map.
      sourceSection: string | null;
      sourceSectionProvenance?: string | null;
      rawSourceCategoryCode?: string | null;
      rawSourceCategoryName?: string | null;
      sourceRowNumber: number;
      collisionType?: string;
      collisionOfRowId?: string | null;
      resourceCatalogId?: string | null;
      unitDefinitionId?: string | null;
      reasonCodes?: string[];
      version?: number;
    }>,
    /**
     * INT-CONNECT-01 — what the canonical authorities already proved about each
     * row, keyed by row id. Optional, and absent everywhere except the review
     * read path.
     *
     * WHAT IS ACTUALLY GUARANTEED, stated exactly:
     *
     *   - preview, patch and submit EXECUTE NO INTELLIGENCE QUERY. Neither
     *     authority is consulted on those paths, so no existing caller pays for
     *     work it did not ask for;
     *   - the additive fields `machineProposal` and `identityPairProvenRows`
     *     are NEUTRAL on those paths — null and zero respectively — because
     *     nothing was asked, not because nothing was found.
     *
     * NOT "exactly the shape they always did", which an earlier note here
     * claimed. `summarize()` gained those two fields for every caller, and a
     * neutral value is still a present field. Removing them to make the older
     * sentence true would trade a truthful contract for a tidy comment; the
     * sentence is what was wrong, so the sentence is what changed.
     */
    proposals?: ReadonlyMap<string, BasicPriceRowMachineProposal>,
    /**
     * WHICH of this batch's rows already exist as WORKSPACE_PRIVATE prices.
     *
     * OPTIONAL, AND ABSENCE MEANS NOT ASKED — the same neutrality rule
     * `proposals` follows, and for the same reason: only the review read path
     * pays for it, and a projection that never asked has no basis to claim that
     * nothing is stored. Undefined therefore travels to the policy as
     * undefined, where it suppresses the already-stored verdict entirely rather
     * than defaulting to a zero that would be wrong by exactly the number of
     * prices that do exist.
     *
     * A SET RATHER THAN A COUNT, because the count could only ever correct a
     * button, and the sentence a person actually reads sits on the ROW. The
     * count is still published, derived from this — `sourceImportRowId` is
     * `@unique`, so the two can never disagree.
     */
    privateRowIds?: ReadonlySet<string>,
  ) {
    // ONE FACT, TWO SHAPES. The count the action projection needs and the
    // per-row flag the row label needs are the SAME truth, so it is derived
    // once and never measured twice.
    const alreadyPrivateRows = privateRowIds ? privateRowIds.size : undefined;
    const machineRows = rows.filter(
      (r) => proposals?.get(r.id)?.identityPairProven === true,
    ).length;
    const readyForSubmissionRows = rows.filter(
      (r) => r.status === 'READY_FOR_SUBMISSION',
    ).length;
    return {
      batchId: batch.id,
      status: batch.status,
      importFingerprint: batch.importFingerprint,
      effectiveDate: batch.effectiveDate,
      /**
       * SOFT RE-VERIFICATION, projected so the metadata form can show back what
       * was actually SAVED rather than what the form happens to be holding —
       * the same read-your-own-writes rule every other field here follows.
       * Null is the ordinary case and renders as an empty field, never as a
       * warning.
       */
      reviewDate: batch.reviewDate ?? null,
      regionId: batch.regionId,
      /**
       * BP-VISUAL-TRUTH-07 §7 — WHICH PRICE COLUMN THIS BATCH WAS READ FROM,
       * said out loud, because it is NOT the same fact as `regionId`.
       *
       * THE DEFECT THIS CLOSES. A regional-matrix workbook offers one price
       * column per jurisdiction, and intake asks which one to read. That answer
       * is the source's OWN wording ("TELUK AMBON") and it lands here. The
       * canonical Region a person separately chooses ("Kecamatan Teluk Ambon
       * Baguala, Kota Ambon") lands in `regionId`. Two different questions,
       * two different columns in the database, and both correct — but this one
       * was never projected, so the review room could only ever read back the
       * canonical Region. The Owner answered the COLUMN question, was shown the
       * REGION answer under the same word "Wilayah", and could only conclude
       * SIMPROK had swapped one region for another.
       *
       * Nothing about identity changes here. The column label has been an
       * identity axis on the fingerprint (`intakeIdentitySegments`) and on the
       * comparable-sibling lookup since USI-01; this merely stops hiding a fact
       * the batch already stores, so the two answers can be told apart by the
       * person who gave them.
       */
      sourceRegionScopeLabel: batch.sourceRegionScopeLabel ?? null,
      sourceType: batch.sourceType,
      sourceOrigin: batch.sourceOrigin,
      sourceOrganizationName: batch.sourceOrganizationName,
      version: batch.version,
      /**
       * BP-KDN-01 — optional KDN column mapping. NEVER fail-stops a lawful
       * price import. NEEDS_REVIEW means SIMPROK will not guess; the price
       * rows still exist. ESTABLISHED means a CLEAR heading or a human
       * confirmation. ABSENT means the source stated no KDN column.
       */
      kdnMapping: {
        status: batch.kdnMappingStatus ?? 'ABSENT',
        confirmedColumn: batch.interpretationKdnColumn ?? null,
        candidates: Array.isArray(batch.kdnMappingCandidates)
          ? batch.kdnMappingCandidates
          : [],
      },
      /**
       * WHAT THIS BATCH MAY DO NEXT, AND WHY NOT WHEN IT MAY NOT.
       *
       * The review room used to decide this for itself, with a local copy of
       * the preconditions that could answer only yes or no. When it said no it
       * rendered a disabled button — which the browser makes inert, so the
       * Owner's click on `Ajukan Batch (6 siap)` produced no request, no
       * message and no outcome. Nothing was broken downstream; the door simply
       * never opened, and nothing on the page could say why.
       *
       * The answer now comes from the same law the two writers enforce
       * (`basic-price-batch-actions.policy.ts`), so a reason a user reads is a
       * reason the server would actually have given.
       */
      actions: evaluateBatchLifecycleActions({
        status: batch.status,
        effectiveDate: batch.effectiveDate,
        regionId: batch.regionId,
        sourceOrigin: batch.sourceOrigin,
        sourceType: batch.sourceType,
        readyForSubmissionRows,
        // THE WRITER'S OWN INPUTS, so the review gate asks the writer's
        // coherence question rather than a softer one. Without these the gate
        // could say "you may review" about a batch `keepBatchPrivate` would
        // later refuse for a derivation that does not explain its date.
        sourcePeriodLabel: batch.sourcePeriodLabel ?? null,
        sourcePeriodGranularity: batch.sourcePeriodGranularity ?? null,
        effectiveDateProvenance: batch.effectiveDateProvenance ?? null,
        effectiveDateDerivationRule: batch.effectiveDateDerivationRule ?? null,
        // WHAT ONE PRESS WOULD STILL ACHIEVE. Undefined on every path that did
        // not measure it, which is what keeps an unasked question from becoming
        // a verdict about work that may already be done.
        alreadyPrivateRows,
        // BP-REGION-TRUTH-07S — the source's own geographic claim about this
        // batch's scope, and whether a human has reconciled it with the Region
        // above. Read from the stored batch, so the verdict is about PERSISTED
        // truth exactly like every other fact this gate consumes.
        sourceRegionScopeLabel: batch.sourceRegionScopeLabel ?? null,
        sourceRegionScopeGeographicEvidence:
          batch.sourceRegionScopeGeographicEvidence ?? null,
        regionScopeConfirmedRegionId:
          batch.regionScopeConfirmedRegionId ?? null,
      }),
      totalRows: rows.length,
      needsReviewRows: rows.filter((r) => r.status === 'NEEDS_REVIEW').length,
      readyForSubmissionRows,
      rejectedRows: rows.filter((r) => r.status === 'REJECTED').length,
      submittedRows: rows.filter((r) => r.status === 'SUBMISSION_CREATED')
        .length,
      /**
       * INT-CONNECT-01 — how many MUTABLE rows have BOTH required Basic Price
       * identity legs — resource and unit — proven and admissible by the
       * canonical authorities, so the review room can direct attention at what
       * is genuinely left.
       *
       * IT IS NOT A COUNT OF FINISHED ROWS. It says nothing about a canonical
       * price being present, nothing about same-identity collisions inside the
       * batch, and nothing about a row reaching READY_FOR_SUBMISSION — those are
       * decided by `BasicPriceRowResolutionService` AFTER it accepts the pair,
       * from facts no proposal ever sees.
       *
       * COUNTED FROM THE PROPOSALS, NEVER PREDICTED. Absent (0) on every path
       * that did not ask for proposals, which is honest: a caller that never
       * consulted the authorities has no basis to claim a machine proved
       * anything.
       */
      identityPairProvenRows: machineRows,
      /**
       * HOW MANY READY ROWS ARE ALREADY STORED, and null when nobody asked.
       *
       * Null is not zero. A caller that never paid for the count must not be
       * able to read this field as proof that nothing has been saved — that is
       * exactly the inference that produced a save button offering to store
       * thirteen prices which already existed.
       */
      alreadyPrivateRows: alreadyPrivateRows ?? null,
      /**
       * WHICH TEMPORAL QUESTION IS TRUE FOR THIS SOURCE — codes, never prose.
       *
       * One required calendar day does not mean one honest question about it.
       * A market survey was OBSERVED on a day; a regulation STATES the day it
       * begins. The room asks the one that is true here and leaves the other
       * unasked, instead of showing every date field a schema can hold. The
       * browser owns the sentences; this owns only which sentence applies.
       */
      temporal: batchTemporalQuestions({
        sourceType: batch.sourceType,
        ingestionChannel: batch.ingestionChannel ?? null,
      }),
      // Every field a human needs to actually resolve a row (assign
      // resource/unit identity, judge a collision) — not just a status
      // label — since this projection is the only row data the review UI
      // ever receives.
      rows: rows.map((r) => ({
        id: r.id,
        status: r.status,
        resolutionStatus: r.resolutionStatus,
        code: r.rawResourceCodeText ?? null,
        name: r.rawResourceNameText,
        unit: r.rawUnitText ?? null,
        rawPriceDisplayText: r.rawPriceDisplayText ?? null,
        proposedCanonicalPrice: r.proposedCanonicalPrice
          ? r.proposedCanonicalPrice.toString()
          : null,
        proposedCanonicalKdn:
          r.proposedCanonicalKdn === null ||
          r.proposedCanonicalKdn === undefined
            ? null
            : toDecimalString2(r.proposedCanonicalKdn.toString()),
        kdnReasonCode: r.kdnReasonCode ?? null,
        sourceKdnHeaderText: r.sourceKdnHeaderText ?? null,
        section: r.sourceSection,
        // USI-01R — the review UI must be able to show WHO decided a row's
        // resource family, and what the source itself called it.
        sectionProvenance: r.sourceSectionProvenance ?? null,
        sourceCategoryCode: r.rawSourceCategoryCode ?? null,
        sourceCategoryName: r.rawSourceCategoryName ?? null,
        sourceRowNumber: r.sourceRowNumber,
        collisionType: r.collisionType ?? 'NONE',
        collisionOfRowId: r.collisionOfRowId ?? null,
        resourceCatalogId: r.resourceCatalogId ?? null,
        unitDefinitionId: r.unitDefinitionId ?? null,
        reasonCodes: r.reasonCodes ?? [],
        version: r.version ?? 0,
        /**
         * What the canonical authorities proved about THIS row, or null when
         * they were not consulted (every non-review path, and every row that is
         * no longer mutable). Null means "not asked", never "found nothing" —
         * the two are different facts and the UI must not merge them.
         */
        machineProposal: proposals?.get(r.id) ?? null,
        /**
         * IS THIS ROW ALREADY A PRICE THIS WORKSPACE CAN USE?
         *
         * The room had no way to ask. A bound row stays READY_FOR_SUBMISSION
         * forever, so the only sentence available for one was the internal
         * status translated literally — and it read `Siap diajukan`, a curation
         * word, about a row whose price was already sitting in the workspace.
         *
         * FALSE ON EVERY PATH THAT DID NOT ASK, which is honest for a boolean:
         * those paths render no row status a person acts on. The COUNT keeps
         * the stricter null-means-unasked rule, because a count feeds a policy
         * verdict and a flag feeds a label.
         */
        savedAsPrivatePrice: privateRowIds?.has(r.id) ?? false,
      })),
    };
  }

  /**
   * Creates a persisted BasicPriceImportBatch + BasicPriceImportRow set
   * from a workbook (state machine A: (none) -> PREVIEWED, immediately
   * followed by the automatic PREVIEWED -> ... -> NEEDS_REVIEW transition,
   * computed inline rather than left transiently stale — no row can be
   * RESOLVED at parse time, since resolution requires a human-driven
   * ResourceCatalog/UnitDefinition lookup this adapter has no access to).
   * REPLAY_POLICY (§12.1): an exact fingerprint replay returns the
   * existing batch, never duplicate rows.
   */
  async preview(
    workspaceId: string,
    uploadedByAccountId: string,
    file: UploadedSourceFile | undefined,
    metadata: PreviewBasicPriceImportDto,
  ) {
    this.validateFile(file);
    const organizationId = await this.resolveOrganizationId(workspaceId);
    // The browser upload is not a special case — it seals an envelope and walks
    // through the same door every other connector will (§10). USER_UPLOAD is a
    // TRANSPORT fact and says nothing about origin or trust.
    const envelope = sealSourceEnvelope({
      ingestionChannel: 'USER_UPLOAD',
      fileName: file.originalname,
      mediaType: file.mimetype ?? null,
      bytes: file.buffer,
      workspaceId,
      organizationId,
      actorAccountId: uploadedByAccountId,
    });
    return this.intake(envelope, metadata);
  }

  /**
   * THE ONE INTAKE DOOR (§10).
   *
   * Every source that ever becomes a Basic Price candidate passes through here
   * — a human's browser upload today, a supplier agent's push tomorrow — and
   * arrives carrying its own transport provenance. There is no second entry
   * point, and there is deliberately no "create a BasicPrice" counterpart: this
   * method's entire output is a batch of NEEDS_REVIEW candidates awaiting the
   * existing, unchanged human trust lifecycle (LAW 1, tests I1/S3).
   */
  async intake(
    envelope: SourceEnvelope,
    incomingMetadata: PreviewBasicPriceImportDto,
  ) {
    const workspaceId = envelope.workspaceId;
    // THE CALLER'S OWN WORDS, UNTOUCHED.
    //
    // This briefly rewrote the DTO: it derived `sourceType` from
    // `sourceOrigin` and refused any pair that disagreed with the table. Both
    // halves were wrong. Origin and type are independent axes (Owner law,
    // BASIC-PRICE-MASTER-DECISION §10), so deriving one invented a fact about
    // the document, and refusing a stated pair called a real-world combination
    // — a market survey published BY a government agency — impossible.
    // Whatever the human stated is what gets fingerprinted and stored.
    const metadata = incomingMetadata;
    // RM-03D1 — preview WRITES all four provenance columns, and validated none
    // of them. The very first write could therefore mint a claim that explains
    // a different date than the one it stores, with only the DB's structural
    // CHECK behind it. Same authority as every other temporal writer, so no
    // path into the system is exempt.
    assertTemporalProvenanceCoherent({
      sourceOrigin: null,
      sourceType: null,
      effectiveDate: metadata.effectiveDate
        ? new Date(metadata.effectiveDate)
        : null,
      sourcePeriodLabel: metadata.sourcePeriodLabel ?? null,
      sourcePeriodGranularity: metadata.sourcePeriodGranularity ?? null,
      effectiveDateProvenance: metadata.effectiveDateProvenance ?? null,
      effectiveDateDerivationRule: metadata.effectiveDateDerivationRule ?? null,
    });
    const knowledge = await this.parse(envelope, {
      selectedTable: metadata.selectedSheet ?? null,
      selectedStructure: metadata.selectedStructure ?? null,
      selectedRegionLabel: metadata.selectedRegionLabel ?? null,
      declaredSection: metadata.declaredSection ?? null,
      selectedNameColumn: metadata.selectedNameColumn ?? null,
      selectedUnitColumn: metadata.selectedUnitColumn ?? null,
      selectedKdnColumn: metadata.selectedKdnColumn ?? null,
    });
    const organizationId = envelope.organizationId;

    // LAW 2.2 — the bytes are retained BEFORE any domain row exists, so a batch
    // can never claim a source it cannot produce. The path is content-addressed
    // and is never deleted by a losing request, so concurrent identical uploads
    // converge on one copy that both may read (STORE-01/02).
    const sourceStorageRef = await this.sourceArchive.retain({
      workspaceId,
      contentDigestSha256: envelope.contentDigestSha256,
      bytes: envelope.bytes,
    });

    // USI-01R2 §6 — which observation this is, and how it orders. Uniqueness is
    // settled by the database below, not by this read.
    const observation = await this.resolveObservation(envelope);
    const presentOptions = {
      actorAccountId: envelope.actorAccountId,
      envelope,
      knowledge,
      regionId: metadata.regionId ?? null,
    };

    // An observation already on record under this key is either a retry (same
    // bytes -> hand back the winner) or a contradiction (different bytes ->
    // refuse). Checked before the insert as a fast path; the unique index is
    // what makes it correct under concurrency.
    if (observation.observationKey) {
      const winner = await this.settleObservationCollision(
        workspaceId,
        observation.observationKey,
        knowledge.sourceSha256,
      );
      if (winner) {
        const winnerRows = await this.prisma.basicPriceImportRow.findMany({
          where: { batchId: winner.id },
        });
        return this.presentIntake(winner, winnerRows, observation, {
          ...presentOptions,
          exactReplay: true,
        });
      }
    }

    const fingerprint = this.fingerprint(
      workspaceId,
      organizationId,
      knowledge,
      metadata,
      envelope,
    );

    const existing = await this.prisma.basicPriceImportBatch.findUnique({
      where: {
        workspaceId_importFingerprint: {
          workspaceId,
          importFingerprint: fingerprint,
        },
      },
    });
    if (existing) {
      const rows = await this.prisma.basicPriceImportRow.findMany({
        where: { batchId: existing.id },
      });
      return this.presentIntake(existing, rows, observation, {
        ...presentOptions,
        exactReplay: true,
      });
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const batch = await tx.basicPriceImportBatch.create({
            data: {
              workspaceId,
              organizationId,
              uploadedByAccountId: envelope.actorAccountId,
              sourceFileName: knowledge.fileName,
              sourceSha256: knowledge.sourceSha256,
              sourceByteLength: envelope.byteSize,
              selectedSheetName: knowledge.sheetName,
              parserContractVersion: knowledge.parserContractVersion,
              // USI-01 — how the bytes arrived, and how this batch's row
              // locators are spelled. Both are provenance, neither is trust.
              sourceLocatorDialect: knowledge.locatorDialect,
              sourceRegionScopeLabel: knowledge.regionScopeLabel,
              // BP-REGION-TRUTH-07S — HOW the scope was read, and whether the
              // SOURCE called it a place. Both were computed at intake and
              // discarded here; a batch could say which column it read but not
              // whether that column meant a jurisdiction at all. Recorded from
              // the reading itself, never inferred later.
              sourceRegionScopeKind: knowledge.regionScopeKind,
              sourceRegionScopeGeographicEvidence:
                knowledge.regionScopeGeographicEvidence,
              // WHICH INTERPRETATION PRODUCED THESE ROWS. Recorded from the
              // reading itself, so a batch can answer the question later instead
              // of a reader inferring column roles from cell addresses. Null
              // throughout wherever the document decided everything.
              interpretationResourceNameColumn:
                knowledge.interpretation?.resourceNameColumn ?? null,
              interpretationSourceUnitColumn:
                knowledge.interpretation?.sourceUnitColumn ?? null,
              interpretationDeclaredSection:
                knowledge.interpretation?.declaredSection ?? null,
              interpretationKdnColumn:
                knowledge.interpretation?.kdnColumn ?? null,
              kdnMappingStatus:
                knowledge.kdnMapping.status === 'ESTABLISHED'
                  ? 'ESTABLISHED'
                  : knowledge.kdnMapping.status === 'NEEDS_REVIEW'
                    ? 'NEEDS_REVIEW'
                    : 'ABSENT',
              kdnMappingCandidates:
                knowledge.kdnMapping.status === 'NEEDS_REVIEW'
                  ? knowledge.kdnMapping.candidates.map((candidate) => ({
                      columnNumber: candidate.columnNumber,
                      headerText: candidate.headerText,
                      kind: candidate.kind,
                    }))
                  : Prisma.DbNull,
              // Where the original bytes are retained, beside the hash that
              // identifies them.
              sourceStorageRef,
              // USI-01R2 §6A — which OBSERVATION of a source stream this is.
              sourceObservationKey: observation.observationKey,
              ingestionChannel: envelope.ingestionChannel,
              ingestionConnectorId: envelope.connectorId,
              // USI-01R §10 — transmission evidence, kept but never identity.
              ingestionDeliveryId: envelope.deliveryId,
              // ...and the source's own observation identity, which IS.
              ingestionExternalSourceId: envelope.externalSourceId,
              ingestionExternalRecordId: envelope.externalRecordId,
              ingestionExternalVersion: envelope.externalVersion,
              sourceObservedAt: envelope.sourceObservedAt,
              regionId: metadata.regionId ?? null,
              effectiveDate: metadata.effectiveDate
                ? new Date(metadata.effectiveDate)
                : null,
              sourceType: metadata.sourceType ?? null,
              sourceOrigin: metadata.sourceOrigin ?? null,
              sourceOrganizationName: metadata.sourceOrganizationName ?? null,
              sourceVendorName: metadata.sourceVendorName ?? null,
              // RM-03D1 — temporal provenance. Null means unknown, which never
              // reads as "the source stated this date".
              sourcePeriodLabel: metadata.sourcePeriodLabel ?? null,
              sourcePeriodGranularity: metadata.sourcePeriodGranularity ?? null,
              effectiveDateProvenance: metadata.effectiveDateProvenance ?? null,
              effectiveDateDerivationRule:
                metadata.effectiveDateDerivationRule ?? null,
              priceCoverageDeclared: metadata.priceCoverageDeclared ?? false,
              transportIncluded: metadata.transportIncluded ?? null,
              loadingIncluded: metadata.loadingIncluded ?? null,
              unloadingIncluded: metadata.unloadingIncluded ?? null,
              deliveredToProject: metadata.deliveredToProject ?? null,
              importFingerprint: fingerprint,
              // Every row is created NEEDS_REVIEW below (resolution is always
              // a separate human step) — the batch reflects that immediately,
              // consistent with state machine A's automatic transition chain.
              status: 'NEEDS_REVIEW',
            },
          });

          /**
           * ONE WRITE PER CHUNK, NOT ONE PER ROW.
           *
           * THIS LINE USED TO BE `await tx.basicPriceImportRow.create()` INSIDE A
           * LOOP, and the Owner's real Ambon workbook is what proved it wrong:
           * 934 rows meant 934 sequential round-trips inside an interactive
           * transaction whose timeout is 5 seconds, and the upload died on
           * Prisma P2028 — "transaction already closed", 5010 ms elapsed. The
           * batch had already been written when the loop ran out of time, so the
           * whole transaction rolled back and the Owner's browser was answered
           * 500 by a workbook SIMPROK had read perfectly.
           *
           * The defect was never the timeout. A per-row write is an N+1 against
           * the database, and raising the clock would only move the row count at
           * which the same upload fails — while making every failure slower.
           *
           * IDS ARE MINTED HERE, and that is what keeps SOURCE ORDER exact.
           * `createMany` returns a COUNT rather than rows, so the written rows
           * have to be reassembled from something. Minting the ids in source
           * order makes that reassembly proven rather than assumed: the array
           * index IS the source position, and the read-back is keyed by id.
           *
           * AN EARLIER VERSION OF THIS NOTE JUSTIFIED IT BY CLAIMING "there is no
           * unique index on (batchId, sourceRowNumber)". THAT WAS FALSE — the
           * constraint is declared at prisma/schema.prisma, `@@unique([batchId,
           * sourceRowNumber])` on BasicPriceImportRow — and so was the reasoning
           * built on it, that a source "may legitimately state a row number
           * twice": `sourceRowNumber` is the reader's PHYSICAL row number within
           * the one selected table, unique by construction.
           *
           * The IMPLEMENTATION was never wrong and is unchanged. Ordering by a
           * column would still be a second thing to trust where minting needs
           * none, and it would still make source order depend on a constraint
           * rather than on the read itself. Only the stated reason was wrong, and
           * only the stated reason has changed.
           *
           * CHUNKED because PostgreSQL binds at most 65535 parameters per
           * statement, and this table writes ~30 columns per row. At the reader's
           * 20 000-row ceiling a single statement would exceed that limit and
           * fail on the largest sources — the ones this repair exists for.
           */
          const rowIds = knowledge.rows.map(() => randomUUID());
          const rowsToCreate = knowledge.rows.map((row, index) => ({
            id: rowIds[index],
            batchId: batch.id,
            // USI-01R GAP B — a row whose family the source stated, together
            // with WHO decided it and the source's own words either way.
            sourceSection: row.sourceSection,
            sourceSectionProvenance: row.sourceSectionProvenance,
            rawSourceCategoryCode: row.rawSourceCategoryCode,
            rawSourceCategoryName: row.rawSourceCategoryName,
            sourceRowNumber: row.sourceRowNumber,
            sourceCodeCellAddress: row.sourceCodeCellAddress,
            sourceNameCellAddress: row.sourceNameCellAddress,
            sourceUnitCellAddress: row.sourceUnitCellAddress,
            sourcePriceCellAddress: row.sourcePriceCellAddress,
            sourceKdnCellAddress: row.sourceKdnCellAddress,
            sourceKdnHeaderText: row.sourceKdnHeaderText,
            rawResourceCodeText: row.rawResourceCodeText,
            rawResourceNameText: row.rawResourceNameText,
            rawUnitText: row.rawUnitText,
            rawPriceCellType: row.rawPriceCellType,
            rawPriceNumericRoundTripString: row.rawPriceNumericRoundTripString,
            rawPriceTextValue: row.rawPriceTextValue,
            rawPriceFormulaText: row.rawPriceFormulaText,
            rawPriceCachedResultRoundTripString:
              row.rawPriceCachedResultRoundTripString,
            rawPriceFormulaError: row.rawPriceFormulaError,
            rawPriceNumberFormat: row.rawPriceNumberFormat,
            rawPriceDisplayText: row.rawPriceDisplayText,
            // LAW 2 — everything the source said that this domain has no
            // field for, kept verbatim rather than discarded.
            rawSourceContext: row.rawSourceContext ?? Prisma.DbNull,
            proposedCanonicalPrice: row.proposedCanonicalPrice,
            canonicalRoundingMode: row.canonicalRoundingMode,
            proposedCanonicalKdn: row.proposedCanonicalKdn,
            rawKdnTextValue: row.rawKdnTextValue,
            rawKdnNumericRoundTripString: row.rawKdnNumericRoundTripString,
            rawKdnDisplayText: row.rawKdnDisplayText,
            kdnReasonCode: row.kdnReasonCode,
            resolutionStatus: 'UNRESOLVED' as const,
            status: 'NEEDS_REVIEW' as const,
            reasonCodes: [
              ...row.warnings,
              ...row.errors,
              ...(row.kdnReasonCode ? [row.kdnReasonCode] : []),
            ],
          }));

          for (
            let start = 0;
            start < rowsToCreate.length;
            start += IMPORT_ROW_INSERT_CHUNK
          ) {
            await tx.basicPriceImportRow.createMany({
              data: rowsToCreate.slice(start, start + IMPORT_ROW_INSERT_CHUNK),
            });
          }

          // The read-back IS the count check: it proves both that every row this
          // request wrote is on record, and that nothing else is in the batch.
          const persistedRows = await tx.basicPriceImportRow.findMany({
            where: { batchId: batch.id },
          });
          if (persistedRows.length !== rowsToCreate.length)
            throw new ConflictException('IMPORT_ROW_COUNT_MISMATCH');

          const persistedById = new Map(persistedRows.map((r) => [r.id, r]));
          const createdRows: Prisma.BasicPriceImportRowGetPayload<
            Record<string, never>
          >[] = [];
          for (const id of rowIds) {
            const persisted = persistedById.get(id);
            if (!persisted)
              throw new ConflictException('IMPORT_ROW_COUNT_MISMATCH');
            createdRows.push(persisted);
          }

          return this.presentIntake(batch, createdRows, observation, {
            ...presentOptions,
            exactReplay: false,
          });
        },
        {
          // Chunked row insert plus fingerprint work routinely exceeds Prisma's
          // 5s interactive default on a loaded e2e machine. Timeout is not a
          // second intake engine — it is the same write finishing lawfully.
          timeout: 30_000,
          maxWait: 30_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // A concurrent request won the race. WHICH index it won on decides what
        // that means, so the observation key is settled first: under
        // concurrency this is the ONLY place OBS-03 can be detected, because
        // both requests read an empty table before either inserted.
        if (observation.observationKey) {
          // Throws SOURCE_OBSERVATION_CONFLICT if the winner holds different
          // bytes under the same stated observation; returns the winner if the
          // bytes are identical (a retry).
          const observationWinner = await this.settleObservationCollision(
            workspaceId,
            observation.observationKey,
            knowledge.sourceSha256,
          );
          if (observationWinner) {
            const rows = await this.prisma.basicPriceImportRow.findMany({
              where: { batchId: observationWinner.id },
            });
            return this.presentIntake(observationWinner, rows, observation, {
              ...presentOptions,
              exactReplay: true,
            });
          }
        }

        // Otherwise it was the fingerprint index: an identical replay (I04/I05).
        const winner =
          await this.prisma.basicPriceImportBatch.findUniqueOrThrow({
            where: {
              workspaceId_importFingerprint: {
                workspaceId,
                importFingerprint: fingerprint,
              },
            },
          });
        const winnerRows = await this.prisma.basicPriceImportRow.findMany({
          where: { batchId: winner.id },
        });
        return this.presentIntake(winner, winnerRows, observation, {
          ...presentOptions,
          exactReplay: true,
        });
      }
      throw error;
    }
  }

  /**
   * Update batch metadata (region/date/source/coverage) — only while the
   * batch is still mutable (NEEDS_REVIEW/READY_FOR_REVIEW). Optimistic
   * `version` check fails closed on staleness (test matrix I06).
   */
  async updateBatchMetadata(
    workspaceId: string,
    batchId: string,
    dto: UpdateBasicPriceImportBatchDto,
    currentAccountId: string,
    /**
     * Keys the client ACTUALLY sent, from the pre-transform raw body.
     *
     * Provenance corrections must be able to CLEAR an obsolete claim: moving a
     * batch from DERIVED_FROM_SOURCE_PERIOD to SOURCE_STATED requires removing
     * the derivation rule, and moving it to UNKNOWN requires removing both. With
     * `dto.x ?? undefined` an explicit null collapsed into "unchanged", so those
     * transitions were unreachable — the batch could never stop claiming a
     * derivation it no longer had. Omitted for callers that do not need clearing;
     * they keep the previous omitted-means-unchanged behaviour exactly.
     */
    providedKeys?: string[],
  ) {
    const provided = providedKeys ? new Set(providedKeys) : null;
    /** ABSENT = unchanged (undefined) · NULL = clear · VALUE = replace. */
    const patch = <T>(key: keyof UpdateBasicPriceImportBatchDto, value: T) => {
      if (!provided) return value ?? undefined;
      if (!provided.has(key)) return undefined;
      return value === undefined ? undefined : value;
    };
    /**
     * BP-REGION-TRUTH-07U — THE COLLISION IS ANSWERED FROM OUTSIDE THE
     * TRANSACTION IT KILLED.
     *
     * The refusal itself is decided inside, by the unique constraint, exactly as
     * before. Only the read that names the batch which already holds this
     * identity happens here — on the pooled client, after `$transaction` has
     * rolled back and released the connection, which is the first moment
     * PostgreSQL will answer a question at all. One extra read, on the refusal
     * path only; the success path is untouched.
     */
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            workspaceId: string;
            status: string;
            version: number;
            uploadedByAccountId: string;
            effectiveDate: Date | null;
            sourcePeriodLabel: string | null;
            sourcePeriodGranularity: string | null;
            effectiveDateProvenance: string | null;
            effectiveDateDerivationRule: string | null;
            // Read under the SAME lock the write takes, because the source
            // classification is now judged on the MERGED state: a patch that
            // moves only the origin has to be checked against the type already
            // stored, and reading that outside the lock would judge a value
            // another writer could have changed.
            sourceType: string | null;
            sourceOrigin: string | null;
            /**
             * BP-REGION-TRUTH-07S §12 — EVERYTHING THIS BATCH'S IDENTITY IS MADE
             * OF, read under the SAME lock the write takes.
             *
             * `importFingerprint` is recomputed below from the MERGED final state,
             * so every input it consumes has to be the state no concurrent writer
             * can move underneath it. Reading them outside the lock would compute
             * an identity for facts that were true a moment ago.
             *
             * It costs no extra round trip — these columns join a SELECT that was
             * already being issued for the lock itself.
             */
            organizationId: string;
            importFingerprint: string;
            sourceSha256: string;
            selectedSheetName: string;
            parserContractVersion: string;
            regionId: string | null;
            sourceOrganizationName: string | null;
            sourceVendorName: string | null;
            priceCoverageDeclared: boolean;
            transportIncluded: boolean | null;
            loadingIncluded: boolean | null;
            unloadingIncluded: boolean | null;
            deliveredToProject: boolean | null;
            sourceRegionScopeLabel: string | null;
            sourceRegionScopeGeographicEvidence: string | null;
            regionScopeConfirmedRegionId: string | null;
            ingestionChannel: string;
            ingestionConnectorId: string | null;
            ingestionExternalSourceId: string | null;
            ingestionExternalRecordId: string | null;
            ingestionExternalVersion: string | null;
            interpretationResourceNameColumn: number | null;
            interpretationSourceUnitColumn: number | null;
            interpretationDeclaredSection: string | null;
            interpretationKdnColumn: number | null;
          }>
        >(
          Prisma.sql`SELECT "id", "workspaceId", "status", "version", "uploadedByAccountId",
                          "effectiveDate", "sourcePeriodLabel", "sourcePeriodGranularity",
                          "effectiveDateProvenance", "effectiveDateDerivationRule",
                          "sourceType", "sourceOrigin",
                          "organizationId", "importFingerprint", "sourceSha256",
                          "selectedSheetName", "parserContractVersion", "regionId",
                          "sourceOrganizationName", "sourceVendorName",
                          "priceCoverageDeclared", "transportIncluded", "loadingIncluded",
                          "unloadingIncluded", "deliveredToProject",
                          "sourceRegionScopeLabel", "sourceRegionScopeGeographicEvidence",
                          "regionScopeConfirmedRegionId",
                          "ingestionChannel", "ingestionConnectorId",
                          "ingestionExternalSourceId", "ingestionExternalRecordId",
                          "ingestionExternalVersion",
                          "interpretationResourceNameColumn", "interpretationSourceUnitColumn",
                          "interpretationDeclaredSection", "interpretationKdnColumn"
                     FROM "basic_price_import_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`,
        );
        const batch = locked[0];
        if (!batch || batch.workspaceId !== workspaceId)
          throw new NotFoundException('Batch not found');
        assertBatchOwnedByCaller(batch, currentAccountId, 'Batch not found');
        if (batch.version !== dto.version)
          throw new ConflictException('BATCH_VERSION_STALE');
        if (
          batch.status !== 'NEEDS_REVIEW' &&
          batch.status !== 'READY_FOR_REVIEW'
        ) {
          throw new ConflictException('BATCH_NOT_MUTABLE');
        }

        // RM-03D1 — an incomplete DERIVED provenance is refused here with a named
        // error rather than reaching the CHECK constraint as a raw 500. The
        // constraint stays as the last word for any writer that never asks; this
        // just gives the human at the boundary a usable answer. Merged state, not
        // the patch alone: a field the caller omitted keeps its stored value.
        // RM-03D1 — A CHANGED DATE INVALIDATES THE DECISION THAT EXPLAINED THE OLD
        // ONE. A provenance claim belongs to the fact it described: "derived from
        // TA 2024 by PERIOD_START" explains 2024-01-01 and nothing else. Letting a
        // date-only PATCH slide the old claim onto a new date is exactly how a
        // structurally perfect falsehood is born, and SIMPROK must not guess the
        // replacement decision either. So the caller states it, or nothing moves.
        //
        // Unknown stays unknown: if the stored provenance is already NULL there is
        // no decision to invalidate, and a date-only change stays honest.
        const requestedEffectiveDate = provided?.has('effectiveDate')
          ? dto.effectiveDate
            ? new Date(dto.effectiveDate)
            : null
          : undefined;
        const finalEffectiveDate =
          requestedEffectiveDate === undefined
            ? batch.effectiveDate
            : requestedEffectiveDate;
        const dateChanged =
          requestedEffectiveDate !== undefined &&
          (batch.effectiveDate === null) !== (finalEffectiveDate === null)
            ? true
            : requestedEffectiveDate !== undefined &&
                batch.effectiveDate &&
                finalEffectiveDate
              ? !isSameUtcDay(batch.effectiveDate, finalEffectiveDate)
              : false;
        const provenanceDecisionSupplied = Boolean(
          provided?.has('effectiveDateProvenance'),
        );
        if (
          dateChanged &&
          batch.effectiveDateProvenance !== null &&
          !provenanceDecisionSupplied
        ) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: 'TEMPORAL_PROVENANCE_DECISION_REQUIRED',
            storedEffectiveDate: batch.effectiveDate
              ? batch.effectiveDate.toISOString().slice(0, 10)
              : null,
            requestedEffectiveDate: finalEffectiveDate
              ? finalEffectiveDate.toISOString().slice(0, 10)
              : null,
            storedEffectiveDateProvenance: batch.effectiveDateProvenance,
          });
        }

        // Exactly the state the update below will produce: a cleared field is
        // validated as cleared, not as its stale stored value.
        const merged = <T>(
          key: keyof UpdateBasicPriceImportBatchDto,
          next: T | null | undefined,
          stored: T | null,
        ): T | null => {
          const patched = patch(key, next);
          return patched === undefined ? stored : patched;
        };
        assertTemporalProvenanceCoherent({
          sourceOrigin: null,
          sourceType: null,
          effectiveDate: finalEffectiveDate,
          sourcePeriodLabel: merged(
            'sourcePeriodLabel',
            dto.sourcePeriodLabel,
            batch.sourcePeriodLabel,
          ),
          sourcePeriodGranularity: merged(
            'sourcePeriodGranularity',
            dto.sourcePeriodGranularity,
            batch.sourcePeriodGranularity,
          ),
          effectiveDateProvenance: merged(
            'effectiveDateProvenance',
            dto.effectiveDateProvenance,
            batch.effectiveDateProvenance,
          ),
          effectiveDateDerivationRule: merged(
            'effectiveDateDerivationRule',
            dto.effectiveDateDerivationRule,
            batch.effectiveDateDerivationRule,
          ),
        });

        // SOURCE FACTS ARE STORED AS STATED. No derivation, no pair test: the
        // two axes are independent, so there is no combination of stated values
        // for this method to argue with. An UNSTATED fact stays unstated, and the
        // action gates fail closed on it — which is where fail-closed belongs.

        /**
         * BP-REGION-TRUTH-07S §12 — IDENTITY MUST DESCRIBE FINAL FACTS.
         *
         * THE DEFECT THIS CLOSES, IN THE LIFECYCLE THAT ACTUALLY HAPPENS. The
         * import page reads a new file with DELIBERATELY EMPTY context —
         * `handleFileChosen` clears metadata first, so that a second workbook can
         * never inherit the first one's provenance. The batch is therefore minted
         * with `regionId: null`, and `regionId` is a FINGERPRINT input. The Region
         * is chosen afterwards, in a form that only exists once the batch does,
         * and saved through this method — which updated the column and left the
         * fingerprint describing a batch that had no region.
         *
         * WHAT THAT COST A USER. Re-uploading the same workbook to import a
         * SECOND jurisdiction re-previewed with empty context too, recomputed the
         * SAME stale fingerprint, matched the first batch and was handed it back
         * as an exact replay. The second region was unreachable through the
         * product: the file had been imported, so it could never be imported
         * again — for anywhere. The fingerprint existed precisely to keep those
         * two imports apart and was instead the thing collapsing them.
         *
         * WHY RECOMPUTE, AND NOT LOOSEN. Dropping `regionId` from the fingerprint
         * would have made the collapse permanent and lawful. Deferring identity
         * until finalization would rebuild the intake door. Recomputation reuses
         * the ONE existing engine over facts this batch already stores — no byte
         * of the source is re-read, and nothing here hashes anything of its own.
         *
         * MERGED STATE, MATCHED TO THE WRITE BELOW rather than to the validation
         * above: the identity must describe what is actually stored, so each value
         * is computed with the same omitted-means-unchanged rule its column uses.
         */
        const finalRegionId = dto.regionId ?? batch.regionId;
        const finalMetadata: FingerprintMetadata = {
          regionId: finalRegionId,
          effectiveDate: dto.effectiveDate
            ? new Date(dto.effectiveDate)
            : batch.effectiveDate,
          sourceType: dto.sourceType ?? batch.sourceType,
          sourceOrigin: dto.sourceOrigin ?? batch.sourceOrigin,
          sourceOrganizationName:
            dto.sourceOrganizationName ?? batch.sourceOrganizationName,
          sourceVendorName: dto.sourceVendorName ?? batch.sourceVendorName,
          sourcePeriodLabel: merged(
            'sourcePeriodLabel',
            dto.sourcePeriodLabel,
            batch.sourcePeriodLabel,
          ),
          sourcePeriodGranularity: merged(
            'sourcePeriodGranularity',
            dto.sourcePeriodGranularity,
            batch.sourcePeriodGranularity,
          ),
          effectiveDateProvenance: merged(
            'effectiveDateProvenance',
            dto.effectiveDateProvenance,
            batch.effectiveDateProvenance,
          ),
          effectiveDateDerivationRule: merged(
            'effectiveDateDerivationRule',
            dto.effectiveDateDerivationRule,
            batch.effectiveDateDerivationRule,
          ),
          priceCoverageDeclared:
            dto.priceCoverageDeclared ?? batch.priceCoverageDeclared,
          transportIncluded: dto.transportIncluded ?? batch.transportIncluded,
          loadingIncluded: dto.loadingIncluded ?? batch.loadingIncluded,
          unloadingIncluded: dto.unloadingIncluded ?? batch.unloadingIncluded,
          deliveredToProject:
            dto.deliveredToProject ?? batch.deliveredToProject,
        };
        const finalFingerprint = fingerprintOf({
          workspaceId,
          organizationId: batch.organizationId,
          sourceSha256: batch.sourceSha256,
          sheetName: batch.selectedSheetName,
          parserContractVersion: batch.parserContractVersion,
          metadata: finalMetadata,
          // The reading is over; these are the facts it left behind. See
          // `intakeIdentitySegmentsOf` for why the stored columns are exactly
          // equivalent to the reading that wrote them.
          intakeSegments: intakeIdentitySegmentsOf({
            regionScopeLabel: batch.sourceRegionScopeLabel,
            ingestionChannel: batch.ingestionChannel,
            connectorId: batch.ingestionConnectorId,
            externalSourceId: batch.ingestionExternalSourceId,
            externalRecordId: batch.ingestionExternalRecordId,
            externalVersion: batch.ingestionExternalVersion,
            interpretationResourceNameColumn:
              batch.interpretationResourceNameColumn,
            interpretationSourceUnitColumn:
              batch.interpretationSourceUnitColumn,
            interpretationDeclaredSection: batch.interpretationDeclaredSection,
            interpretationKdnColumn: batch.interpretationKdnColumn,
          }),
        });

        /**
         * BP-REGION-TRUTH-07S §8 — THE CONFIRMATION, RECORDED AS THE REGION IT
         * WAS GIVEN ABOUT.
         *
         * A CHANGED REGION REOPENS THE QUESTION BY CONSTRUCTION, and not by a
         * rule written here: the stored value is compared against the batch's
         * current region by `regionScopeCompatibilityUnproven`, so moving the
         * region simply stops matching. This is the same shape as the temporal
         * provenance law above — a decision belongs to the fact it explained, and
         * sliding it onto a new fact is how a structurally perfect falsehood is
         * born.
         *
         * Only an explicit `false` withdraws one. An omitted field is silent.
         */
        const confirmedRegionId =
          dto.confirmRegionScopeCompatibility === undefined
            ? undefined
            : dto.confirmRegionScopeCompatibility
              ? finalRegionId
              : null;

        /**
         * A THUNK, NOT AN INLINE AWAIT — so the write can be attempted inside a
         * `try` without the argument literal leaving this call site. Hoisting the
         * arguments into a variable instead would cost Prisma's `include`
         * inference, and the region this method answers with would silently
         * degrade to `unknown`.
         */
        const writeBatch = () =>
          tx.basicPriceImportBatch.update({
            where: { id: batchId },
            // THE REGION ITSELF, ON THE WAY BACK OUT OF THE SAVE.
            //
            // `savedMetadataLines` — the "Tercatat di SIMPROK" block that makes
            // metadata persistence provable through the product — is documented to
            // read the SERVER's answer and never the form's own state. For every
            // other field it can. For the region it could not: `regionId` alone is
            // a UUID no room may print at a person, so the line degraded to
            // "sudah dipilih" until the next reload. The read path already shapes
            // the region exactly this way; the save now answers with the same
            // fact, so what a person is told they saved is a PLACE.
            include: {
              region: { select: { id: true, code: true, name: true } },
            },
            data: {
              regionId: dto.regionId ?? undefined,
              effectiveDate: dto.effectiveDate
                ? new Date(dto.effectiveDate)
                : undefined,
              /**
               * SOFT RE-VERIFICATION, under the SAME omitted-means-unchanged rule
               * as every other field here — `patch` is what lets a person CLEAR it
               * by sending an explicit null, which matters because "I no longer
               * think this needs re-checking" is a real decision, and a field that
               * can only ever be set would silently make the first guess permanent.
               *
               * Nothing derives this. An absent value stays absent.
               */
              reviewDate: patch(
                'reviewDate',
                dto.reviewDate ? new Date(dto.reviewDate) : dto.reviewDate,
              ),
              sourceType: dto.sourceType ?? undefined,
              sourceOrigin: dto.sourceOrigin ?? undefined,
              sourceOrganizationName: dto.sourceOrganizationName ?? undefined,
              sourceVendorName: dto.sourceVendorName ?? undefined,
              // RM-03D1 — temporal provenance, under the same
              // omitted-means-unchanged rule as every other field here.
              sourcePeriodLabel: patch(
                'sourcePeriodLabel',
                dto.sourcePeriodLabel,
              ),
              sourcePeriodGranularity: patch(
                'sourcePeriodGranularity',
                dto.sourcePeriodGranularity,
              ),
              effectiveDateProvenance: patch(
                'effectiveDateProvenance',
                dto.effectiveDateProvenance,
              ),
              effectiveDateDerivationRule: patch(
                'effectiveDateDerivationRule',
                dto.effectiveDateDerivationRule,
              ),
              priceCoverageDeclared: dto.priceCoverageDeclared ?? undefined,
              transportIncluded: dto.transportIncluded ?? undefined,
              loadingIncluded: dto.loadingIncluded ?? undefined,
              unloadingIncluded: dto.unloadingIncluded ?? undefined,
              deliveredToProject: dto.deliveredToProject ?? undefined,
              regionScopeConfirmedRegionId: confirmedRegionId,
              /**
               * WRITTEN ONLY WHEN IT ACTUALLY MOVED. An unchanged batch keeps the
               * exact string it has always had, so a metadata save that touches no
               * identity-bearing fact cannot perturb identity — and the collision
               * path below stays reserved for the case that genuinely means
               * something.
               */
              importFingerprint:
                finalFingerprint === batch.importFingerprint
                  ? undefined
                  : finalFingerprint,
              version: { increment: 1 },
            },
          });

        /**
         * BP-REGION-TRUTH-07S §13 — TWO BATCHES MAY NOT FINALIZE INTO ONE
         * IDENTITY, AND THE DATABASE IS WHAT SAYS SO.
         *
         * Once identity is recomputed on finalization, two separately previewed
         * batches of the same file CAN converge: preview mints each with an empty
         * context, and naming the same Region and date for both makes them, at
         * that moment, the same import truth. `workspaceId_importFingerprint` is
         * unique precisely to forbid that, so the second save loses by
         * construction rather than by a check that could be raced past.
         *
         * REFUSED, NOT MERGED, NOT RETRIED. Folding the loser into the winner
         * would discard whichever row decisions the user had made in it; retrying
         * would loop against a constraint that is stating a fact. The transaction
         * rolls back, so the batch keeps its version, its metadata and its rows
         * exactly as they were — and the person is told which batch already holds
         * this identity. One statement, one verdict, no backoff.
         */
        let updated: Awaited<ReturnType<typeof writeBatch>>;
        try {
          updated = await writeBatch();
        } catch (error) {
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== 'P2002'
          ) {
            throw error;
          }
          /**
           * BP-REGION-TRUTH-07U — NOTHING MORE IS ASKED OF THIS CONNECTION.
           *
           * The write above has already aborted the transaction server-side, so
           * the read that names the winning batch cannot be issued here. It is
           * issued by the handler below, once the rollback has actually happened.
           */
          throw new BatchIdentityCollision(finalFingerprint);
        }
        const rows = await tx.basicPriceImportRow.findMany({
          where: { batchId },
        });
        return {
          ...this.summarize(updated, rows),
          region: updated.region ?? null,
        };
      });
    } catch (error) {
      if (!(error instanceof BatchIdentityCollision)) throw error;
      /**
       * REFUSED, NOT MERGED, NOT RETRIED — and now also NOT GUESSED AT. The
       * failed transaction has ended, so this read runs on a healthy
       * connection and can actually answer WHICH batch the person already has.
       * If it cannot be found, the answer is an honest null rather than a
       * second attempt.
       */
      const owner = await this.prisma.basicPriceImportBatch.findUnique({
        where: {
          workspaceId_importFingerprint: {
            workspaceId,
            importFingerprint: error.importFingerprint,
          },
        },
        select: { id: true },
      });
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'BATCH_IDENTITY_ALREADY_EXISTS',
        existingBatchId: owner?.id ?? null,
      });
    }
  }

  async getBatch(
    workspaceId: string,
    batchId: string,
    currentAccountId: string,
  ) {
    const batch = await this.prisma.basicPriceImportBatch.findUnique({
      where: { id: batchId },
      // The region ITSELF. `regionId` alone is a UUID: a person reopening a
      // batch to check what they saved cannot read it, and this room may not
      // print it at them either. Shaped exactly like every other region
      // projection so a caller renders it with the words it already uses,
      // rather than reassembling a half-region of its own.
      //
      // The metadata SAVE answers with the same field, for the reason stated
      // there. The two paths a person actually watches a region through — save
      // it, then reload and check — therefore say the same thing in the same
      // shape, instead of one of them going quiet.
      include: { region: { select: { id: true, code: true, name: true } } },
    });
    if (!batch || batch.workspaceId !== workspaceId)
      throw new NotFoundException('Batch not found');
    assertBatchOwnedByCaller(batch, currentAccountId, 'Batch not found');
    const rows = await this.prisma.basicPriceImportRow.findMany({
      where: { batchId },
      orderBy: { sourceRowNumber: 'asc' },
    });

    // INT-CONNECT-01 — THE REVIEW ROOM ASKS BEFORE IT ASKS THE HUMAN.
    //
    // Every fact below is computed here and NOTHING is written: the row keeps
    // its own state machine, its own version, and its own human-decided
    // identity. What changes is only that the reviewer now arrives at a screen
    // where SIMPROK has already said what it can prove and why — instead of two
    // empty search boxes over engines that were never consulted.
    //
    // Bounded on purpose: `proposeForRows` batches its database work, so this
    // read carries no row-linear N+1. It is NOT a constant — the work is bounded
    // by the distinct evidence a batch contains (governed contexts, unit
    // spellings, proposed identities), never by how many rows there are. See
    // that method's own note for the exact bound.
    //
    // Only mutable rows are asked about. A rejected or already-submitted row has
    // nothing left to decide, and proposing an identity for it would be advice
    // nobody can act on.
    const proposals = await this.proposals.proposeForRows(
      workspaceId,
      rows
        .filter((row) => row.status === 'NEEDS_REVIEW')
        .map((row) => ({
          id: row.id,
          sourceSection: row.sourceSection,
          rawResourceNameText: row.rawResourceNameText,
          rawResourceCodeText: row.rawResourceCodeText,
          rawUnitText: row.rawUnitText,
        })),
    );

    /**
     * WHICH ROWS ARE ALREADY STORED — and therefore how many.
     *
     * ASKED ONLY HERE, because only this room renders the states that depend on
     * it. The review page used to be told 13 rows were ready and nothing else,
     * so it offered to save thirteen prices that already existed, and labelled
     * each of those rows `Siap diajukan` — an internal row status translated
     * into a curation word, for rows whose price was already in the workspace.
     *
     * PER ROW, NOT A SCALAR, and that is the only thing that changed here. A
     * count can correct a button; it cannot tell one ROW from another, and the
     * row is where the sentence a person reads actually lives. `BasicPrice
     * .sourceImportRowId` is `@unique`, so the id list and the old `count()`
     * are provably the same number — `alreadyPrivateRows` keeps its exact
     * meaning, from the same tenant-scoped query shape, in one round trip.
     */
    const privatePriceRows = await this.prisma.basicPrice.findMany({
      where: { workspaceId, sourceImportRow: { batchId } },
      select: { sourceImportRowId: true },
    });
    const privateRowIds = new Set(
      privatePriceRows
        .map((price) => price.sourceImportRowId)
        .filter((rowId): rowId is string => rowId !== null),
    );

    return {
      ...this.summarize(batch, rows, proposals, privateRowIds),
      region: batch.region ?? null,
    };
  }

  /**
   * PROPOSE THIS BATCH TO SIMPROK'S CURATION (state machine A:
   * READY_FOR_REVIEW -> APPROVED_FOR_SUBMISSION -> SUBMITTED /
   * PARTIALLY_SUBMITTED).
   *
   * TERMINAL, AND THAT IS WHY IT KEEPS THE STRICT GATE. It freezes the batch,
   * so it legitimately requires every row to have been decided first — which
   * is exactly what READY_FOR_REVIEW means. Its sibling `keepBatchPrivate` is
   * incremental and deliberately does NOT require that; the two are not
   * exclusive and a batch may do both.
   *
   * WHAT IT IS NOT. It is not "save my prices". It creates no BasicPrice at
   * all: one PriceSubmission plus its review per ready row, for a human
   * curator to judge. A user whose prices must simply become usable wants
   * `keepBatchPrivate`, and the review room now offers that as the primary
   * action rather than presenting this one as the only way out.
   *
   * PRECONDITIONS ARE NOT STATED HERE ANY MORE. They live in
   * `basic-price-batch-actions.policy.ts` alongside the private path's, so the
   * room that decides whether to OFFER this action reads the same law this
   * method enforces — including that sourceOrigin must be set (PriceSubmission
   * .sourceOrigin has no schema default and is never fabricated) and that the
   * (origin, type) pair must be coherent.
   *
   * Idempotent: already-submitted batches return their existing state, never
   * re-process.
   */
  async submitBatch(
    workspaceId: string,
    batchId: string,
    currentAccountId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          organizationId: string;
          status: string;
          effectiveDate: Date | null;
          regionId: string | null;
          sourceType: string | null;
          sourceOrigin: string | null;
          uploadedByAccountId: string;
          sourceOrganizationName: string | null;
          // `SELECT *` has always returned these; only the declared shape
          // omitted them, which is why the idempotent return below had to cast
          // itself away. Declared now, so the projection is type-checked here
          // exactly as it is on every other path.
          importFingerprint: string;
          version: number;
          sourceRegionScopeLabel: string | null;
          sourceRegionScopeGeographicEvidence: string | null;
          regionScopeConfirmedRegionId: string | null;
        }>
      >(
        Prisma.sql`SELECT * FROM "basic_price_import_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`,
      );
      const batch = locked[0];
      if (!batch || batch.workspaceId !== workspaceId)
        throw new NotFoundException('Batch not found');
      assertBatchOwnedByCaller(batch, currentAccountId, 'Batch not found');

      if (
        [
          'APPROVED_FOR_SUBMISSION',
          'PARTIALLY_SUBMITTED',
          'SUBMITTED',
        ].includes(batch.status)
      ) {
        const rows = await tx.basicPriceImportRow.findMany({
          where: { batchId },
        });
        return this.summarize(batch, rows);
      }
      const readyRows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "basic_price_import_rows" WHERE "batchId" = ${batchId}::uuid AND "status" = 'READY_FOR_SUBMISSION' FOR UPDATE`,
      );

      // ONE STATEMENT OF THE PRECONDITIONS, read by this writer and by the
      // review room that decides whether to offer the action at all. They used
      // to be stated twice — here as throws, and again in the frontend's own
      // `canSubmitBatch`, which could answer only yes/no and therefore rendered
      // a silent dead button when it said no. Same checks, same order, same
      // codes; the difference is that the reason now reaches a person.
      //
      // SOURCE CLASSIFICATION IS PART OF THE GATE NOW. This method used to
      // write `sourceType: batch.sourceType ?? 'MARKET_SURVEY'` a few lines
      // below — the exact falsehood RM-03D1 removed from the private writer: a
      // government price list recorded as a market survey. There is no fallback
      // any more, and an incoherent (origin, type) pair is refused by the one
      // origin-to-type authority rather than silently stored.
      const blocked = proposalBlockReason({
        status: batch.status,
        effectiveDate: batch.effectiveDate,
        regionId: batch.regionId,
        sourceOrigin: batch.sourceOrigin,
        sourceType: batch.sourceType,
        readyForSubmissionRows: readyRows.length,
        // SAME THREE FACTS THE REVIEW GATE READS. SELECT * already loaded
        // them; omitting them here made submit accept an unconfirmed
        // geography the door had already refused.
        sourceRegionScopeLabel: batch.sourceRegionScopeLabel ?? null,
        sourceRegionScopeGeographicEvidence:
          batch.sourceRegionScopeGeographicEvidence ?? null,
        regionScopeConfirmedRegionId:
          batch.regionScopeConfirmedRegionId ?? null,
      });
      if (blocked) {
        throw new ConflictException(blocked);
      }

      await tx.basicPriceImportBatch.update({
        where: { id: batchId },
        data: { status: 'APPROVED_FOR_SUBMISSION' },
      });

      for (const { id: rowId } of readyRows) {
        const row = await tx.basicPriceImportRow.findUniqueOrThrow({
          where: { id: rowId },
        });
        if (!row.resourceCatalogId || !row.proposedCanonicalPrice)
          throw new ConflictException('ROW_NOT_RESOLVED');

        const submission = await tx.priceSubmission.create({
          data: {
            workspaceId: batch.workspaceId,
            organizationId: batch.organizationId,
            resourceId: row.resourceCatalogId,
            regionId: batch.regionId,
            reportedByAccountId: batch.uploadedByAccountId,
            // Both halves cast from the raw-SQL read's `string` to the enum the
            // column actually holds. No fallback on either: the gate above
            // already refused an absent or incoherent classification, so this
            // is the batch's stated truth or the submission never happened.
            sourceOrigin: batch.sourceOrigin as PriceSourceOrigin,
            sourceType: batch.sourceType as PriceSourceType,
            status: 'SUBMITTED',
          },
        });

        const revision = await tx.priceSubmissionRevision.create({
          data: {
            submissionId: submission.id,
            revisionNumber: 1,
            value: new Prisma.Decimal(row.proposedCanonicalPrice),
            effectiveDate: row.effectiveDateOverride ?? batch.effectiveDate,
            validationPassed: true,
          },
        });

        await tx.priceSubmission.update({
          where: { id: submission.id },
          data: { currentRevisionId: revision.id },
        });

        await tx.priceSubmissionAudit.create({
          data: {
            submissionId: submission.id,
            fromStatus: null,
            toStatus: 'SUBMITTED',
            actorType: 'SYSTEM',
            actorAccountId: null,
            reason: `RM02_IMPORT_SUBMISSION; batchId:${batch.id}; rowId:${row.id}`,
          },
        });

        // RM-02D2A-1 Work Package A: create the PriceSubmissionReview in the
        // SAME transaction, via the one canonical helper. If review creation
        // fails, this whole batch-submission transaction rolls back — no
        // PriceSubmission is ever left orphaned without a review.
        await this.reviewService.createReviewWithinTransaction(tx, {
          id: submission.id,
          workspaceId: batch.workspaceId,
          organizationId: batch.organizationId,
        });

        await tx.basicPriceImportRow.update({
          where: { id: row.id },
          data: {
            priceSubmissionId: submission.id,
            status: 'SUBMISSION_CREATED',
          },
        });
      }

      const rejectedCount = await tx.basicPriceImportRow.count({
        where: { batchId, status: 'REJECTED' },
      });
      const finalStatus =
        rejectedCount > 0 ? 'PARTIALLY_SUBMITTED' : 'SUBMITTED';
      const finalBatch = await tx.basicPriceImportBatch.update({
        where: { id: batchId },
        data: { status: finalStatus, reviewedAt: new Date() },
      });

      const finalRows = await tx.basicPriceImportRow.findMany({
        where: { batchId },
      });
      const finalSubmittedCount = finalRows.filter(
        (r) => r.status === 'SUBMISSION_CREATED',
      ).length;
      if (finalSubmittedCount !== readyRows.length)
        throw new ConflictException('ROW_SUBMISSION_COUNT_MISMATCH');

      return this.summarize(finalBatch, finalRows);
    });
  }
}

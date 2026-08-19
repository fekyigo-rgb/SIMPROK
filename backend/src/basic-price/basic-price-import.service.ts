import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BasicPriceImportKnowledgeObject,
  BasicPriceIntakeSelection,
  BasicPriceUniversalIntakeAdapter,
} from './basic-price-universal-intake.adapter';
import { INTAKE_ERRORS, IntakeError } from '../universal-intake/intake-errors';
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
import {
  assertTemporalProvenanceCoherent,
  isSameUtcDay,
} from './basic-price-private-asset.service';

export const MAX_UPLOAD_BYTES = MAX_ENVELOPE_BYTES;
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
function intakeIdentitySegments(
  knowledge: BasicPriceImportKnowledgeObject,
  envelope: SourceEnvelope,
): string[] {
  const segments: string[] = [];
  if (knowledge.regionScopeLabel !== null)
    segments.push(`regionScopeLabel:${knowledge.regionScopeLabel}`);
  if (envelope.ingestionChannel !== 'USER_UPLOAD')
    segments.push(`ingestionChannel:${envelope.ingestionChannel}`);
  if (envelope.connectorId !== null)
    segments.push(`ingestionConnectorId:${envelope.connectorId}`);

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
  if (envelope.externalSourceId !== null)
    segments.push(`externalSourceId:${envelope.externalSourceId}`);
  if (envelope.externalRecordId !== null)
    segments.push(`externalRecordId:${envelope.externalRecordId}`);
  if (envelope.externalVersion !== null)
    segments.push(`externalVersion:${envelope.externalVersion}`);
  return segments;
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
  ) {}

  private validateFile(
    file: UploadedSourceFile | undefined,
  ): asserts file is UploadedSourceFile {
    if (!file?.buffer) throw new BadRequestException('A source file is required');
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
    const metadataPart = FINGERPRINT_METADATA_KEYS.map(
      (key) => `${key}:${(metadata as Record<string, unknown>)[key] ?? ''}`,
    ).join('|');
    return createHash('sha256')
      .update(
        [
          workspaceId,
          organizationId,
          knowledge.sourceSha256,
          knowledge.sheetName,
          // The knowledge object's OWN contract, not a module constant: each
          // structure has its own parser contract, and two structures read out
          // of one file are two different readings of it.
          knowledge.parserContractVersion,
          metadataPart,
          ...intakeIdentitySegments(knowledge, envelope),
        ].join('|'),
      )
      .digest('hex')
      .toUpperCase();
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
  private async resolveObservation(
    envelope: SourceEnvelope,
  ): Promise<{
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
        workspaceId_sourceObservationKey: { workspaceId, sourceObservationKey: observationKey },
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
      regionId: string | null;
      version: number;
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
  ) {
    return {
      batchId: batch.id,
      status: batch.status,
      importFingerprint: batch.importFingerprint,
      effectiveDate: batch.effectiveDate,
      regionId: batch.regionId,
      version: batch.version,
      totalRows: rows.length,
      needsReviewRows: rows.filter((r) => r.status === 'NEEDS_REVIEW').length,
      readyForSubmissionRows: rows.filter(
        (r) => r.status === 'READY_FOR_SUBMISSION',
      ).length,
      rejectedRows: rows.filter((r) => r.status === 'REJECTED').length,
      submittedRows: rows.filter((r) => r.status === 'SUBMISSION_CREATED')
        .length,
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
  async intake(envelope: SourceEnvelope, metadata: PreviewBasicPriceImportDto) {
    const workspaceId = envelope.workspaceId;
    // RM-03D1 — preview WRITES all four provenance columns, and validated none
    // of them. The very first write could therefore mint a claim that explains
    // a different date than the one it stores, with only the DB's structural
    // CHECK behind it. Same authority as every other temporal writer, so no
    // path into the system is exempt.
    assertTemporalProvenanceCoherent({
      sourceOrigin: null,
      sourceType: null,
      effectiveDate: metadata.effectiveDate ? new Date(metadata.effectiveDate) : null,
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
        return { ...this.summarize(winner, winnerRows), ...this.observationVerdict(observation) };
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
      return { ...this.summarize(existing, rows), ...this.observationVerdict(observation) };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
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

        const createdRows: Prisma.BasicPriceImportRowGetPayload<
          Record<string, never>
        >[] = [];
        for (const row of knowledge.rows) {
          const created = await tx.basicPriceImportRow.create({
            data: {
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
              rawResourceCodeText: row.rawResourceCodeText,
              rawResourceNameText: row.rawResourceNameText,
              rawUnitText: row.rawUnitText,
              rawPriceCellType: row.rawPriceCellType,
              rawPriceNumericRoundTripString:
                row.rawPriceNumericRoundTripString,
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
              resolutionStatus: 'UNRESOLVED',
              status: 'NEEDS_REVIEW',
              reasonCodes: [...row.warnings, ...row.errors],
            },
          });
          createdRows.push(created);
        }

        const finalItemCount = await tx.basicPriceImportRow.count({
          where: { batchId: batch.id },
        });
        if (finalItemCount !== createdRows.length)
          throw new ConflictException('IMPORT_ROW_COUNT_MISMATCH');

        return { ...this.summarize(batch, createdRows), ...this.observationVerdict(observation) };
      });
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
            return {
              ...this.summarize(observationWinner, rows),
              ...this.observationVerdict(observation),
            };
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
        return {
          ...this.summarize(winner, winnerRows),
          ...this.observationVerdict(observation),
        };
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
      if (!provided.has(key as string)) return undefined;
      return value === undefined ? undefined : value;
    };
    return this.prisma.$transaction(async (tx) => {
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
        }>
      >(
        Prisma.sql`SELECT "id", "workspaceId", "status", "version", "uploadedByAccountId",
                          "effectiveDate", "sourcePeriodLabel", "sourcePeriodGranularity",
                          "effectiveDateProvenance", "effectiveDateDerivationRule"
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
        return patched === undefined ? stored : (patched as T | null);
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
        ) as any,
        effectiveDateProvenance: merged(
          'effectiveDateProvenance',
          dto.effectiveDateProvenance,
          batch.effectiveDateProvenance,
        ) as any,
        effectiveDateDerivationRule: merged(
          'effectiveDateDerivationRule',
          dto.effectiveDateDerivationRule,
          batch.effectiveDateDerivationRule,
        ),
      });

      const updated = await tx.basicPriceImportBatch.update({
        where: { id: batchId },
        data: {
          regionId: dto.regionId ?? undefined,
          effectiveDate: dto.effectiveDate
            ? new Date(dto.effectiveDate)
            : undefined,
          sourceType: dto.sourceType ?? undefined,
          sourceOrigin: dto.sourceOrigin ?? undefined,
          sourceOrganizationName: dto.sourceOrganizationName ?? undefined,
          sourceVendorName: dto.sourceVendorName ?? undefined,
          // RM-03D1 — temporal provenance, under the same
          // omitted-means-unchanged rule as every other field here.
          sourcePeriodLabel: patch('sourcePeriodLabel', dto.sourcePeriodLabel),
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
          version: { increment: 1 },
        },
      });
      const rows = await tx.basicPriceImportRow.findMany({
        where: { batchId },
      });
      return this.summarize(updated, rows);
    });
  }

  async getBatch(
    workspaceId: string,
    batchId: string,
    currentAccountId: string,
  ) {
    const batch = await this.prisma.basicPriceImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch || batch.workspaceId !== workspaceId)
      throw new NotFoundException('Batch not found');
    assertBatchOwnedByCaller(batch, currentAccountId, 'Batch not found');
    const rows = await this.prisma.basicPriceImportRow.findMany({
      where: { batchId },
      orderBy: { sourceRowNumber: 'asc' },
    });
    return this.summarize(batch, rows);
  }

  /**
   * Batch approval (state machine A: READY_FOR_REVIEW -> APPROVED_FOR_SUBMISSION
   * -> SUBMITTED/PARTIALLY_SUBMITTED). Preconditions: effectiveDate and
   * regionId set (schema contract §12.2), plus sourceOrigin set — a
   * structural necessity this design's precondition list did not spell
   * out: PriceSubmission.sourceOrigin has no schema default and is never
   * fabricated. Idempotent: already-submitted batches return their
   * existing state, never re-process.
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
        return this.summarize(batch as any, rows);
      }
      if (batch.status !== 'READY_FOR_REVIEW')
        throw new ConflictException('BATCH_NOT_READY_FOR_REVIEW');
      if (!batch.effectiveDate)
        throw new ConflictException(
          'EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION',
        );
      if (!batch.regionId)
        throw new ConflictException('REGION_REQUIRED_BEFORE_SUBMISSION');
      if (!batch.sourceOrigin)
        throw new ConflictException('SOURCE_ORIGIN_REQUIRED_BEFORE_SUBMISSION');

      const readyRows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "basic_price_import_rows" WHERE "batchId" = ${batchId}::uuid AND "status" = 'READY_FOR_SUBMISSION' FOR UPDATE`,
      );
      if (readyRows.length === 0)
        throw new ConflictException('NO_ROWS_READY_FOR_SUBMISSION');

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
            sourceOrigin: batch.sourceOrigin as any,
            sourceType: (batch.sourceType as any) ?? 'MARKET_SURVEY',
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

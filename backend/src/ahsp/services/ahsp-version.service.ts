import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspVersionStatus, Prisma } from '@prisma/client';
import { UnitKernelService } from '../../unit-kernel/unit-kernel.service';

/**
 * ACG-01 CLOSURE 1 — the source facts a resource line was born from.
 *
 * Every field is optional and every one means "the source stated this". A
 * hand-built recipe supplies none of them and is unchanged; a document import
 * supplies exactly what its parser read and nothing more. Nothing here is ever
 * derived from another field.
 */
export interface AhspResourceSourceProvenance {
  rawName?: string | null;
  rawCode?: string | null;
  rawUnit?: string | null;
  sourceSha256?: string | null;
  sourceFileName?: string | null;
  parserContractVersion?: string | null;
  sheetName?: string | null;
  sourceRowNumber?: number | null;
  sourceNameCellAddress?: string | null;
  sourceCodeCellAddress?: string | null;
  sourceUnitCellAddress?: string | null;
}

/**
 * WHAT A REQUEST MAY SAY ABOUT A LINE — AND WHAT IT MAY NOT.
 *
 * Deliberately NOT extending `AhspResourceSourceProvenance`. The version route
 * spreads the request body, so anything declared here is something a client can
 * assert. Where a line was READ FROM is not a client's to assert: it is either
 * recorded by the trusted import pipeline, in one piece, or carried forward by
 * the server from the line being revised — never composed field by field from a
 * body, and never half from one origin and half from another.
 *
 * `carriedFromResourceLineId` is the one provenance-adjacent value a request may
 * send, and it is not a claim: it is a REFERENCE to an existing AHSPResource
 * row, resolved by the server against the version being revised. A forged id
 * resolves to nothing and is refused; it can never invent an origin.
 */
export interface CreateAhspResourceInput {
  resourceId: string;
  resourceType: string;
  coefficient: number;
  baseUnit: string;
  conversionFactor?: unknown;
  /**
   * The line in the base version this line continues — the server's own row
   * identity. NOT the catalogue id, which identifies a RESOURCE and says
   * nothing about which occurrence of it a recipe means.
   */
  carriedFromResourceLineId?: string;
}

export interface CreateAhspVersionDto {
  workspaceId?: string;
  resources: CreateAhspResourceInput[];
  outputUnit: string;
  userId: string;
  regulationReference?: string;
  effectiveDate?: Date;
  /**
   * The version the author was editing. A revision saved from an OLDER version
   * must continue THAT version's lines rather than quietly borrow the newest
   * one's, so the base is stated instead of assumed. Absent means the current
   * latest — what an editor that opened the current recipe is looking at.
   */
  basedOnVersionId?: string;
}

/**
 * Source facts recorded by a TRUSTED in-process pipeline, positionally aligned
 * with `resources`. A separate argument and deliberately not part of the DTO,
 * precisely so an HTTP body cannot reach it: the controller builds the DTO from
 * the request and never passes this.
 */
export interface TrustedAhspSourceFacts {
  readonly sourceFacts: ReadonlyArray<AhspResourceSourceProvenance | null>;
}

/** A line whose origin cannot be established coherently keeps honest nulls. */
const NO_SOURCE_FACTS: AhspResourceSourceProvenance = {
  rawName: null,
  rawCode: null,
  rawUnit: null,
  sourceSha256: null,
  sourceFileName: null,
  parserContractVersion: null,
  sheetName: null,
  sourceRowNumber: null,
  sourceNameCellAddress: null,
  sourceCodeCellAddress: null,
  sourceUnitCellAddress: null,
};

/** A line referenced a row that is not part of the version being revised. */
export const AHSP_CARRIED_LINE_NOT_IN_BASE_VERSION =
  'AHSP_CARRIED_LINE_NOT_IN_BASE_VERSION';
/** Two lines claimed continuity from the SAME prior line. */
export const AHSP_CARRIED_LINE_REUSED = 'AHSP_CARRIED_LINE_REUSED';
/** The stated base version does not belong to this AHSP. */
export const AHSP_BASE_VERSION_NOT_FOUND = 'AHSP_BASE_VERSION_NOT_FOUND';

@Injectable()
export class AhspVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
    private readonly units: UnitKernelService,
  ) {}

  /**
   * `client` lets a caller append the version inside a transaction it already
   * holds — the document import writes parent, version, resources and their
   * audit whole-or-nothing. Omitted, the version is written in its own
   * transaction exactly as before. Every validation and the tenant check run the
   * same either way, and the parent is read on the SAME client, so a parent
   * created earlier in that transaction is visible here.
   */
  async createVersion(
    ahspId: string,
    data: CreateAhspVersionDto,
    client?: Prisma.TransactionClient,
    /**
     * THE TRUST BOUNDARY, and it is a PARAMETER rather than a field.
     *
     * Only an in-process caller that actually read the document can pass this —
     * the HTTP route builds the DTO from the request body and never reaches
     * here. No `isTrusted` flag is consulted, because a flag in a body is just
     * another thing a body says.
     */
    trusted?: TrustedAhspSourceFacts,
  ) {
    data.resources.forEach(r => {
      if (r.coefficient <= 0) throw new BadRequestException('Coefficient must be > 0');
      if (r.conversionFactor !== undefined && r.conversionFactor !== null)
        throw new BadRequestException('LEGACY_CONVERSION_FACTOR_WRITE_FORBIDDEN');
    });
    if (typeof data.outputUnit !== 'string' || data.outputUnit.trim().length === 0)
      throw new BadRequestException('AHSP_OUTPUT_UNIT_UNRESOLVED');
    const outputResolution = await this.units.resolve(data.outputUnit, data.outputUnit);
    if (outputResolution.status !== 'RESOLVED' || !outputResolution.sourceUnitDefinition)
      throw new BadRequestException('AHSP_OUTPUT_UNIT_UNRESOLVED');
    const outputUnitDefinitionId = outputResolution.sourceUnitDefinition.id;

    const ahsp = await (client ?? this.prisma).aHSP.findUnique({
      where: { id: ahspId },
    });
    if (!ahsp) throw new NotFoundException('AHSP not found');

    // RM-03B tenant scope: this lookup was by id ALONE, so any workspace that
    // knew an AHSP id could append a version to it. A version is the thing that
    // gets bound and priced, so that is a write into another tenant's pricing
    // surface. A foreign AHSP is reported as not-found rather than forbidden,
    // so the endpoint never confirms the existence of ids the caller cannot see.
    if (ahsp.workspaceId !== null && ahsp.workspaceId !== data.workspaceId) {
      throw new NotFoundException('AHSP not found');
    }

    // Append a new revision, then retire prior private revisions so the new
    // one is the only current applicable AHSP. History is kept: SUPERSEDED
    // versions remain readable and already-bound occurrences keep their
    // ahspVersionId. PUBLISHED catalog rows are not withdrawn here — that is
    // a different authority, the same boundary retireVersion already keeps.
    const write = async (tx: Prisma.TransactionClient) => {
      const lastVersion = await tx.aHSPVersion.findFirst({
        where: { ahspId },
        orderBy: { versionNumber: 'desc' },
      });
      const versionNumber = lastVersion ? lastVersion.versionNumber + 1 : 1;

      /**
       * ACG-01 CLOSURE 1 — A REVISION DOES NOT ERASE WHERE A LINE WAS BORN, AND
       * A REQUEST NEVER INVENTS ONE.
       *
       * Source facts arrive by exactly two roads, and they are WHOLE on both:
       *
       *   1. the trusted pipeline hands them in, per line, already read from the
       *      document it parsed; or
       *   2. the server carries a prior line's facts forward, entire, when this
       *      line says which prior line it continues.
       *
       * There is no third road, and no merging between the two. The earlier
       * `input ?? inherited` merge could compose an origin that never existed —
       * one document's digest with another row's sheet and a third line's cell
       * address — which is a locator naming nowhere. A locator names one place
       * in one document, or it names none.
       *
       * Continuity is the SERVER'S row identity (AHSPResource.id), resolved
       * against the version being revised. The catalogue id is not usable for
       * this: it identifies a RESOURCE, so two lines quoting the same resource —
       * a lawful recipe — are indistinguishable by it, and reorder, duplication
       * and delete-then-add all become guesses.
       */
      const base = data.basedOnVersionId
        ? await tx.aHSPVersion.findFirst({
            where: { id: data.basedOnVersionId, ahspId },
            select: { id: true },
          })
        : lastVersion;
      // A base that is not this AHSP's is refused rather than silently replaced
      // by the latest: the author was editing SOMETHING, and guessing what
      // would attach the wrong recipe's origins to this one.
      if (data.basedOnVersionId && !base) {
        throw new BadRequestException(AHSP_BASE_VERSION_NOT_FOUND);
      }

      const carriedIds = data.resources
        .map((r) => r.carriedFromResourceLineId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      const priorById = new Map<
        string,
        AhspResourceSourceProvenance & {
          resourceId: string;
          resourceType: string;
        }
      >();
      if (carriedIds.length > 0) {
        if (!base) throw new BadRequestException(AHSP_CARRIED_LINE_NOT_IN_BASE_VERSION);
        const priorRows = await tx.aHSPResource.findMany({
          // Scoped to the base version, so an id from another AHSP — or from a
          // version of this AHSP the author was not editing — simply is not here.
          where: { ahspVersionId: base.id, id: { in: [...new Set(carriedIds)] } },
        });
        for (const row of priorRows) priorById.set(row.id, row);
        for (const id of carriedIds) {
          if (!priorById.has(id)) {
            throw new BadRequestException(AHSP_CARRIED_LINE_NOT_IN_BASE_VERSION);
          }
        }
        // One prior line continues into at most ONE new line. Letting two claim
        // it would hand the same locator to two different components.
        const claims = new Map<string, number>();
        for (const id of carriedIds) claims.set(id, (claims.get(id) ?? 0) + 1);
        for (const [, times] of claims) {
          if (times > 1) throw new BadRequestException(AHSP_CARRIED_LINE_REUSED);
        }
      }

      /** The ONE origin this line may carry — whole, or nothing. */
      const sourceFactsFor = (
        r: CreateAhspResourceInput,
        index: number,
      ): AhspResourceSourceProvenance => {
        const fromPipeline = trusted?.sourceFacts[index];
        if (fromPipeline) return fromPipeline;
        if (trusted) return NO_SOURCE_FACTS;
        const id = r.carriedFromResourceLineId;
        if (!id) return NO_SOURCE_FACTS;
        const prior = priorById.get(id);
        if (!prior) return NO_SOURCE_FACTS;
        /**
         * CONTINUITY ENDS WHERE THE RESOURCE CHANGES.
         *
         * Provenance says "the document stated THIS, here". It is evidence about
         * a particular resource, not about a slot in a recipe. So when an author
         * REPLACES what a line is about — a MATERIAL priced in M3 becomes a piece
         * of EQUIPMENT priced by the hour — carrying the old facts forward would
         * hand the new resource a workbook cell that never named it: an authentic
         * lineage turned into false evidence for an identity it never proved.
         *
         * The lineage itself is real and is not denied; it simply stops being
         * evidence. The substituted line is hand-built, and it says so with the
         * same nulls any hand-built line carries. A person may of course re-state
         * a source for it through the trusted pipeline, which is the only road
         * that ever asserts a source fact.
         */
        if (
          prior.resourceId !== r.resourceId ||
          prior.resourceType !== r.resourceType
        ) {
          return NO_SOURCE_FACTS;
        }
        // Taken as one unit — including its nulls. A prior line that was itself
        // hand-built carries its emptiness forward, which is the truth about it.
        return {
          rawName: prior.rawName ?? null,
          rawCode: prior.rawCode ?? null,
          rawUnit: prior.rawUnit ?? null,
          sourceSha256: prior.sourceSha256 ?? null,
          sourceFileName: prior.sourceFileName ?? null,
          parserContractVersion: prior.parserContractVersion ?? null,
          sheetName: prior.sheetName ?? null,
          sourceRowNumber: prior.sourceRowNumber ?? null,
          sourceNameCellAddress: prior.sourceNameCellAddress ?? null,
          sourceCodeCellAddress: prior.sourceCodeCellAddress ?? null,
          sourceUnitCellAddress: prior.sourceUnitCellAddress ?? null,
        };
      };

      const version = await tx.aHSPVersion.create({
        data: {
          ahspId,
          workspaceId: data.workspaceId || ahsp.workspaceId,
          versionNumber,
          status: AhspVersionStatus.DRAFT,
          regulationReference: data.regulationReference,
          effectiveDate: data.effectiveDate,
          outputUnit: data.outputUnit,
          outputUnitDefinitionId,
          resources: {
            // CLOSURE 1 — the source facts travel WITH the line. `?? null` and
            // never a fallback to another column: an absent code is absent, not
            // the name, and not an empty string. The database CHECK refuses a
            // locator that cannot name the document it came from.
            create: data.resources.map((r, index) => ({
              resourceId: r.resourceId,
              resourceType: r.resourceType,
              coefficient: r.coefficient,
              baseUnit: r.baseUnit,
              // ONE origin, spread whole. Nothing here reads the request body.
              ...sourceFactsFor(r, index),
            })),
          },
        },
        include: { resources: true },
      });

      await this.audit.logAction(
        {
          ahspId,
          ahspVersionId: version.id,
          action: 'AHSPVersionCreated',
          who: data.userId,
          after: version,
        },
        tx,
      );

      const callerOwnsPrivateParent =
        ahsp.ownershipType === 'USER_ASSET' &&
        ahsp.workspaceId !== null &&
        ahsp.workspaceId === data.workspaceId;
      if (callerOwnsPrivateParent) {
        const predecessors = await tx.aHSPVersion.findMany({
          where: {
            ahspId,
            id: { not: version.id },
            workspaceId: data.workspaceId,
            status: {
              notIn: [
                AhspVersionStatus.PUBLISHED,
                AhspVersionStatus.SUPERSEDED,
                AhspVersionStatus.ARCHIVED,
              ],
            },
          },
        });
        for (const predecessor of predecessors) {
          const superseded = await tx.aHSPVersion.update({
            where: { id: predecessor.id },
            data: { status: AhspVersionStatus.SUPERSEDED },
          });
          await this.audit.logAction(
            {
              ahspId,
              ahspVersionId: predecessor.id,
              action: 'AHSPVersionSUPERSEDED',
              who: data.userId,
              before: predecessor,
              after: superseded,
              reason: 'AHSP_UPDATED',
            },
            tx,
          );
        }
      }

      return version;
    };
    return client ? write(client) : this.prisma.$transaction(write);
  }

  async updateStatus(versionId: string, newStatus: AhspVersionStatus, userId: string, reason?: string) {
    const version = await this.prisma.aHSPVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    const updated = await this.prisma.aHSPVersion.update({
      where: { id: versionId },
      data: { status: newStatus }
    });

    await this.audit.logAction({ ahspId: version.ahspId, ahspVersionId: version.id, action: `AHSPVersion${newStatus}`, who: userId, before: version, after: updated, reason });
    return updated;
  }

  /**
   * RM-03D1 — RETIRE one AHSP version so it stops being selectable, while every
   * historical trace of it survives.
   *
   * WHY THIS EXISTS. A version's composition and effectiveDate are immutable in
   * practice: nothing in this codebase mutates either, and `createVersion` only
   * ever appends a new numbered version. That is the right model — a version an
   * occurrence priced against must not change under its feet. But it left an
   * erroneous version permanently eligible: `updateStatus` above shipped with
   * ZERO callers, so no route could withdraw one, and the only reachable
   * alternative was `POST /ahsp/:id/archive`, which archives the whole PARENT and
   * takes the correct versions down with it.
   *
   * WHAT IT DOES NOT DO. It never deletes the version, its resources, its audit
   * log, or any occurrence that priced against it — all remain readable history.
   * It cannot promote a version: only SUPERSEDED/ARCHIVED reach it, enforced at
   * the DTO boundary. And it introduces NO new eligibility rule — both statuses
   * are already in `PRIVATE_UNUSABLE_VERSION_STATUSES`, and neither can satisfy
   * the catalog branch's PUBLISHED requirement, so the SAME predicate that feeds
   * the picker and `selectForBoqItem` excludes a retired version automatically.
   *
   * TENANT SCOPE. The version AND its parent AHSP must both belong to the
   * caller's trusted workspace, by strict equality — never an OR with null. A
   * null-workspace (Official Repository) version is therefore not retirable
   * here: withdrawing national reference data is not one workspace's decision.
   * A foreign version reads as not-found, so the endpoint never confirms the
   * existence of ids the caller cannot see.
   *
   * ATOMIC. The status transition and the audit row that says why commit or
   * roll back together. They used to be two separate writes, so a failed audit
   * could leave a version withdrawn with no recorded reason — the trail
   * disagreeing with reality about a decision nobody could explain.
   *
   * SERIALIZED. The row is locked FOR UPDATE and the status re-read AFTER the
   * lock, so two concurrent requests cannot both observe DRAFT and both
   * transition. Exactly one changes state and writes exactly one audit row.
   *
   * FIRST LAWFUL TERMINAL DECISION WINS. Retiring to the status a version
   * already holds is idempotent. Retiring to the OTHER terminal status is
   * refused rather than applied: ARCHIVED and SUPERSEDED are different
   * statements about why a version was withdrawn, and last-writer-wins would
   * let a race decide which one history records.
   */
  async retireVersion(params: {
    versionId: string;
    workspaceId: string;
    // The two retirement outcomes, and only those. Written as literals because
    // the generated AhspVersionStatus is a type alias, not a namespace.
    status: 'SUPERSEDED' | 'ARCHIVED';
    userId: string;
    reason: string;
  }) {
    const { versionId, workspaceId, status, userId, reason } = params;

    return this.prisma.$transaction(async (tx) => {
      // Serialize on the exact row. Everything below re-reads state the lock
      // now protects, so a concurrent retirement is queued rather than raced.
      const locked = await tx.$queryRaw<
        Array<{ id: string; ahspId: string; workspaceId: string | null; status: string }>
      >(
        Prisma.sql`SELECT "id", "ahspId", "workspaceId", "status"
                     FROM "ahsp_versions"
                    WHERE "id" = ${versionId}::uuid
                    FOR UPDATE`,
      );
      const current = locked[0];
      // Strict equality, never an OR with null: an Official Repository version
      // (workspaceId NULL) is not one workspace's to withdraw.
      if (!current || current.workspaceId !== workspaceId) {
        throw new NotFoundException('Version not found');
      }

      const parent = await tx.aHSP.findUnique({
        where: { id: current.ahspId },
        select: {
          workspaceId: true,
          ownershipType: true,
          deletedAt: true,
          archivedAt: true,
        },
      });
      // The parent is re-proved rather than trusted, and this route is scoped to
      // workspace-private USER_ASSET AHSPs only.
      if (
        !parent ||
        parent.workspaceId !== workspaceId ||
        parent.deletedAt !== null ||
        parent.archivedAt !== null ||
        parent.ownershipType !== 'USER_ASSET'
      ) {
        throw new NotFoundException('Version not found');
      }

      // A PUBLISHED version has crossed into catalog/publication authority. A
      // workspace AHSP_MANAGE actor may not withdraw it through this private
      // route — that is a different decision with different authority, and it
      // fails closed rather than being quietly permitted here.
      if (current.status === 'PUBLISHED') {
        throw new ConflictException(
          'PUBLISHED_AHSP_VERSION_NOT_RETIRABLE_HERE',
        );
      }

      if (current.status === status) {
        // Already settled this exact way. No transition, no second audit row.
        const unchanged = await tx.aHSPVersion.findUniqueOrThrow({
          where: { id: versionId },
        });
        return { version: unchanged, changed: false };
      }

      if (current.status === 'SUPERSEDED' || current.status === 'ARCHIVED') {
        // Already retired, differently. The first lawful terminal decision
        // stands; overwriting it would let a race rewrite why history says a
        // version was withdrawn.
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'AHSP_VERSION_ALREADY_RETIRED_DIFFERENTLY',
          currentStatus: current.status,
          requestedStatus: status,
        });
      }

      const before = await tx.aHSPVersion.findUniqueOrThrow({
        where: { id: versionId },
      });
      const updated = await tx.aHSPVersion.update({
        where: { id: versionId },
        data: { status },
      });
      // Same transaction as the update: both commit, or neither does.
      await this.audit.logAction(
        {
          ahspId: current.ahspId,
          ahspVersionId: versionId,
          action: `AHSPVersion${status}`,
          who: userId,
          before,
          after: updated,
          reason,
        },
        tx,
      );

      return { version: updated, changed: true };
    });
  }
}

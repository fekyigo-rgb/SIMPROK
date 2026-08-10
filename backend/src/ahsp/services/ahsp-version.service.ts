import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspVersionStatus, Prisma } from '@prisma/client';
import { UnitKernelService } from '../../unit-kernel/unit-kernel.service';

export interface CreateAhspResourceInput {
  resourceId: string;
  resourceType: string;
  coefficient: number;
  baseUnit: string;
  conversionFactor?: unknown;
}

export interface CreateAhspVersionDto {
  workspaceId?: string;
  resources: CreateAhspResourceInput[];
  outputUnit: string;
  userId: string;
  regulationReference?: string;
  effectiveDate?: Date;
}

@Injectable()
export class AhspVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
    private readonly units: UnitKernelService,
  ) {}

  async createVersion(ahspId: string, data: CreateAhspVersionDto) {
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

    const ahsp = await this.prisma.aHSP.findUnique({ where: { id: ahspId } });
    if (!ahsp) throw new NotFoundException('AHSP not found');

    // RM-03B tenant scope: this lookup was by id ALONE, so any workspace that
    // knew an AHSP id could append a version to it. A version is the thing that
    // gets bound and priced, so that is a write into another tenant's pricing
    // surface. A foreign AHSP is reported as not-found rather than forbidden,
    // so the endpoint never confirms the existence of ids the caller cannot see.
    if (ahsp.workspaceId !== null && ahsp.workspaceId !== data.workspaceId) {
      throw new NotFoundException('AHSP not found');
    }

    const lastVersion = await this.prisma.aHSPVersion.findFirst({
      where: { ahspId },
      orderBy: { versionNumber: 'desc' }
    });
    const versionNumber = lastVersion ? lastVersion.versionNumber + 1 : 1;

    const version = await this.prisma.aHSPVersion.create({
      data: {
        ahspId,
        workspaceId: data.workspaceId || ahsp.workspaceId,
        versionNumber,
        status: AhspVersionStatus.DRAFT,
        regulationReference: data.regulationReference,
        effectiveDate: data.effectiveDate,
        outputUnit: data.outputUnit,
        outputUnitDefinitionId: outputResolution.sourceUnitDefinition.id,
        resources: {
          create: data.resources.map(r => ({
            resourceId: r.resourceId,
            resourceType: r.resourceType,
            coefficient: r.coefficient,
            baseUnit: r.baseUnit
          }))
        }
      },
      include: { resources: true }
    });

    await this.audit.logAction({ ahspId, ahspVersionId: version.id, action: 'AHSPVersionCreated', who: data.userId, after: version });
    return version;
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

import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { MethodType, LocationType, OwnershipType, ReviewStatus, Prisma } from '@prisma/client';
import { AhspOwnershipPolicy, OwnershipViolationError, AhspEntity } from '../domain/ahsp-ownership.policy';
import type { AhspIdentityRow } from '../document/ahsp-identity-classifier';

export interface CreateAhspDto {
  workspaceId?: string;
  workType: string;
  methodType: MethodType;
  locationType: LocationType;
  methodName: string;
  userId: string;
  // Owner-approved descriptive attributes (optional). Non-interpretive: what the
  // source states, never SIMPROK's method/terrain classification.
  code?: string | null;
  fieldCategory?: string | null;
  subCategory?: string | null;
  classification?: string | null;
}

export interface UpdateAhspDto {
  workType?: string;
  methodType?: MethodType;
  locationType?: LocationType;
  methodName?: string;
}

/**
 * Parent AHSP identity is source names in a workspace, not SIMPROK's method
 * or terrain classification. Schema still requires NOT NULL methodType and
 * locationType; OTHER is the non-interpretive filler. Callers may send
 * MANUAL/MOUNTAIN; those values are never persisted as identity and never
 * distinguish two parents.
 */
export const AHSP_PARENT_IDENTITY_FILLER = {
  methodType: MethodType.OTHER,
  locationType: LocationType.OTHER,
} as const;

@Injectable()
export class AhspService {
  private readonly policy = new AhspOwnershipPolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
  ) {}

  private runPolicy(action: (policy: AhspOwnershipPolicy) => void) {
    try {
      action(this.policy);
    } catch (error) {
      if (error instanceof OwnershipViolationError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  private async getUserDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: {
          include: {
            account: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    return user;
  }

  async create(data: CreateAhspDto) {
    // The pre-check mirrors the DB @@unique EXACTLY. It deliberately does NOT
    // filter deletedAt: a soft-deleted twin still occupies the unique index, so
    // surfacing it as a clean 409 here is what stops a raw Prisma P2002 becoming
    // an HTTP 500 when the create below would otherwise collide with it.
    const duplicate = await this.prisma.aHSP.findFirst({
      where: {
        workspaceId: data.workspaceId ?? null,
        workType: data.workType,
        methodName: data.methodName,
      },
    });
    if (duplicate) throw new ConflictException('AHSP_SOURCE_IDENTITY_EXISTS');

    let ahsp;
    try {
      ahsp = await this.prisma.aHSP.create({
        data: {
          workspaceId: data.workspaceId,
          workType: data.workType,
          methodName: data.methodName,
          code: data.code ?? null,
          fieldCategory: data.fieldCategory ?? null,
          subCategory: data.subCategory ?? null,
          classification: data.classification ?? null,
          ...AHSP_PARENT_IDENTITY_FILLER,
          createdByUserId: data.userId,
          ownershipType: 'USER_ASSET',
          reviewStatus: 'PENDING',
        },
      });
    } catch (error) {
      // Race backstop: if a twin is inserted between the pre-check and this
      // create, the unique index throws P2002. Translate it to the same clean
      // 409 rather than leaking a raw database error as a 500. No auto-revive.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('AHSP_SOURCE_IDENTITY_EXISTS');
      }
      throw error;
    }

    await this.audit.logAction({ ahspId: ahsp.id, action: 'AHSPCreated', who: data.userId, after: ahsp });
    return ahsp;
  }

  /**
   * The read-only AHSP-identity surface for the duplicate classifier: every AHSP
   * this workspace could collide with, PLUS the Official Repository (workspaceId
   * null) — the same tenancy clause `list` uses, but deliberately WIDER than
   * `list` in one respect: it drops the `deletedAt: null` filter that every other
   * AHSP read enforces. That is required, not accidental — a soft-deleted twin
   * still holds the @@unique index, so it must be visible here to be surfaced as
   * IDENTICAL(deleted) instead of exploding into a P2002. Consequently a deleted
   * AHSP's names can reach the reader as a "this already exists" reference; the
   * display bars adopting it. Projection only; it mints, writes, decides nothing.
   */
  async loadIdentitySurface(workspaceId: string): Promise<AhspIdentityRow[]> {
    const rows = await this.prisma.aHSP.findMany({
      where: { OR: [{ workspaceId }, { workspaceId: null }] },
      // Stable order so the classifier's exact-match find() is deterministic
      // regardless of storage order (its POSSIBLY matches sort by id too).
      orderBy: { id: 'asc' },
      select: {
        id: true,
        workspaceId: true,
        workType: true,
        methodName: true,
        code: true,
        deletedAt: true,
      },
    });
    return rows.map((row) => ({
      ahspId: row.id,
      workspaceId: row.workspaceId,
      workType: row.workType,
      methodName: row.methodName,
      code: row.code,
      deletedAt: row.deletedAt,
    }));
  }

  async getById(id: string, workspaceId?: string) {
    // THE same definition the list already proved visible. Versions and their
    // stored resources travel with it so the room detail can show the recipe
    // without a second query, a second service, or the RAB occurrence path.
    const ahsp = await this.prisma.aHSP.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: { resources: true },
        },
      },
    });
    if (!ahsp || (ahsp.workspaceId !== null && ahsp.workspaceId !== workspaceId)) {
      throw new NotFoundException('AHSP not found');
    }
    return this.withCatalogResourceNames(ahsp, workspaceId);
  }

  /**
   * The detail read for the room's own detail view: the same tenant-scoped
   * definition getById proves, plus the creator's email resolved through the
   * existing relation for the "Dibuat oleh" line. A thin wrapper so getById (and
   * every mutation's audit snapshot) keeps its exact shape.
   */
  async getDetail(id: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);
    let createdByEmail: string | null = null;
    const createdByUserId = (ahsp as { createdByUserId?: string | null }).createdByUserId;
    if (createdByUserId) {
      const creator = await this.prisma.user.findUnique({
        where: { id: createdByUserId },
        include: { membership: { include: { account: { select: { email: true } } } } },
      });
      createdByEmail = creator?.membership?.account?.email ?? null;
    }
    return { ...ahsp, createdByEmail };
  }

  /**
   * Presentation names from the existing ResourceCatalog. Not a second identity
   * engine: stored resourceId stays the write contract. Official catalog rows
   * (workspaceId null) remain visible beside this workspace's own rows.
   */
  private async withCatalogResourceNames<
    T extends {
      versions: Array<{
        resources: Array<{ resourceId: string } & Record<string, unknown>>;
      }>;
    },
  >(ahsp: T, workspaceId?: string): Promise<T> {
    const ids = [
      ...new Set(
        ahsp.versions.flatMap((version) =>
          version.resources.map((row) => row.resourceId).filter(isCatalogUuid),
        ),
      ),
    ];
    if (ids.length === 0) return ahsp;
    const catalog = await this.prisma.resourceCatalog.findMany({
      where: {
        id: { in: ids },
        status: 'ACTIVE',
        OR: workspaceId
          ? [{ workspaceId }, { workspaceId: null }]
          : [{ workspaceId: null }],
      },
      select: { id: true, name: true },
    });
    const names = new Map(catalog.map((row) => [row.id, row.name]));
    return {
      ...ahsp,
      versions: ahsp.versions.map((version) => ({
        ...version,
        resources: version.resources.map((row) => ({
          ...row,
          resourceName: names.get(row.resourceId) ?? null,
        })),
      })),
    };
  }

  /**
   * THE workspace AHSP visibility list — discovery, not bindability.
   *
   * This is getById's own tenant rule, asked for many rows instead of one. That
   * rule is already stated twice in production and identically both times: a row
   * is visible when it is not deleted AND it either belongs to this workspace or
   * belongs to none (workspaceId NULL is the Official Repository). getById
   * enforces it above; rab-intelligence-proposal.service.ts asks the same
   * `deletedAt: null` + `OR: [{ workspaceId }, { workspaceId: null }]` of the
   * same model. So this list widens nothing: every row it can return is a row
   * getById would already hand the same caller.
   *
   * It is deliberately NOT listEligibleVersions. That method answers 'which AHSP
   * VERSIONS may bind to a BOQ item' — it requires an output unit and resources
   * because a version without them cannot be PRICED, and its own contract says
   * the picker set must stay exactly what selectForBoqItem revalidates. Asking
   * it here would answer 'what may I bind right now' to someone who asked 'what
   * AHSP do I have', hiding their own half-composed work, and would tie a
   * display surface to a binding-security invariant.
   *
   * Every selected field is a stored column. Nothing is derived, counted by
   * hand, or inferred — the version count comes from the database.
   */
  async list(workspaceId: string) {
    return this.prisma.aHSP.findMany({
      where: {
        deletedAt: null,
        OR: [{ workspaceId }, { workspaceId: null }],
      },
      select: {
        id: true,
        workspaceId: true,
        workType: true,
        methodType: true,
        locationType: true,
        methodName: true,
        code: true,
        fieldCategory: true,
        subCategory: true,
        classification: true,
        ownershipType: true,
        reviewStatus: true,
        proposedAt: true,
        archivedAt: true,
        updatedAt: true,
        // The applicable version's Satuan and Dasar for the list columns — the
        // newest version, the same "current" the detail shows. Read-only, no
        // second query per row.
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { outputUnit: true, regulationReference: true },
        },
        _count: { select: { versions: true } },
      },
      orderBy: [{ workType: 'asc' }, { methodName: 'asc' }],
    });
  }

  async update(id: string, updateData: UpdateAhspDto, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canUpdate(ahsp as AhspEntity, reason));

    const updated = await this.prisma.$transaction(async (tx) => {
      // HTTP PATCH forwards the raw body, which still carries reason/userId and
      // may carry methodType/locationType. Parent identity is source names only;
      // classification and request metadata must never be persisted here.
      const identitySafe: { workType?: string; methodName?: string } = {};
      if (updateData.workType !== undefined) identitySafe.workType = updateData.workType;
      if (updateData.methodName !== undefined) identitySafe.methodName = updateData.methodName;
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: identitySafe,
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPUpdated',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return updated;
  }

  async delete(id: string, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canRequestDeletion(ahsp as AhspEntity, reason));

    const user = await this.getUserDetails(userId);

    const deleted = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedByUserId: userId,
          deletedByName: user.fullName,
          deletedByEmail: user.membership?.account?.email || null,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPDeleted',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return deleted;
  }

  async archive(id: string, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canArchive(ahsp as AhspEntity, reason));

    const user = await this.getUserDetails(userId);

    const archived = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          archivedByUserId: userId,
          archivedByName: user.fullName,
          archivedByEmail: user.membership?.account?.email || null,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPArchived',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return archived;
  }

  async approve(id: string, userId: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canApprove(ahsp as AhspEntity));

    // A human other than the author decides. The creator (and whoever proposed
    // it) may not approve their own AHSP — acceptance is never a self-decision.
    this.ensureNotSelfDecision(ahsp, userId);

    const user = await this.getUserDetails(userId);

    const approved = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          reviewStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedByUserId: userId,
          approvedByName: user.fullName,
          approvedByEmail: user.membership?.account?.email || null,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPApproved',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
      });

      return updatedAhsp;
    });

    return approved;
  }

  /**
   * "Usulkan ke SIMPROK" — submit a workspace-owned AHSP for human review.
   *
   * This is a WORKFLOW state change on the canonical AHSP, not a copy and not a
   * publish: it records that the AHSP was submitted (proposedAt + who/when) and
   * leaves reviewStatus PENDING for a reviewer to decide. Nothing becomes shared
   * or canonical here; acceptance stays a separate human decision (approve).
   */
  async propose(id: string, userId: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    this.runPolicy(p => p.canPropose(ahsp as AhspEntity));

    const user = await this.getUserDetails(userId);

    const proposed = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          proposedAt: new Date(),
          proposedByUserId: userId,
          proposedByName: user.fullName,
          proposedByEmail: user.membership?.account?.email || null,
          reviewStatus: 'PENDING',
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPProposed',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
      });

      return updatedAhsp;
    });

    return proposed;
  }

  /**
   * A reviewer declines a proposed AHSP. The outcome rides the existing
   * reviewStatus (-> REJECTED); the reason and decider are recorded in the audit
   * trail. Not a self-decision, and never auto-anything.
   */
  async reject(id: string, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    this.runPolicy(p => p.canApprove(ahsp as AhspEntity));
    this.ensureNotSelfDecision(ahsp, userId);

    const rejected = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: { reviewStatus: 'REJECTED' },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPRejected',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return rejected;
  }

  private ensureNotSelfDecision(
    ahsp: { createdByUserId?: string | null; proposedByUserId?: string | null },
    userId: string,
  ): void {
    if (
      (ahsp.createdByUserId && ahsp.createdByUserId === userId) ||
      (ahsp.proposedByUserId && ahsp.proposedByUserId === userId)
    ) {
      throw new ForbiddenException('AHSP_SELF_DECISION_FORBIDDEN');
    }
  }

  async transfer(id: string, targetOwnershipType: OwnershipType, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canTransfer(ahsp as AhspEntity, reason));

    const user = await this.getUserDetails(userId);

    const transferred = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          ownershipType: targetOwnershipType,
          ownershipTransferredAt: new Date(),
          ownershipTransferredByUserId: userId,
          ownershipTransferredByName: user.fullName,
          ownershipTransferredByEmail: user.membership?.account?.email || null,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPOwnershipTransferred',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return transferred;
  }
}

const CATALOG_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCatalogUuid(value: string): boolean {
  return CATALOG_UUID.test(value);
}

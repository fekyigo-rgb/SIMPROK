import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  RESOURCE_ADMISSION_LOCK_NAMESPACE,
  resourceAdmissionLockKey,
} from './resource-admission.service';
import { normalizeResourceName } from './resource-identity-resolution.kernel';

/**
 * BP-C3: ONE narrow correction writer for an EXISTING resource label.
 * No resource admission, no new identifier, no unit conversion and no mutation
 * to any Basic Price or AHSP/BOQ row.
 *
 * This first writer permits ONLY typography/spacing/case corrections whose
 * alphanumeric spelling is unchanged. Broader terminological changes require
 * a separate identity adjudication; no arbitrary 'Edit' masquerading as typo.
 */
export function catalogLabelSignature(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('id-ID')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function validateCorrectedName(value: unknown): string {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new BadRequestException('CATALOG_NAME_INVALID');
  }
  const name = value.trim().replace(/\s+/gu, ' ');
  if (name.length < 3 || name.length > 180) {
    throw new BadRequestException('CATALOG_NAME_INVALID');
  }
  return name;
}

function requiredEvidence(value: unknown, min: number, max: number, code: string): string {
  if (typeof value !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(value)) {
    throw new BadRequestException(code);
  }
  const text = value.trim();
  if (text.length < min || text.length > max) throw new BadRequestException(code);
  return text;
}

export interface CorrectResourceCatalogNameInput {
  workspaceId: string;
  resourceCatalogId: string;
  actorAccountId: string;
  previousName: string;
  expectedUpdatedAt: string;
  correctedName: string;
  reason: string;
  evidence: string;
  sameIdentityConfirmed: boolean;
}

@Injectable()
export class ResourceCatalogNameCorrectionService {
  constructor(private readonly prisma: PrismaService) {}

  async correct(input: CorrectResourceCatalogNameInput) {
    if (input.sameIdentityConfirmed !== true) {
      throw new BadRequestException('CATALOG_SAME_IDENTITY_CONFIRMATION_REQUIRED');
    }
    // The expected name must remain byte-for-byte as last observed, even if
    // it contains the typo this operation is intended to correct.
    if (typeof input.previousName !== 'string' || !input.previousName.trim()) {
      throw new BadRequestException('CATALOG_PREVIOUS_NAME_REQUIRED');
    }
    const previousName = input.previousName;
    const correctedName = validateCorrectedName(input.correctedName);
    const reason = requiredEvidence(input.reason, 10, 500, 'CATALOG_CORRECTION_REASON_REQUIRED');
    const evidence = requiredEvidence(input.evidence, 20, 2000, 'CATALOG_CORRECTION_EVIDENCE_REQUIRED');
    if (previousName === correctedName) {
      throw new BadRequestException('CATALOG_CORRECTION_NO_CHANGE');
    }
    if (catalogLabelSignature(previousName) !== catalogLabelSignature(correctedName)) {
      throw new ConflictException('CATALOG_CORRECTION_REQUIRES_IDENTITY_ADJUDICATION');
    }
    const expected = new Date(input.expectedUpdatedAt);
    if (!input.expectedUpdatedAt || Number.isNaN(expected.getTime()) ||
        expected.toISOString() !== input.expectedUpdatedAt) {
      throw new BadRequestException('CATALOG_CORRECTION_VERSION_INVALID');
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize with the SAME admission lock used by Basic Price and AHSP.
      // Name changes cannot race an admission in this workspace/type.
      const initial = await tx.resourceCatalog.findFirst({
        where: { id: input.resourceCatalogId, workspaceId: input.workspaceId, status: 'ACTIVE' },
        select: { type: true },
      });
      if (!initial) throw new NotFoundException('RESOURCE_CATALOG_NOT_FOUND');
      const lockKey = resourceAdmissionLockKey(input.workspaceId + '|' + initial.type);
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${RESOURCE_ADMISSION_LOCK_NAMESPACE}::int4, ${lockKey}::int4)`,
      );
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "resource_catalogs"
        WHERE "id" = ${input.resourceCatalogId}::uuid FOR UPDATE
      `);

      const resource = await tx.resourceCatalog.findFirst({
        where: { id: input.resourceCatalogId, workspaceId: input.workspaceId, status: 'ACTIVE' },
        select: { id: true, name: true, type: true, baseUnit: true, updatedAt: true },
      });
      if (!resource) throw new NotFoundException('RESOURCE_CATALOG_NOT_FOUND');
      if (resource.name !== input.previousName ||
          resource.updatedAt.getTime() !== expected.getTime() ||
          resource.type !== initial.type) {
        throw new ConflictException('CATALOG_CORRECTION_STALE_DECISION');
      }
      if (catalogLabelSignature(resource.name) !== catalogLabelSignature(correctedName)) {
        throw new ConflictException('CATALOG_CORRECTION_REQUIRES_IDENTITY_ADJUDICATION');
      }

      // This is a spelling-collision check, NOT a new identity matcher.
      // Reuse the canonical name normalization for other ACTIVE candidates.
      const others = await tx.resourceCatalog.findMany({
        where: {
          workspaceId: input.workspaceId, type: resource.type,
          status: 'ACTIVE', id: { not: resource.id },
        },
        select: { id: true, name: true },
        take: 5001, // explicit upper bound; a truncated collision search must fail closed
      });
      if (others.length > 5000) {
        throw new ConflictException('CATALOG_NAME_COLLISION_SCOPE_EXCEEDED');
      }
      const foldedNew = normalizeResourceName(correctedName);
      if (others.some((other) =>
        normalizeResourceName(other.name) === foldedNew ||
        catalogLabelSignature(other.name) === catalogLabelSignature(correctedName))) {
        throw new ConflictException('CATALOG_CORRECTION_IDENTITY_CONFLICT');
      }
      const updated = await tx.resourceCatalog.updateMany({
        where: { id: resource.id, workspaceId: input.workspaceId, status: 'ACTIVE', updatedAt: resource.updatedAt },
        data: { name: correctedName },
      });
      if (updated.count !== 1) throw new ConflictException('CATALOG_CORRECTION_STALE_DECISION');
      const after = await tx.resourceCatalog.findUniqueOrThrow({
        where: { id: resource.id },
        select: { name: true, updatedAt: true, baseUnit: true, type: true },
      });
      if (after.baseUnit !== resource.baseUnit || after.type !== resource.type ||
          after.name !== correctedName) {
        throw new ConflictException('CATALOG_CORRECTION_IDENTITY_CHANGED');
      }
      // Parameterized immutable audit insert; the generated Prisma client for
      // this isolated branch may predate the additive journal model. No new
      // delegate or extra code-generation dependency is necessary.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "resource_catalog_name_corrections"
        ("id", "workspaceId", "resourceCatalogId", "actorAccountId",
         "previousName", "correctedName", "reason", "evidence",
         "priorUpdatedAt", "newUpdatedAt")
        VALUES (${randomUUID()}::uuid, ${input.workspaceId}::uuid,
          ${resource.id}::uuid, ${input.actorAccountId}::uuid,
          ${resource.name}, ${correctedName}, ${reason}, ${evidence},
          ${resource.updatedAt}, ${after.updatedAt})
      `);
      return {
        corrected: true,
        previousName: resource.name,
        correctedName,
        catalogIdentityPreserved: true,
        sourceTextPreserved: true,
        basicPricesUntouched: true,
        unitUnchanged: true,
        correctedAt: after.updatedAt.toISOString(),
      };
    });
  }
}

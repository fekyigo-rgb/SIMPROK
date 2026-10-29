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
import {
  compareConfirmedSpecifications,
  confirmedSpecifications,
} from './resource-identity-specification.contract';

/**
 * BP-C3: ONE narrow correction writer for an EXISTING resource label.
 * No resource admission, no new identifier, no unit conversion and no mutation
 * to any Basic Price or AHSP/BOQ row.
 *
 * Typography corrections use the existing safe pathway. Small nomenclature
 * corrections require a documented curator/Owner determination and an exact
 * catalog code confirmation. The gate NEVER treats two spellings as synonyms:
 * a source can contain the erroneous spelling (e.g. TC), while a lawful human
 * correction explains why the correct label is Ton for that SAME resource.
 */
export function catalogLabelSignature(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('id-ID')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * A same-name row is an identity collision unless both rows carry confirmed
 * technical facts that positively contradict one another. Missing or opaque
 * specifications never prove two identities are different.
 */
export function isCatalogNameCollision(
  proposedName: string,
  targetSpecifications: unknown,
  candidate: { name: string; specifications?: unknown },
): boolean {
  const sameName =
    normalizeResourceName(candidate.name) === normalizeResourceName(proposedName) ||
    catalogLabelSignature(candidate.name) === catalogLabelSignature(proposedName);
  if (!sameName) return false;
  const target = confirmedSpecifications(targetSpecifications);
  return !target ||
    compareConfirmedSpecifications(target, candidate.specifications) !== 'CONFLICT';
}

export type CatalogNameChangeClass =
  | 'TYPOGRAPHY_ONLY'
  | 'NOMENCLATURE_REQUIRES_VERIFICATION'
  | 'TECHNICAL_CHANGE_BLOCKED';

/**
 * Conservative single-term spelling-review gate, never an identity
 * resolver. "TC" -> "Ton" or "Portlan" -> "Portland" MAY be submitted as
 * suspected errors. Their semantic equivalence is NEVER asserted.
 * Numerics, multiple term changes or substantial substitutions remain blocked.
 */
export function classifyCatalogNameChange(oldName: string, newName: string): CatalogNameChangeClass {
  // Technical numbers include their OPERATORS, not only their digits.
  // The existing label signature intentionally ignores punctuation to allow
  // normal spacing/case fixes. For equipment capacities that is too broad:
  // 80-100 Ton/Jam and 80100 Ton/Jam have the same folded label, but very
  // different meanings. Fail closed BEFORE the typography shortcut.
  //
  // Keep separators within a numeric expression (ranges, ratios, decimal
  // values, dimensions). Spaces around an unchanged operator and Unicode
  // dash glyphs are typographic; losing or replacing an operator is not.
  const numericExpressions = (value: string): string[] => {
    const normalized = value.normalize('NFKC').replace(/[‐‑‒–—−]/gu, '-');
    return Array.from(
      normalized.matchAll(/\d+(?:\s*[-/:.,×]\s*\d+)*/gu),
      match => match[0].replace(/\s+/gu, ''),
    );
  };
  if (JSON.stringify(numericExpressions(oldName)) !==
      JSON.stringify(numericExpressions(newName))) {
    return 'TECHNICAL_CHANGE_BLOCKED';
  }
  if (catalogLabelSignature(oldName) === catalogLabelSignature(newName)) {
    return 'TYPOGRAPHY_ONLY';
  }
  const tokens = (s: string) => s.toLocaleLowerCase('id-ID').match(/[\p{L}\p{N}]+/gu) ?? [];
  const a = tokens(oldName);
  const b = tokens(newName);
  if (a.length !== b.length || a.length < 2) return 'TECHNICAL_CHANGE_BLOCKED';
  let changed = 0;
  const smallEdit = (aToken: string, bToken: string) => {
    if (aToken.length > 30 || bToken.length > 30) return false;
    const row = Array.from({ length: bToken.length + 1 }, (_, index) => index);
    for (let i = 1; i <= aToken.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= bToken.length; j++) {
        const prior = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          prev + (aToken[i - 1] === bToken[j - 1] ? 0 : 1),
        );
        prev = prior;
      }
    }
    return row[bToken.length] <= 2;
  };
  // Guard familiar dimensional/strength notation from masquerading as typo.
  // These are DENIAL controls, not a replacement for Unit Kernel normalization.
  const protectedUnits = new Set([
    'mm', 'cm', 'm', 'meter', 'km', 'kg', 'gram', 'liter', 'litre',
    'mpa', 'psi', 'bar', 'hp', 'kw', 'kva', 'k', 'fc',
    'hari', 'jam', 'ton', 'tc',
    // Track-mounted and truck-mounted cranes are different technical types,
    // not a one-letter nomenclature typo; preserve the existing identities.
    'track', 'truck',
  ]);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    // TC -> Ton is eligible for human correction of a mistaken label;
    // this is emphatically NOT a UnitAlias, conversion, or synonym rule.
    const potentialLabelError = a[i] === 'tc' && b[i] === 'ton';
    if ((protectedUnits.has(a[i]) || protectedUnits.has(b[i])) &&
        !potentialLabelError) return 'TECHNICAL_CHANGE_BLOCKED';
    changed++;
    if (changed > 1 || !smallEdit(a[i], b[i])) return 'TECHNICAL_CHANGE_BLOCKED';
  }
  return changed === 1 ? 'NOMENCLATURE_REQUIRES_VERIFICATION' : 'TECHNICAL_CHANGE_BLOCKED';
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
  nomenclatureVerified?: boolean;
  confirmedCatalogCode?: string;
  /** Required instead of an invented code when the existing catalog has NO code. */
  confirmedCatalogName?: string;
  confirmedCatalogBaseUnit?: string;
  sourceReference?: string;
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
    const changeClass = classifyCatalogNameChange(previousName, correctedName);
    if (changeClass === 'TECHNICAL_CHANGE_BLOCKED') {
      throw new ConflictException('CATALOG_CORRECTION_REQUIRES_IDENTITY_ADJUDICATION');
    }
    const nomenclature = changeClass === 'NOMENCLATURE_REQUIRES_VERIFICATION';
    // Catalog code is optional canonical data. Never require a fake code.
    // Code-present records retain the existing retype gate. Code-absent
    // records require independent live name + unit retype, verified again
    // inside the transaction against the locked resource.
    if (nomenclature &&
        (input.nomenclatureVerified !== true ||
         !(typeof input.confirmedCatalogCode === 'string' && input.confirmedCatalogCode.trim()) &&
         !(typeof input.confirmedCatalogName === 'string' && input.confirmedCatalogName.trim() &&
           typeof input.confirmedCatalogBaseUnit === 'string' && input.confirmedCatalogBaseUnit.trim()))) {
      throw new BadRequestException('CATALOG_NOMENCLATURE_CURATOR_VERIFICATION_REQUIRED');
    }
    // Reference to actual documented basis: source/specification OR an
    // explicitly attributable Owner/curator correction decision. Never claim
    // the raw source already says the corrected term when it does not.
    const reference = nomenclature
      ? requiredEvidence(input.sourceReference, 12, 350, 'CATALOG_NOMENCLATURE_SOURCE_REQUIRED')
      : '';
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
        select: {
          id: true, name: true, code: true, type: true, baseUnit: true,
          specifications: true, updatedAt: true,
        },
      });
      if (!resource) throw new NotFoundException('RESOURCE_CATALOG_NOT_FOUND');
      if (resource.name !== input.previousName ||
          resource.updatedAt.getTime() !== expected.getTime() ||
          resource.type !== initial.type) {
        throw new ConflictException('CATALOG_CORRECTION_STALE_DECISION');
      }
      if (classifyCatalogNameChange(resource.name, correctedName) !== changeClass) {
        throw new ConflictException('CATALOG_CORRECTION_STALE_DECISION');
      }
      if (nomenclature) {
        if (resource.code && resource.code.trim()) {
          if (resource.code.toLocaleLowerCase('id-ID') !==
              input.confirmedCatalogCode?.trim().toLocaleLowerCase('id-ID')) {
            throw new ConflictException('CATALOG_NOMENCLATURE_CODE_MISMATCH');
          }
        } else if (
          resource.name !== input.confirmedCatalogName?.trim() ||
          resource.baseUnit !== input.confirmedCatalogBaseUnit?.trim()
        ) {
          throw new ConflictException('CATALOG_NOMENCLATURE_NO_CODE_IDENTITY_MISMATCH');
        }
      }

      // This is a spelling-collision check, NOT a new identity matcher.
      // Reuse the canonical name normalization for other ACTIVE candidates.
      const others = await tx.resourceCatalog.findMany({
        where: {
          OR: [{ workspaceId: input.workspaceId }, { workspaceId: null }],
          type: resource.type,
          status: 'ACTIVE', id: { not: resource.id },
        },
        select: { id: true, name: true, specifications: true },
        take: 5001, // explicit upper bound; a truncated collision search must fail closed
      });
      if (others.length > 5000) {
        throw new ConflictException('CATALOG_NAME_COLLISION_SCOPE_EXCEEDED');
      }
      if (others.some((other) =>
        isCatalogNameCollision(correctedName, resource.specifications, other))) {
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
          ${resource.name}, ${correctedName},
          ${nomenclature ? '[KOREKSI_SALAH_TULIS_TERVERIFIKASI] ' + reason : reason},
          ${nomenclature ? 'DASAR_PENETAPAN: ' + reference + '\nBUKTI_IDENTITAS: ' + evidence : evidence},
          ${resource.updatedAt}, ${after.updatedAt})
      `);
      return {
        corrected: true,
        previousName: resource.name,
        correctedName,
        correctionClass: changeClass,
        catalogIdentityPreserved: true,
        sourceTextPreserved: true,
        basicPricesUntouched: true,
        unitUnchanged: true,
        correctedAt: after.updatedAt.toISOString(),
      };
    });
  }
}

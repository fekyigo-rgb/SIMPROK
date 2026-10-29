import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ObservedResourceStatus, Prisma, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resourceAdmissionLockKey } from './resource-admission.service';

export const OBSERVED_RESOURCE_NAME_REVIEW_POLICY_VERSION =
  'RI01_OBSERVED_RESOURCE_NAME_REVIEW_V1';

const NAME_REVIEW_LOCK_NAMESPACE = resourceAdmissionLockKey(
  'RI01_OBSERVED_RESOURCE_NAME_REVIEW',
);
/**
 * Same per-observation lock for append and BOTH curation doors.
 * Serialize a saved spelling with the identity decision that consumes it.
 * Without this, admission may read rawName while another transaction appends
 * the reviewed name; neither action would notice the race.
 */
export async function lockObservedResourceNameReviewDecision(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  observationId: string,
): Promise<void> {
  const lockKey = resourceAdmissionLockKey(`${workspaceId}|${observationId}`);
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${NAME_REVIEW_LOCK_NAMESPACE}::int4, ${lockKey}::int4)`,
  );
}
const SHA256 = /^[0-9a-f]{64}$/;

/** Exactly the source facts a spelling interpretation is bound to. */
export interface ObservedResourceSourceFacts {
  rawName: string;
  rawCode: string | null;
  rawUnit: string | null;
  resourceType: ResourceType | string;
  sourceSha256: string | null;
  sheetName: string | null;
  sourceRowNumber: number | null;
  parserContractVersion: string | null;
}

/** Stable JSON shape: property order is part of V1 and therefore explicit. */
export function observedResourceSourceFactsFingerprint(
  facts: ObservedResourceSourceFacts,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        rawName: facts.rawName,
        rawCode: facts.rawCode,
        rawUnit: facts.rawUnit,
        resourceType: facts.resourceType,
        sourceSha256: facts.sourceSha256,
        sheetName: facts.sheetName,
        sourceRowNumber: facts.sourceRowNumber,
        parserContractVersion: facts.parserContractVersion,
      }),
      'utf8',
    )
    .digest('hex');
}

const TECHNICAL_TOKENS = new Set([
  'G',
  'KG',
  'MG',
  'MM',
  'CM',
  'M',
  'M1',
  'M2',
  'M3',
  'KM',
  'ML',
  'L',
  'LTR',
  'LITER',
  'TON',
  'T',
  'W',
  'KW',
  'KVA',
  'V',
  'A',
  'HP',
  'PK',
  'JAM',
  'HARI',
  'BULAN',
  'TAHUN',
]);

function tokens(value: string): string[] {
  return value.normalize('NFKC').toUpperCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function oneAdjacentTransposition(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  const changed: number[] = [];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) changed.push(index);
  }
  return (
    changed.length === 2 &&
    changed[1] === changed[0] + 1 &&
    left[changed[0]] === right[changed[1]] &&
    left[changed[1]] === right[changed[0]]
  );
}

function oneInsertionOrDeletion(left: string, right: string): boolean {
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  // A one-character insertion is NOT, by itself, proof of a spelling error:
  // PVC -> CPVC and PE -> PEX are different materials. Accept only the narrow
  // repeated-final-letter typo of a substantial alphabetic word
  // (SINTETIKK -> SINTETIK). All other length changes need the ordinary
  // governed identity/specification decision rather than a spelling review.
  if (shorter.length < 6 || longer.length !== shorter.length + 1) return false;
  if (!/^[\p{L}]+$/u.test(shorter) || !/^[\p{L}]+$/u.test(longer)) return false;
  return longer === shorter + shorter[shorter.length - 1];
}

function isNarrowSpellingChange(left: string, right: string): boolean {
  if (left === right) return true;
  // Short technical acronyms/models (PVC, PPR, etc.) must NOT be rearranged
  // under a free-text spelling policy. FALT -> FLAT is a transposition in an
  // ordinary word; consonant-only model codes remain outside this door.
  const ordinaryWordTransposition =
    left.length >= 4 &&
    /[AEIOU]/u.test(left) &&
    /[AEIOU]/u.test(right) &&
    oneAdjacentTransposition(left, right);
  // A generic insertion/deletion is ambiguous with a different material
  // (PVC -> CPVC), even if the diff is only one character.
  return ordinaryWordTransposition || oneInsertionOrDeletion(left, right);
}

/**
 * A single, evidence-bounded concrete compressive-strength notation repair.
 * "Beton fc 10 Mpa" -> "Beton f'c 10 Mpa" is ONLY punctuation of the
 * technical symbol. The exact rest of the ORIGINAL text, including strength
 * and unit, must remain byte-for-byte identical. This never resolves identity.
 */
/**
 * Strict source-only equipment name spacing review. All remaining original
 * characters must match exactly: capacity, model, class and unit cannot change.
 */
function isFlatbedSpacingOnly(rawName: string, reviewedName: string): boolean {
  const normal = rawName.replace(/\bFLAT BED TRUCK\b/giu, 'FLATBED TRUCK');
  return normal !== rawName && reviewedName === normal;
}

function isConcreteFcNotationOnly(rawName: string, reviewedName: string): boolean {
  if (!/\bbeton\b/iu.test(rawName)) return false;
  const canonicalNotation = rawName.replace(/\bfc\b/giu, "f'c");
  return canonicalNotation !== rawName && reviewedName === canonicalNotation;
}

/**
 * This door records spelling/notation only. Capacity/model numerics and unit
 * tokens must remain byte-equivalent; arbitrary punctuation or a wholesale
 * word replacement is not relabelled a typo. Unsupported ambiguity stays
 * outside this event and needs normal identity review.
 */
export function assertSpellingOnlyNameReview(
  rawName: string,
  reviewedName: string,
): void {
  if (
    typeof reviewedName !== 'string' ||
    reviewedName.length === 0 ||
    reviewedName !== reviewedName.trim()
  ) {
    throw new BadRequestException('REVIEWED_NAME_INVALID');
  }
  // Exact notation-only correction, not a blanket punctuation whitelist.
  if (isConcreteFcNotationOnly(rawName, reviewedName) ||
      isFlatbedSpacingOnly(rawName, reviewedName)) return;
  const raw = tokens(rawName);
  const reviewed = tokens(reviewedName);
  if (
    raw.length === 0 ||
    reviewed.length !== raw.length ||
    raw.join('\u0000') === reviewed.join('\u0000')
  ) {
    throw new BadRequestException(
      raw.join('\u0000') === reviewed.join('\u0000')
        ? 'REVIEWED_NAME_UNCHANGED'
        : 'NAME_REVIEW_NOT_SPELLING_ONLY',
    );
  }
  for (let index = 0; index < raw.length; index += 1) {
    const before = raw[index];
    const after = reviewed[index];
    if (before === after) continue;
    if (
      /\d/u.test(before) ||
      /\d/u.test(after) ||
      TECHNICAL_TOKENS.has(before) ||
      TECHNICAL_TOKENS.has(after) ||
      !isNarrowSpellingChange(before, after)
    ) {
      throw new BadRequestException('NAME_REVIEW_NOT_SPELLING_ONLY');
    }
  }
}

type ObservationWithLatestNameReview = ObservedResourceSourceFacts & {
  nameReviews?: ReadonlyArray<{
    reviewedName: string;
    sourceFactsFingerprint: string;
  }>;
};

/**
 * Curation-only projection. It does not update the observation, create an
 * identity decision, teach IQL, or alter source locators.
 */
export function reviewedNameForCuration(
  observation: ObservationWithLatestNameReview,
): string {
  const latest = observation.nameReviews?.[0];
  if (!latest) return observation.rawName;
  const current = observedResourceSourceFactsFingerprint(observation);
  if (latest.sourceFactsFingerprint !== current) {
    throw new ConflictException('OBSERVATION_SOURCE_FACTS_STALE');
  }
  assertSpellingOnlyNameReview(observation.rawName, latest.reviewedName);
  return latest.reviewedName;
}

export interface AppendObservedResourceNameReviewInput {
  workspaceId: string;
  observationId: string;
  actorAccountId: string;
  expectedVersion: number;
  expectedSourceFactsFingerprint: string;
  reviewedName: string;
  reason: string;
  evidence: string;
}

@Injectable()
export class ObservedResourceNameReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async read(workspaceId: string, observationId: string) {
    const observation = await this.prisma.observedResource.findFirst({
      where: { id: observationId, workspaceId },
      select: {
        id: true,
        status: true,
        rawName: true,
        rawCode: true,
        rawUnit: true,
        resourceType: true,
        sourceSha256: true,
        sheetName: true,
        sourceRowNumber: true,
        parserContractVersion: true,
      },
    });
    if (!observation) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    const sourceFactsFingerprint =
      observedResourceSourceFactsFingerprint(observation);
    const history = await this.prisma.observedResourceNameReview.findMany({
      where: { workspaceId, observationId },
      orderBy: { version: 'asc' },
      select: {
        id: true,
        version: true,
        reviewedName: true,
        actorAccountId: true,
        reason: true,
        evidence: true,
        sourceFactsFingerprint: true,
        createdAt: true,
      },
    });
    if (
      history.some(
        (event) => event.sourceFactsFingerprint !== sourceFactsFingerprint,
      )
    ) {
      throw new ConflictException('OBSERVATION_SOURCE_FACTS_STALE');
    }
    return {
      observationId: observation.id,
      observationStatus: observation.status,
      rawName: observation.rawName,
      policyVersion: OBSERVED_RESOURCE_NAME_REVIEW_POLICY_VERSION,
      sourceFactsFingerprint,
      currentVersion: history.at(-1)?.version ?? 0,
      latest: history.at(-1) ?? null,
      history,
    };
  }

  async append(input: AppendObservedResourceNameReviewInput) {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new BadRequestException('EXPECTED_VERSION_INVALID');
    }
    if (!SHA256.test(input.expectedSourceFactsFingerprint)) {
      throw new BadRequestException('SOURCE_FACTS_FINGERPRINT_INVALID');
    }
    const reason = input.reason?.trim();
    const evidence = input.evidence?.trim();
    if (!reason) throw new BadRequestException('REASON_REQUIRED');
    if (!evidence) throw new BadRequestException('EVIDENCE_REQUIRED');

    return this.prisma.$transaction(
      async (txc) => {
        const tx = txc as Prisma.TransactionClient;
        await lockObservedResourceNameReviewDecision(
          tx,
          input.workspaceId,
          input.observationId,
        );
        const observation = await tx.observedResource.findFirst({
          where: { id: input.observationId, workspaceId: input.workspaceId },
          select: {
            id: true,
            status: true,
            rawName: true,
            rawCode: true,
            rawUnit: true,
            resourceType: true,
            sourceSha256: true,
            sheetName: true,
            sourceRowNumber: true,
            parserContractVersion: true,
          },
        });
        if (!observation)
          throw new NotFoundException('OBSERVATION_NOT_FOUND');
        if (observation.status !== ObservedResourceStatus.OBSERVED) {
          throw new ConflictException('OBSERVATION_ALREADY_DECIDED');
        }
        const sourceFactsFingerprint =
          observedResourceSourceFactsFingerprint(observation);
        if (
          sourceFactsFingerprint !== input.expectedSourceFactsFingerprint
        ) {
          throw new ConflictException('OBSERVATION_SOURCE_FACTS_STALE');
        }
        const latest = await tx.observedResourceNameReview.findFirst({
          where: {
            workspaceId: input.workspaceId,
            observationId: input.observationId,
          },
          orderBy: { version: 'desc' },
        });
        if (
          latest &&
          latest.sourceFactsFingerprint !== sourceFactsFingerprint
        ) {
          throw new ConflictException('OBSERVATION_SOURCE_FACTS_STALE');
        }
        const currentVersion = latest?.version ?? 0;
        if (input.expectedVersion !== currentVersion) {
          throw new ConflictException('NAME_REVIEW_VERSION_CONFLICT');
        }
        assertSpellingOnlyNameReview(
          observation.rawName,
          input.reviewedName,
        );
        try {
          return await tx.observedResourceNameReview.create({
            data: {
              workspaceId: input.workspaceId,
              observationId: input.observationId,
              version: currentVersion + 1,
              reviewedName: input.reviewedName,
              actorAccountId: input.actorAccountId,
              reason,
              evidence,
              sourceFactsFingerprint,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new ConflictException('NAME_REVIEW_VERSION_CONFLICT');
          }
          throw error;
        }
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  }
}

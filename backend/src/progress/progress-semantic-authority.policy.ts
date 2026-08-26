import { ProgressActualStatus, ProgressAuditOutcome } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  isProgressActualCalculationEligible,
  selectCurrentCalculationLineageLeaves,
  type ProgressCalculationLineageInvalidReason,
} from './progress-actual-calculation.policy';
import { PROGRESS_AUTHORITIES } from './progress-authority.service';

export const MON04_SEMANTIC_POLICY_VERSION =
  'MON04_CURRENT_NUMERIC_LAW_V1' as const;
export const MON04_SEMANTIC_CONTEXT_VERSION = 1 as const;
export const MON04_SEMANTIC_ATTESTATION_TYPE =
  'DISTINCT_INCREMENT_NON_OVERLAP_CONFIRMED' as const;
export const MON04_SEMANTIC_AUDIT_ACTION =
  'ACTUAL_SEMANTIC_AUTHORITY_CONFIRMED' as const;

export interface ProgressSemanticContextEntry {
  id: string;
  supersedesEntryId: string | null;
  installedQuantity: { toString(): string } | string;
  workDate: Date | null;
  status: ProgressActualStatus;
  captureMethod: string;
  evidenceReferences: unknown;
  notes: string | null;
  correctionReasonCode: string | null;
  correctionReason: string | null;
  recordedByAccountId: string | null;
  revision: number;
}

export interface ProgressSemanticContextScope {
  projectId: string;
  activeBaselineId: string;
  boqItemId: string;
}

export type ProgressSemanticVerificationContext<
  T extends ProgressSemanticContextEntry,
> =
  | {
      state: 'VALID';
      policyVersion: typeof MON04_SEMANTIC_POLICY_VERSION;
      attestationType: typeof MON04_SEMANTIC_ATTESTATION_TYPE;
      contextVersion: typeof MON04_SEMANTIC_CONTEXT_VERSION;
      scope: ProgressSemanticContextScope;
      contextDigest: string;
      currentLeaves: readonly T[];
      currentLeafIds: readonly string[];
    }
  | {
      state: 'INVALID_LINEAGE';
      policyVersion: typeof MON04_SEMANTIC_POLICY_VERSION;
      attestationType: typeof MON04_SEMANTIC_ATTESTATION_TYPE;
      contextVersion: typeof MON04_SEMANTIC_CONTEXT_VERSION;
      scope: ProgressSemanticContextScope;
      reason: ProgressCalculationLineageInvalidReason;
      contextDigest: null;
      currentLeaves: readonly [];
      currentLeafIds: readonly [];
    };

export interface ProgressSemanticProofMetadata {
  policyVersion: typeof MON04_SEMANTIC_POLICY_VERSION;
  attestationType: typeof MON04_SEMANTIC_ATTESTATION_TYPE;
  contextVersion: typeof MON04_SEMANTIC_CONTEXT_VERSION;
  activeBaselineId: string;
  boqItemId: string;
  contextDigest: string;
  currentLeafIds: string[];
  explicitConfirmation: true;
}

export interface ProgressSemanticAuditCandidate {
  action: string;
  outcome: ProgressAuditOutcome;
  metadata: unknown;
  occurredAt: Date;
  actorAccountId: string;
  authorityCode: string | null;
  actor?: { displayName: string };
}

export type ProgressSemanticAuthority =
  | { state: 'NOT_PROVEN'; proof: null }
  | { state: 'STALE'; proof: null }
  | { state: 'INVALID_PROVENANCE'; proof: null }
  | {
      state: 'PROVEN';
      proof: {
        actorAccountId: string;
        actorDisplayName: string | null;
        authorityCode: string | null;
        occurredAt: Date;
      };
    };

const canonicalize = (input: unknown): unknown => {
  if (Array.isArray(input)) return input.map(canonicalize);
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, canonicalize(value)]),
    );
  }
  return input;
};

const stableDigest = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

const semanticEntryDigestProjection = (entry: ProgressSemanticContextEntry) =>
  ({
    id: entry.id,
    supersedesEntryId: entry.supersedesEntryId,
    installedQuantity: entry.installedQuantity.toString(),
    workDate: entry.workDate?.toISOString() ?? null,
    captureMethod: entry.captureMethod,
    evidenceReferences: entry.evidenceReferences,
    notes: entry.notes,
    correctionReasonCode: entry.correctionReasonCode,
    correctionReason: entry.correctionReason,
    recordedByAccountId: entry.recordedByAccountId,
    revision: entry.revision,
  }) as const;

/**
 * Builds MON-04 verification context by composing the existing canonical
 * lineage selector. Lifecycle status is exposed to the verifier but is not
 * part of the semantic digest: VERIFIED -> ACCEPTED is a lifecycle change,
 * not a change to the physical increment the human adjudicated.
 */
export function createProgressSemanticVerificationContext<
  T extends ProgressSemanticContextEntry,
>(
  scope: ProgressSemanticContextScope,
  entries: readonly T[],
): ProgressSemanticVerificationContext<T> {
  const orderedEntries = [...entries].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const lineage = selectCurrentCalculationLineageLeaves(orderedEntries);
  const common = {
    policyVersion: MON04_SEMANTIC_POLICY_VERSION,
    attestationType: MON04_SEMANTIC_ATTESTATION_TYPE,
    contextVersion: MON04_SEMANTIC_CONTEXT_VERSION,
    scope,
  } as const;

  if (lineage.state === 'INVALID_LINEAGE') {
    return {
      ...common,
      state: 'INVALID_LINEAGE',
      reason: lineage.reason,
      contextDigest: null,
      currentLeaves: [],
      currentLeafIds: [],
    };
  }

  const currentLeaves = [...lineage.leaves].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const currentLeafIds = currentLeaves.map((entry) => entry.id);
  const contextDigest = stableDigest({
    ...common,
    relevantEntries: orderedEntries.map(semanticEntryDigestProjection),
    currentLeafIds,
  });

  return {
    ...common,
    state: 'VALID',
    contextDigest,
    currentLeaves,
    currentLeafIds,
  };
}

export function isProgressSemanticAttestationEligible(
  status: ProgressActualStatus,
): boolean {
  return isProgressActualCalculationEligible(status);
}

export function progressSemanticProofMetadata(
  context: Extract<
    ProgressSemanticVerificationContext<ProgressSemanticContextEntry>,
    { state: 'VALID' }
  >,
): ProgressSemanticProofMetadata {
  return {
    policyVersion: context.policyVersion,
    attestationType: context.attestationType,
    contextVersion: context.contextVersion,
    activeBaselineId: context.scope.activeBaselineId,
    boqItemId: context.scope.boqItemId,
    contextDigest: context.contextDigest,
    currentLeafIds: [...context.currentLeafIds],
    explicitConfirmation: true,
  };
}

const asProofMetadata = (
  value: unknown,
): ProgressSemanticProofMetadata | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  if (
    metadata.policyVersion !== MON04_SEMANTIC_POLICY_VERSION ||
    metadata.attestationType !== MON04_SEMANTIC_ATTESTATION_TYPE ||
    metadata.contextVersion !== MON04_SEMANTIC_CONTEXT_VERSION ||
    typeof metadata.activeBaselineId !== 'string' ||
    typeof metadata.boqItemId !== 'string' ||
    typeof metadata.contextDigest !== 'string' ||
    metadata.explicitConfirmation !== true ||
    !Array.isArray(metadata.currentLeafIds) ||
    !metadata.currentLeafIds.every((id) => typeof id === 'string')
  ) {
    return null;
  }
  return metadata as unknown as ProgressSemanticProofMetadata;
};

export function readProgressSemanticAuthority(
  context: Extract<
    ProgressSemanticVerificationContext<ProgressSemanticContextEntry>,
    { state: 'VALID' }
  >,
  events: readonly ProgressSemanticAuditCandidate[],
): ProgressSemanticAuthority {
  const semanticEvents = events.filter(
    (event) =>
      event.action === MON04_SEMANTIC_AUDIT_ACTION &&
      event.outcome === ProgressAuditOutcome.SUCCESS,
  );
  if (semanticEvents.length === 0) return { state: 'NOT_PROVEN', proof: null };

  let hasValidStaleProof = false;
  let hasMalformedProof = false;
  for (const event of [...semanticEvents].reverse()) {
    const metadata = asProofMetadata(event.metadata);
    if (
      !metadata ||
      !event.actorAccountId ||
      event.authorityCode !== PROGRESS_AUTHORITIES.VERIFY
    ) {
      hasMalformedProof = true;
      continue;
    }
    const leafIdsMatch =
      metadata.currentLeafIds.length === context.currentLeafIds.length &&
      metadata.currentLeafIds.every(
        (id, index) => id === context.currentLeafIds[index],
      );
    if (
      metadata.activeBaselineId === context.scope.activeBaselineId &&
      metadata.boqItemId === context.scope.boqItemId &&
      metadata.contextDigest === context.contextDigest &&
      leafIdsMatch
    ) {
      return {
        state: 'PROVEN',
        proof: {
          actorAccountId: event.actorAccountId,
          actorDisplayName: event.actor?.displayName ?? null,
          authorityCode: event.authorityCode,
          occurredAt: event.occurredAt,
        },
      };
    }
    hasValidStaleProof = true;
  }

  if (hasValidStaleProof) return { state: 'STALE', proof: null };
  return hasMalformedProof
    ? { state: 'INVALID_PROVENANCE', proof: null }
    : { state: 'NOT_PROVEN', proof: null };
}

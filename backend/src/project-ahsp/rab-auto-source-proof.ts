import { createHash } from 'crypto';
import { normalizeWorkHeadingForEvidence } from './ahsp-preference';

/**
 * RAB-AUTO-04 — same canonical BOQ SOURCE fact, not a lexical AHSP matcher.
 *
 * A person's proven AHSP decision can be inherited only when both BOQ rows
 * refer to exactly one WBS node AND source row code, full work description and
 * output unit agree. Non-identical specifications are not silently narrowed.
 * This never turns two AHSP names into one identity.
 */
export interface BoqSourceFact {
  wbsNodeId: string | null;
  wbsCode: string;
  name: string;
  unit: string;
}
const sourceText = (v: string): string =>
  normalizeWorkHeadingForEvidence(v).toLocaleLowerCase('id-ID');
export function sameProvenBoqSourceFact(
  a: BoqSourceFact,
  b: BoqSourceFact,
): boolean {
  return Boolean(
    a.wbsNodeId &&
    b.wbsNodeId &&
    a.wbsNodeId === b.wbsNodeId &&
    a.wbsCode.trim() &&
    b.wbsCode.trim() &&
    a.wbsCode === b.wbsCode &&
    sourceText(a.name).length > 0 &&
    sourceText(a.name) === sourceText(b.name) &&
    a.unit.trim().length > 0 &&
    a.unit === b.unit,
  );
}


/**
 * Internal RAB-AUTO context-refresh proof, NOT an AHSP matcher.
 *
 * The first refresh request carries a BOQ revision and the previously working
 * occurrence. A user-supplied idempotencyKey is never proof by itself: manual
 * selection cannot supply the internal refresh fields, so its payload hash
 * cannot satisfy the historical refresh proof below.
 */
type ContextRefreshFacts = {
  projectId: string;
  boqItemId: string;
  previousOccurrenceId: string;
  ahspVersionId: string;
  referenceRegionId: string;
  businessPricingAsOfDate: string;
  boqUpdatedAt: string;
};

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const buildProvenContextRefreshKey = (f: ContextRefreshFacts): string =>
  'rab-auto-context-' + f.boqItemId + '-' + f.boqUpdatedAt + '-' + digest([
    f.projectId,
    f.boqItemId,
    f.previousOccurrenceId,
    f.ahspVersionId,
    f.referenceRegionId,
    f.businessPricingAsOfDate,
    f.boqUpdatedAt,
  ].join('|'));

export function isProvenContextRefreshOccurrence(input: {
  projectId: string;
  boqItemId: string;
  ahspVersionId: string;
  referenceRegionId: string;
  businessPricingAsOfDate: string;
  previousOccurrenceId: string | null;
  resolutionPolicyVersion: string | null;
  idempotencyKey: string;
  requestPayloadHash: string | null;
}): boolean {
  if (!input.previousOccurrenceId ||
      !input.resolutionPolicyVersion || !input.requestPayloadHash) return false;
  const prefix = 'rab-auto-context-' + input.boqItemId + '-';
  if (!input.idempotencyKey.startsWith(prefix)) return false;
  const suffix = input.idempotencyKey.slice(prefix.length);
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)-([a-f0-9]{64})$/.exec(suffix);
  if (!match || !Number.isFinite(Date.parse(match[1]))) return false;
  const originalRevision = match[1];
  const canonical = buildProvenContextRefreshKey({
    projectId: input.projectId,
    boqItemId: input.boqItemId,
    previousOccurrenceId: input.previousOccurrenceId,
    ahspVersionId: input.ahspVersionId,
    referenceRegionId: input.referenceRegionId,
    businessPricingAsOfDate: input.businessPricingAsOfDate,
    boqUpdatedAt: originalRevision,
  });
  if (canonical !== input.idempotencyKey) return false;
  const originalPayloadHash = digest(JSON.stringify({
    boqItemId: input.boqItemId,
    ahspVersionId: input.ahspVersionId,
    businessPricingAsOfDate: input.businessPricingAsOfDate,
    referenceRegionId: input.referenceRegionId,
    resolutionPolicyVersion: input.resolutionPolicyVersion,
    refreshSourceOccurrenceId: input.previousOccurrenceId,
    refreshExpectedBoqUpdatedAt: originalRevision,
  }));
  return originalPayloadHash === input.requestPayloadHash;
}


/**
 * Narrow RAB-AUTO-04 adjunct for legacy BOQ rows with no WBS node.
 * NOT a text matcher or a first-association inference: both rows must live in
 * the same server-scoped Working Draft (enforced by the caller), retain the
 * same source WBS code and entire meaning-bearing description/specification,
 * share the exact source unit, and have one governed prior occurrence.
 *
 * Unlike sameProvenBoqSourceFact, this helper MUST NOT be used without
 * transactionally checking the unique, human-originated source decision.
 */
export function samePreviouslyDecidedUnindexedWorkFact(
  a: BoqSourceFact,
  b: BoqSourceFact,
): boolean {
  const exactWork = (text: string): string =>
    normalizeWorkHeadingForEvidence(text)
      .replace(/^Pekerjaan\s+/iu, '')
      .trim()
      .toLocaleLowerCase('id-ID');
  return Boolean(
    a.wbsNodeId === null &&
    b.wbsNodeId === null &&
    a.wbsCode.trim() &&
    b.wbsCode.trim() &&
    a.wbsCode.trim() === b.wbsCode.trim() &&
    exactWork(a.name) &&
    exactWork(a.name) === exactWork(b.name) &&
    a.unit.trim() &&
    a.unit === b.unit,
  );
}

export function unindexedWorkSearchTerm(name: string): string {
  return normalizeWorkHeadingForEvidence(name)
    .replace(/^Pekerjaan\s+/iu, '')
    .trim();
}

/**
 * Requires positive persisted provenance, not the user-editable idempotency
 * prefix alone. A refreshed occurrence must prove the existing canonical
 * context-refresh hash AND trace back to one human-governed original choice.
 */
export function hasGovernedUnindexedSource(
  sourceBoqItemId: string,
  occurrence: {
    ahspVersionId: string;
    createdByAccountId: string | null;
    idempotencyKey: string;
    requestPayloadHash: string | null;
    resolutionPolicyVersion: string | null;
    previousOccurrenceId: string | null;
    businessPricingAsOfDate: Date | null;
    referenceRegionId: string | null;
    previousOccurrence?: {
      ahspVersionId: string;
      createdByAccountId: string | null;
      idempotencyKey: string;
      requestPayloadHash: string | null;
      resolutionPolicyVersion: string | null;
    } | null;
  },
  projectId: string,
): boolean {
  if (!occurrence.createdByAccountId || !occurrence.requestPayloadHash ||
      !occurrence.resolutionPolicyVersion) return false;
  if (occurrence.idempotencyKey.startsWith('rab-auto-context-')) {
    const prior = occurrence.previousOccurrence;
    if (!prior || !prior.createdByAccountId || !prior.requestPayloadHash ||
        !prior.resolutionPolicyVersion ||
        prior.ahspVersionId !== occurrence.ahspVersionId ||
        prior.idempotencyKey.startsWith('rab-auto-') ||
        !occurrence.businessPricingAsOfDate || !occurrence.referenceRegionId) {
      return false;
    }
    return isProvenContextRefreshOccurrence({
      projectId,
      boqItemId: sourceBoqItemId,
      ahspVersionId: occurrence.ahspVersionId,
      referenceRegionId: occurrence.referenceRegionId,
      businessPricingAsOfDate:
        occurrence.businessPricingAsOfDate.toISOString().slice(0, 10),
      previousOccurrenceId: occurrence.previousOccurrenceId,
      resolutionPolicyVersion: occurrence.resolutionPolicyVersion,
      idempotencyKey: occurrence.idempotencyKey,
      requestPayloadHash: occurrence.requestPayloadHash,
    });
  }
  return !occurrence.idempotencyKey.startsWith('rab-auto-') &&
    occurrence.previousOccurrenceId === null;
}

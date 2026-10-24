import { ResourceType } from '@prisma/client';
import {
  reuseExactPrivateReviewedMapping,
  type ResourceIdentityResolution,
  type ReviewedMappingEvidence,
} from '../resource-catalog/resource-identity-resolution.kernel';

const resourceId = 'baja-tulangan-private';
const unitId = 'kg-canonical-unit';

const historicalMapping: ReviewedMappingEvidence = {
  mappingId: 'audit-old-mapping',
  resourceCatalogId: resourceId,
  rawName: 'Baja Tulangan/Besi Beton',
  rawCode: 'M57a',
  rawUnit: 'Kg',
  resourceType: ResourceType.MATERIAL,
  unitDefinitionId: unitId,
  originatingRowStatus: 'READY_FOR_SUBMISSION',
  hasAuditedSourceSpecifications: false,
  reviewerAccountId: 'real-owner-account',
  decidedAt: '2026-10-22T04:40:42.745Z',
  reason: null,
};

const verdict: ResourceIdentityResolution = {
  status: 'NEEDS_REVIEW',
  authority: 'EVIDENCE_CANDIDATE',
  resolvedResourceCatalogId: null,
  candidates: [{
    resourceCatalogId: resourceId,
    name: 'Baja tulangan',
    code: null,
    type: ResourceType.MATERIAL,
    baseUnit: 'Kg',
    evidence: ['REVIEWED_MAPPING_NAME_MATCH', 'REVIEWED_MAPPING_CODE_MATCH'],
    identityBasis: 'RECORDED_FACT',
    specificationUnproved: false,
    unprovedSpecificationFacts: [],
    specifications: null,
    priorHumanDecision: {
      reviewerAccountId: 'real-owner-account',
      decidedAt: historicalMapping.decidedAt,
      reason: null,
    },
  }],
  reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
  explanation: 'Previous user choice is nominated, but not a permanent identity without a strict replay proof.',
};

const current = {
  rawName: 'Baja Tulangan/Besi Beton',
  rawCode: 'M57a',
  rawUnit: 'Kg',
  resourceType: ResourceType.MATERIAL,
};

const reuse = (reference = current, mappings = [historicalMapping], currentUnit: string | null = unitId, candidateVerdict = verdict) =>
  reuseExactPrivateReviewedMapping(candidateVerdict, reference, currentUnit, mappings);

describe('BP-PRIVATE-LEARNING — exact prior user mapping through canonical identity kernel', () => {
  it('reuses a previously verified exact raw question with same proven canonical unit', () => {
    const result = reuse();
    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('VERIFIED_PRIVATE_ROW_MAPPING_REUSED');
    expect(result.resolvedResourceCatalogId).toBe(resourceId);
    expect(result.reasonCodes).toEqual(['VERIFIED_PRIVATE_ROW_MAPPING_REUSED']);
  });

  it('refuses a different source code or raw name (never a fuzzy family match)', () => {
    expect(reuse({ ...current, rawCode: 'M39b' }).status).toBe('NEEDS_REVIEW');
    expect(reuse({ ...current, rawName: 'Besi Beton 12 mm' }).status).toBe('NEEDS_REVIEW');
  });

  it('refuses changed raw unit, changed canonical unit or resource type', () => {
    expect(reuse({ ...current, rawUnit: 'Ton' }).status).toBe('NEEDS_REVIEW');
    expect(reuse(current, [historicalMapping], 'ton-canonical-unit').status).toBe('NEEDS_REVIEW');
    expect(reuse({ ...current, resourceType: ResourceType.EQUIPMENT }).status).toBe('NEEDS_REVIEW');
  });

  it('refuses conflicting historical decisions instead of selecting the newest one', () => {
    const conflict = { ...historicalMapping, mappingId: 'different-old-event', resourceCatalogId: 'other-catalog' };
    expect(reuse(current, [historicalMapping, conflict]).status).toBe('NEEDS_REVIEW');
  });

  it('does not reuse a prior row that was rejected or had audited source specifications', () => {
    expect(reuse(current, [{ ...historicalMapping, originatingRowStatus: 'REJECTED' }]).status).toBe('NEEDS_REVIEW');
    expect(reuse(current, [{ ...historicalMapping, hasAuditedSourceSpecifications: true }]).status).toBe('NEEDS_REVIEW');
  });

  it('does not treat a source specification as a generic same-question approval', () => {
    expect(reuse({ ...current, confirmedSpecifications: { mutu: 'BJTS 420' } } as typeof current).status).toBe('NEEDS_REVIEW');
  });

  it('does not auto-accept a candidate missing from current evidence or with unproved specifications', () => {
    expect(reuse(current, [historicalMapping], unitId, { ...verdict, candidates: [] }).status).toBe('NEEDS_REVIEW');
    expect(reuse(current, [historicalMapping], unitId, {
      ...verdict,
      candidates: verdict.candidates.map(c => ({ ...c, specificationUnproved: true })),
    }).status).toBe('NEEDS_REVIEW');
  });

  it('does not equate name-similarity evidence with recorded human identity', () => {
    expect(reuse(current, [historicalMapping], unitId, {
      ...verdict,
      candidates: verdict.candidates.map(c => ({ ...c, identityBasis: 'NAME_SIMILARITY_ONLY' })),
    }).status).toBe('NEEDS_REVIEW');
  });

  it('never reverses a machine-resolved verdict or silently writes a new mapping', () => {
    const already = { ...verdict, status: 'RESOLVED' as const, authority: 'EXACT_CANONICAL_MATCH' as const, resolvedResourceCatalogId: resourceId };
    expect(reuse(current, [historicalMapping], unitId, already)).toBe(already);
  });
});

import { ResourceType } from '@prisma/client';
import {
  categoryProvenByExactPriorReview,
  type ReviewedMappingEvidence,
} from '../resource-catalog/resource-identity-resolution.kernel';

const source = {
  rawName: 'Baja Tulangan/Besi Beton',
  rawCode: 'M57a',
  rawUnit: 'Kg',
  resourceType: ResourceType.MATERIAL,
  sourceSha256: 'SAME_EXACT_FILE_SHA',
  sourceRowNumber: 22,
  hasAuditedSpecifications: false,
};

const prior: ReviewedMappingEvidence = {
  mappingId: 'prior-accepted-human-decision',
  resourceCatalogId: 'catalog-baja-tulangan',
  rawName: source.rawName,
  rawCode: source.rawCode,
  rawUnit: source.rawUnit,
  resourceType: source.resourceType,
  sourceSha256: source.sourceSha256,
  sourceRowNumber: source.sourceRowNumber,
  priorCategoryConfirmed: true,
  priorCategoryHistoryConflicted: false,
  hasAuditedSourceSpecifications: false,
  originatingRowStatus: 'READY_FOR_SUBMISSION',
  unitDefinitionId: 'CANONICAL_KG',
  reviewerAccountId: 'human-account',
  decidedAt: '2026-10-22T04:40:42.745Z',
  reason: null,
};

const prove = (q = source, history: ReviewedMappingEvidence[] = [prior]) =>
  categoryProvenByExactPriorReview(q, history);

describe('BP category memory: exact source + append-only human confirmation only', () => {
  it('reuses the already-reviewed category for exact same input', () => {
    expect(prove()).toBe(true);
  });

  it('never uses a bare uploader category or unreviewed catalog candidate', () => {
    expect(prove(source, [{ ...prior, priorCategoryConfirmed: false }])).toBe(false);
    expect(prove(source, [{ ...prior, priorCategoryConfirmed: undefined }])).toBe(false);
  });

  it('requires exact file SHA, row coordinate and source question', () => {
    expect(prove({ ...source, sourceSha256: 'OTHER_FILE_SHA' })).toBe(false);
    expect(prove({ ...source, sourceRowNumber: 23 })).toBe(false);
    expect(prove({ ...source, rawName: 'Besi Beton 16 mm' })).toBe(false);
    expect(prove({ ...source, rawCode: 'M57b' })).toBe(false);
    expect(prove({ ...source, rawUnit: 'Ton' })).toBe(false);
    expect(prove({ ...source, sourceSha256: undefined })).toBe(false);
  });

  it('must match the same material/labor/equipment category', () => {
    expect(prove({ ...source, resourceType: ResourceType.EQUIPMENT })).toBe(false);
    expect(prove({ ...source, resourceType: null })).toBe(false);
  });

  it('recalls the independently audited category of a size-specific resource', () => {
    // Exact historical Paku 5-7 cm: the SAME file/row/category was confirmed,
    // even though a separate size specification was also audited. This does
    // NOT prove an arbitrary catalog identity or allow reuse of generic nails.
    const nails = { ...source, rawName: 'Paku 5-7 cm', rawCode: 'M18', sourceRowNumber: 27, hasAuditedSpecifications: false };
    const priorNails = {
      ...prior, rawName: nails.rawName, rawCode: nails.rawCode,
      sourceRowNumber: nails.sourceRowNumber,
      resourceCatalogId: 'distinct-specialized-nails', hasAuditedSourceSpecifications: true,
    };
    expect(prove(nails, [priorNails])).toBe(true);
    expect(prove({ ...nails, hasAuditedSpecifications: true }, [priorNails])).toBe(true);
    expect(prove({ ...nails, resourceType: ResourceType.LABOR }, [priorNails])).toBe(false);
    expect(prove(nails, [{ ...priorNails, priorCategoryHistoryConflicted: true }])).toBe(false);
  });

  it('refuses contradictory historical category and catalog answers', () => {
    expect(prove(source, [{ ...prior, priorCategoryHistoryConflicted: true }])).toBe(false);
    expect(prove(source, [prior, { ...prior, mappingId: 'conflicting', resourceType: ResourceType.LABOR }])).toBe(false);
    expect(prove(source, [prior, { ...prior, mappingId: 'conflicting', resourceCatalogId: 'other-resource' }])).toBe(false);
  });

  it('does not reuse rejected or unattributed prior decisions', () => {
    expect(prove(source, [{ ...prior, originatingRowStatus: 'REJECTED' }])).toBe(false);
    expect(prove(source, [{ ...prior, reviewerAccountId: '' }])).toBe(false);
    expect(prove(source, [])).toBe(false);
  });
});

import { ResourceType } from '@prisma/client';
import { resolveResourceIdentity } from '../resource-catalog/resource-identity-resolution.kernel';
import { buildBasicPriceAdmissionReview } from './basic-price-row-resolution-proposal.service';

const reviewQuestion = (rawName: string, rawUnit: string, rawCode: string | null = null) => ({
  workspaceId: 'workspace-verified',
  batchId: 'batch-verified',
  rowId: 'row-verified',
  rowVersion: 1,
  sourceSha256: 'f'.repeat(64),
  rawResourceNameText: rawName,
  rawResourceCodeText: rawCode,
  rawUnitText: rawUnit,
  sourceSection: ResourceType.MATERIAL,
  sourceSectionProvenance: 'UPLOADER_DECLARED',
  rowCategoryConfirmedByReviewer: true,
});

const genericPaku = {
  id: 'generic-paku', code: null, name: 'Paku Biasa Segala Ukuran',
  type: ResourceType.MATERIAL, baseUnit: 'Kg', status: 'ACTIVE',
  specifications: null,
};

const specificPakuReference = (rawCode: string | null) => ({
  rawName: 'Paku 5-7 cm',
  rawCode,
  rawUnit: 'Kg',
  resourceType: ResourceType.MATERIAL,
  confirmedSpecifications: { ukuran: '5-7 cm' },
});

describe('BP general-versus-specific product law — real kernel and existing private admission', () => {
  it('never auto-equates Paku 5-7 cm with Paku Biasa Segala Ukuran when evidence is missing', () => {
    const verdict = resolveResourceIdentity({
      reference: specificPakuReference(null),
      catalogCandidates: [genericPaku],
      sourceSightings: [], reviewedMappings: [],
    });
    expect(verdict.status).toBe('UNRESOLVED');
    expect(verdict.resolvedResourceCatalogId).toBeNull();
    expect(verdict.candidates).toEqual([]);
    const review = buildBasicPriceAdmissionReview(
      reviewQuestion('Paku 5-7 cm', 'Kg'), verdict, new Set(),
    );
    expect(review.offered).toBe(true);
    expect(review.humanRefusableCandidateIds).toEqual([]);
    expect(review.blockedCandidateIds).toEqual([]);
  });

  it('a reused source code M18 never forces a specific nail to equal a general nail without adjudication', () => {
    const verdict = resolveResourceIdentity({
      reference: specificPakuReference('M18'),
      catalogCandidates: [genericPaku],
      sourceSightings: [{
        resourceCatalogId: genericPaku.id,
        rawName: 'Paku Biasa Segala Ukuran',
        rawCode: 'M18',
        rawUnit: 'Kg',
        sourceSection: 'MATERIAL',
        sourceSha256: 'e'.repeat(64),
        sheetName: 'Daftar Komponen',
        sourceRowNumber: 12,
      }],
      reviewedMappings: [],
    });
    expect(verdict.status).toBe('NEEDS_REVIEW');
    expect(verdict.resolvedResourceCatalogId).toBeNull();
    expect(verdict.candidates[0].identityBasis).toBe('RECORDED_FACT');
    const review = buildBasicPriceAdmissionReview(
      reviewQuestion('Paku 5-7 cm', 'Kg', 'M18'),
      verdict, new Set([genericPaku.id]),
    );
    expect(review.offered).toBe(false);
    expect(review.blockedCandidateIds).toEqual([genericPaku.id]);
  });

  it('generic Semen is not silently identified with branded Semen Tonasa', () => {
    const branded = {
      id: 'specific-semen-tonasa', code: null, name: 'Semen Tonasa',
      type: ResourceType.MATERIAL, baseUnit: 'Zak', status: 'ACTIVE',
      specifications: { merek: 'Tonasa' },
    };
    const verdict = resolveResourceIdentity({
      reference: { rawName: 'Semen', rawCode: null, rawUnit: 'Zak', resourceType: ResourceType.MATERIAL },
      catalogCandidates: [branded],
      sourceSightings: [], reviewedMappings: [],
    });
    expect(verdict.resolvedResourceCatalogId).toBeNull();
    expect(verdict.status).toBe('NEEDS_REVIEW');
    expect(verdict.candidates[0].identityBasis).toBe('NAME_SIMILARITY_ONLY');
    const review = buildBasicPriceAdmissionReview(
      reviewQuestion('Semen', 'Zak'), verdict, new Set([branded.id]),
    );
    expect(review.offered).toBe(true);
    expect(review.humanRefusableCandidateIds).toEqual([branded.id]);
  });

  it('an exactly identical, proven same-specification nail still reuses canonical identity', () => {
    const specific = {
      id: 'same-specific-paku', code: null, name: 'Paku 5-7 cm',
      type: ResourceType.MATERIAL, baseUnit: 'Kg', status: 'ACTIVE',
      specifications: { ukuran: '5-7 cm' },
    };
    const verdict = resolveResourceIdentity({
      reference: specificPakuReference(null),
      catalogCandidates: [specific],
      sourceSightings: [], reviewedMappings: [],
    });
    expect(verdict.status).toBe('RESOLVED');
    expect(verdict.resolvedResourceCatalogId).toBe(specific.id);
    const review = buildBasicPriceAdmissionReview(
      reviewQuestion('Paku 5-7 cm', 'Kg'), verdict, new Set([specific.id]),
    );
    expect(review.offered).toBe(false);
  });
});

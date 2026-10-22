import { ResourceType } from '@prisma/client';
import { resolveResourceIdentity, isAdmissibleAfterExamination, isEvidenceBoundSpecificVariantOfGeneral } from '../resource-catalog/resource-identity-resolution.kernel';
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
      { ...reviewQuestion('Paku 5-7 cm', 'Kg', 'M18'),
        confirmedSpecifications: { ukuran: '5-7 cm' } },
      verdict, new Set([genericPaku.id]),
    );
    expect(review.offered).toBe(true);
    expect(review.humanRefusableCandidateIds).toEqual([genericPaku.id]);
  });


  it('the shared locked gate needs an explicit, current human refusal of a broad M18 nail candidate', () => {
    const candidate = genericPaku;
    const reference = specificPakuReference('M18');
    const verdict = resolveResourceIdentity({
      reference, catalogCandidates: [candidate],
      sourceSightings: [{
        resourceCatalogId: candidate.id, rawName: 'Paku Biasa Segala Ukuran',
        rawCode: 'M18', rawUnit: 'Kg', sourceSection: 'MATERIAL',
        sourceSha256: 'e'.repeat(64), sheetName: 'Daftar Komponen', sourceRowNumber: 12,
      }], reviewedMappings: [],
    });
    expect(verdict.status).toBe('NEEDS_REVIEW');
    expect(verdict.candidates[0].identityBasis).toBe('RECORDED_FACT');
    const review = buildBasicPriceAdmissionReview(
      { ...reviewQuestion('Paku 5-7 cm', 'Kg', 'M18'),
        confirmedSpecifications: { ukuran: '5-7 cm' } },
      verdict, new Set([candidate.id]),
    );
    expect(review.offered).toBe(true);
    expect(review.humanRefusableCandidateIds).toEqual([candidate.id]);
    const witness = { refusedCandidateIds: [candidate.id], candidateContextDigest: review.candidateContextDigest };
    expect(isAdmissibleAfterExamination(verdict, witness, review.candidateContextDigest)).toBe(false);
    expect(isAdmissibleAfterExamination(verdict, witness, review.candidateContextDigest, reference)).toBe(true);
    expect(isAdmissibleAfterExamination(verdict, witness, 'stale-context', reference)).toBe(false);
    expect(isAdmissibleAfterExamination(verdict, { ...witness, refusedCandidateIds: [] }, review.candidateContextDigest, reference)).toBe(false);
  });

  it('does not permit a historical strong candidate to be refused without confirmed specifications or with a same-name scope', () => {
    const source = specificPakuReference('M18');
    const candidate = {
      ...genericPaku, id: 'paku-specific-alias', name: 'Paku 5-7 cm',
      specifications: null,
    };
    const verdict = resolveResourceIdentity({
      reference: source, catalogCandidates: [candidate],
      sourceSightings: [{
        resourceCatalogId: candidate.id, rawName: 'Paku 5-7 cm', rawCode: 'M18',
        rawUnit: 'Kg', sourceSection: 'MATERIAL',
        sourceSha256: 'e'.repeat(64), sheetName: 'Sheet1', sourceRowNumber: 1,
      }], reviewedMappings: [],
    });
    expect(isEvidenceBoundSpecificVariantOfGeneral(source, {
      resourceCatalogId: candidate.id, name: candidate.name, type: candidate.type,
      code: null, baseUnit: 'Kg', evidence: [], identityBasis: 'RECORDED_FACT',
      specifications: null, specificationUnproved: false, unprovedSpecificationFacts: [],
      priorHumanDecision: null,
    })).toBe(false);
    const broadCandidate = { ...candidate, name: 'Paku Biasa Segala Ukuran' };
    expect(isEvidenceBoundSpecificVariantOfGeneral(
      { ...source, confirmedSpecifications: null },
      { resourceCatalogId: broadCandidate.id, name: broadCandidate.name, type: broadCandidate.type,
        code: null, baseUnit: 'Kg', evidence: [], identityBasis: 'RECORDED_FACT',
        specifications: null, specificationUnproved: false, unprovedSpecificationFacts: [],
        priorHumanDecision: null },
    )).toBe(false);
    expect(verdict.status).not.toBe('RESOLVED');
  });

  it('permits different specific cement brand against strongly recorded generic Semen, without forcing identity', () => {
    const general = {
      id: 'catalog-semen-umum', name: 'Semen', type: ResourceType.MATERIAL,
      baseUnit: 'Zak', code: null, status: 'ACTIVE', specifications: null,
    };
    const ref = {
      rawName: 'Semen Tonasa', rawCode: 'M31', rawUnit: 'Zak',
      resourceType: ResourceType.MATERIAL,
      confirmedSpecifications: { merek: 'Tonasa' },
    };
    const verdict = resolveResourceIdentity({
      reference: ref, catalogCandidates: [general],
      sourceSightings: [{
        resourceCatalogId: general.id, rawName: 'Semen', rawCode: 'M31',
        rawUnit: 'Zak', sourceSection: 'MATERIAL', sourceSha256: 'e'.repeat(64),
        sheetName: 'Harga', sourceRowNumber: 3,
      }], reviewedMappings: [],
    });
    expect(verdict.resolvedResourceCatalogId).toBeNull();
    expect(verdict.candidates[0].identityBasis).toBe('RECORDED_FACT');
    const review = buildBasicPriceAdmissionReview(
      { ...reviewQuestion('Semen Tonasa', 'Zak', 'M31'),
        confirmedSpecifications: { merek: 'Tonasa' } },
      verdict, new Set([general.id]),
    );
    expect(review.offered).toBe(true);
    expect(review.humanRefusableCandidateIds).toEqual([general.id]);
  });

  it('refuses a strong recorded candidate with unproved scope or inaccessible identity', () => {
    const reference = specificPakuReference('M18');
    const candidate = {
      id: 'catalog-paku', code: null, name: 'Paku Biasa Segala Ukuran',
      type: ResourceType.MATERIAL, baseUnit: 'Kg', status: 'ACTIVE',
      specifications: null,
    };
    const verdict = resolveResourceIdentity({
      reference, catalogCandidates: [candidate],
      sourceSightings: [{
        resourceCatalogId: candidate.id, rawName: 'Paku Segala Ukuran', rawCode: 'M18',
        rawUnit: 'Kg', sourceSection: 'MATERIAL', sourceSha256: 'e'.repeat(64),
        sheetName: 'Harga', sourceRowNumber: 3,
      }], reviewedMappings: [],
    });
    const unproved = buildBasicPriceAdmissionReview(
      reviewQuestion('Paku 5-7 cm', 'Kg', 'M18'), verdict, new Set([candidate.id]),
    );
    expect(unproved.offered).toBe(false);
    expect(unproved.blockedCandidateIds).toEqual([candidate.id]);
    const outside = buildBasicPriceAdmissionReview(
      { ...reviewQuestion('Paku 5-7 cm', 'Kg', 'M18'),
        confirmedSpecifications: { ukuran: '5-7 cm' } },
      verdict, new Set(),
    );
    expect(outside.offered).toBe(false);
    expect(outside.blockedCandidateIds).toEqual([candidate.id]);
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

import { ResourceType } from '@prisma/client';
import { candidateContextDigest } from './ghx-candidate-context';
import {
  isAdmissibleAfterExamination,
  isEvidenceBoundSpecificVariantOfGeneral,
  resolveResourceIdentity,
} from './resource-identity-resolution.kernel';
import { sourceStatedSpecifications } from './resource-identity-specification.contract';

describe('AHSP source-bound specific resource, existing Resource Identity law', () => {
  const rawName = 'Mini Excavator 40–60 HP';
  const generic = {
    id: 'mini-general',
    code: null,
    name: 'Mini Excavator',
    type: ResourceType.EQUIPMENT,
    baseUnit: 'Jam',
    status: 'ACTIVE' as const,
    specifications: null,
  };
  const source = {
    resourceCatalogId: generic.id,
    rawName: 'Mini Excavator',
    rawCode: 'E10',
    rawUnit: 'Jam',
    sourceSection: 'EQUIPMENT',
    sourceSha256: 'a'.repeat(64),
    sheetName: 'AHSP',
    sourceRowNumber: 1,
  };
  const reference = (specs?: Record<string, string> | null) => ({
    rawName,
    rawCode: 'E10',
    rawUnit: 'Jam',
    resourceType: ResourceType.EQUIPMENT,
    ...(specs ? { confirmedSpecifications: specs } : {}),
  });
  const resolve = (specs?: Record<string, string> | null) =>
    resolveResourceIdentity({
      reference: reference(specs),
      catalogCandidates: [generic],
      sourceSightings: [source],
      reviewedMappings: [],
    });

  it('code E10 plus generic label does NOT automatically prove specific mini excavator identity', () => {
    const verdict = resolve();
    expect(verdict.status).not.toBe('RESOLVED');
    expect(verdict.resolvedResourceCatalogId).toBeNull();
  });

  it('human source-visible 40–60 HP with reason reuses the existing kernel rejection and admission predicate', () => {
    const specs = sourceStatedSpecifications(
      rawName,
      { kapasitas: '40–60 HP' },
      'Catalog only records the general Mini Excavator',
    );
    expect(specs).toEqual({ kapasitas: '40–60 HP' });
    const verdict = resolve(specs);
    expect(verdict.status).toBe('NEEDS_REVIEW');
    expect(
      isEvidenceBoundSpecificVariantOfGeneral(
        reference(specs),
        verdict.candidates[0],
      ),
    ).toBe(true);
    const digest = candidateContextDigest(
      verdict.candidates.map((c) => ({
        resourceCatalogId: c.resourceCatalogId,
        name: c.name,
        type: c.type,
        baseUnit: c.baseUnit,
        specifications: c.specifications,
      })),
    );
    const displayedBeforeReview = resolve();
    const displayedDigest = candidateContextDigest(
      displayedBeforeReview.candidates.map((c) => ({
        resourceCatalogId: c.resourceCatalogId,
        name: c.name,
        type: c.type,
        baseUnit: c.baseUnit,
        specifications: c.specifications,
      })),
    );
    expect(displayedDigest).toBe(digest); // The user refuses exactly what was displayed, not a newly fabricated set.
    expect(
      isAdmissibleAfterExamination(
        verdict,
        { refusedCandidateIds: [generic.id], candidateContextDigest: digest },
        digest,
        reference(specs),
      ),
    ).toBe(true);
    expect(
      isAdmissibleAfterExamination(
        verdict,
        { refusedCandidateIds: [generic.id], candidateContextDigest: 'stale' },
        digest,
        reference(specs),
      ),
    ).toBe(false);
  });

  it('source text is required and a person cannot invent capacity, claim a bare label, or omit reason', () => {
    expect(
      sourceStatedSpecifications(rawName, { kapasitas: '90 HP' }, 'different'),
    ).toBeNull();
    expect(
      sourceStatedSpecifications(
        'Mini Excavator',
        { kapasitas: '40–60 HP' },
        'different',
      ),
    ).toBeNull();
    expect(
      sourceStatedSpecifications(rawName, { kapasitas: '40–60 HP' }, ''),
    ).toBeNull();
    expect(
      sourceStatedSpecifications(
        rawName,
        { inventedscope: '40–60 HP' },
        'different',
      ),
    ).toBeNull();
    expect(
      isEvidenceBoundSpecificVariantOfGeneral(
        reference(),
        resolve().candidates[0],
      ),
    ).toBe(false);
  });

  it('a source exactly the same as the candidate cannot create a variant by declared specs', () => {
    const same = {
      ...reference({ kapasitas: '40–60 HP' }),
      rawName: 'Mini Excavator',
    };
    const verdict = resolve({ kapasitas: '40–60 HP' });
    expect(
      isEvidenceBoundSpecificVariantOfGeneral(same, verdict.candidates[0]),
    ).toBe(false);
  });
});

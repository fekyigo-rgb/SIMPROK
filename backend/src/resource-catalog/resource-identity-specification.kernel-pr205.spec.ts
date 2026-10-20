import { resolveResourceIdentity } from './resource-identity-resolution.kernel';

const catalog = (specifications: unknown) => ({
  id: 'canonical-pump-one', code: null, name: 'Pompa Air', type: 'MATERIAL',
  baseUnit: 'UNIT', status: 'ACTIVE', specifications,
});
const ask = (claimed?: Record<string, string> | null, stored: unknown = { merek: 'Shimizu', tipe: 'PS-128' }) =>
  resolveResourceIdentity({
    reference: {
      rawName: 'Pompa Air', rawCode: null, rawUnit: 'UNIT', resourceType: 'MATERIAL',
      ...(claimed === undefined ? {} : { confirmedSpecifications: claimed }),
    },
    catalogCandidates: [catalog(stored)], sourceSightings: [], reviewedMappings: [],
  });

describe('PR205 single LOCKED resource kernel — verified specification question', () => {
  it('never assumes unspecified source model equals a branded catalog', () => {
    expect(ask().status).toBe('NEEDS_REVIEW');
  });
  it('matches an already-proven identical brand and model, preserving catalog identity', () => {
    const result = ask({ merek: 'Shimizu', tipe: 'PS-128' });
    expect(result.status).toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBe('canonical-pump-one');
  });
  it('does not conflate the same name with a positively conflicting brand', () => {
    const result = ask({ merek: 'Panasonic', tipe: 'PS-128' });
    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('SPECIFICATION_CONFLICT');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });
  it('never assumes unrecorded catalog specifications establish a new identity', () => {
    const result = ask({ merek: 'Shimizu' }, null);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
  });
  it('refuses partial evidence where the catalog knows an extra model', () => {
    const result = ask({ merek: 'Shimizu' });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });
  it('selects an exact specified identity from multiple same-name and same-unit variants only when every alternative conflicts', () => {
    const result = resolveResourceIdentity({
      reference: {
        rawName: 'Pompa Air', rawCode: null, rawUnit: 'UNIT', resourceType: 'MATERIAL',
        confirmedSpecifications: { merek: 'Shimizu', tipe: 'PS-128' },
      },
      catalogCandidates: [
        catalog({ merek: 'Shimizu', tipe: 'PS-128' }),
        { ...catalog({ merek: 'Panasonic', tipe: 'GA-130' }), id: 'canonical-pump-two' },
      ],
      sourceSightings: [], reviewedMappings: [],
    });
    expect(result.status).toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBe('canonical-pump-one');
  });

  it('rules out all exact-name variants when every confirmed technical specification contradicts them', () => {
    const result = resolveResourceIdentity({
      reference: {
        rawName: 'Pompa Air', rawCode: null, rawUnit: 'UNIT', resourceType: 'MATERIAL',
        confirmedSpecifications: { merek: 'Grundfos', tipe: 'CMBE' },
      },
      catalogCandidates: [
        catalog({ merek: 'Shimizu', tipe: 'PS-128' }),
        { ...catalog({ merek: 'Panasonic', tipe: 'GA-130' }), id: 'canonical-pump-two' },
      ],
      sourceSightings: [], reviewedMappings: [],
    });
    expect(result.status).toBe('UNRESOLVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.reasonCodes).toEqual(['SPECIFICATION_CONFLICT']);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every(candidate => candidate.identityBasis === 'RULED_OUT')).toBe(true);
  });

  it('keeps multiple same-name variants ambiguous when an alternative lacks specifications', () => {
    const result = resolveResourceIdentity({
      reference: {
        rawName: 'Pompa Air', rawCode: null, rawUnit: 'UNIT', resourceType: 'MATERIAL',
        confirmedSpecifications: { merek: 'Shimizu', tipe: 'PS-128' },
      },
      catalogCandidates: [
        catalog({ merek: 'Shimizu', tipe: 'PS-128' }),
        { ...catalog(null), id: 'catalog-unknown' },
      ],
      sourceSightings: [], reviewedMappings: [],
    });
    expect(result.status).not.toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('never chooses between two identical specification identities without further evidence', () => {
    const result = resolveResourceIdentity({
      reference: {
        rawName: 'Pompa Air', rawCode: null, rawUnit: 'UNIT', resourceType: 'MATERIAL',
        confirmedSpecifications: { merek: 'Shimizu', tipe: 'PS-128' },
      },
      catalogCandidates: [
        catalog({ merek: 'Shimizu', tipe: 'PS-128' }),
        { ...catalog({ merek: 'Shimizu', tipe: 'PS-128' }), id: 'duplicate-same-spec' },
      ],
      sourceSightings: [], reviewedMappings: [],
    });
    expect(result.status).not.toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('does not change no-spec generic identity behavior', () => {
    const result = ask(undefined, null);
    expect(result.status).toBe('RESOLVED');
  });
});

/**
 * SIMPROK — ResourceIdentityResolutionService (RM-03D1 loader + RM-03D2 seam).
 *
 * The service is the I/O half of the identity authority: it establishes the
 * tenant boundary, and — since RM-03D2 — it asks the Unit authority for the
 * canonical unit facts an exact-representation tie needs. The decision itself
 * stays in the pure kernel, so what this file tests is the SEAM, not the law:
 *
 *   - the tenant predicate never widens;
 *   - the Unit authority is asked ONLY for a tie, ONCE, and about a bounded set;
 *   - the caller's transaction is the client that read is made on;
 *   - the resource's own governed class is the only context ever supplied.
 */

import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';

describe('ResourceIdentityResolutionService', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001';

  const MORTAR_M3 = { id: 'cat-mortar-m3', code: null, name: 'Mortar', type: 'MATERIAL', baseUnit: 'm3', status: 'ACTIVE', specifications: null };
  const MORTAR_KG = { id: 'cat-mortar-kg', code: null, name: 'Mortar', type: 'MATERIAL', baseUnit: 'kg', status: 'ACTIVE', specifications: null };
  const PEKERJA = { id: 'cat-pekerja', code: 'L.01', name: 'Pekerja', type: 'LABOR', baseUnit: 'OH', status: 'ACTIVE', specifications: null };

  const evidenceOf = (catalogCandidates: any[]) => ({
    catalogCandidates,
    sourceSightings: [],
    reviewedMappings: [],
  });

  const unitDefinition = (id: string, code: string) => ({ id, code, dimension: 'VOLUME' });

  let units: { resolveCanonicalUnitIdentities: jest.Mock };
  let prisma: any;
  let service: ResourceIdentityResolutionService;

  beforeEach(() => {
    units = { resolveCanonicalUnitIdentities: jest.fn().mockResolvedValue([]) };
    prisma = {
      resourceCatalog: { findMany: jest.fn().mockResolvedValue([]) },
      resourceSourceIdentity: { findMany: jest.fn().mockResolvedValue([]) },
      basicPriceImportRowResourceMapping: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new ResourceIdentityResolutionService(prisma, units as any);
  });

  // ---------- TENANT BOUNDARY (§34) ----------
  describe('loadEvidence tenant scope', () => {
    it('admits genuinely global catalog rows, and ONLY for the catalog', async () => {
      await service.loadEvidence(prisma, workspaceId);

      expect(prisma.resourceCatalog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ workspaceId }, { workspaceId: null }] } }),
      );
    });

    it('scopes source sightings with STRICT workspace equality — never an OR with null', async () => {
      await service.loadEvidence(prisma, workspaceId);

      expect(prisma.resourceSourceIdentity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId } }),
      );
    });

    it('scopes reviewed human mappings with STRICT workspace equality', async () => {
      await service.loadEvidence(prisma, workspaceId);

      expect(prisma.basicPriceImportRowResourceMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId } }),
      );
    });
  });

  // ---------- THE RM-03D2 SEAM ----------
  describe('canonical-unit disambiguation seam', () => {
    it('never asks the Unit authority when identity was settled without a tie', async () => {
      const result = await service.resolve(evidenceOf([PEKERJA]), {
        rawName: 'Pekerja',
        rawCode: null,
        rawUnit: 'Jam',
        resourceType: 'LABOR',
      });

      expect(result.status).toBe('RESOLVED');
      expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
      // The common case costs nothing: no extra query, ever.
      expect(units.resolveCanonicalUnitIdentities).not.toHaveBeenCalled();
    });

    it('never asks the Unit authority when nothing matched at all', async () => {
      const result = await service.resolve(evidenceOf([PEKERJA]), {
        rawName: 'Tidak Ada',
        rawCode: null,
        rawUnit: 'Kg',
        resourceType: 'MATERIAL',
      });

      expect(result.status).toBe('UNRESOLVED');
      expect(units.resolveCanonicalUnitIdentities).not.toHaveBeenCalled();
    });

    it('asks ONCE for a tie, about exactly the source unit and the tied base units', async () => {
      units.resolveCanonicalUnitIdentities.mockResolvedValue([
        { rawUnit: 'm3', status: 'RESOLVED', unitDefinition: unitDefinition('unit-m3', 'M3'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: [], contextScoped: false, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
        { rawUnit: 'kg', status: 'RESOLVED', unitDefinition: unitDefinition('unit-kg', 'KG'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: [], contextScoped: false, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
      ]);

      const result = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG]), {
        rawName: 'Mortar',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'MATERIAL',
      });

      expect(result.status).toBe('RESOLVED');
      expect(result.authority).toBe('EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT');
      expect(result.resolvedResourceCatalogId).toBe(MORTAR_M3.id);

      // Bounded by the tie, asked exactly once, and DEDUPED — never once per
      // candidate, and never twice for a spelling the source and a candidate
      // happen to share.
      expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledTimes(1);
      const [spellings] = units.resolveCanonicalUnitIdentities.mock.calls[0];
      expect([...spellings].sort()).toEqual(['kg', 'm3']);
    });

    it('proves a spelling once per evidence set, however many resources tie on it', async () => {
      // The B1-B12 shape: one AHSP version, several lines all naming Mortar.
      // Evidence is loaded once for the version, so the units behind that tie
      // must be proved once for the version too.
      units.resolveCanonicalUnitIdentities.mockResolvedValue([
        { rawUnit: 'm3', status: 'RESOLVED', unitDefinition: unitDefinition('unit-m3', 'M3'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: [], contextScoped: false, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
        { rawUnit: 'kg', status: 'RESOLVED', unitDefinition: unitDefinition('unit-kg', 'KG'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: [], contextScoped: false, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
      ]);
      prisma.resourceCatalog.findMany.mockResolvedValue([MORTAR_M3, MORTAR_KG]);
      const evidence = await service.loadEvidence(prisma, workspaceId);
      const reference = { rawName: 'Mortar', rawCode: null, rawUnit: 'm3', resourceType: 'MATERIAL' };

      const first = await service.resolve(evidence, reference);
      const second = await service.resolve(evidence, reference);
      const third = await service.resolve(evidence, { ...reference, rawUnit: 'kg' });

      expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledTimes(1);
      expect(first.resolvedResourceCatalogId).toBe(MORTAR_M3.id);
      expect(second.resolvedResourceCatalogId).toBe(MORTAR_M3.id);
      // The cached facts serve a DIFFERENT source unit correctly too.
      expect(third.resolvedResourceCatalogId).toBe(MORTAR_KG.id);
    });

    it('NEVER serves a meaning proved for one resource class to another class', async () => {
      // "jam" is the shipped catalogue's real context-scoped spelling: a
      // labourer's hour on LABOR, a machine's hour on EQUIPMENT. One AHSP
      // version routinely holds both classes, so a memo keyed on the spelling
      // alone would hand the labour meaning to an equipment line — exactly the
      // foreign-context alias the unit contract forbids.
      const PEKERJA_JAM = { id: 'cat-pekerja-jam', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'jam', status: 'ACTIVE', specifications: null };
      const PEKERJA_OH = { id: 'cat-pekerja-oh', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'OH', status: 'ACTIVE', specifications: null };
      const EXCA_JAM = { id: 'cat-exca-jam', code: null, name: 'Excavator', type: 'EQUIPMENT', baseUnit: 'jam', status: 'ACTIVE', specifications: null };
      const EXCA_HARI = { id: 'cat-exca-hari', code: null, name: 'Excavator', type: 'EQUIPMENT', baseUnit: 'hari', status: 'ACTIVE', specifications: null };

      const perContext: Record<string, Record<string, string>> = {
        LABOR: { jam: 'unit-person-hour', OH: 'unit-person-day' },
        EQUIPMENT: { jam: 'unit-equipment-hour', hari: 'unit-equipment-day' },
      };
      units.resolveCanonicalUnitIdentities.mockImplementation(
        async (spellings: string[], context: string) =>
          spellings.map((rawUnit) => ({
            rawUnit,
            status: 'RESOLVED',
            unitDefinition: unitDefinition(perContext[context][rawUnit], rawUnit),
            reasonCode: 'CONTEXT_SCOPED_UNIT_ALIAS',
            matchedAliasIds: [],
            contextScoped: true,
            resolvedContext: context,
            policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1',
          })),
      );
      prisma.resourceCatalog.findMany.mockResolvedValue([PEKERJA_JAM, PEKERJA_OH, EXCA_JAM, EXCA_HARI]);
      const evidence = await service.loadEvidence(prisma, workspaceId);

      const labour = await service.resolve(evidence, { rawName: 'Pekerja', rawCode: null, rawUnit: 'jam', resourceType: 'LABOR' });
      const machine = await service.resolve(evidence, { rawName: 'Excavator', rawCode: null, rawUnit: 'jam', resourceType: 'EQUIPMENT' });

      expect(labour.resolvedResourceCatalogId).toBe(PEKERJA_JAM.id);
      expect(machine.resolvedResourceCatalogId).toBe(EXCA_JAM.id);
      // Two classes, two proofs. The second was NOT served from the first.
      expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledTimes(2);
      expect(units.resolveCanonicalUnitIdentities.mock.calls[0][1]).toBe('LABOR');
      expect(units.resolveCanonicalUnitIdentities.mock.calls[1][1]).toBe('EQUIPMENT');
      // THE assertion that actually pins it: the SHARED spelling was re-proved
      // under the second class rather than served from the first class's memo.
      // Without this, a spelling-only cache key passes every line above.
      expect(units.resolveCanonicalUnitIdentities.mock.calls[0][0]).toContain('jam');
      expect(units.resolveCanonicalUnitIdentities.mock.calls[1][0]).toContain('jam');
      // And the meaning that decided the EQUIPMENT line is the EQUIPMENT one.
      expect(machine.explanation).toContain('cat-exca-jam');
    });

    it('a cross-class version cannot be flipped by the order its resources happen to be in', async () => {
      // Same two ties, resolved in the opposite order. A memo that leaked one
      // class's meaning into the other would make the verdict depend on which
      // resource the version happened to list first.
      const PEKERJA_JAM = { id: 'cat-pekerja-jam', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'jam', status: 'ACTIVE', specifications: null };
      const PEKERJA_OH = { id: 'cat-pekerja-oh', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'OH', status: 'ACTIVE', specifications: null };
      const EXCA_JAM = { id: 'cat-exca-jam', code: null, name: 'Excavator', type: 'EQUIPMENT', baseUnit: 'jam', status: 'ACTIVE', specifications: null };
      const EXCA_HARI = { id: 'cat-exca-hari', code: null, name: 'Excavator', type: 'EQUIPMENT', baseUnit: 'hari', status: 'ACTIVE', specifications: null };
      const perContext: Record<string, Record<string, string>> = {
        LABOR: { jam: 'unit-person-hour', OH: 'unit-person-day' },
        EQUIPMENT: { jam: 'unit-equipment-hour', hari: 'unit-equipment-day' },
      };
      units.resolveCanonicalUnitIdentities.mockImplementation(
        async (spellings: string[], context: string) =>
          spellings.map((rawUnit) => ({
            rawUnit,
            status: 'RESOLVED',
            unitDefinition: unitDefinition(perContext[context][rawUnit], rawUnit),
            reasonCode: 'CONTEXT_SCOPED_UNIT_ALIAS',
            matchedAliasIds: [],
            contextScoped: true,
            resolvedContext: context,
            policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1',
          })),
      );
      prisma.resourceCatalog.findMany.mockResolvedValue([PEKERJA_JAM, PEKERJA_OH, EXCA_JAM, EXCA_HARI]);

      const forwards = await service.loadEvidence(prisma, workspaceId);
      const labourFirst = await service.resolve(forwards, { rawName: 'Pekerja', rawCode: null, rawUnit: 'jam', resourceType: 'LABOR' });
      const machineSecond = await service.resolve(forwards, { rawName: 'Excavator', rawCode: null, rawUnit: 'jam', resourceType: 'EQUIPMENT' });

      const backwards = await service.loadEvidence(prisma, workspaceId);
      const machineFirst = await service.resolve(backwards, { rawName: 'Excavator', rawCode: null, rawUnit: 'jam', resourceType: 'EQUIPMENT' });
      const labourSecond = await service.resolve(backwards, { rawName: 'Pekerja', rawCode: null, rawUnit: 'jam', resourceType: 'LABOR' });

      expect(JSON.stringify(machineFirst)).toBe(JSON.stringify(machineSecond));
      expect(JSON.stringify(labourSecond)).toBe(JSON.stringify(labourFirst));
    });

    it('the memo lives and dies with one evidence set — it never spans transactions', async () => {
      units.resolveCanonicalUnitIdentities.mockResolvedValue([]);
      prisma.resourceCatalog.findMany.mockResolvedValue([MORTAR_M3, MORTAR_KG]);
      const reference = { rawName: 'Mortar', rawCode: null, rawUnit: 'm3', resourceType: 'MATERIAL' };

      await service.resolve(await service.loadEvidence(prisma, workspaceId), reference);
      await service.resolve(await service.loadEvidence(prisma, workspaceId), reference);

      // A second evidence load is a second consistency window, so it proves the
      // units again rather than trusting a previous transaction's alias table.
      expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledTimes(2);
    });

    it('supplies the resource CLASS as the trusted unit context, never a name', async () => {
      units.resolveCanonicalUnitIdentities.mockResolvedValue([]);

      await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG]), {
        rawName: 'Mortar',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'MATERIAL',
      });

      expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledWith(
        expect.any(Array),
        'MATERIAL',
        undefined,
      );
    });

    it('supplies NO context for a class the unit contract does not recognise — fail-closed', async () => {
      units.resolveCanonicalUnitIdentities.mockResolvedValue([]);

      await service.resolve(evidenceOf([{ ...MORTAR_M3, type: 'WEIRD' }, { ...MORTAR_KG, type: 'WEIRD' }]), {
        rawName: 'Mortar',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'WEIRD',
      });

      expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledWith(
        expect.any(Array),
        undefined,
        undefined,
      );
    });

    it('reads the unit evidence on the CALLER transaction when one is given', async () => {
      const tx = { unitAlias: { findMany: jest.fn() } };
      units.resolveCanonicalUnitIdentities.mockResolvedValue([]);

      await service.resolve(
        evidenceOf([MORTAR_M3, MORTAR_KG]),
        { rawName: 'Mortar', rawCode: null, rawUnit: 'm3', resourceType: 'MATERIAL' },
        tx as any,
      );

      expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledWith(
        expect.any(Array),
        'MATERIAL',
        tx,
      );
    });

    it('does not ask when the tie states no source unit — there is nothing to prove', async () => {
      const result = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG]), {
        rawName: 'Mortar',
        rawCode: null,
        rawUnit: null,
        resourceType: 'MATERIAL',
      });

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.reasonCodes).toContain('UNIT_CONTEXT_SOURCE_UNIT_UNSTATED');
      // The title's actual claim, now asserted: a round-trip that provably
      // cannot change the verdict is never spent — least of all inside the
      // pre-lock freeze window.
      expect(units.resolveCanonicalUnitIdentities).not.toHaveBeenCalled();
    });

    it('asks at most once — an unresolvable tie is never retried in a loop', async () => {
      units.resolveCanonicalUnitIdentities.mockResolvedValue([
        { rawUnit: 'm3', status: 'NEEDS_REVIEW', unitDefinition: null, reasonCode: 'UNKNOWN_UNIT_ALIAS', matchedAliasIds: [], contextScoped: false, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
      ]);

      const result = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG]), {
        rawName: 'Mortar',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'MATERIAL',
      });

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.reasonCodes).toContain('UNIT_CONTEXT_SOURCE_UNIT_UNPROVED');
      expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledTimes(1);
    });

    // ---------- PROVENANCE SURVIVES `asFact` (§6, §7, §9) ----------
    //
    // This is the seam the closeout was aimed at. The Unit authority knows
    // whether a context-scoped alias answered, which trusted class it depended
    // on and which alias rows decided it — and `asFact` used to drop all of it,
    // keeping the right answer while losing part of why the answer was valid.
    describe('unit-authority provenance retention', () => {
      const contextualIdentity = (rawUnit: string, id: string, aliasIds: string[]) => ({
        rawUnit,
        status: 'RESOLVED',
        unitDefinition: unitDefinition(id, rawUnit.toUpperCase()),
        reasonCode: 'CONTEXT_SCOPED_UNIT_ALIAS',
        matchedAliasIds: aliasIds,
        contextScoped: true,
        resolvedContext: 'LABOR',
        policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1',
      });

      const PEKERJA_JAM = { id: 'cat-pekerja-jam', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'jam', status: 'ACTIVE', specifications: null };
      const PEKERJA_OH = { id: 'cat-pekerja-oh', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'OH', status: 'ACTIVE', specifications: null };

      it('a context-scoped meaning reaches the identity trail AS context-scoped', async () => {
        units.resolveCanonicalUnitIdentities.mockResolvedValue([
          contextualIdentity('jam', 'unit-person-hour', ['alias-jam-labor']),
          contextualIdentity('OH', 'unit-person-day', ['alias-oh-labor']),
        ]);

        const result = await service.resolve(evidenceOf([PEKERJA_JAM, PEKERJA_OH]), {
          rawName: 'Pekerja',
          rawCode: null,
          rawUnit: 'jam',
          resourceType: 'LABOR',
        });

        expect(result.status).toBe('RESOLVED');
        expect(result.resolvedResourceCatalogId).toBe(PEKERJA_JAM.id);
        // Everything §7 asks to be retained, now visible on the stored trail:
        // the authority's reason, that context was material, WHICH context, the
        // canonical unit itself, and the deciding alias by stable id.
        expect(result.explanation).toContain('CONTEXT_SCOPED_UNIT_ALIAS');
        expect(result.explanation).toContain('konteks tepercaya LABOR');
        expect(result.explanation).toContain('unit canonical JAM');
        expect(result.explanation).toContain('alias-jam-labor');
      });

      it('takes the context from the Unit authority, never from the context it passed in', async () => {
        // The service supplied MATERIAL, but the authority answered from a
        // context-free alias and said so. Recording MATERIAL as a dependency
        // would be false provenance — a proof narrower than it really is.
        units.resolveCanonicalUnitIdentities.mockResolvedValue([
          { rawUnit: 'm3', status: 'RESOLVED', unitDefinition: unitDefinition('unit-m3', 'M3'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: ['alias-m3'], contextScoped: false, resolvedContext: null, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
          { rawUnit: 'kg', status: 'RESOLVED', unitDefinition: unitDefinition('unit-kg', 'KG'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: ['alias-kg'], contextScoped: false, resolvedContext: null, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
        ]);

        const result = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG]), {
          rawName: 'Mortar',
          rawCode: null,
          rawUnit: 'm3',
          resourceType: 'MATERIAL',
        });

        expect(units.resolveCanonicalUnitIdentities).toHaveBeenCalledWith(expect.any(Array), 'MATERIAL', undefined);
        expect(result.status).toBe('RESOLVED');
        expect(result.explanation).not.toContain('konteks tepercaya');
        expect(result.explanation).toContain('EXACT_UNIT_IDENTITY');
      });

      it('two classes sharing one spelling keep their OWN provenance — no cross-contamination', async () => {
        const EXCA_JAM = { id: 'cat-exca-jam', code: null, name: 'Excavator', type: 'EQUIPMENT', baseUnit: 'jam', status: 'ACTIVE', specifications: null };
        const EXCA_HARI = { id: 'cat-exca-hari', code: null, name: 'Excavator', type: 'EQUIPMENT', baseUnit: 'hari', status: 'ACTIVE', specifications: null };
        const perContext: Record<string, Record<string, [string, string]>> = {
          LABOR: { jam: ['unit-person-hour', 'alias-jam-labor'], OH: ['unit-person-day', 'alias-oh-labor'] },
          EQUIPMENT: { jam: ['unit-equipment-hour', 'alias-jam-equipment'], hari: ['unit-equipment-day', 'alias-hari-equipment'] },
        };
        units.resolveCanonicalUnitIdentities.mockImplementation(
          async (spellings: string[], context: string) =>
            spellings.map((rawUnit) => {
              const [id, aliasId] = perContext[context][rawUnit];
              return {
                rawUnit,
                status: 'RESOLVED',
                unitDefinition: unitDefinition(id, rawUnit.toUpperCase()),
                reasonCode: 'CONTEXT_SCOPED_UNIT_ALIAS',
                matchedAliasIds: [aliasId],
                contextScoped: true,
                resolvedContext: context,
                policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1',
              };
            }),
        );
        prisma.resourceCatalog.findMany.mockResolvedValue([PEKERJA_JAM, PEKERJA_OH, EXCA_JAM, EXCA_HARI]);
        const evidence = await service.loadEvidence(prisma, workspaceId);

        const labour = await service.resolve(evidence, { rawName: 'Pekerja', rawCode: null, rawUnit: 'jam', resourceType: 'LABOR' });
        const machine = await service.resolve(evidence, { rawName: 'Excavator', rawCode: null, rawUnit: 'jam', resourceType: 'EQUIPMENT' });

        // The shared spelling "jam" carries a DIFFERENT authority story on each
        // row, and neither borrowed the other's.
        expect(labour.explanation).toContain('konteks tepercaya LABOR');
        expect(labour.explanation).toContain('alias-jam-labor');
        expect(labour.explanation).not.toContain('alias-jam-equipment');
        expect(machine.explanation).toContain('konteks tepercaya EQUIPMENT');
        expect(machine.explanation).toContain('alias-jam-equipment');
        expect(machine.explanation).not.toContain('alias-jam-labor');
      });

      it('the same evidence in a different order produces identical provenance', async () => {
        // §9. Provenance must not depend on the order the authority returned its
        // facts in, or "same evidence, same output" fails on serialisation alone.
        const facts = [
          { rawUnit: 'm3', status: 'RESOLVED', unitDefinition: unitDefinition('unit-m3', 'M3'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: ['alias-m3'], contextScoped: false, resolvedContext: null, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
          { rawUnit: 'kg', status: 'RESOLVED', unitDefinition: unitDefinition('unit-kg', 'KG'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: ['alias-kg'], contextScoped: false, resolvedContext: null, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
        ];
        const reference = { rawName: 'Mortar', rawCode: null, rawUnit: 'm3', resourceType: 'MATERIAL' };

        units.resolveCanonicalUnitIdentities.mockResolvedValue(facts);
        const forwards = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG]), reference);
        units.resolveCanonicalUnitIdentities.mockResolvedValue([...facts].reverse());
        const backwards = await service.resolve(evidenceOf([MORTAR_KG, MORTAR_M3]), reference);

        expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
      });
    });

    it('carries a NEEDS_REVIEW unit verdict through as unproved, never as a resolved id', async () => {
      units.resolveCanonicalUnitIdentities.mockResolvedValue([
        { rawUnit: 'm3', status: 'RESOLVED', unitDefinition: unitDefinition('unit-m3', 'M3'), reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: [], contextScoped: false, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
        { rawUnit: 'kg', status: 'NEEDS_REVIEW', unitDefinition: null, reasonCode: 'AMBIGUOUS_UNIT_ALIAS', matchedAliasIds: [], contextScoped: false, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
      ]);

      const result = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG]), {
        rawName: 'Mortar',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'MATERIAL',
      });

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.resolvedResourceCatalogId).toBeNull();
      expect(result.reasonCodes).toContain('UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED');
    });
  });
});

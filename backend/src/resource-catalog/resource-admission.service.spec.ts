import { Prisma } from '@prisma/client';
import {
  ResourceAdmissionService,
  ResourceAdmissionNotExhaustedError,
  ResourceAdmissionProvenanceIncompleteError,
  ResourceProvenanceAlreadyBoundError,
  RESOURCE_ADMISSION_LOCK_NAMESPACE,
} from './resource-admission.service';

/**
 * THE one canonical mint authority. These prove the hard safety gate: a new
 * ResourceCatalog + ResourceSourceIdentity are minted ONLY when identity is
 * genuinely exhausted, never from a candidate, a similarity or a partial
 * provenance.
 */
describe('ResourceAdmissionService', () => {
  const EXHAUSTED = {
    status: 'UNRESOLVED',
    authority: null,
    resolvedResourceCatalogId: null,
    candidates: [],
    reasonCodes: ['RESOURCE_NOT_FOUND'],
    explanation: '',
  };

  const fullProvenance = {
    sourceSha256: 'A'.repeat(64),
    sourceFileName: 'file.xlsx',
    parserContractVersion: 'XLSX_V1',
    sheetName: 'SHEET',
    sourceRowNumber: 42,
    sourceNameCellAddress: 'B42',
    sourceCodeCellAddress: 'A42',
    sourceUnitCellAddress: 'C42',
  };

  const input = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'ws-1',
    rawName: 'Agregat XYZ Premium',
    rawCode: 'AGX',
    rawUnit: 'm3',
    resourceType: 'MATERIAL' as const,
    baseUnit: 'M3',
    provenance: fullProvenance,
    ...over,
  });

  let tx: any;
  let identity: any;
  let service: ResourceAdmissionService;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      resourceCatalog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'cat-new' }),
      },
      resourceSourceIdentity: {
        create: jest.fn().mockResolvedValue({ id: 'sighting-new' }),
      },
    };
    identity = {
      loadEvidence: jest.fn().mockResolvedValue({}),
      resolve: jest.fn().mockResolvedValue(EXHAUSTED),
    };
    service = new ResourceAdmissionService(identity);
  });

  it('mints exactly one ResourceCatalog and one ResourceSourceIdentity when identity is exhausted', async () => {
    const catalog = await service.admitObservedResource(tx, input());
    expect(catalog).toEqual({ id: 'cat-new' });
    // Serialized under the advisory lock before the create.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.resourceCatalog.create).toHaveBeenCalledTimes(1);
    expect(tx.resourceCatalog.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: 'ws-1',
      name: 'Agregat XYZ Premium',
      type: 'MATERIAL',
      baseUnit: 'M3',
      code: 'AGX',
    });
    expect(tx.resourceSourceIdentity.create).toHaveBeenCalledTimes(1);
    expect(
      tx.resourceSourceIdentity.create.mock.calls[0][0].data,
    ).toMatchObject({
      resourceCatalogId: 'cat-new',
      sourceRowNumber: 42,
      sourceNameCellAddress: 'B42',
      sourceSection: 'MATERIAL',
      rawName: 'Agregat XYZ Premium',
      rawCode: 'AGX',
      rawUnit: 'm3',
    });
  });

  it('places a trimmed observed code only when its workspace slot is free while preserving raw provenance', async () => {
    await service.admitObservedResource(
      tx,
      input({ rawCode: '  AGX source  ', rawUnit: ' m3 source ' }),
    );

    expect(tx.resourceCatalog.create.mock.calls[0][0].data.code).toBe(
      'AGX source',
    );
    expect(tx.resourceSourceIdentity.create.mock.calls[0][0].data).toMatchObject(
      {
        rawCode: '  AGX source  ',
        rawName: 'Agregat XYZ Premium',
        rawUnit: ' m3 source ',
      },
    );
  });

  it('mints a distinct observed identity with null catalog code when the same source code is occupied', async () => {
    tx.resourceCatalog.findFirst.mockResolvedValue({
      id: 'cat-existing',
      name: 'Agregat Berbeda',
      code: 'AGX',
      type: 'MATERIAL',
      baseUnit: 'M3',
      workspaceId: 'ws-1',
    });

    await service.admitObservedResource(tx, input());

    expect(tx.resourceCatalog.create.mock.calls[0][0].data).toMatchObject({
      name: 'Agregat XYZ Premium',
      code: null,
    });
    expect(
      tx.resourceSourceIdentity.create.mock.calls[0][0].data.rawCode,
    ).toBe('AGX');
  });

  it('keeps a cross-type observed code collision separate and fail-safe', async () => {
    tx.resourceCatalog.findFirst.mockResolvedValue({
      id: 'cat-material',
      name: 'Stamper',
      code: 'E25',
      type: 'MATERIAL',
      baseUnit: 'BUAH',
      workspaceId: 'ws-1',
    });

    const catalog = await service.admitObservedResource(
      tx,
      input({
        rawName: 'Stamper',
        rawCode: 'E25',
        resourceType: 'EQUIPMENT',
        baseUnit: 'JAM',
      }),
    );

    expect(catalog).toEqual({ id: 'cat-new' });
    expect(tx.resourceCatalog.create.mock.calls[0][0].data).toMatchObject({
      name: 'Stamper',
      type: 'EQUIPMENT',
      code: null,
    });
    expect(catalog.id).not.toBe('cat-material');
  });

  it('uses the same admission-then-code lock order for human and observed writers', async () => {
    const sqlValues = (call: unknown[]) =>
      (call[0] as { values: unknown[] }).values;

    await service.admitHumanDeclaredResource(tx, {
      workspaceId: 'ws-1',
      rawName: 'Resource Human',
      rawCode: ' SHARED-01 ',
      rawUnit: 'OH',
      resourceType: 'LABOR',
      baseUnit: 'OH',
    });
    const humanLocks = tx.$executeRaw.mock.calls.map(sqlValues);

    tx.$executeRaw.mockClear();
    tx.resourceCatalog.create.mockClear();
    await service.admitObservedResource(
      tx,
      input({
        rawName: 'Resource Observed',
        rawCode: 'SHARED-01',
        resourceType: 'MATERIAL',
      }),
    );
    const observedLocks = tx.$executeRaw.mock.calls.map(sqlValues);

    expect(humanLocks).toHaveLength(2);
    expect(observedLocks).toHaveLength(2);
    expect(humanLocks[0][0]).toBe(RESOURCE_ADMISSION_LOCK_NAMESPACE);
    expect(observedLocks[0][0]).toBe(RESOURCE_ADMISSION_LOCK_NAMESPACE);
    expect(humanLocks[1]).toEqual(observedLocks[1]);
    expect(humanLocks[1][0]).not.toBe(RESOURCE_ADMISSION_LOCK_NAMESPACE);
  });

  it('refuses to mint when identity is NOT exhausted — a candidate is not a new resource', async () => {
    identity.resolve.mockResolvedValue({
      ...EXHAUSTED,
      status: 'NEEDS_REVIEW',
      reasonCodes: ['MULTIPLE_CANDIDATES_NEEDS_REVIEW'],
      candidates: [{ resourceCatalogId: 'cat-x', name: 'Agregat' }],
    });
    await expect(
      service.admitObservedResource(tx, input()),
    ).rejects.toBeInstanceOf(ResourceAdmissionNotExhaustedError);
    expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
    expect(tx.resourceSourceIdentity.create).not.toHaveBeenCalled();
  });

  it('refuses to mint when a resolved identity already exists', async () => {
    identity.resolve.mockResolvedValue({
      ...EXHAUSTED,
      status: 'RESOLVED',
      authority: 'EXACT_CANONICAL_MATCH',
      resolvedResourceCatalogId: 'cat-existing',
      reasonCodes: [],
    });
    await expect(
      service.admitObservedResource(tx, input()),
    ).rejects.toBeInstanceOf(ResourceAdmissionNotExhaustedError);
    expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
  });

  it('refuses to mint without complete provenance — shared memory cannot be written half-located', async () => {
    await expect(
      service.admitObservedResource(
        tx,
        input({ provenance: { ...fullProvenance, sourceRowNumber: null } }),
      ),
    ).rejects.toBeInstanceOf(ResourceAdmissionProvenanceIncompleteError);
    expect(identity.resolve).not.toHaveBeenCalled();
    expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
  });

  it('maps a provenance-collision (P2002) to a clean domain error, never a silent steal', async () => {
    tx.resourceSourceIdentity.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      service.admitObservedResource(tx, input()),
    ).rejects.toBeInstanceOf(ResourceProvenanceAlreadyBoundError);
  });

  /**
   * AHSP KNOWLEDGE INTAKE — the human-declared channel. Same authority, same
   * lock, same exhaustion proof; the ONE difference is that no document exists,
   * so no ResourceSourceIdentity is written and none is invented.
   */
  describe('admitHumanDeclaredResource', () => {
    const declared = (over: Record<string, unknown> = {}) => ({
      workspaceId: 'ws-1',
      rawName: 'Mandor Lapangan Khusus',
      rawCode: null,
      rawUnit: 'OH',
      resourceType: 'LABOR' as const,
      baseUnit: 'OH',
      ...over,
    });

    it('mints exactly one workspace ResourceCatalog and NO source sighting', async () => {
      const catalog = await service.admitHumanDeclaredResource(tx, declared());
      expect(catalog).toEqual({ id: 'cat-new' });
      expect(tx.resourceCatalog.create).toHaveBeenCalledTimes(1);
      expect(tx.resourceCatalog.create.mock.calls[0][0].data).toMatchObject({
        workspaceId: 'ws-1',
        name: 'Mandor Lapangan Khusus',
        type: 'LABOR',
        baseUnit: 'OH',
        code: null,
      });
      // THE WHOLE POINT: no document, so no provenance row and no fake one.
      expect(tx.resourceSourceIdentity.create).not.toHaveBeenCalled();
    });

    it('serializes on the SAME advisory lock as document-born admission', async () => {
      await service.admitHumanDeclaredResource(tx, declared());
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('asks the identity question with NO source digest — absent, not empty', async () => {
      await service.admitHumanDeclaredResource(tx, declared());
      expect(identity.resolve).toHaveBeenCalledTimes(1);
      expect(identity.resolve.mock.calls[0][1]).toMatchObject({
        rawName: 'Mandor Lapangan Khusus',
        resourceType: 'LABOR',
        sourceSha256: null,
      });
    });

    it('refuses to mint when the identity is still known — novelty is not assumed', async () => {
      identity.resolve.mockResolvedValue({
        ...EXHAUSTED,
        status: 'NEEDS_REVIEW',
        reasonCodes: ['MULTIPLE_CANDIDATES_NEEDS_REVIEW'],
        candidates: [{ resourceCatalogId: 'cat-x', name: 'Mandor' }],
      });
      await expect(
        service.admitHumanDeclaredResource(tx, declared()),
      ).rejects.toBeInstanceOf(ResourceAdmissionNotExhaustedError);
      expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
      expect(tx.resourceSourceIdentity.create).not.toHaveBeenCalled();
    });

    it('refuses to mint when an exact identity already resolved — matching is reuse', async () => {
      identity.resolve.mockResolvedValue({
        ...EXHAUSTED,
        status: 'RESOLVED',
        authority: 'EXACT_CANONICAL_MATCH',
        resolvedResourceCatalogId: 'cat-existing',
        reasonCodes: [],
      });
      await expect(
        service.admitHumanDeclaredResource(tx, declared()),
      ).rejects.toBeInstanceOf(ResourceAdmissionNotExhaustedError);
      expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
    });

    it('keeps the source code when no workspace row already holds it', async () => {
      tx.resourceCatalog.findFirst = jest.fn().mockResolvedValue(null);
      tx.resourceCatalog.create.mockResolvedValue({
        id: 'cat-new',
        name: 'Pipa porous diameter 5"',
        code: 'M25a',
      });
      await service.admitHumanDeclaredResource(
        tx,
        declared({ rawName: 'Pipa porous diameter 5"', rawCode: 'M25a' }),
      );
      expect(tx.resourceCatalog.create.mock.calls[0][0].data.code).toBe('M25a');
    });

    it('mints a different resource without the occupied code and does not reuse that row', async () => {
      tx.resourceCatalog.findFirst = jest.fn().mockResolvedValue({
        id: 'cat-4inch',
        name: 'Pipa porous diameter 4"',
        code: 'M25a',
        type: 'MATERIAL',
        baseUnit: 'M1',
        workspaceId: 'ws-1',
      });
      tx.resourceCatalog.create.mockResolvedValue({
        id: 'cat-5inch',
        name: 'Pipa porous diameter 5"',
        code: null,
      });
      const catalog = await service.admitHumanDeclaredResource(
        tx,
        declared({
          rawName: 'Pipa porous diameter 5"',
          rawCode: 'M25a',
          resourceType: 'MATERIAL',
          baseUnit: 'M1',
        }),
      );
      expect(catalog).toEqual({
        id: 'cat-5inch',
        name: 'Pipa porous diameter 5"',
        code: null,
      });
      expect(tx.resourceCatalog.create.mock.calls[0][0].data).toMatchObject({
        name: 'Pipa porous diameter 5"',
        code: null,
      });
      expect(catalog.id).not.toBe('cat-4inch');
    });

    it('returns the existing row when the same name already holds that code', async () => {
      const existing = {
        id: 'cat-same',
        name: 'Pipa porous diameter 5"',
        code: 'M25a',
        type: 'MATERIAL',
        baseUnit: 'M1',
        workspaceId: 'ws-1',
      };
      tx.resourceCatalog.findFirst = jest.fn().mockResolvedValue(existing);
      const catalog = await service.admitHumanDeclaredResource(
        tx,
        declared({
          rawName: 'Pipa porous diameter 5"',
          rawCode: 'M25a',
          resourceType: 'MATERIAL',
          baseUnit: 'M1',
        }),
      );
      expect(catalog).toEqual(existing);
      expect(tx.resourceCatalog.create).not.toHaveBeenCalled();
    });

    it('does not reuse a different type that already holds the code', async () => {
      tx.resourceCatalog.findFirst = jest.fn().mockResolvedValue({
        id: 'cat-material',
        name: 'Pipa porous diameter 4"',
        code: 'M25a',
        type: 'MATERIAL',
        baseUnit: 'M1',
        workspaceId: 'ws-1',
      });
      tx.resourceCatalog.create.mockResolvedValue({
        id: 'cat-labor',
        name: 'Pipa porous diameter 4"',
        code: null,
        type: 'LABOR',
      });
      const catalog = await service.admitHumanDeclaredResource(
        tx,
        declared({
          rawName: 'Pipa porous diameter 4"',
          rawCode: 'M25a',
          resourceType: 'LABOR',
          baseUnit: 'OH',
        }),
      );
      expect(catalog.id).toBe('cat-labor');
      expect(catalog.id).not.toBe('cat-material');
      expect(tx.resourceCatalog.create.mock.calls[0][0].data).toMatchObject({
        type: 'LABOR',
        name: 'Pipa porous diameter 4"',
        code: null,
      });
    });

    it('never asks for a price, a date, a location or a document', async () => {
      await service.admitHumanDeclaredResource(tx, declared());
      const written = tx.resourceCatalog.create.mock.calls[0][0].data;
      expect(Object.keys(written).sort()).toEqual([
        'baseUnit',
        'code',
        'name',
        'type',
        'workspaceId',
      ]);
    });
  });

  it('the exhaustion predicate agrees with Basic Price: only truly not-found, zero candidates', () => {
    expect(ResourceAdmissionService.isIdentityExhausted(EXHAUSTED as any)).toBe(
      true,
    );
    expect(
      ResourceAdmissionService.isIdentityExhausted({
        ...EXHAUSTED,
        candidates: [{}],
      } as any),
    ).toBe(false);
    expect(
      ResourceAdmissionService.isIdentityExhausted({
        ...EXHAUSTED,
        status: 'NEEDS_REVIEW',
      } as any),
    ).toBe(false);
  });
});

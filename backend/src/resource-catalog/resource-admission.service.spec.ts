import { Prisma } from '@prisma/client';
import {
  ResourceAdmissionService,
  ResourceAdmissionNotExhaustedError,
  ResourceAdmissionProvenanceIncompleteError,
  ResourceProvenanceAlreadyBoundError,
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
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
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
    });
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

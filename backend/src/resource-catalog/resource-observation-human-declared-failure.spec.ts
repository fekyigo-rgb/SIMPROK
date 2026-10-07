import { ConflictException } from '@nestjs/common';
import { ResourceObservationService } from './resource-observation.service';
import { ResourceAdmissionNotExhaustedError } from './resource-admission.service';
import { UNIT_RESOLUTION_STATUS } from '../unit-kernel/unit-kernel.contracts';
import type { ResourceIdentityResolution } from './resource-identity-resolution.kernel';

const WS = '11111111-1111-4111-8111-111111111111';

function resolution(
  partial: Partial<ResourceIdentityResolution> &
    Pick<ResourceIdentityResolution, 'status' | 'candidates'>,
): ResourceIdentityResolution {
  return {
    authority: null,
    resolvedResourceCatalogId: null,
    reasonCodes: [],
    explanation: '',
    ...partial,
  };
}

/**
 * Failure and ruled-out semantics of the one human-declared admission entry.
 * Import Confirm/Save calls this method inside the item transaction.
 */
describe('acceptHumanDeclaredResourceIn — failure and ruled-out', () => {
  const admission = { admitHumanDeclaredResource: jest.fn() };
  const identity = { loadEvidence: jest.fn(), resolve: jest.fn() };
  const unitKernel = { resolve: jest.fn() };
  const catalog = { findFirst: jest.fn() };
  const tx = {
    unitDefinition: { findFirst: jest.fn() },
    unitAlias: { findFirst: jest.fn() },
    resourceCatalog: catalog,
  };
  const service = new ResourceObservationService(
    {} as never,
    admission as never,
    unitKernel as never,
    identity as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.unitDefinition.findFirst.mockResolvedValue({
      id: 'unit-1',
      code: 'OH',
      isActive: true,
    });
    tx.unitAlias.findFirst.mockResolvedValue({ rawAlias: 'OH' });
    unitKernel.resolve.mockResolvedValue({
      status: UNIT_RESOLUTION_STATUS.RESOLVED,
      sourceUnitDefinition: { id: 'unit-1' },
    });
    identity.loadEvidence.mockResolvedValue({});
  });

  it('reuses the catalogue row a concurrent admission proved under the lock', async () => {
    identity.resolve.mockResolvedValue(
      resolution({
        status: 'UNRESOLVED',
        candidates: [],
        reasonCodes: ['RESOURCE_NOT_FOUND'],
      }),
    );
    const winner = {
      id: 'winner-1',
      name: 'Pekerja',
      code: 'L.01',
      type: 'LABOR',
      baseUnit: 'OH',
      workspaceId: WS,
    };
    admission.admitHumanDeclaredResource.mockRejectedValue(
      new ResourceAdmissionNotExhaustedError(
        resolution({
          status: 'RESOLVED',
          resolvedResourceCatalogId: 'winner-1',
          candidates: [],
        }),
      ),
    );
    catalog.findFirst.mockResolvedValue(winner);

    const answer = await service.acceptHumanDeclaredResourceIn(tx as never, {
      workspaceId: WS,
      rawName: 'Pekerja',
      rawCode: 'L.01',
      resourceType: 'LABOR',
      unitDefinitionId: 'unit-1',
    });

    expect(answer).toEqual({ outcome: 'REUSED', resource: winner });
  });

  it('mints when every live candidate was ruled out, and does not mint a name-only candidate', async () => {
    const ruledOut = {
      resourceCatalogId: 'catalog-pipe-4',
      name: 'Pipa porous diameter 4"',
      code: null,
      type: 'MATERIAL',
      baseUnit: 'M',
      evidence: [],
      identityBasis: 'RULED_OUT' as const,
      specificationUnproved: true,
      unprovedSpecificationFacts: [],
      specifications: { diameter: '4' },
      priorHumanDecision: null,
    };
    identity.resolve.mockResolvedValue(
      resolution({
        status: 'UNRESOLVED',
        candidates: [ruledOut],
        reasonCodes: ['SPECIFICATION_CONFLICT'],
      }),
    );
    admission.admitHumanDeclaredResource.mockResolvedValue({
      id: 'catalog-new',
      name: 'Pipa porous diameter 6"',
      code: null,
      type: 'MATERIAL',
      baseUnit: 'M',
      workspaceId: WS,
    });

    const created = await service.acceptHumanDeclaredResourceIn(tx as never, {
      workspaceId: WS,
      rawName: 'Pipa porous diameter 6"',
      resourceType: 'MATERIAL',
      unitDefinitionId: 'unit-1',
    });
    expect(created.outcome).toBe('CREATED');
    if (created.outcome !== 'CREATED') return;
    expect(created.resource.id).toBe('catalog-new');
    const input = admission.admitHumanDeclaredResource.mock.calls[0][1] as {
      examination: { refusedCandidateIds: string[] };
    };
    expect(input.examination.refusedCandidateIds).toEqual(['catalog-pipe-4']);

    identity.resolve.mockResolvedValue(
      resolution({
        status: 'NEEDS_REVIEW',
        candidates: [{ ...ruledOut, identityBasis: 'NAME_SIMILARITY_ONLY' }],
        reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
        authority: 'HUMAN_REVIEW_REQUIRED',
      }),
    );
    const review = await service.acceptHumanDeclaredResourceIn(tx as never, {
      workspaceId: WS,
      rawName: 'Pipa porous',
      resourceType: 'MATERIAL',
      unitDefinitionId: 'unit-1',
    });
    expect(review.outcome).toBe('REVIEW_REQUIRED');
    expect(admission.admitHumanDeclaredResource).toHaveBeenCalledTimes(1);
  });

  it('asks the kernel with the selected definition alias, so PERSON_MONTH is not looked up as its code', async () => {
    tx.unitDefinition.findFirst.mockResolvedValue({
      id: 'unit-month',
      code: 'PERSON_MONTH',
      isActive: true,
    });
    tx.unitAlias.findFirst.mockResolvedValue({ rawAlias: 'orang-bulan' });
    unitKernel.resolve.mockResolvedValue({
      status: UNIT_RESOLUTION_STATUS.RESOLVED,
      sourceUnitDefinition: { id: 'unit-month', code: 'PERSON_MONTH', dimension: 'PERSON_TIME' },
    });
    identity.resolve.mockResolvedValue(
      resolution({ status: 'UNRESOLVED', candidates: [], reasonCodes: ['RESOURCE_NOT_FOUND'] }),
    );
    admission.admitHumanDeclaredResource.mockResolvedValue({
      id: 'catalog-labor',
      name: 'Pekerja',
      code: null,
      type: 'LABOR',
      baseUnit: 'PERSON_MONTH',
      workspaceId: WS,
    });

    const answer = await service.acceptHumanDeclaredResourceIn(tx as never, {
      workspaceId: WS,
      rawName: 'Pekerja',
      resourceType: 'LABOR',
      unitDefinitionId: 'unit-month',
    });

    expect(unitKernel.resolve).toHaveBeenCalledWith('orang-bulan', 'orang-bulan', undefined, 'LABOR');
    expect(answer.outcome).toBe('CREATED');
  });

  it('rejects a person-month definition when the kernel refuses that resource type', async () => {
    tx.unitDefinition.findFirst.mockResolvedValue({
      id: 'unit-month',
      code: 'PERSON_MONTH',
      isActive: true,
    });
    tx.unitAlias.findFirst.mockResolvedValue({ rawAlias: 'orang-bulan' });
    unitKernel.resolve.mockResolvedValue({
      status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
      sourceUnitDefinition: null,
      reasonCodes: ['RESOURCE_TYPE_UNIT_INCOMPATIBLE'],
    });

    await expect(
      service.acceptHumanDeclaredResourceIn(tx as never, {
        workspaceId: WS,
        rawName: 'Pekerja',
        resourceType: 'EQUIPMENT',
        unitDefinitionId: 'unit-month',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(admission.admitHumanDeclaredResource).not.toHaveBeenCalled();
  });
});

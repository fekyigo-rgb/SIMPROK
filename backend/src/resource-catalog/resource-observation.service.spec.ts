import { ConflictException, NotFoundException } from '@nestjs/common';
import { GhxDecisionContextTokenService } from './ghx-decision-context-token.service';
import { ResourceObservationService } from './resource-observation.service';
import {
  ResourceAdmissionNotExhaustedError,
  ResourceAdmissionService,
} from './resource-admission.service';

/**
 * THE shared OBSERVED → HUMAN → CANONICAL lifecycle. Proves an unknown resource
 * survives as an observation (C), a human maps it to an existing row (D), a
 * human confirms it new and exactly one catalog + one sighting are minted
 * through the ONE authority (E), and nothing is ever auto-selected or
 * auto-promoted.
 */
describe('ResourceObservationService', () => {
  let prisma: any;
  let admission: any;
  let unitKernel: any;
  let identity: any;
  let service: ResourceObservationService;

  const OBSERVATION = {
    id: 'obs-1',
    workspaceId: 'ws-1',
    status: 'OBSERVED',
    rawName: 'Agregat XYZ Premium',
    rawCode: 'AGX',
    rawUnit: 'm3',
    resourceType: 'MATERIAL',
    sourceSha256: 'A'.repeat(64),
    sourceFileName: 'f.xlsx',
    parserContractVersion: 'V1',
    sheetName: 'S',
    sourceRowNumber: 42,
    sourceNameCellAddress: 'B42',
    sourceCodeCellAddress: 'A42',
    sourceUnitCellAddress: 'C42',
  };

  beforeEach(() => {
    prisma = {
      observedResource: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(OBSERVATION),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ ...OBSERVATION, ...data }),
          ),
      },
      resourceCatalog: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cat-existing' }),
      },
      unitDefinition: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'unit-m3', code: 'M3', isActive: true }),
      },
      $transaction: (fn: any) => fn(prisma),
    };
    admission = {
      admitObservedResource: jest.fn().mockResolvedValue({ id: 'cat-new' }),
    };
    unitKernel = {
      resolve: jest.fn().mockResolvedValue({
        status: 'RESOLVED',
        sourceUnitDefinition: { id: 'unit-m3', code: 'M3' },
      }),
    };
    identity = {
      loadEvidence: jest.fn().mockResolvedValue({}),
      resolve: jest.fn().mockResolvedValue({ candidates: [] }),
    };
    service = new ResourceObservationService(
      prisma,
      admission as ResourceAdmissionService,
      unitKernel,
      identity,
      // IQL-01 signed contexts — unused by these pre-IQL scenarios.
      new GhxDecisionContextTokenService(),
    );
  });

  // C — an unknown resource is persisted as an observation, not lost.
  it('C: persists an observed resource, carrying its candidates as evidence', async () => {
    const result = await service.observeMany([
      {
        workspaceId: 'ws-1',
        origin: 'AHSP_IMPORT',
        rawName: 'Agregat XYZ Premium',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'MATERIAL',
        candidates: ['Agregat Kasar', 'Agregat Halus'],
        provenance: {
          sourceSha256: 'A'.repeat(64),
          sheetName: 'S',
          sourceRowNumber: 7,
          sourceNameCellAddress: 'B7',
        },
      },
    ]);
    expect(result).toEqual({ persisted: 1 });
    expect(prisma.observedResource.createMany).toHaveBeenCalledTimes(1);
    const call = prisma.observedResource.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0]).toMatchObject({
      origin: 'AHSP_IMPORT',
      rawName: 'Agregat XYZ Premium',
      resourceType: 'MATERIAL',
    });
    // Candidates are evidence, stored as-is — never a resolved id.
    expect(call.data[0].candidatesJson).toEqual([
      'Agregat Kasar',
      'Agregat Halus',
    ]);
    expect(call.data[0].resolvedResourceCatalogId).toBeUndefined();
  });

  it('C: a nameless observation is never recorded', async () => {
    const result = await service.observeMany([
      {
        workspaceId: 'ws-1',
        origin: 'BASIC_PRICE',
        rawName: '   ',
        resourceType: 'MATERIAL',
      },
    ]);
    expect(result).toEqual({ persisted: 0 });
    expect(prisma.observedResource.createMany).not.toHaveBeenCalled();
  });

  // A — the curator sees live candidates (name + id), and nothing is auto-selected.
  it('A: listOpenForCuration surfaces candidates as evidence, never a resolved identity', async () => {
    prisma.observedResource.findMany.mockResolvedValue([OBSERVATION]);
    identity.resolve.mockResolvedValue({
      candidates: [
        { resourceCatalogId: 'cat-x', name: 'Kerikil / Agregat', extra: 'ignored' },
      ],
    });
    const list = await service.listOpenForCuration('ws-1');
    expect(list).toHaveLength(1);
    expect(list[0].candidates).toEqual([
      { resourceCatalogId: 'cat-x', name: 'Kerikil / Agregat' },
    ]);
    // A suggested unit for curate-new, from the Unit Kernel — not invented here.
    expect(list[0].suggestedUnitDefinitionId).toBe('unit-m3');
    // Still OBSERVED — the read decides nothing.
    expect(list[0].status).toBe('OBSERVED');
    expect((list[0] as any).resolvedResourceCatalogId).toBeUndefined();
  });

  /**
   * PAB-04 — THE CLASS TRAVELS WITH THE QUESTION.
   *
   * Real AHSP documents write an hour as "jam" for BOTH a labourer and a
   * machine — in the Owner's own Bina Marga workbook, "Pekerja / jam" sits
   * under TENAGA and "Dump Truck / jam" under PERALATAN, in the same file.
   * The Unit Kernel catalogues that honestly: "jam" has two context-scoped
   * aliases (PERSON_HOUR under LABOR, EQUIPMENT_HOUR under EQUIPMENT) and no
   * context-free one, so asked WITHOUT a class it must refuse.
   *
   * The refusal was never the defect. Asking without the class was, because
   * the class is already on the observation row.
   */
  it('PAB-04: asks the Unit Kernel with the observation own class, so an hour can be answered', async () => {
    prisma.observedResource.findMany.mockResolvedValue([
      { ...OBSERVATION, rawUnit: 'jam', resourceType: 'EQUIPMENT' },
    ]);
    unitKernel.resolve.mockResolvedValue({
      status: 'RESOLVED',
      sourceUnitDefinition: { id: 'unit-equipment-hour', code: 'EQUIPMENT_HOUR' },
    });

    const list = await service.listOpenForCuration('ws-1');

    expect(unitKernel.resolve).toHaveBeenCalledWith(
      'jam',
      'jam',
      undefined,
      'EQUIPMENT',
    );
    expect(list[0].suggestedUnitDefinitionId).toBe('unit-equipment-hour');
  });

  it('PAB-04: the same spelling under a different class is asked as a different question', async () => {
    prisma.observedResource.findMany.mockResolvedValue([
      { ...OBSERVATION, rawUnit: 'jam', resourceType: 'LABOR' },
    ]);
    unitKernel.resolve.mockResolvedValue({
      status: 'RESOLVED',
      sourceUnitDefinition: { id: 'unit-person-hour', code: 'PERSON_HOUR' },
    });

    const list = await service.listOpenForCuration('ws-1');

    expect(unitKernel.resolve).toHaveBeenCalledWith('jam', 'jam', undefined, 'LABOR');
    expect(list[0].suggestedUnitDefinitionId).toBe('unit-person-hour');
  });

  /**
   * FAIL-CLOSED IS PRESERVED. Supplying context is not the same as forcing an
   * answer: when the kernel still cannot prove the unit, the suggestion stays
   * null. Nothing here invents a unit, and nothing downgrades the kernel's
   * verdict.
   */
  it('PAB-04: a unit the kernel still cannot prove yields no suggestion', async () => {
    prisma.observedResource.findMany.mockResolvedValue([
      { ...OBSERVATION, rawUnit: 'Ls', resourceType: 'EQUIPMENT' },
    ]);
    unitKernel.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      sourceUnitDefinition: null,
    });

    const list = await service.listOpenForCuration('ws-1');

    expect(list[0].suggestedUnitDefinitionId).toBeNull();
  });

  /**
   * NO CLASS, NO CONTEXT — never a guessed one. An unrecognised class must
   * yield undefined so a context-scoped alias stays ineligible, exactly as the
   * shared mapper's contract promises.
   */
  it('PAB-04: an unrecognised class supplies no context rather than a default', async () => {
    prisma.observedResource.findMany.mockResolvedValue([
      { ...OBSERVATION, rawUnit: 'jam', resourceType: 'SOMETHING_ELSE' },
    ]);

    await service.listOpenForCuration('ws-1');

    expect(unitKernel.resolve).toHaveBeenCalledWith('jam', 'jam', undefined, undefined);
  });

  // D — a human maps the observation to an existing canonical resource.
  it('D: curateExisting records the chosen existing catalog id, minting nothing', async () => {
    const updated = await service.curateExisting({
      workspaceId: 'ws-1',
      observationId: 'obs-1',
      selectedResourceCatalogId: 'cat-existing',
      actorAccountId: 'acct-1',
      reason: 'same as our aggregate',
    });
    expect(prisma.resourceCatalog.findFirst).toHaveBeenCalled();
    expect(prisma.observedResource.update).toHaveBeenCalledTimes(1);
    expect(updated).toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: 'cat-existing',
      decidedByAccountId: 'acct-1',
    });
    expect(admission.admitObservedResource).not.toHaveBeenCalled();
  });

  it('D: refuses an existing selection the workspace cannot see', async () => {
    prisma.resourceCatalog.findFirst.mockResolvedValue(null);
    await expect(
      service.curateExisting({
        workspaceId: 'ws-1',
        observationId: 'obs-1',
        selectedResourceCatalogId: 'cat-foreign',
        actorAccountId: 'acct-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.observedResource.update).not.toHaveBeenCalled();
  });

  // E — a human confirms genuinely new; the ONE authority mints it.
  it('E: curateNew mints through the one authority and records the result', async () => {
    const result = await service.curateNew({
      workspaceId: 'ws-1',
      observationId: 'obs-1',
      unitDefinitionId: 'unit-m3',
      actorAccountId: 'acct-1',
      reason: 'genuinely new',
    });
    // PAB-04: the admission proof now carries the observation's own class,
    // like every other unit question on this path. Behaviour is unchanged for
    // M3 — a canonical code with a context-free self-alias resolves either
    // way — but the question is no longer asked with less than SIMPROK knows.
    expect(unitKernel.resolve).toHaveBeenCalledWith('M3', 'M3', undefined, 'MATERIAL');
    expect(admission.admitObservedResource).toHaveBeenCalledTimes(1);
    const admitArgs = admission.admitObservedResource.mock.calls[0][1];
    expect(admitArgs).toMatchObject({
      workspaceId: 'ws-1',
      rawName: 'Agregat XYZ Premium',
      resourceType: 'MATERIAL',
      baseUnit: 'M3',
    });
    expect(admitArgs.provenance).toMatchObject({
      sourceRowNumber: 42,
      sourceNameCellAddress: 'B42',
    });
    expect(result.admittedResource).toEqual({ id: 'cat-new' });
    expect(result.observation).toMatchObject({
      status: 'ADMITTED_NEW',
      resolvedResourceCatalogId: 'cat-new',
    });
  });

  it('E: curateNew fails closed if the identity turns out to still be known', async () => {
    admission.admitObservedResource.mockRejectedValue(
      new ResourceAdmissionNotExhaustedError({} as any),
    );
    await expect(
      service.curateNew({
        workspaceId: 'ws-1',
        observationId: 'obs-1',
        unitDefinitionId: 'unit-m3',
        actorAccountId: 'acct-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.observedResource.update).not.toHaveBeenCalled();
  });

  it('E: curateNew refuses a unit the Unit Kernel cannot represent', async () => {
    unitKernel.resolve.mockResolvedValue({ status: 'NEEDS_REVIEW' });
    await expect(
      service.curateNew({
        workspaceId: 'ws-1',
        observationId: 'obs-1',
        unitDefinitionId: 'unit-m3',
        actorAccountId: 'acct-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(admission.admitObservedResource).not.toHaveBeenCalled();
  });

  it('an observation already decided cannot be curated again', async () => {
    prisma.observedResource.findFirst.mockResolvedValue({
      ...OBSERVATION,
      status: 'ADMITTED_NEW',
    });
    await expect(
      service.curateExisting({
        workspaceId: 'ws-1',
        observationId: 'obs-1',
        selectedResourceCatalogId: 'cat-existing',
        actorAccountId: 'acct-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a missing observation is a clean not-found', async () => {
    prisma.observedResource.findFirst.mockResolvedValue(null);
    await expect(
      service.curateNew({
        workspaceId: 'ws-1',
        observationId: 'nope',
        unitDefinitionId: 'unit-m3',
        actorAccountId: 'acct-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

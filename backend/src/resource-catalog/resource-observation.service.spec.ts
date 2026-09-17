import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import type { ResourceIdentityResolutionService } from './resource-identity-resolution.service';
import { GhxDecisionContextTokenService } from './ghx-decision-context-token.service';
import {
  ResourceObservationService,
  kernelRefusalOfSelection,
} from './resource-observation.service';
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
      // A well-formed evidence set: the plain door narrows this catalogue to
      // the chosen row to ask the machine about that row alone, so an empty
      // stand-in would hide the seam rather than test it.
      loadEvidence: jest.fn().mockResolvedValue({
        catalogCandidates: [
          'cat-existing',
          'cat-unp',
          'cat-other',
          'cat-proven',
          'cat-x',
        ].map((id) => ({
          id,
          code: null,
          name: id,
          type: 'MATERIAL',
          baseUnit: 'M3',
          status: 'ACTIVE',
          specifications: null,
        })),
        sourceSightings: [],
        reviewedMappings: [],
      }),
      // A well-formed kernel verdict: the list now carries the verdict itself,
      // so the fixture must be the shape the kernel really returns.
      resolve: jest.fn().mockResolvedValue({
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [],
        reasonCodes: ['RESOURCE_NOT_FOUND'],
        explanation: '',
      }),
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
      status: 'NEEDS_REVIEW',
      authority: 'EVIDENCE_CANDIDATE',
      resolvedResourceCatalogId: null,
      reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
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
   * ACG-01 OWNER BROWSER GAP — a candidate list is read WITH its verdict.
   *
   * Under UNRESOLVED the kernel lists the rows it RULED OUT (a stated
   * specification conflict, a class mismatch) so a human can see them; under
   * NEEDS_REVIEW it lists nominations. The verdict travels with the list so the
   * reader can never offer a ruled-out row as an answer, and "genuinely new" is
   * offered from the SAME exhaustion predicate curateNew re-proves.
   */
  it('ACG-01: a ruled-out list travels with its verdict, and is never called exhausted', async () => {
    prisma.observedResource.findMany.mockResolvedValue([OBSERVATION]);
    identity.resolve.mockResolvedValue({
      status: 'UNRESOLVED',
      authority: null,
      resolvedResourceCatalogId: null,
      candidates: [
        {
          resourceCatalogId: 'cat-unp',
          name: 'Besi UNP 100.50.5',
          evidence: [],
        },
      ],
      reasonCodes: ['SPECIFICATION_CONFLICT'],
    });

    const [row] = await service.listOpenForCuration('ws-1', 'acct-1');

    expect(row.identityVerdict).toEqual({
      status: 'UNRESOLVED',
      reasonCodes: ['SPECIFICATION_CONFLICT'],
      exhausted: false,
    });
    // The list itself is unchanged — shown, never removed.
    expect(row.candidates.map((candidate) => candidate.name)).toEqual([
      'Besi UNP 100.50.5',
    ]);
    // Nothing about learning is decided here: the refusal is only named.
    expect(row.identicalQuestion).toMatchObject({
      rememberable: false,
      notRememberableReason: 'NOT_DECIDABLE',
      decisionContextToken: null,
    });
  });

  it('ACG-01: only a genuinely-not-found verdict is exhausted — the one curateNew accepts', async () => {
    prisma.observedResource.findMany.mockResolvedValue([OBSERVATION]);
    identity.resolve.mockResolvedValue({
      status: 'UNRESOLVED',
      authority: null,
      resolvedResourceCatalogId: null,
      candidates: [],
      reasonCodes: ['RESOURCE_NOT_FOUND'],
    });

    const [row] = await service.listOpenForCuration('ws-1');

    expect(row.identityVerdict).toEqual({
      status: 'UNRESOLVED',
      reasonCodes: ['RESOURCE_NOT_FOUND'],
      exhausted: true,
    });
    expect(row.identityVerdict.exhausted).toBe(
      ResourceAdmissionService.isIdentityExhausted({
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [],
        reasonCodes: ['RESOURCE_NOT_FOUND'],
        explanation: '',
      }),
    );
    // No known actor: learning is not offered, and the reason says exactly that.
    expect(row.identicalQuestion.notRememberableReason).toBe('NO_ACTOR');
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

  /**
   * ACG-01.1 — A KERNEL REFUSAL IS NOT BYPASSED AT THE WRITE.
   *
   * The screen no longer offers a row the kernel refused, but the plain
   * decision door used to check only that the row was ACTIVE and visible, so a
   * direct request could still record it as this resource's identity. The
   * machine's answer for the observation's own wording is now read inside the
   * write — TWICE: once against the whole catalogue, and once against the
   * CHOSEN ROW ALONE, because the kernel stops reporting a row it ruled out as
   * soon as it has some other row to nominate. The SOURCE RESOURCE is never
   * what is refused: it stays OBSERVED.
   *
   * These cases pin the WIRING with a stubbed resolver. The machine behaviour
   * itself — which rows the real kernel rules out, and that an unrelated
   * sibling row cannot change that — is proved against the REAL kernel in
   * resource-observation.iql.spec.ts and in the acceptance e2e.
   */
  const plainDecision = (selectedResourceCatalogId: string) =>
    service.curateExisting({
      workspaceId: 'ws-1',
      observationId: 'obs-1',
      selectedResourceCatalogId,
      actorAccountId: 'acct-1',
    });

  it('ACG-01.1: a row the kernel RULED OUT can never be persisted as the identity', async () => {
    prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'cat-unp' });
    identity.resolve.mockResolvedValue({
      status: 'UNRESOLVED',
      authority: null,
      resolvedResourceCatalogId: null,
      candidates: [{ resourceCatalogId: 'cat-unp', name: 'Besi UNP 100.50.5' }],
      reasonCodes: ['SPECIFICATION_CONFLICT'],
    });

    await expect(plainDecision('cat-unp')).rejects.toThrow(
      new ConflictException('IDENTITY_CANDIDATE_RULED_OUT'),
    );
    // The verdict came from the machine, for THIS observation's own wording.
    expect(identity.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        rawName: OBSERVATION.rawName,
        rawCode: OBSERVATION.rawCode,
        rawUnit: OBSERVATION.rawUnit,
        resourceType: OBSERVATION.resourceType,
      }),
      expect.anything(),
    );
    // Nothing written: the source resource stays accepted and unresolved.
    expect(prisma.observedResource.update).not.toHaveBeenCalled();
  });

  it('ACG-01.1: a row other than the identity the machine PROVED is refused', async () => {
    prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'cat-other' });
    identity.resolve.mockResolvedValue({
      status: 'RESOLVED',
      authority: 'EXACT_CANONICAL_MATCH',
      resolvedResourceCatalogId: 'cat-proven',
      candidates: [
        { resourceCatalogId: 'cat-proven', name: 'Agregat XYZ Premium' },
      ],
      reasonCodes: ['EXACT_CANONICAL_MATCH'],
    });

    await expect(plainDecision('cat-other')).rejects.toThrow(
      new ConflictException('IDENTITY_PROVEN_OTHERWISE'),
    );
    expect(prisma.observedResource.update).not.toHaveBeenCalled();

    // Confirming the proven identity itself stays possible.
    prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'cat-proven' });
    await expect(plainDecision('cat-proven')).resolves.toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: 'cat-proven',
    });
  });

  it('ACG-01.1: the door asks about the CHOSEN ROW ALONE, and refuses on that answer', async () => {
    prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'cat-unp' });
    // The whole-catalogue answer nominates a DIFFERENT row and never mentions
    // the chosen one — exactly the shape that used to let a refused row through.
    identity.resolve
      .mockResolvedValueOnce({
        status: 'NEEDS_REVIEW',
        authority: 'EVIDENCE_CANDIDATE',
        resolvedResourceCatalogId: null,
        candidates: [{ resourceCatalogId: 'cat-x', name: 'Besi UNP' }],
        reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
      })
      .mockResolvedValueOnce({
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [
          { resourceCatalogId: 'cat-unp', name: 'Besi UNP 100.50.5' },
        ],
        reasonCodes: ['SPECIFICATION_CONFLICT'],
      });

    await expect(plainDecision('cat-unp')).rejects.toThrow(
      new ConflictException('IDENTITY_CANDIDATE_RULED_OUT'),
    );
    expect(prisma.observedResource.update).not.toHaveBeenCalled();

    // ONE evidence load, two questions, the same wording — and the second one
    // is the same evidence with the catalogue narrowed to the chosen row.
    expect(identity.loadEvidence).toHaveBeenCalledTimes(1);
    expect(identity.resolve).toHaveBeenCalledTimes(2);
    const [whole, alone] = identity.resolve.mock.calls;
    expect(
      whole[0].catalogCandidates.map((row: { id: string }) => row.id),
    ).toEqual(['cat-existing', 'cat-unp', 'cat-other', 'cat-proven', 'cat-x']);
    expect(
      alone[0].catalogCandidates.map((row: { id: string }) => row.id),
    ).toEqual(['cat-unp']);
    // Same question, same sightings, same reviewed mappings — only the
    // catalogue is narrowed. Nothing is re-derived or re-scored.
    expect(alone[1]).toEqual(whole[1]);
    expect(alone[0].sourceSightings).toBe(whole[0].sourceSightings);
    expect(alone[0].reviewedMappings).toBe(whole[0].reviewedMappings);
  });

  it('ACG-01.1: a nominated candidate is still a human decision the door records', async () => {
    prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'cat-x' });
    identity.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      authority: 'EVIDENCE_CANDIDATE',
      resolvedResourceCatalogId: null,
      candidates: [{ resourceCatalogId: 'cat-x', name: 'Kerikil / Agregat' }],
      reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
    });

    await expect(plainDecision('cat-x')).resolves.toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: 'cat-x',
    });
  });

  it('ACG-01.1: the kernel NOT FINDING a row is not the kernel refusing it — human judgment stays', async () => {
    // Default verdict: UNRESOLVED / RESOURCE_NOT_FOUND with nothing listed. A
    // person may know an alias the kernel cannot connect; that is not a refusal.
    await expect(plainDecision('cat-existing')).resolves.toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: 'cat-existing',
    });
  });

  it('ACG-01.1: the refusal rule reads only the verdict — pure and exhaustive', () => {
    const candidate = (id: string) => ({ resourceCatalogId: id }) as never;
    const verdict = (
      status: 'UNRESOLVED' | 'NEEDS_REVIEW' | 'RESOLVED',
      resolvedResourceCatalogId: string | null,
      id: string,
    ) => ({ status, resolvedResourceCatalogId, candidates: [candidate(id)] });
    // UNRESOLVED lists only what it ruled out.
    expect(
      kernelRefusalOfSelection(verdict('UNRESOLVED', null, 'a'), 'a'),
    ).toBe('IDENTITY_CANDIDATE_RULED_OUT');
    expect(
      kernelRefusalOfSelection(verdict('UNRESOLVED', null, 'a'), 'b'),
    ).toBeNull();
    // NEEDS_REVIEW lists nominations — never a refusal, whatever is chosen.
    // That is exactly WHY the door asks a second time about the chosen row
    // alone: this predicate judges ONE answer, and one answer can hide a
    // refusal behind an unrelated nomination.
    expect(
      kernelRefusalOfSelection(verdict('NEEDS_REVIEW', null, 'a'), 'a'),
    ).toBeNull();
    // RESOLVED refuses every row but the proven one.
    expect(
      kernelRefusalOfSelection(verdict('RESOLVED', 'p', 'p'), 'p'),
    ).toBeNull();
    expect(kernelRefusalOfSelection(verdict('RESOLVED', 'p', 'p'), 'q')).toBe(
      'IDENTITY_PROVEN_OTHERWISE',
    );
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

  /**
   * AHSP COMPLETION — the questions each document still asks, for the import's
   * completion view: the curation queue's own projection, asked once per exact
   * question, counted per document.
   */
  describe('openQuestionsBySource', () => {
    const SOURCE_1 = '1'.repeat(64);
    const SOURCE_2 = '2'.repeat(64);
    const row = (sourceSha256: string, rawName: string) => ({
      workspaceId: 'ws-1',
      sourceSha256,
      rawName,
      rawCode: null,
      rawUnit: 'Bh',
      resourceType: 'MATERIAL',
    });
    // Typed doubles of its own: only the two reads this method may make.
    const findMany = jest.fn();
    const update = jest.fn();
    const loadEvidence = jest.fn();
    const resolve = jest.fn();
    const reader = () =>
      new ResourceObservationService(
        { observedResource: { findMany, update } } as unknown as PrismaService,
        {} as ResourceAdmissionService,
        {} as UnitKernelService,
        {
          loadEvidence,
          resolve,
        } as unknown as ResourceIdentityResolutionService,
        new GhxDecisionContextTokenService(),
      );

    beforeEach(() => {
      [findMany, update, loadEvidence, resolve].forEach((mock) =>
        mock.mockReset(),
      );
      loadEvidence.mockResolvedValue({
        catalogCandidates: [],
        sourceSightings: [],
        reviewedMappings: [],
      });
    });

    it('asks the kernel ONCE per exact question, and a question it proves today is not open', async () => {
      findMany.mockResolvedValue([
        row(SOURCE_1, 'Pipa PVC'),
        row(SOURCE_1, 'Pipa PVC'),
        row(SOURCE_2, 'Pipa PVC'),
        row(SOURCE_1, 'Semen Portland'),
      ]);
      resolve.mockImplementation(
        (_evidence: unknown, reference: { rawName: string }) =>
          Promise.resolve(
            reference.rawName === 'Semen Portland'
              ? {
                  status: 'RESOLVED',
                  resolvedResourceCatalogId: 'cat-semen',
                  candidates: [],
                  reasonCodes: [],
                }
              : {
                  status: 'NEEDS_REVIEW',
                  resolvedResourceCatalogId: null,
                  candidates: [],
                  reasonCodes: [],
                },
          ),
      );
      const open = await reader().openQuestionsBySource('ws-1', [
        SOURCE_1,
        SOURCE_2,
      ]);
      // Only what is still OBSERVED, only for these documents, only this workspace.
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId: 'ws-1',
            status: 'OBSERVED',
            sourceSha256: { in: [SOURCE_1, SOURCE_2] },
          },
        }),
      );
      expect(loadEvidence).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(open.get(SOURCE_1)?.keys.size).toBe(1);
      expect(open.get(SOURCE_1)?.uses).toBe(2);
      expect(open.get(SOURCE_2)?.uses).toBe(1);
      // The same exact question in two documents is the same question.
      expect([...(open.get(SOURCE_1)?.keys ?? [])]).toEqual([
        ...(open.get(SOURCE_2)?.keys ?? []),
      ]);
      // A read: nothing is decided.
      expect(update).not.toHaveBeenCalled();
    });

    it('a document with nothing observed asks nothing', async () => {
      const open = await reader().openQuestionsBySource('ws-1', []);
      expect(open.size).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
      expect(loadEvidence).not.toHaveBeenCalled();
    });
  });
});

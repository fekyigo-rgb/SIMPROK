import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import type { ResourceIdentityResolutionService } from './resource-identity-resolution.service';
import { GhxDecisionContextTokenService } from './ghx-decision-context-token.service';
import {
  ResourceObservationService,
  kernelRefusalOfSelection,
  observedSourceRowKey,
} from './resource-observation.service';
import {
  ResourceAdmissionNotExhaustedError,
  ResourceAdmissionService,
} from './resource-admission.service';
import { selectionRefusal } from './resource-identity-resolution.kernel';

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
      // A RESOLVED proof from the real kernel always states its price operation:
      // IDENTITY when the two spellings are the same canonical unit. Admission now
      // requires that, so the fixture states what the kernel would actually return.
        priceOperation: 'IDENTITY',
        quantityFactor: '1',
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
        {
          resourceCatalogId: 'cat-x',
          name: 'Kerikil / Agregat',
          type: 'MATERIAL',
          baseUnit: 'M3',
          identityBasis: 'RECORDED_FACT',
          extra: 'ignored',
        },
      ],
    });
    const list = await service.listOpenForCuration('ws-1');
    expect(list).toHaveLength(1);
    // The kernel's own statement of what the nomination rests on is carried,
    // never re-derived: a recorded fact is confirmable.
    expect(list[0].candidates).toEqual([
      {
        resourceCatalogId: 'cat-x',
        name: 'Kerikil / Agregat',
        type: 'MATERIAL',
        baseUnit: 'M3',
        identityBasis: 'RECORDED_FACT',
        confirmable: true,
      },
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
          type: 'MATERIAL',
          baseUnit: 'M3',
          evidence: [],
          identityBasis: 'RULED_OUT',
        },
      ],
      reasonCodes: ['SPECIFICATION_CONFLICT'],
    });

    const [row] = await service.listOpenForCuration('ws-1', 'acct-1');

    expect(row.identityVerdict).toEqual({
      status: 'UNRESOLVED',
      reasonCodes: ['SPECIFICATION_CONFLICT'],
      exhausted: false,
      // Not machine-exhausted, but every listed row was ruled out: a person
      // who refuses exactly these may lawfully admit it (branch c).
      admissibleAfterExamination: true,
      candidateContextDigest: expect.any(String),
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
      // No candidate at all: nothing to examine, so this road is not needed.
      admissibleAfterExamination: false,
      candidateContextDigest: expect.any(String),
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
      priceOperation: 'IDENTITY',
      quantityFactor: '1',
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
    identity.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      authority: 'EVIDENCE_CANDIDATE',
      resolvedResourceCatalogId: null,
      candidates: [
        {
          resourceCatalogId: 'cat-existing',
          name: 'Agregat XYZ',
          identityBasis: 'RECORDED_FACT',
        },
      ],
      reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
    });
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
        candidates: [
          {
            resourceCatalogId: 'cat-x',
            name: 'Besi UNP',
            identityBasis: 'RECORDED_FACT',
          },
        ],
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

  it('ACG-01.1: a nomination backed by a recorded fact is still a human decision the door records', async () => {
    prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'cat-x' });
    identity.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      authority: 'EVIDENCE_CANDIDATE',
      resolvedResourceCatalogId: null,
      candidates: [
        {
          resourceCatalogId: 'cat-x',
          name: 'Kerikil / Agregat',
          identityBasis: 'RECORDED_FACT',
        },
      ],
      reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
    });

    await expect(plainDecision('cat-x')).resolves.toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: 'cat-x',
    });
  });

  /**
   * RESOURCE DECISION SAFETY — a name-similarity nomination is a reason to look,
   * never an identity. "Tripleks" is contained in "Paku tripleks"; a single
   * such candidate is not strong because it is alone. A direct request to the
   * plain door is refused BEFORE anything is written.
   */
  it('DECISION SAFETY: a nomination resting on name similarity only is refused at the write', async () => {
    prisma.resourceCatalog.findFirst.mockResolvedValue({ id: 'cat-x' });
    identity.resolve.mockResolvedValue({
      status: 'NEEDS_REVIEW',
      authority: 'EVIDENCE_CANDIDATE',
      resolvedResourceCatalogId: null,
      candidates: [
        {
          resourceCatalogId: 'cat-x',
          name: 'Paku tripleks',
          evidence: ['NAME_TOKEN_CONTAINMENT', 'NAME_TOKEN_STEM_SHARED'],
          identityBasis: 'NAME_SIMILARITY_ONLY',
        },
      ],
      reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
    });

    await expect(plainDecision('cat-x')).rejects.toThrow(
      new ConflictException('IDENTITY_CANDIDATE_NAME_SIMILARITY_ONLY'),
    );
    expect(prisma.observedResource.update).not.toHaveBeenCalled();
  });

  /**
   * RESOURCE DECISION SAFETY — a row the machine never connected to this wording
   * carries NO evidence at all, which is weaker than a name guess. It is refused
   * too, so the name-similarity refusal cannot be walked around by naming an
   * unrelated row. (Before this law, ACG-01.1 left such a row to human judgment;
   * the census found no stored decision that used that door.)
   */
  it('DECISION SAFETY: a row the kernel never nominated is not recorded as this resource', async () => {
    // Default verdict: UNRESOLVED / RESOURCE_NOT_FOUND with nothing listed.
    await expect(plainDecision('cat-existing')).rejects.toThrow(
      new ConflictException('IDENTITY_CANDIDATE_NOT_NOMINATED'),
    );
    expect(prisma.observedResource.update).not.toHaveBeenCalled();
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

    it('asks the kernel once per exact question PER DOCUMENT, and a question it proves today is not open', async () => {
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
      // THREE, not two: "Pipa PVC" is asked once for SOURCE_1 and once for
      // SOURCE_2, because the document-code law can settle it in one document
      // and withhold it in the other. The two identical SOURCE_1 rows still
      // collapse to ONE evaluation — that is the saving this memo exists for.
      expect(resolve).toHaveBeenCalledTimes(3);
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

    /**
     * F2 — THE AUDITOR'S COUNTEREXAMPLE.
     *
     * Documents A and B carry rows with the SAME exact-question tuple, but only
     * A's row meets the same-document code conflict. Memoizing the kernel's
     * answer under the question tuple alone let ONE document's row win the map
     * and answer for both, so the result depended on the order rows arrived in:
     * [A,B] reported nothing open, [B,A] reported both open.
     *
     * The correct answer is the same in both orders: only A.
     */
    it('F2: the summary is per DOCUMENT and does not depend on row order', async () => {
      const A = SOURCE_1;
      const B = SOURCE_2;
      // Withheld in A — its document records that row under another code — and
      // settled in B. Nothing else differs between them.
      resolve.mockImplementation(
        (_evidence: unknown, reference: { sourceSha256?: string | null }) =>
          Promise.resolve(
            reference.sourceSha256 === A
              ? {
                  status: 'NEEDS_REVIEW',
                  resolvedResourceCatalogId: null,
                  candidates: [],
                  reasonCodes: ['SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT'],
                }
              : {
                  status: 'RESOLVED',
                  resolvedResourceCatalogId: 'cat-pipa',
                  candidates: [],
                  reasonCodes: [],
                },
          ),
      );

      const run = async (ordered: unknown[]) => {
        findMany.mockResolvedValue(ordered);
        return reader().openQuestionsBySource('ws-1', [A, B]);
      };
      const forward = await run([row(A, 'Pipa PVC'), row(B, 'Pipa PVC')]);
      const reversed = await run([row(B, 'Pipa PVC'), row(A, 'Pipa PVC')]);

      for (const result of [forward, reversed]) {
        expect(result.get(A)?.uses).toBe(1);
        expect(result.get(A)?.keys.size).toBe(1);
        // B was settled, so B asks nothing.
        expect(result.get(B)).toBeUndefined();
      }
      expect([...(forward.get(A)?.keys ?? [])]).toEqual([
        ...(reversed.get(A)?.keys ?? []),
      ]);
    });

    it('F2: a row that names no document is evaluated apart, and attributed to none', async () => {
      findMany.mockResolvedValue([
        { ...row(SOURCE_1, 'Pipa PVC'), sourceSha256: null },
        row(SOURCE_1, 'Pipa PVC'),
      ]);
      resolve.mockResolvedValue({
        status: 'NEEDS_REVIEW',
        resolvedResourceCatalogId: null,
        candidates: [],
        reasonCodes: [],
      });
      const open = await reader().openQuestionsBySource('ws-1', [SOURCE_1]);
      // Two evaluations: the digest-less row is its own group rather than being
      // folded into the document's answer. Only the row that names a document
      // is counted against it.
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(open.get(SOURCE_1)?.uses).toBe(1);
    });

    /**
     * F1 — A LAWFUL CONFIRMATION MUST BE USABLE WHEN THE ROW IS READ AGAIN.
     *
     * A person confirmed a component, the write succeeded, the question left the
     * queue — and re-reading the document asked the same question again and got
     * the same refusal, because `resolvedResourceCatalogId` was a column nothing
     * ever read.
     *
     * The reader below is narrow on purpose: it answers only about the SAME
     * source row, and only for decisions today's write-eligibility law would
     * still accept. A decision made under the older law, which permitted
     * confirming a name-similarity nomination, is NOT revived by this wiring.
     */
    describe('decidedIdentityForSourceRows', () => {
      const DOC = 'a'.repeat(64);
      const settledRow = (over = {}) => ({
        sourceSha256: DOC,
        sheetName: 'Sheet1',
        sourceRowNumber: 41,
        rawName: 'Timbunan Porus',
        rawCode: 'M144',
        rawUnit: 'M3',
        parserContractVersion: 'USI01_XLSX_V1',
        resourceType: 'MATERIAL',
        resolvedResourceCatalogId: 'cat-timbunan',
        ...over,
      });
      const asked = (over = {}) => ({
        sourceSha256: DOC,
        sheetName: 'Sheet1',
        sourceRowNumber: 41,
        rawName: 'Timbunan Porus',
        resourceType: 'MATERIAL',
        // E2 — the stated facts travel with the address.
        rawCode: 'M144',
        rawUnit: 'M3',
        parserContractVersion: 'USI01_XLSX_V1',
        ...over,
      });
      /** Today's verdict: withheld, but the chosen row is an EXACT_NAME candidate. */
      const confirmableToday = {
        status: 'NEEDS_REVIEW',
        authority: 'EVIDENCE_CANDIDATE',
        resolvedResourceCatalogId: null,
        reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW', 'SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT'],
        candidates: [
          {
            resourceCatalogId: 'cat-timbunan',
            name: 'Timbunan Porus',
            code: null,
            type: 'MATERIAL',
            baseUnit: 'M3',
            evidence: [],
            identityBasis: 'EXACT_NAME',
            specificationUnproved: false,
            unprovedSpecificationFacts: [],
            specifications: null,
            priorHumanDecision: null,
          },
        ],
        explanation: '',
      };
      /** A decision from the older law: the chosen row rests on a name alone. */
      const nameOnlyToday = {
        ...confirmableToday,
        reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
        candidates: [
          { ...confirmableToday.candidates[0], identityBasis: 'NAME_SIMILARITY_ONLY' },
        ],
      };

      it('F1: a decision today’s law still accepts is handed back for the SAME row', async () => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue(confirmableToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.get(observedSourceRowKey(asked()))).toBe('cat-timbunan');
        // Only settled rows of the asked documents, in this workspace.
        //
        // CORRECTED: this asserted a single hex spelling, which is the narrow
        // law that made the reader silently blind to rows stored in the other
        // case. The scope being proven here is the DOCUMENT, not a spelling of
        // its digest, so both spellings are offered and nothing else is.
        expect(findMany.mock.calls[0][0].where).toMatchObject({
          workspaceId: 'ws-1',
        });
        expect(new Set(findMany.mock.calls[0][0].where.sourceSha256.in)).toEqual(
          new Set([DOC.toLowerCase(), DOC.toUpperCase()]),
        );
      });

      it('F1: a WEAK historical decision is NOT revived — today’s law would refuse it', async () => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue(nameOnlyToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.size).toBe(0);
      });

      it('F1: a decision whose chosen row the machine no longer nominates is not handed back', async () => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue({ ...confirmableToday, candidates: [] });
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.size).toBe(0);
      });

      it.each([
        ['another document', { sourceSha256: 'b'.repeat(64) }],
        ['another sheet', { sheetName: 'Sheet2' }],
        ['another row', { sourceRowNumber: 42 }],
        ['another wording', { rawName: 'Timbunan porus' }],
        ['another class', { resourceType: 'EQUIPMENT' }],
      ])('F1: a decision never travels to %s', async (_label, over) => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue(confirmableToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [
          asked(over),
        ]);
        expect(decided.size).toBe(0);
      });

      it('F1: when the machine proves it by itself, that is its own answer', async () => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue({
          ...confirmableToday,
          status: 'RESOLVED',
          resolvedResourceCatalogId: 'cat-timbunan',
        });
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.get(observedSourceRowKey(asked()))).toBe('cat-timbunan');
      });

      it('F1: a machine proof that names a DIFFERENT row overrides nothing here', async () => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue({
          ...confirmableToday,
          status: 'RESOLVED',
          resolvedResourceCatalogId: 'cat-someone-else',
        });
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.size).toBe(0);
      });

      it('F1: rows that name no document ask nothing of the database', async () => {
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [
          asked({ sourceSha256: null }),
        ]);
        expect(decided.size).toBe(0);
        expect(findMany).not.toHaveBeenCalled();
      });

      /**
       * F1 — ONE OCCURRENCE, ONE ANSWER. A DISAGREEMENT IS NOT AN ANSWER.
       *
       * Two settled rows can describe the same source occurrence. If they name
       * DIFFERENT catalogue rows, the reader used to hand back whichever the
       * database returned last: two people contradicting each other settled by
       * query order, flipping between runs with nothing recording the doubt.
       */
      const secondSettled = (catalogId) =>
        settledRow({ resolvedResourceCatalogId: catalogId });

      it('F1: two decisions that DISAGREE about one occurrence hand back nothing', async () => {
        findMany.mockResolvedValue([settledRow(), secondSettled('cat-other')]);
        resolve.mockResolvedValue(confirmableToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.size).toBe(0);
      });

      it('F1: the SAME disagreement in the OTHER query order hands back nothing too', async () => {
        findMany.mockResolvedValue([secondSettled('cat-other'), settledRow()]);
        resolve.mockResolvedValue(confirmableToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.size).toBe(0);
      });

      it('F1: two rows that AGREE about one occurrence are one answer, in either order', async () => {
        for (const order of [
          [settledRow(), settledRow()],
          [settledRow(), settledRow()].reverse(),
        ]) {
          findMany.mockResolvedValue(order);
          resolve.mockResolvedValue(confirmableToday);
          const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
          expect(decided.get(observedSourceRowKey(asked()))).toBe('cat-timbunan');
          // Agreement is ONE question, asked of the kernel once.
          expect(resolve).toHaveBeenCalledTimes(1);
          resolve.mockClear();
        }
      });

      /**
       * F1 — A DECISION NEVER TRAVELS ON A LOCATOR THAT NAMES NOWHERE.
       *
       * The key folds a missing sheet and a missing row number to placeholders, so
       * two rows that cannot say where they are would collapse onto one key and
       * become "the same occurrence" by accident.
       */
      it.each([
        ['no sheet', { sheetName: null }],
        ['no row number', { sourceRowNumber: null }],
      ])('F1: a row with %s is not asked about at all', async (_label, over) => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue(confirmableToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked(over)]);
        expect(decided.size).toBe(0);
        expect(findMany).not.toHaveBeenCalled();
      });

      /**
       * F1 — HEX CASE IS A SPELLING, NOT AN IDENTITY.
       *
       * The key case-folds the digest; SQL equality does not, and an IN list has no
       * case-insensitive form. A query narrowed to one spelling would return
       * NOTHING for rows stored in the other — an empty answer that reads
       * exactly like "nobody ever decided this".
       */
      it('F1: the query offers BOTH hex spellings of every digest asked about', async () => {
        findMany.mockResolvedValue([]);
        await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        const asked256 = findMany.mock.calls[0][0].where.sourceSha256.in;
        expect(asked256).toEqual(expect.arrayContaining([DOC.toLowerCase(), DOC.toUpperCase()]));
      });

      it('F1: a decision stored under the OTHER hex spelling is still the same occurrence', async () => {
        findMany.mockResolvedValue([settledRow({ sourceSha256: DOC.toUpperCase() })]);
        resolve.mockResolvedValue(confirmableToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [
          asked({ sourceSha256: DOC.toLowerCase() }),
        ]);
        expect(decided.get(observedSourceRowKey(asked()))).toBe('cat-timbunan');
      });

      /**
       * E1 — A NEW SIGHTING MUST NOT VALIDATE AN OLD DECISION.
       *
       * The audit's sequence. T0: a decision is made when the evidence is thin.
       * T1: some LATER import sights the same spelling and binds it, so the row
       * is now nominated as a RECORDED FACT. T2: the machine still says
       * NEEDS_REVIEW and nobody has looked again.
       *
       * Today's write-eligibility law would ACCEPT that selection — a person may
       * confirm on a sighting, because a person sees it. Replaying it unattended
       * is a different act, and the kernel's own contract is that a sighting
       * "can nominate a candidate, it can never assert one".
       */
      const sightingOnlyToday = {
        ...confirmableToday,
        reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW'],
        candidates: [
          {
            ...confirmableToday.candidates[0],
            identityBasis: 'RECORDED_FACT',
            evidence: ['SOURCE_SIGHTING_NAME_MATCH'],
          },
        ],
      };

      /**
       * THE TWO LAWS ARE DELIBERATELY DIFFERENT, AND THIS IS THE PROOF.
       *
       * The write law ACCEPTS this selection — which is exactly why the reader
       * handed it back before this repair: it asked only that question. A person
       * confirming on a sighting is lawful, because they see it; replaying it
       * with nobody looking is not.
       */
      it('E1: the WRITE law still accepts it — the replay law is what narrowed', () => {
        expect(selectionRefusal(sightingOnlyToday, 'cat-timbunan')).toBeNull();
      });

      it('E1: a decision nominated ONLY by a later sighting is NOT replayed', async () => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue(sightingOnlyToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.size).toBe(0);
      });

      it.each([
        ['a source CODE match', ['SOURCE_CODE_MATCH']],
        ['a reviewed human mapping', ['REVIEWED_MAPPING_NAME_MATCH']],
        ['a sighting AND a code match', ['SOURCE_SIGHTING_NAME_MATCH', 'SOURCE_CODE_MATCH']],
      ])('E1: %s still stands on its own and IS replayed', async (_label, evidence) => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue({
          ...sightingOnlyToday,
          candidates: [{ ...sightingOnlyToday.candidates[0], evidence }],
        });
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.get(observedSourceRowKey(asked()))).toBe('cat-timbunan');
      });

      it('E1: an EXACT catalogue-name match is never "sighting only"', async () => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue({
          ...confirmableToday,
          candidates: [
            {
              ...confirmableToday.candidates[0],
              identityBasis: 'EXACT_NAME',
              evidence: ['SOURCE_SIGHTING_NAME_MATCH'],
            },
          ],
        });
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.get(observedSourceRowKey(asked()))).toBe('cat-timbunan');
      });

      /**
       * E2 — THE SAME PLACE IS NOT THE SAME FACT.
       *
       * The locator key carries digest, sheet, row, name and class — not the
       * stated code, unit or parser contract. So an answer given about M144 at
       * this row would answer a question about M999 at this row: a different
       * source fact wearing the same address.
       */
      it.each([
        ['another stated code (M144 answered, M999 asked)', { rawCode: 'M999' }],
        ['another stated unit', { rawUnit: 'Kg' }],
        ['another parser contract', { parserContractVersion: 'USI01_XLSX_V2' }],
      ])('E2: a decision does not answer %s', async (_label, over) => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue(confirmableToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked(over)]);
        expect(decided.size).toBe(0);
      });

      it('E2: a stated code the source never gave is not the same as one it did', async () => {
        findMany.mockResolvedValue([settledRow({ rawCode: null })]);
        resolve.mockResolvedValue(confirmableToday);
        const decided = await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(decided.size).toBe(0);
      });

      it('F1: it is a READ — nothing is written', async () => {
        findMany.mockResolvedValue([settledRow()]);
        resolve.mockResolvedValue(confirmableToday);
        await reader().decidedIdentityForSourceRows('ws-1', [asked()]);
        expect(update).not.toHaveBeenCalled();
      });
    });

    it('a document with nothing observed asks nothing', async () => {
      const open = await reader().openQuestionsBySource('ws-1', []);
      expect(open.size).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
      expect(loadEvidence).not.toHaveBeenCalled();
    });
  });
});

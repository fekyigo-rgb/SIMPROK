import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RabIntelligenceProposalService } from './rab-intelligence-proposal.service';
import { CreateRabIntelligenceProposalDto } from './dto/create-rab-intelligence-proposal.dto';

const PROJECT = {
  id: 'project-a',
  workspaceId: 'workspace-a',
  organizationId: 'org-a',
  mainMaterialSpec: 'Beton K-300',
};

const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';

function boqItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'boq-item-1',
    boqStructureId: 'structure-1',
    parentId: null,
    wbsNodeId: null,
    wbsCode: '1.1',
    name: 'Galian tanah biasa',
    itemType: 'WORK_ITEM',
    quantity: { toString: () => '10' } as any,
    unit: 'm3',
    unitPrice: null,
    lineTotal: null,
    sortOrder: 0,
    ahspVersionId: null,
    ahspSnapshotId: null,
    ...overrides,
  };
}

function createHarness(options?: {
  project?: typeof PROJECT | null;
  draftStructureId?: string | null;
  boqItems?: ReturnType<typeof boqItem>[];
  ahspRows?: { id: string; workType: string; methodName: string }[];
}) {
  const boqItems = options?.boqItems ?? [boqItem()];
  const findMany = jest.fn().mockImplementation((args: any) => {
    // Explicit-refs path: scoped id: { in: [...] } lookup only.
    if (args?.where?.id?.in) {
      const ids: string[] = args.where.id.in;
      return Promise.resolve(boqItems.filter((item) => ids.includes(item.id)));
    }
    // Default-selection path: DB-level orderBy + take, never a full load.
    const sorted = [...boqItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const limited = typeof args?.take === 'number' ? sorted.slice(0, args.take) : sorted;
    return Promise.resolve(limited);
  });

  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue(options?.project === undefined ? PROJECT : options.project),
    },
    boqStructure: {
      findFirst: jest.fn().mockResolvedValue(
        options?.draftStructureId === undefined
          ? { id: 'structure-1' }
          : options.draftStructureId === null
            ? null
            : { id: options.draftStructureId },
      ),
    },
    projectBaseline: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    rabDocument: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    boqItem: { findMany },
    aHSP: {
      findMany: jest.fn().mockResolvedValue(options?.ahspRows ?? []),
    },
  };
  const orchestrator = {
    proposeRabDraft: jest.fn().mockResolvedValue({
      requestId: 'orchestrator-returned-id',
      status: 'NEEDS_REVIEW',
      items: [],
      warnings: ['PROVIDER_UNAVAILABLE'],
    }),
  };

  const service = new RabIntelligenceProposalService(prisma as any, orchestrator as any);
  return { service, prisma, orchestrator };
}

const dto: CreateRabIntelligenceProposalDto = {};

describe('RabIntelligenceProposalService', () => {
  it('grounding packet contains only the correct tenant/project data', async () => {
    const { service, orchestrator } = createHarness({
      boqItems: [boqItem()],
      ahspRows: [{ id: 'ahsp-1', workType: 'Pekerjaan Tanah', methodName: 'Manual' }],
    });

    await service.propose(PROJECT.id, 'account-server-derived', dto);

    expect(orchestrator.proposeRabDraft).toHaveBeenCalledTimes(1);
    const request = orchestrator.proposeRabDraft.mock.calls[0][0];
    expect(request).toMatchObject({
      workspaceId: PROJECT.workspaceId,
      organizationId: PROJECT.organizationId,
      projectId: PROJECT.id,
      accountId: 'account-server-derived',
      boqItemRefs: ['boq-item-1'],
      basicPriceCandidates: [],
      efPermission: 'NOT_ALLOWED',
      requestedAction: 'GENERATE_DRAFT_RAB',
    });
    // Quantity is a canonical decimal string, never a JS number.
    expect(request.boqItems).toEqual([
      { boqItemRef: 'boq-item-1', wbsCode: '1.1', name: 'Galian tanah biasa', unit: 'm3', quantity: '10' },
    ]);
    expect(request.ahspCandidates).toEqual([{ id: 'ahsp-1', label: 'Pekerjaan Tanah - Manual' }]);
    expect(typeof request.requestId).toBe('string');
    expect(request.requestId).not.toBe('');
  });

  it('projectContextRef/mainMaterialSpecRef are stable, content-free references; the actual spec text only travels in mainMaterialSpecContext', async () => {
    const { service, orchestrator } = createHarness();

    await service.propose(PROJECT.id, 'account-1', dto);

    const request = orchestrator.proposeRabDraft.mock.calls[0][0];
    expect(request.projectContextRef).toBe(`project:${PROJECT.id}`);
    expect(request.projectContextRef).not.toContain('Beton K-300');
    expect(request.mainMaterialSpecRef).toBe(`project:${PROJECT.id}:main-material-spec`);
    expect(request.mainMaterialSpecRef).not.toContain('Beton K-300');
    expect(request.mainMaterialSpecContext).toBe('Beton K-300');
  });

  it('omits mainMaterialSpecRef/Context entirely when the project has no mainMaterialSpec', async () => {
    const { service, orchestrator } = createHarness({ project: { ...PROJECT, mainMaterialSpec: null as any } });

    await service.propose(PROJECT.id, 'account-1', dto);

    const request = orchestrator.proposeRabDraft.mock.calls[0][0];
    expect(request.mainMaterialSpecRef).toBeUndefined();
    expect(request.mainMaterialSpecContext).toBeUndefined();
  });

  it('identity/scope is never trusted from the request body, even if smuggled in', async () => {
    const { service, orchestrator } = createHarness();
    const attackerDto = {
      boqItemRefs: undefined,
      workspaceId: 'attacker-workspace',
      organizationId: 'attacker-org',
      accountId: 'attacker-account',
      requestId: 'attacker-chosen-request-id',
    } as unknown as CreateRabIntelligenceProposalDto;

    await service.propose(PROJECT.id, 'real-account-id', attackerDto);

    const request = orchestrator.proposeRabDraft.mock.calls[0][0];
    expect(request.workspaceId).toBe(PROJECT.workspaceId);
    expect(request.organizationId).toBe(PROJECT.organizationId);
    expect(request.accountId).toBe('real-account-id');
    expect(request.requestId).not.toBe('attacker-chosen-request-id');
  });

  it('rejects a boqItemRef that does not belong to this project BOQ (cross-project/tenant)', async () => {
    const { service } = createHarness({ boqItems: [boqItem({ id: 'boq-item-1' })] });

    await expect(
      service.propose(PROJECT.id, 'account-1', { boqItemRefs: ['boq-item-from-another-project'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when more than the bounded max of boqItemRefs is requested', async () => {
    const { service } = createHarness({ boqItems: [boqItem()] });
    const tooMany = Array.from({ length: 21 }, (_, i) => `id-${i}`);

    await expect(service.propose(PROJECT.id, 'account-1', { boqItemRefs: tooMany })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('default selection queries the database with orderBy + take -- never loads the whole BOQ', async () => {
    const manyItems = Array.from({ length: 500 }, (_, i) => boqItem({ id: `boq-item-${i}`, sortOrder: i }));
    const { service, orchestrator, prisma } = createHarness({ boqItems: manyItems });

    await service.propose(PROJECT.id, 'account-1', dto);

    expect(prisma.boqItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { boqStructureId: 'structure-1', itemType: 'WORK_ITEM' },
        orderBy: { sortOrder: 'asc' },
        take: 20,
      }),
    );
    const request = orchestrator.proposeRabDraft.mock.calls[0][0];
    expect(request.boqItemRefs).toHaveLength(20);
    expect(request.boqItemRefs).toEqual(manyItems.slice(0, 20).map((item) => item.id));
  });

  it('explicit refs query only those ids scoped to this boqStructureId, in request order', async () => {
    const items = [
      boqItem({ id: 'boq-item-1', sortOrder: 0 }),
      boqItem({ id: 'boq-item-2', sortOrder: 1 }),
      boqItem({ id: 'boq-item-3', sortOrder: 2 }),
    ];
    const { service, orchestrator, prisma } = createHarness({ boqItems: items });

    await service.propose(PROJECT.id, 'account-1', { boqItemRefs: ['boq-item-3', 'boq-item-1'] });

    expect(prisma.boqItem.findMany).toHaveBeenCalledWith({
      where: { boqStructureId: 'structure-1', itemType: 'WORK_ITEM', id: { in: ['boq-item-3', 'boq-item-1'] } },
    });
    const request = orchestrator.proposeRabDraft.mock.calls[0][0];
    // Preserves the caller's requested order, not DB/insertion order.
    expect(request.boqItemRefs).toEqual(['boq-item-3', 'boq-item-1']);
  });

  it('rejects duplicate boqItemRefs at the DTO validation layer', async () => {
    const instance = plainToInstance(CreateRabIntelligenceProposalDto, { boqItemRefs: [UUID_1, UUID_1] });
    const errors = await validate(instance);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.constraints && 'arrayUnique' in e.constraints)).toBe(true);
  });

  it('accepts unique boqItemRefs at the DTO validation layer', async () => {
    const instance = plainToInstance(CreateRabIntelligenceProposalDto, { boqItemRefs: [UUID_1, UUID_2] });
    const errors = await validate(instance);

    expect(errors).toHaveLength(0);
  });

  it('rejects when the project has no draft or baseline BOQ at all', async () => {
    const { service } = createHarness({ draftStructureId: null });

    await expect(service.propose(PROJECT.id, 'account-1', dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects (without calling the orchestrator) when the BOQ structure exists but has no WORK_ITEM rows', async () => {
    const { service, orchestrator } = createHarness({ boqItems: [] });

    await expect(service.propose(PROJECT.id, 'account-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(orchestrator.proposeRabDraft).not.toHaveBeenCalled();
  });

  it('rejects an unknown project id', async () => {
    const { service } = createHarness({ project: null });

    await expect(service.propose('unknown-project', 'account-1', dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns exactly what the orchestrator produced (no local mutation/override of the result)', async () => {
    const { service } = createHarness();

    const result = await service.propose(PROJECT.id, 'account-1', dto);

    expect(result).toMatchObject({ status: 'NEEDS_REVIEW', warnings: ['PROVIDER_UNAVAILABLE'] });
  });
});

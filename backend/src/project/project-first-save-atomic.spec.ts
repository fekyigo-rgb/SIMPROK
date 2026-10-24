import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';

const firstRows = [{ tempId: 'local-item-1', itemType: 'WORK_ITEM', name: 'Galian Tanah', quantity: 2, unit: 'm3' }];
function harness() {
  const tx = {
    project: { create: jest.fn().mockResolvedValue({ id: 'project-first-1' }) },
    workspaceMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    projectAssignment: { create: jest.fn() },
    boqStructure: { create: jest.fn().mockResolvedValue({ id: 'boq-first-1' }) },
  };
  const prisma = {
    workspace: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) },
    $transaction: jest.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const service = new ProjectService(prisma as any, {} as any, {} as any);
  const writer = jest.spyOn(service as any, 'saveDraftBoqInTransaction').mockResolvedValue({
    structureId: 'boq-first-1',
    items: firstRows,
    recap: {},
  });
  return { tx, prisma, service, writer };
}
describe('RAB first Save Draft — one canonical transaction writer', () => {
  it('accepts a validated nested first RAB draft DTO', async () => {
    const input = plainToInstance(CreateProjectDto, {
      name: 'RAB',
      code: 'RAB-FIRST-1',
      initialDraft: { rows: firstRows, marginPercent: 10, taxPercent: 11 },
    });
    expect(await validate(input)).toEqual([]);
  });
  it('rejects a malformed nested RAB before any service mutation', async () => {
    const input = plainToInstance(CreateProjectDto, {
      name: 'RAB',
      code: 'RAB-FIRST-1',
      initialDraft: { rows: [{ tempId: 't', itemType: 'INVALID', name: 'Galian' }] },
    });
    expect((await validate(input)).length).toBeGreaterThan(0);
  });
  it('reuses the same transaction context for project, Working Draft and BOQ save', async () => {
    const { tx, prisma, service, writer } = harness();
    const initialDraft = { rows: firstRows, marginPercent: 10, taxPercent: 11 } as any;
    const result = await service.create(
      { name: 'RAB', code: 'RAB-FIRST-1', initialDraft },
      'workspace-1',
    );
    expect(result.id).toBe('project-first-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.boqStructure.create).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(tx, 'project-first-1', initialDraft, firstRows);
  });
  it('preserves existing project creation without an initial BOQ document', async () => {
    const { service, writer } = harness();
    await service.create({ name: 'Project', code: 'OLD-CREATE' }, 'workspace-1');
    expect(writer).not.toHaveBeenCalled();
  });
  it('does not report a created project if its BOQ writer rejects the transaction', async () => {
    const { prisma, service, writer } = harness();
    writer.mockRejectedValueOnce(new BadRequestException('INVALID_BOQ_GRAPH'));
    await expect(service.create(
      { name: 'RAB', code: 'RAB-INVALID', initialDraft: { rows: firstRows } as any },
      'workspace-1',
    )).rejects.toThrow();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('First-save PROJECT_CREATE + RAB_DRAFT_EDIT authority', () => {
  function controllerHarness(permissions: string[]) {
    const fakeService = { create: jest.fn().mockResolvedValue({ id: 'project-first-1' }) };
    const permissionResolver = {
      resolve: jest.fn().mockResolvedValue({ permissions }),
    };
    const controller = new ProjectController(
      fakeService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      permissionResolver as any,
    );
    const request = {
      workspaceContext: { workspaceId: 'workspace-1' },
      user: { id: 'actor-1' },
    };
    return { controller, request, fakeService, permissionResolver };
  }
  it('rejects the new initial RAB save when draft edit authority is missing', async () => {
    const h = controllerHarness(['PROJECT_CREATE']);
    await expect(h.controller.create(h.request as any, {
      name: 'RAB', code: 'RAB-SECURE', initialDraft: { rows: firstRows } as any,
    })).rejects.toThrow('RAB_DRAFT_EDIT permission is required');
    expect(h.fakeService.create).not.toHaveBeenCalled();
  });
  it('accepts both permissions and reuses the existing ProjectService.create', async () => {
    const h = controllerHarness(['PROJECT_CREATE', 'RAB_DRAFT_EDIT']);
    await h.controller.create(h.request as any, {
      name: 'RAB', code: 'RAB-SECURE', initialDraft: { rows: firstRows } as any,
    });
    expect(h.permissionResolver.resolve).toHaveBeenCalledWith('actor-1', 'workspace-1');
    expect(h.fakeService.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RAB-SECURE' }), 'workspace-1', 'actor-1',
    );
  });
  it('does not add an RAB permission requirement to existing metadata-only Project creation', async () => {
    const h = controllerHarness(['PROJECT_CREATE']);
    await h.controller.create(h.request as any, { name: 'Project', code: 'EXISTING' });
    expect(h.permissionResolver.resolve).not.toHaveBeenCalled();
    expect(h.fakeService.create).toHaveBeenCalledTimes(1);
  });
});

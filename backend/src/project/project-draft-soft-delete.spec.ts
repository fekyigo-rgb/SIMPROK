import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { PERMISSIONS_ALL_KEY } from '../common/decorators/permissions.decorator';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const owner = {
  accountId: '33333333-3333-4333-8333-333333333333',
  membershipId: '44444444-4444-4444-8444-444444444444',
  workspaceId,
  roleInProject: 'OWNER',
  isPrimaryAssignment: true,
};

function harness(overrides?: { project?: any; allowed?: boolean; official?: boolean; changed?: number }) {
  const project = overrides?.project === undefined
    ? { id: projectId, name: 'Uji Draft', workspaceId, status: ProjectStatus.PLANNED, deletedAt: null }
    : overrides.project;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(project ? [project] : []),
    project: { updateMany: jest.fn().mockResolvedValue({ count: overrides?.changed ?? 1 }) },
    projectBaseline: { count: jest.fn().mockResolvedValue(overrides?.official ? 1 : 0) },
    rabDocument: { count: jest.fn().mockResolvedValue(0) },
    boqStructure: { count: jest.fn().mockResolvedValue(0) },
    progressReport: { count: jest.fn().mockResolvedValue(0) },
    projectContract: { count: jest.fn().mockResolvedValue(0) },
    formalDecision: { count: jest.fn().mockResolvedValue(0) },
    progressAuditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const lifecycle = {
    evaluateInTransaction: jest.fn().mockResolvedValue({ canEditDraft: overrides?.allowed ?? true }),
  };
  const service = new ProjectService(prisma as any, {} as any, lifecycle as any);
  return { tx, prisma, lifecycle, service };
}

describe('Project Draft Soft Delete: reuse canonical Project.deletedAt, fail closed', () => {
  it('requires BOTH preexisting permissions, never OR', () => {
    const permissionCodes = Reflect.getMetadata(
      PERMISSIONS_ALL_KEY,
      ProjectController.prototype.discardDraftProject,
    );
    expect(permissionCodes).toEqual(['PROJECT_VIEW', 'RAB_DRAFT_EDIT']);
  });

  it('marks only an eligible draft, records actor audit and never physically deletes BOQ/Project', async () => {
    const h = harness();
    await expect(h.service.discardDraftProject(projectId, 'Uji Draft', owner)).resolves.toEqual({ id: projectId, deleted: true });
    expect(h.lifecycle.evaluateInTransaction).toHaveBeenCalledWith(h.tx, projectId, ProjectStatus.PLANNED);
    expect(h.tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: projectId, workspaceId, deletedAt: null, status: ProjectStatus.PLANNED },
      data: { deletedAt: expect.any(Date) },
    });
    expect(h.tx.progressAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      projectId, workspaceId, actorAccountId: owner.accountId,
      action: 'PROJECT_DRAFT_SOFT_DELETE', eventType: 'PROJECT_CONFIGURATION',
      sourceModule: 'PROJECT_GOVERNANCE',
    }) });
    expect((h.tx.project as any).delete).toBeUndefined();
  });

  it('denies non-primary owner and non-OWNER before any database transaction', async () => {
    const h = harness();
    await expect(h.service.discardDraftProject(projectId, 'Uji Draft', { ...owner, isPrimaryAssignment: false }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.discardDraftProject(projectId, 'Uji Draft', { ...owner, roleInProject: 'PM' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-workspace', { workspaceId: '55555555-5555-4555-8555-555555555555' }, NotFoundException],
    ['deleted already', { deletedAt: new Date() }, NotFoundException],
    ['locked/later project stage', { status: ProjectStatus.ACTIVE }, ConflictException],
  ])('refuses %s safely', async (_label, patch, exception) => {
    const h = harness({ project: {
      id: projectId, workspaceId, name: 'Uji Draft', status: ProjectStatus.PLANNED, deletedAt: null, ...patch,
    } });
    await expect(h.service.discardDraftProject(projectId, 'Uji Draft', owner)).rejects.toBeInstanceOf(exception);
    expect(h.tx.project.updateMany).not.toHaveBeenCalled();
    expect(h.tx.progressAuditEvent.create).not.toHaveBeenCalled();
  });

  it('accepts an existing draft name with surrounding whitespace when confirmed', async () => {
    const h = harness({ project: { id: projectId, name: '  Uji Draft  ', workspaceId, status: ProjectStatus.PLANNED, deletedAt: null } });
    await expect(h.service.discardDraftProject(projectId, '  Uji Draft  ', owner)).resolves.toEqual({ id: projectId, deleted: true });
  });

  it('refuses locked or approved RAB and any historical official baseline', async () => {
    for (const options of [{allowed: false}, {official: true}]) {
      const h = harness(options);
      await expect(h.service.discardDraftProject(projectId, 'Uji Draft', owner)).rejects.toBeInstanceOf(ConflictException);
      expect(h.tx.project.updateMany).not.toHaveBeenCalled();
    }
  });

  it('refuses stale name and racing updates; never produces success audit', async () => {
    const name = harness();
    await expect(name.service.discardDraftProject(projectId, 'Nama Lama', owner)).rejects.toBeInstanceOf(ConflictException);
    const race = harness({changed: 0});
    await expect(race.service.discardDraftProject(projectId, 'Uji Draft', owner)).rejects.toBeInstanceOf(ConflictException);
    expect(race.tx.progressAuditEvent.create).not.toHaveBeenCalled();
  });
});

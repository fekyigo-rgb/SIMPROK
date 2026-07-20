import { Test, TestingModule } from '@nestjs/testing';
import { ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';

describe('RabLifecyclePolicyService', () => {
  let service: RabLifecyclePolicyService;
  let prisma: {
    projectBaseline: { count: jest.Mock; groupBy: jest.Mock };
    rabDocument: { count: jest.Mock; groupBy: jest.Mock };
    boqStructure: { count: jest.Mock; groupBy: jest.Mock };
  };

  const projectId = 'project-1';

  beforeEach(async () => {
    prisma = {
      projectBaseline: { count: jest.fn(), groupBy: jest.fn() },
      rabDocument: { count: jest.fn(), groupBy: jest.fn() },
      boqStructure: { count: jest.fn(), groupBy: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabLifecyclePolicyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<RabLifecyclePolicyService>(RabLifecyclePolicyService);
  });

  const mockCounts = (activeBaselineCount: number, approvedRabCount: number, workingDraftCount: number) => {
    prisma.projectBaseline.count.mockResolvedValue(activeBaselineCount);
    prisma.rabDocument.count.mockResolvedValue(approvedRabCount);
    prisma.boqStructure.count.mockResolvedValue(workingDraftCount);
  };

  it('allows entering and editing a PLANNED, zero-draft project — zero drafts is not a denial', async () => {
    mockCounts(0, 0, 0);
    const result = await service.evaluate(projectId, ProjectStatus.PLANNED);
    expect(result).toEqual({
      canEnterEditableDraftWorkspace: true,
      canEditDraft: true,
      reasonCode: null,
      projectStatus: ProjectStatus.PLANNED,
      activeBaselineCount: 0,
      approvedRabCount: 0,
      workingDraftCount: 0,
    });
  });

  it('allows a PLANNED project with exactly one Working Draft', async () => {
    mockCounts(0, 0, 1);
    const result = await service.evaluate(projectId, ProjectStatus.PLANNED);
    expect(result.canEnterEditableDraftWorkspace).toBe(true);
    expect(result.canEditDraft).toBe(true);
    expect(result.reasonCode).toBeNull();
    expect(result.workingDraftCount).toBe(1);
  });

  it('blocks with ACTIVE_BASELINE_EXISTS when a PLANNED project has an active baseline', async () => {
    mockCounts(1, 0, 0);
    const result = await service.evaluate(projectId, ProjectStatus.PLANNED);
    expect(result.canEnterEditableDraftWorkspace).toBe(false);
    expect(result.canEditDraft).toBe(false);
    expect(result.reasonCode).toBe('ACTIVE_BASELINE_EXISTS');
  });

  it('blocks with APPROVED_RAB_EXISTS when a PLANNED project has an approved RAB and no active baseline', async () => {
    mockCounts(0, 1, 0);
    const result = await service.evaluate(projectId, ProjectStatus.PLANNED);
    expect(result.canEnterEditableDraftWorkspace).toBe(false);
    expect(result.reasonCode).toBe('APPROVED_RAB_EXISTS');
  });

  it('blocks with MULTIPLE_WORKING_DRAFTS when a PLANNED project has more than one Working Draft', async () => {
    mockCounts(0, 0, 2);
    const result = await service.evaluate(projectId, ProjectStatus.PLANNED);
    expect(result.canEnterEditableDraftWorkspace).toBe(false);
    expect(result.reasonCode).toBe('MULTIPLE_WORKING_DRAFTS');
  });

  it.each([
    ProjectStatus.ACTIVE,
    ProjectStatus.ON_HOLD,
    ProjectStatus.COMPLETED,
    ProjectStatus.ARCHIVED,
    ProjectStatus.CANCELLED,
  ])('blocks with PROJECT_NOT_DRAFT when status is %s and counts are otherwise clean', async (status) => {
    mockCounts(0, 0, 0);
    const result = await service.evaluate(projectId, status);
    expect(result.canEnterEditableDraftWorkspace).toBe(false);
    expect(result.canEditDraft).toBe(false);
    expect(result.reasonCode).toBe('PROJECT_NOT_DRAFT');
    expect(result.projectStatus).toBe(status);
  });

  it('prioritizes ACTIVE_BASELINE_EXISTS over APPROVED_RAB_EXISTS, MULTIPLE_WORKING_DRAFTS, and PROJECT_NOT_DRAFT', async () => {
    mockCounts(1, 1, 2);
    const result = await service.evaluate(projectId, ProjectStatus.ACTIVE);
    expect(result.reasonCode).toBe('ACTIVE_BASELINE_EXISTS');
  });

  it('prioritizes APPROVED_RAB_EXISTS over MULTIPLE_WORKING_DRAFTS and PROJECT_NOT_DRAFT', async () => {
    mockCounts(0, 1, 2);
    const result = await service.evaluate(projectId, ProjectStatus.ACTIVE);
    expect(result.reasonCode).toBe('APPROVED_RAB_EXISTS');
  });

  it('prioritizes MULTIPLE_WORKING_DRAFTS over PROJECT_NOT_DRAFT', async () => {
    mockCounts(0, 0, 2);
    const result = await service.evaluate(projectId, ProjectStatus.ACTIVE);
    expect(result.reasonCode).toBe('MULTIPLE_WORKING_DRAFTS');
  });

  it('Project.status is an eligibility door only — it never fabricates or overrides real baseline/approved-RAB facts', async () => {
    // A PLANNED project with a real active baseline is still blocked by that
    // fact, not waved through because its status happens to be editable.
    mockCounts(1, 0, 0);
    const plannedWithBaseline = await service.evaluate(projectId, ProjectStatus.PLANNED);
    expect(plannedWithBaseline.canEnterEditableDraftWorkspace).toBe(false);
    expect(plannedWithBaseline.reasonCode).toBe('ACTIVE_BASELINE_EXISTS');

    // An ACTIVE project with zero baseline/approved/draft facts is blocked
    // purely on the status gate — status cannot invent those facts either way.
    mockCounts(0, 0, 0);
    const activeClean = await service.evaluate(projectId, ProjectStatus.ACTIVE);
    expect(activeClean.canEnterEditableDraftWorkspace).toBe(false);
    expect(activeClean.reasonCode).toBe('PROJECT_NOT_DRAFT');
    expect(activeClean.activeBaselineCount).toBe(0);
    expect(activeClean.approvedRabCount).toBe(0);
  });

  it('evaluateInTransaction reads through the supplied client, not the injected PrismaService', async () => {
    const txClient = {
      projectBaseline: { count: jest.fn().mockResolvedValue(0) },
      rabDocument: { count: jest.fn().mockResolvedValue(0) },
      boqStructure: { count: jest.fn().mockResolvedValue(1) },
    };
    mockCounts(9, 9, 9); // would block if the tx client were ignored

    const result = await service.evaluateInTransaction(txClient as never, projectId, ProjectStatus.PLANNED);

    expect(result.canEditDraft).toBe(true);
    expect(result.workingDraftCount).toBe(1);
    expect(prisma.projectBaseline.count).not.toHaveBeenCalled();
    expect(txClient.projectBaseline.count).toHaveBeenCalledWith({ where: { projectId, status: 'ACTIVE' } });
  });

  describe('evaluateBatch', () => {
    it('returns an empty map for an empty project list without querying', async () => {
      const result = await service.evaluateBatch([], new Map());
      expect(result.size).toBe(0);
      expect(prisma.projectBaseline.groupBy).not.toHaveBeenCalled();
    });

    it('issues exactly three queries regardless of project count and projects each row independently', async () => {
      prisma.projectBaseline.groupBy.mockResolvedValue([{ projectId: 'p1', _count: { _all: 1 } }]);
      prisma.rabDocument.groupBy.mockResolvedValue([{ projectId: 'p2', _count: { _all: 1 } }]);
      prisma.boqStructure.groupBy.mockResolvedValue([{ projectId: 'p3', _count: { _all: 1 } }]);

      const statusById = new Map<string, ProjectStatus>([
        ['p1', ProjectStatus.PLANNED],
        ['p2', ProjectStatus.PLANNED],
        ['p3', ProjectStatus.PLANNED],
        ['p4', ProjectStatus.PLANNED],
        ['p5', ProjectStatus.ACTIVE],
      ]);

      const result = await service.evaluateBatch(['p1', 'p2', 'p3', 'p4', 'p5'], statusById);

      expect(prisma.projectBaseline.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.rabDocument.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.boqStructure.groupBy).toHaveBeenCalledTimes(1);

      expect(result.get('p1')?.reasonCode).toBe('ACTIVE_BASELINE_EXISTS');
      expect(result.get('p2')?.reasonCode).toBe('APPROVED_RAB_EXISTS');
      expect(result.get('p3')).toEqual({
        canEnterEditableDraftWorkspace: true,
        canEditDraft: true,
        reasonCode: null,
        projectStatus: ProjectStatus.PLANNED,
        activeBaselineCount: 0,
        approvedRabCount: 0,
        workingDraftCount: 1,
      });
      expect(result.get('p4')?.workingDraftCount).toBe(0);
      expect(result.get('p4')?.canEnterEditableDraftWorkspace).toBe(true);
      // ACTIVE with zero facts of its own — blocked purely by the status gate.
      expect(result.get('p5')?.reasonCode).toBe('PROJECT_NOT_DRAFT');
    });

    it('fails closed with PROJECT_STATUS_MISSING_FOR_RAB_LIFECYCLE when a projectId has no status entry — never falls back to PLANNED', async () => {
      prisma.projectBaseline.groupBy.mockResolvedValue([]);
      prisma.rabDocument.groupBy.mockResolvedValue([]);
      prisma.boqStructure.groupBy.mockResolvedValue([]);

      const statusById = new Map<string, ProjectStatus>(); // p1 intentionally absent

      await expect(service.evaluateBatch(['p1'], statusById)).rejects.toMatchObject({
        message: 'PROJECT_STATUS_MISSING_FOR_RAB_LIFECYCLE',
      });
    });
  });
});

import { ForbiddenException, ConflictException } from '@nestjs/common';
import {
  ExecutionPlanStatus,
  ProgressAuditOutcome,
  ProjectStatus,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISSIONS } from '../common/constants/permissions';
import { EXECUTION_PLAN_AUTHORITY } from '../execution-plan/execution-plan.contracts';
import { StartProjectExecutionDto } from './dto/start-project-execution.dto';
import {
  PROJECT_EXECUTION_START_ACTION,
  PROJECT_EXECUTION_START_AUTHORITY,
  PROJECT_EXECUTION_START_POLICY_VERSION,
} from './project-execution.contracts';
import { ProjectService } from './project.service';
import {
  WORK_PERIOD_ANCHOR_ACTION,
  WORK_PERIOD_ANCHOR_POLICY_VERSION,
} from './work-period-anchor.policy';

describe('SR-01 governed Mulai Pelaksanaan command', () => {
  const projectId = '10000000-0000-4000-8000-000000000001';
  const workspaceId = '10000000-0000-4000-8000-000000000002';
  const membershipId = '10000000-0000-4000-8000-000000000003';
  const assignmentId = '10000000-0000-4000-8000-000000000004';
  const accountId = '10000000-0000-4000-8000-000000000005';
  const positionId = '10000000-0000-4000-8000-000000000006';
  const baselineId = '10000000-0000-4000-8000-000000000007';
  const planId = '10000000-0000-4000-8000-000000000008';
  const boqItemId = '10000000-0000-4000-8000-000000000009';
  const commandId = '10000000-0000-4000-8000-000000000010';
  const nextCommandId = '10000000-0000-4000-8000-000000000011';
  const anchorEventId = '10000000-0000-4000-8000-000000000012';
  const actor = {
    accountId,
    membershipId,
    workspaceId,
    assignmentId,
    roleInProject: 'PROJECT_GOVERNOR',
    isPrimaryAssignment: true,
    roles: ['PROJECT_GOVERNOR'],
  };
  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

  type HarnessOptions = {
    projectStatus?: ProjectStatus;
    timeZone?: string | null;
    anchorDate?: string | null;
    baselineCount?: number;
    planCount?: number;
    planBaselineId?: string;
    periodStartDate?: string;
    permission?: boolean;
    authorityError?: Error;
    wholeLock?: boolean;
    compareAndSetCount?: number;
  };

  function harness(options: HarnessOptions = {}) {
    const anchorDate =
      options.anchorDate === undefined ? '2026-10-01' : options.anchorDate;
    const project = {
      id: projectId,
      workspaceId,
      status: options.projectStatus ?? ProjectStatus.PLANNED,
      startDate: anchorDate === null ? null : day(anchorDate),
      endDate: day('2026-12-31'),
      timeZone: options.timeZone === undefined ? 'UTC' : options.timeZone,
    };
    const baselines = Array.from(
      { length: options.baselineCount ?? 1 },
      (_, index) => ({
        id: index === 0 ? baselineId : `baseline-${index + 1}`,
        versionNumber: index + 1,
      }),
    );
    const basePlan = (index = 0): any => ({
      id: index === 0 ? planId : `plan-${index + 1}`,
      projectId,
      baselineId:
        index === 0 ? (options.planBaselineId ?? baselineId) : baselineId,
      versionNumber: index + 1,
      revision: 2,
      status: ExecutionPlanStatus.LOCKED,
      lockedAt: new Date('2026-09-20T00:00:00.000Z'),
      lockedByAccountId: accountId,
      lockedByPositionId: positionId,
      lockedFromRevision: options.wholeLock === false ? 1 : 2,
      lockedFromProjectStatus: ProjectStatus.PLANNED,
      lockedAuthorityCode: EXECUTION_PLAN_AUTHORITY,
      distributions: [
        {
          boqItemId,
          periodStartDate: day(options.periodStartDate ?? '2026-10-01'),
        },
      ],
    });
    const plans = Array.from({ length: options.planCount ?? 1 }, (_, index) =>
      basePlan(index),
    );
    const anchorEvents =
      anchorDate === null
        ? []
        : [
            {
              id: anchorEventId,
              projectId,
              targetEntityType: 'PROJECT',
              targetEntityId: projectId,
              action: WORK_PERIOD_ANCHOR_ACTION.ACTIVATED,
              outcome: ProgressAuditOutcome.SUCCESS,
              actorAccountId: accountId,
              actorMembershipId: membershipId,
              reason: 'Owner confirmed Day-1',
              metadata: {
                policyVersion: WORK_PERIOD_ANCHOR_POLICY_VERSION,
                anchorDate,
                previousStartDate: null,
                actorAssignmentId: assignmentId,
                explicitConfirmation: true,
              },
              occurredAt: new Date('2026-09-15T00:00:00.000Z'),
            },
          ];
    const startAudits: any[] = [];
    const progressAuditEvent = {
      findMany: jest.fn().mockResolvedValue(anchorEvents),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            startAudits.find((event) => event.commandId === where.commandId) ??
              null,
          ),
        ),
      create: jest.fn().mockImplementation(({ data }) => {
        const event = { id: `start-audit-${startAudits.length + 1}`, ...data };
        startAudits.push(event);
        return Promise.resolve(event);
      }),
    };
    const updateMany = jest.fn().mockImplementation(({ where, data }) => {
      const count = options.compareAndSetCount ?? 1;
      if (
        count === 1 &&
        project.status === where.status &&
        data.status === ProjectStatus.ACTIVE
      ) {
        project.status = ProjectStatus.ACTIVE;
      }
      return Promise.resolve({ count });
    });
    const tx: any = {
      $queryRaw: jest.fn().mockImplementation(() =>
        Promise.resolve([
          {
            id: project.id,
            workspaceId: project.workspaceId,
            status: project.status,
            startDate: project.startDate,
            timeZone: project.timeZone,
          },
        ]),
      ),
      projectBaseline: { findMany: jest.fn().mockResolvedValue(baselines) },
      executionPlanVersion: { findMany: jest.fn().mockResolvedValue(plans) },
      progressAuditEvent,
      project: { updateMany },
    };
    const prisma: any = {
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const permissionResolver: any = {
      resolveWithinTransaction: jest.fn().mockResolvedValue({
        membershipId,
        permissions:
          options.permission === false
            ? []
            : [PERMISSIONS.PROJECT_EXECUTION_START],
      }),
    };
    const authority: any = {
      requireWithinTransaction: options.authorityError
        ? jest.fn().mockRejectedValue(options.authorityError)
        : jest.fn().mockResolvedValue({
            positionId,
            positionCode: 'PROJECT_GOVERNOR',
            authorityCode: PROJECT_EXECUTION_START_AUTHORITY,
          }),
    };
    const service = new ProjectService(
      prisma,
      {} as any,
      {} as any,
      permissionResolver,
      authority,
    );
    return {
      service,
      project,
      baselines,
      plans,
      tx,
      updateMany,
      startAudits,
      permissionResolver,
      authority,
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('validates command identity and trims an optional reason', async () => {
    const dto = plainToInstance(StartProjectExecutionDto, {
      commandId,
      reason: '  Notice to proceed confirmed  ',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('Notice to proceed confirmed');
  });

  it('starts execution only after every governed gate and records separate effective/action time', async () => {
    const candidate = harness();
    const result = await candidate.service.startExecution(
      projectId,
      { commandId, reason: 'Owner command' },
      actor,
    );

    expect(result).toEqual({
      changed: true,
      projectId,
      projectStatus: ProjectStatus.ACTIVE,
      baselineId,
      executionPlanVersionId: planId,
      effectiveStartDate: '2026-10-01',
      recordedAt: '2026-10-02T12:00:00.000Z',
      authorityCode: PROJECT_EXECUTION_START_AUTHORITY,
      positionId,
    });
    expect(PROJECT_EXECUTION_START_ACTION).toBe('PROJECT_EXECUTION_START');
    expect(candidate.updateMany).toHaveBeenCalledWith({
      where: { id: projectId, status: ProjectStatus.PLANNED },
      data: { status: ProjectStatus.ACTIVE },
    });
    expect(candidate.project.startDate).toEqual(day('2026-10-01'));
    expect(candidate.project.endDate).toEqual(day('2026-12-31'));
    expect(candidate.startAudits).toHaveLength(1);
    expect(candidate.startAudits[0]).toMatchObject({
      eventType: 'PROJECT_LIFECYCLE',
      outcome: ProgressAuditOutcome.SUCCESS,
      projectId,
      workspaceId,
      actorAccountId: accountId,
      actorMembershipId: membershipId,
      actorPositionId: positionId,
      authorityCode: PROJECT_EXECUTION_START_AUTHORITY,
      action: PROJECT_EXECUTION_START_ACTION,
      businessCommandId: commandId,
      commandId: `PROJECT_EXECUTION_START:${commandId}`,
      metadata: {
        policyVersion: PROJECT_EXECUTION_START_POLICY_VERSION,
        previousStatus: ProjectStatus.PLANNED,
        nextStatus: ProjectStatus.ACTIVE,
        activeBaselineId: baselineId,
        executionPlanVersionId: planId,
        effectiveStartDate: '2026-10-01',
        workPeriodAnchorEventId: anchorEventId,
        actorAssignmentId: assignmentId,
        projectBusinessDateAtAction: '2026-10-02',
        explicitConfirmation: true,
      },
      occurredAt: new Date('2026-10-02T12:00:00.000Z'),
      recordedAt: new Date('2026-10-02T12:00:00.000Z'),
    });
  });

  it('replays the exact command idempotently without appending audit truth', async () => {
    const candidate = harness();
    await candidate.service.startExecution(
      projectId,
      { commandId, reason: 'Owner command' },
      actor,
    );
    await expect(
      candidate.service.startExecution(
        projectId,
        { commandId, reason: 'Owner command' },
        actor,
      ),
    ).resolves.toMatchObject({ changed: false, projectStatus: 'ACTIVE' });
    expect(candidate.startAudits).toHaveLength(1);
    expect(candidate.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of the same commandId when the payload intent changes', async () => {
    const candidate = harness();
    await candidate.service.startExecution(
      projectId,
      { commandId, reason: 'Owner command' },
      actor,
    );

    await expect(
      candidate.service.startExecution(
        projectId,
        { commandId, reason: 'Changed intent' },
        actor,
      ),
    ).rejects.toMatchObject({ message: 'COMMAND_ID_REUSED' });
    expect(candidate.startAudits).toHaveLength(1);
    expect(candidate.updateMany).toHaveBeenCalledTimes(1);
  });

  it('refuses a different command against an already ACTIVE project', async () => {
    const candidate = harness();
    await candidate.service.startExecution(projectId, { commandId }, actor);
    await expect(
      candidate.service.startExecution(
        projectId,
        { commandId: nextCommandId },
        actor,
      ),
    ).rejects.toMatchObject({ message: 'PROJECT_EXECUTION_ALREADY_STARTED' });
    expect(candidate.startAudits).toHaveLength(1);
  });

  it('fails without the PROJECT_EXECUTION_START Permission', async () => {
    const candidate = harness({ permission: false });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({
      message: 'PROJECT_EXECUTION_START_PERMISSION_REQUIRED',
    });
    expect(candidate.authority.requireWithinTransaction).not.toHaveBeenCalled();
  });

  it('fails without active Position authority', async () => {
    const candidate = harness({
      authorityError: new ForbiddenException('DECISION_AUTHORITY_REQUIRED'),
    });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({ message: 'DECISION_AUTHORITY_REQUIRED' });
    expect(candidate.updateMany).not.toHaveBeenCalled();
  });

  it('fails for an inactive or revoked project assignment', async () => {
    const candidate = harness({
      authorityError: new ForbiddenException('PROJECT_ASSIGNMENT_REVOKED'),
    });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({ message: 'PROJECT_ASSIGNMENT_REVOKED' });
  });

  it.each([
    [0, 'NO_ACTIVE_BASELINE'],
    [2, 'MULTIPLE_ACTIVE_BASELINES'],
  ])('fails closed for %i Active Baselines', async (baselineCount, code) => {
    const candidate = harness({ baselineCount });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({ message: code });
  });

  it('fails when there is no locked Execution Plan', async () => {
    const candidate = harness({ planCount: 0 });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({
      message: 'PROJECT_EXECUTION_START_LOCKED_PLAN_REQUIRED',
    });
  });

  it('fails for multiple locked plans', async () => {
    const candidate = harness({ planCount: 2 });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({
      message: 'AMBIGUOUS_EXECUTION_PLAN_CONTEXT',
    });
  });

  it('fails for a locked plan from another baseline', async () => {
    const candidate = harness({ planBaselineId: 'another-baseline' });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({ message: 'BASELINE_BINDING_MISMATCH' });
  });

  it('fails when locked-plan provenance is incomplete', async () => {
    const candidate = harness({ wholeLock: false });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({
      message: 'EXECUTION_PLAN_LOCK_PROVENANCE_INVALID',
    });
  });

  it('fails without a PROVEN Work Period Anchor', async () => {
    const candidate = harness({ anchorDate: null });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({ message: 'WORK_PERIOD_ANCHOR_NOT_PROVEN' });
  });

  it('fails when Project Business Date is before governed Day-1', async () => {
    const candidate = harness({
      anchorDate: '2026-10-03',
      periodStartDate: '2026-10-03',
    });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({
      response: {
        code: 'PROJECT_EXECUTION_START_BEFORE_EFFECTIVE_DAY_ONE',
        projectId,
        projectBusinessDate: '2026-10-02',
        anchorDate: '2026-10-03',
      },
    });
    expect(candidate.project.startDate).toEqual(day('2026-10-03'));
  });

  it('fails when Project timezone cannot resolve a business date', async () => {
    const candidate = harness({ timeZone: null });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({
      response: {
        code: 'PROJECT_BUSINESS_DATE_UNAVAILABLE',
        reason: 'PROJECT_TIME_ZONE_NOT_SET',
      },
    });
  });

  it('fails and reports the earliest interval beginning before Day-1', async () => {
    const candidate = harness({ periodStartDate: '2026-09-30' });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({
      response: {
        state: 'CONFLICT',
        code: 'PROJECT_EXECUTION_INTERVAL_BEFORE_EFFECTIVE_DAY_ONE',
        baselineId,
        executionPlanVersionId: planId,
        boqItemId,
        earliestConflictingPeriodStartDate: '2026-09-30',
        anchorDate: '2026-10-01',
      },
    });
  });

  it('uses compare-and-set so a concurrent winner cannot create second truth', async () => {
    const candidate = harness({ compareAndSetCount: 0 });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toMatchObject({
      message: 'PROJECT_EXECUTION_START_CONCURRENT_CHANGE',
    });
    expect(candidate.startAudits).toHaveLength(0);
    expect(candidate.project.status).toBe(ProjectStatus.PLANNED);
  });

  it('does not treat legacy ACTIVE without this command proof as an idempotent replay', async () => {
    const candidate = harness({ projectStatus: ProjectStatus.ACTIVE });
    await expect(
      candidate.service.startExecution(projectId, { commandId }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(candidate.startAudits).toHaveLength(0);
  });
});

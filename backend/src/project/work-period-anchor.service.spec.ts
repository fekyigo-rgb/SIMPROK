import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma, ProgressAuditOutcome } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivateWorkPeriodAnchorDto } from './dto/activate-work-period-anchor.dto';
import { DeviationService } from './deviation.service';
import { ProjectService } from './project.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';
import {
  WORK_PERIOD_ANCHOR_ACTION,
  WORK_PERIOD_ANCHOR_POLICY_VERSION,
  type WorkPeriodAnchorAuditCandidate,
} from './work-period-anchor.policy';

interface StoredAnchorAudit extends WorkPeriodAnchorAuditCandidate {
  commandId: string;
  commandFingerprint: string;
  [key: string]: unknown;
}

type AnchorAuditCreateData = Omit<StoredAnchorAudit, 'id'>;

describe('MON-04 Work Period anchor governance service', () => {
  const projectId = '10000000-0000-4000-8000-000000000001';
  const workspaceId = '10000000-0000-4000-8000-000000000002';
  const accountId = '10000000-0000-4000-8000-000000000003';
  const membershipId = '10000000-0000-4000-8000-000000000004';
  const assignmentId = '10000000-0000-4000-8000-000000000005';
  const actor = {
    accountId,
    membershipId,
    workspaceId,
    assignmentId,
    roleInProject: 'PROJECT_GOVERNOR',
  };
  const commandId = '10000000-0000-4000-8000-000000000006';
  const nextCommandId = '10000000-0000-4000-8000-000000000007';
  const businessDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

  function harness(initialStartDate: Date | null = null) {
    let projectStartDate = initialStartDate;
    const audits: StoredAnchorAudit[] = [];
    const tx = {
      $queryRaw: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve([
            { id: projectId, workspaceId, startDate: projectStartDate },
          ]),
        ),
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: membershipId }),
      },
      projectAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: assignmentId }),
      },
      projectBaseline: { findMany: jest.fn().mockResolvedValue([]) },
      executionPlanVersion: { findMany: jest.fn().mockResolvedValue([]) },
      progressEntry: { count: jest.fn().mockResolvedValue(0) },
      boqItem: { findMany: jest.fn().mockResolvedValue([]) },
      project: {
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: { startDate: Date } }) => {
            projectStartDate = data.startDate;
            return Promise.resolve({
              id: projectId,
              startDate: projectStartDate,
            });
          }),
      },
      progressAuditEvent: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { commandId: string } }) =>
            Promise.resolve(
              audits.find((event) => event.commandId === where.commandId) ??
                null,
            ),
          ),
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve(
            audits.map((event) => ({
              id: event.id,
              projectId: event.projectId,
              targetEntityType: event.targetEntityType,
              targetEntityId: event.targetEntityId,
              action: event.action,
              outcome: event.outcome,
              actorAccountId: event.actorAccountId,
              actorMembershipId: event.actorMembershipId,
              reason: event.reason,
              metadata: event.metadata,
              occurredAt: event.occurredAt,
            })),
          ),
        ),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: AnchorAuditCreateData }) => {
            const event: StoredAnchorAudit = {
              id: `anchor-event-${audits.length + 1}`,
              ...data,
            };
            audits.push(event);
            return Promise.resolve(event);
          }),
      },
    };
    const prisma = {
      project: {
        findUnique: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve({ id: projectId, startDate: projectStartDate }),
          ),
      },
      progressAuditEvent: {
        findMany: tx.progressAuditEvent.findMany,
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (transaction: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
    };
    return {
      tx,
      prisma,
      audits,
      service: new ProjectService(
        prisma as unknown as PrismaService,
        {} as DeviationService,
        {} as RabLifecyclePolicyService,
      ),
      currentStartDate: () => projectStartDate,
    };
  }

  it('validates exact Project Business Date and command identity in the DTO', async () => {
    await expect(
      validate(
        plainToInstance(ActivateWorkPeriodAnchorDto, {
          commandId,
          anchorDate: '2026-05-18',
          reason: '  Owner confirmation  ',
        }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(ActivateWorkPeriodAnchorDto, {
          commandId,
          anchorDate: '2026-05-18T00:00:00.000Z',
        }),
      ),
    ).resolves.not.toHaveLength(0);
  });

  it('reads null and legacy startDate as NOT_PROVEN without audit proof', async () => {
    const empty = harness();
    await expect(empty.service.getWorkPeriodAnchor(projectId)).resolves.toEqual(
      {
        state: 'NOT_PROVEN',
        anchorDate: null,
        candidateDate: null,
        provenance: null,
      },
    );

    const legacy = harness(businessDate('2026-05-18'));
    await expect(
      legacy.service.getWorkPeriodAnchor(projectId),
    ).resolves.toEqual({
      state: 'NOT_PROVEN',
      anchorDate: null,
      candidateDate: '2026-05-18',
      provenance: null,
    });
  });

  it('activates from null atomically, stores UTC midnight, and appends canonical proof', async () => {
    const candidate = harness();
    const result = await candidate.service.activateWorkPeriodAnchor(
      projectId,
      { commandId, anchorDate: '2026-05-18', reason: 'Owner confirmation' },
      actor,
    );

    expect(result).toMatchObject({
      state: 'PROVEN',
      anchorDate: '2026-05-18',
    });
    expect(candidate.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(candidate.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(candidate.currentStartDate()?.toISOString()).toBe(
      '2026-05-18T00:00:00.000Z',
    );
    expect(candidate.audits[0]).toMatchObject({
      eventType: 'PROJECT_CONFIGURATION',
      outcome: ProgressAuditOutcome.SUCCESS,
      action: WORK_PERIOD_ANCHOR_ACTION.ACTIVATED,
      workspaceId,
      projectId,
      actorAccountId: accountId,
      actorMembershipId: membershipId,
      businessCommandId: commandId,
      metadata: {
        policyVersion: WORK_PERIOD_ANCHOR_POLICY_VERSION,
        anchorDate: '2026-05-18',
        previousStartDate: null,
        actorAssignmentId: assignmentId,
        explicitConfirmation: true,
      },
    });
  });

  it('governs an equal legacy candidate through explicit confirmation without rewriting it', async () => {
    const candidate = harness(businessDate('2026-05-18'));
    await expect(
      candidate.service.activateWorkPeriodAnchor(
        projectId,
        { commandId, anchorDate: '2026-05-18' },
        actor,
      ),
    ).resolves.toMatchObject({ state: 'PROVEN', anchorDate: '2026-05-18' });
    expect(candidate.tx.project.update).not.toHaveBeenCalled();
    expect(candidate.audits[0].action).toBe(
      WORK_PERIOD_ANCHOR_ACTION.CONFIRMED,
    );
  });

  it('replaces a different unproven candidate only after compatibility succeeds', async () => {
    const candidate = harness(businessDate('2026-05-01'));
    await expect(
      candidate.service.activateWorkPeriodAnchor(
        projectId,
        { commandId, anchorDate: '2026-05-18' },
        actor,
      ),
    ).resolves.toMatchObject({ state: 'PROVEN', anchorDate: '2026-05-18' });
    expect(candidate.tx.projectBaseline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId, status: 'ACTIVE' } }),
    );
    expect(candidate.tx.progressEntry.count).toHaveBeenCalled();
  });

  it('replays an exact command once and rejects commandId payload reuse', async () => {
    const candidate = harness();
    const body = {
      commandId,
      anchorDate: '2026-05-18',
      reason: 'Owner confirmation',
    };
    const first = await candidate.service.activateWorkPeriodAnchor(
      projectId,
      body,
      actor,
    );
    await expect(
      candidate.service.activateWorkPeriodAnchor(projectId, body, actor),
    ).resolves.toEqual(first);
    expect(candidate.tx.project.update).toHaveBeenCalledTimes(1);
    expect(candidate.tx.progressAuditEvent.create).toHaveBeenCalledTimes(1);

    await expect(
      candidate.service.activateWorkPeriodAnchor(
        projectId,
        { ...body, reason: 'Changed material payload' },
        actor,
      ),
    ).rejects.toThrow('COMMAND_ID_REUSED');
  });

  it('allows same-anchor confirmation but rejects a rival date after PROVEN', async () => {
    const candidate = harness();
    await candidate.service.activateWorkPeriodAnchor(
      projectId,
      { commandId, anchorDate: '2026-05-18' },
      actor,
    );
    await expect(
      candidate.service.activateWorkPeriodAnchor(
        projectId,
        { commandId: nextCommandId, anchorDate: '2026-05-18' },
        actor,
      ),
    ).resolves.toMatchObject({ state: 'PROVEN', anchorDate: '2026-05-18' });
    expect(candidate.tx.project.update).toHaveBeenCalledTimes(1);

    await expect(
      candidate.service.activateWorkPeriodAnchor(
        projectId,
        {
          commandId: '10000000-0000-4000-8000-000000000008',
          anchorDate: '2026-05-19',
        },
        actor,
      ),
    ).rejects.toThrow('WORK_PERIOD_ANCHOR_AMENDMENT_REQUIRED');
    expect(candidate.currentStartDate()?.toISOString()).toBe(
      '2026-05-18T00:00:00.000Z',
    );
  });

  it('maps PostgreSQL serialization conflicts to a controlled rival-command conflict', async () => {
    const candidate = harness();
    candidate.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        'could not serialize access due to concurrent update',
        {
          code: 'P2010',
          clientVersion: '6.4.1',
          meta: {
            code: '40001',
            message: 'could not serialize access due to concurrent update',
          },
        },
      ),
    );

    await expect(
      candidate.service.activateWorkPeriodAnchor(
        projectId,
        { commandId, anchorDate: '2026-05-18' },
        actor,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        message: 'WORK_PERIOD_ANCHOR_CONCURRENT_CHANGE',
        error: 'Conflict',
      },
    });
  });

  it('rejects inactive membership and revoked assignment before compatibility or mutation', async () => {
    const inactive = harness();
    inactive.tx.workspaceMembership.findFirst.mockResolvedValueOnce(null);
    await expect(
      inactive.service.activateWorkPeriodAnchor(
        projectId,
        { commandId, anchorDate: '2026-05-18' },
        actor,
      ),
    ).rejects.toThrow('Trusted project actor is required');
    expect(inactive.tx.project.update).not.toHaveBeenCalled();

    const revoked = harness();
    revoked.tx.projectAssignment.findFirst.mockResolvedValueOnce(null);
    await expect(
      revoked.service.activateWorkPeriodAnchor(
        projectId,
        { commandId, anchorDate: '2026-05-18' },
        actor,
      ),
    ).rejects.toThrow('Trusted project assignment is required');
    expect(revoked.tx.project.update).not.toHaveBeenCalled();
  });

  it('fails closed on mismatched governed provenance and performs zero mutation', async () => {
    const candidate = harness(businessDate('2026-05-19'));
    candidate.audits.push({
      id: 'anchor-event-existing',
      projectId,
      targetEntityType: 'PROJECT',
      targetEntityId: projectId,
      action: WORK_PERIOD_ANCHOR_ACTION.ACTIVATED,
      outcome: ProgressAuditOutcome.SUCCESS,
      actorAccountId: accountId,
      actorMembershipId: membershipId,
      reason: null,
      metadata: {
        policyVersion: WORK_PERIOD_ANCHOR_POLICY_VERSION,
        anchorDate: '2026-05-18',
        previousStartDate: null,
        actorAssignmentId: assignmentId,
        explicitConfirmation: true,
      },
      occurredAt: new Date('2026-09-17T00:00:00.000Z'),
      commandId: 'PROJECT_WORK_PERIOD_ANCHOR:old-command',
      commandFingerprint: 'old-fingerprint',
    });

    await expect(
      candidate.service.activateWorkPeriodAnchor(
        projectId,
        { commandId, anchorDate: '2026-05-19' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID',
        reason: 'GOVERNED_ANCHOR_START_DATE_MISMATCH',
      },
    });
    expect(candidate.tx.project.update).not.toHaveBeenCalled();
  });
});

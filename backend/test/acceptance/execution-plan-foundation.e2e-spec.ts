import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ExecutionPlanService } from '../../src/execution-plan/execution-plan.service';

describe('MON-04 official Execution Plan foundation (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `MON04PLAN${Date.now()}`;
  const password = 'ExecutionPlanV1!';

  let app: INestApplication;
  let plans: ExecutionPlanService;
  let organizationId: string;
  let workspaceId: string;
  let projectId: string;
  let baselineId: string;
  let firstItemId: string;
  let secondItemId: string;
  let atomicProjectId: string;
  let atomicBaselineId: string;
  let atomicItemId: string;
  let legacyProjectId: string;
  let legacyBaselineId: string;
  let legacyItemId: string;
  let foreignProjectId: string;
  let foreignItemId: string;
  let authorizedAccountId: string;
  let authorizedMembershipId: string;
  let authorizedPositionId: string;
  let authorizedToken: string;
  let permissionOnlyToken: string;
  let planId: string;
  let planRevision: number;
  let atomicPlanId: string;
  let atomicPlanRevision: number;

  const createdPermissionIds: string[] = [];
  const createdAuthorityIds: string[] = [];
  const roleIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const positionIds: string[] = [];
  const projectIds: string[] = [];

  const auth = (token: string, workspace = workspaceId) => ({
    Authorization: `Bearer ${token}`,
    'x-workspace-id': workspace,
  });

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.access_token as string;
  };

  const ensurePermission = async (code: string) => {
    const existing = await prisma.permission.findUnique({ where: { code } });
    if (existing) return existing;
    const created = await prisma.permission.create({
      data: { code, name: `${tag} ${code}`, description: 'MON-04 E2E fixture' },
    });
    createdPermissionIds.push(created.id);
    return created;
  };

  const createActor = async (suffix: string, withPosition: boolean) => {
    const permissionCodes = [
      'PROJECT_VIEW',
      'PROJECT_SETTINGS_MANAGE',
      'EXECUTION_PLAN_EDIT',
      'EXECUTION_PLAN_LOCK',
      'FIELD_PROGRESS_SUBMIT',
    ];
    const permissions = await Promise.all(
      permissionCodes.map(ensurePermission),
    );
    const role = await prisma.role.create({
      data: {
        workspaceId,
        code: `${tag}_${suffix.toUpperCase()}`,
        name: `${tag} ${suffix}`,
        rolePermissions: {
          create: permissions.map((permission) => ({
            permissionId: permission.id,
          })),
        },
      },
    });
    roleIds.push(role.id);
    const email = `${tag}.${suffix}@simprok.test`.toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: `${tag} ${suffix}`,
        status: 'ACTIVE',
      },
    });
    accountIds.push(account.id);
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: role.id }] },
      },
    });
    membershipIds.push(membership.id);
    const user = await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId,
        fullName: `${tag} ${suffix}`,
        status: 'ACTIVE',
      },
    });
    for (const targetProjectId of [
      projectId,
      atomicProjectId,
      legacyProjectId,
    ]) {
      await prisma.projectAssignment.create({
        data: {
          workspaceMembershipId: membership.id,
          projectId: targetProjectId,
          roleInProject: 'MEMBER',
          isPrimaryAssignment: targetProjectId === projectId,
          status: 'ASSIGNED',
        },
      });
    }
    if (withPosition) {
      const position = await prisma.position.create({
        data: {
          workspaceId,
          code: `${tag}_LOCK_HOLDER`,
          name: `${tag} Execution Plan Lock Holder`,
        },
      });
      positionIds.push(position.id);
      authorizedPositionId = position.id;
      await prisma.positionAssignment.create({
        data: { positionId: position.id, userId: user.id, isActive: true },
      });
    }
    return { account, membership, email };
  };

  const createPlanBasis = async (name: string, itemQuantities: string[]) => {
    const project = await prisma.project.create({
      data: {
        workspaceId,
        organizationId,
        code: `${tag}-${name}`,
        name: `${tag} ${name}`,
        status: 'PLANNED',
        timeZone: 'Asia/Makassar',
      },
    });
    projectIds.push(project.id);
    const structure = await prisma.boqStructure.create({
      data: { projectId: project.id, name: `${name} BOQ`, version: 1 },
    });
    const items: Array<{ id: string }> = [];
    for (let index = 0; index < itemQuantities.length; index += 1) {
      const quantity = itemQuantities[index];
      items.push(
        await prisma.boqItem.create({
          data: {
            boqStructureId: structure.id,
            wbsCode: `${index + 1}`,
            name: `${name} Work Item ${index + 1}`,
            itemType: 'WORK_ITEM',
            quantity,
            unit: 'm3',
            unitPrice: index === 0 ? '6' : '10',
            lineTotal: index === 0 ? '60' : '40',
            priceOrigin: 'MANUAL_CLIENT',
            sortOrder: index,
          },
        }),
      );
    }
    const rab = await prisma.rabDocument.create({
      data: {
        projectId: project.id,
        boqStructureId: structure.id,
        version: 1,
        name: `${name} Approved RAB`,
        totalBaseCost: itemQuantities.length === 1 ? '60' : '100',
        totalFinalCost: itemQuantities.length === 1 ? '60' : '100',
        status: 'APPROVED',
      },
    });
    const baseline = await prisma.projectBaseline.create({
      data: {
        projectId: project.id,
        rabDocumentId: rab.id,
        versionNumber: 1,
        status: 'ACTIVE',
        approvedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    return { project, baseline, items };
  };

  const assignAuthorizedToProject = (targetProjectId: string) =>
    prisma.projectAssignment.create({
      data: {
        workspaceMembershipId: authorizedMembershipId,
        projectId: targetProjectId,
        roleInProject: 'MEMBER',
        isPrimaryAssignment: false,
        status: 'ASSIGNED',
      },
    });

  const activateWorkPeriodAnchor = (
    targetProjectId: string,
    anchorDate: string,
  ) =>
    request(app.getHttpServer())
      .patch(`/projects/${targetProjectId}/work-period-anchor`)
      .set(auth(authorizedToken))
      .send({ commandId: randomUUID(), anchorDate });

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    plans = app.get(ExecutionPlanService);

    const organization = await prisma.organization.create({
      data: { name: `${tag} Organization`, type: 'COMPANY' },
    });
    organizationId = organization.id;
    const workspace = await prisma.workspace.create({
      data: { name: `${tag} Workspace`, organizationId },
    });
    workspaceId = workspace.id;

    const primary = await createPlanBasis('PRIMARY', ['10', '4']);
    projectId = primary.project.id;
    baselineId = primary.baseline.id;
    firstItemId = primary.items[0].id;
    secondItemId = primary.items[1].id;

    const atomic = await createPlanBasis('ATOMIC', ['10']);
    atomicProjectId = atomic.project.id;
    atomicBaselineId = atomic.baseline.id;
    atomicItemId = atomic.items[0].id;

    const legacy = await createPlanBasis('LEGACY-ACTIVE', ['10']);
    legacyProjectId = legacy.project.id;
    legacyBaselineId = legacy.baseline.id;
    legacyItemId = legacy.items[0].id;
    await prisma.project.update({
      where: { id: legacyProjectId },
      data: { status: 'ACTIVE' },
    });

    const foreign = await createPlanBasis('FOREIGN', ['1']);
    foreignProjectId = foreign.project.id;
    foreignItemId = foreign.items[0].id;

    const authorized = await createActor('authorized', true);
    authorizedAccountId = authorized.account.id;
    authorizedMembershipId = authorized.membership.id;
    const permissionOnly = await createActor('permission-only', false);

    const existingAuthority = await prisma.authority.findUnique({
      where: { code: 'EXECUTION_PLAN_LOCK' },
    });
    const authority =
      existingAuthority ??
      (await prisma.authority.create({
        data: {
          code: 'EXECUTION_PLAN_LOCK',
          name: 'Lock Official Execution Plan',
          description: 'Final authority act for the official Execution Plan.',
        },
      }));
    if (!existingAuthority) createdAuthorityIds.push(authority.id);
    await prisma.positionAuthority.create({
      data: { positionId: authorizedPositionId, authorityId: authority.id },
    });

    authorizedToken = await login(authorized.email);
    permissionOnlyToken = await login(permissionOnly.email);
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE progress_audit_events DISABLE TRIGGER progress_audit_events_immutable_trigger',
      );
      await prisma.progressAuditEvent.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.$executeRawUnsafe(
        'ALTER TABLE progress_audit_events ENABLE TRIGGER progress_audit_events_immutable_trigger',
      );
      await prisma.progressEntry.deleteMany({
        where: { progressReport: { projectId: { in: projectIds } } },
      });
      await prisma.progressReport.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.executionPlanDistribution.deleteMany({
        where: { executionPlanVersion: { projectId: { in: projectIds } } },
      });
      await prisma.executionPlanVersion.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }
    await prisma.positionAuthority.deleteMany({
      where: { positionId: { in: positionIds } },
    });
    await prisma.positionAssignment.deleteMany({
      where: { positionId: { in: positionIds } },
    });
    await prisma.position.deleteMany({ where: { id: { in: positionIds } } });
    await prisma.projectAssignment.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.user.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { id: { in: membershipIds } },
    });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await prisma.projectBaseline.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.rabDocument.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.boqItem.deleteMany({
      where: { boqStructure: { projectId: { in: projectIds } } },
    });
    await prisma.boqStructure.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.permission.deleteMany({
      where: { id: { in: createdPermissionIds } },
    });
    await prisma.authority.deleteMany({
      where: { id: { in: createdAuthorityIds } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it('reads PLAN_NOT_READY and refuses Actual before a locked plan', async () => {
    const readiness = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-plan`)
      .set(auth(authorizedToken))
      .expect(200);
    expect(readiness.body).toMatchObject({
      projectStatus: 'PLANNED',
      readinessState: 'PLAN_NOT_READY',
      plan: null,
      capabilities: { canEditDraft: true, canLock: false },
    });
    expect(readiness.body.workPlan).toHaveLength(2);

    const before = await prisma.progressReport.count({ where: { projectId } });
    const rejected = await request(app.getHttpServer())
      .post(`/projects/${projectId}/progress/field`)
      .set(auth(authorizedToken))
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: firstItemId,
            installedQuantity: '1',
            workDate: '2026-09-02',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(409);
    expect(rejected.body.message).toBe('EXECUTION_PLAN_NOT_LOCKED');
    expect(await prisma.progressReport.count({ where: { projectId } })).toBe(
      before,
    );
  });

  it('creates an incomplete draft, protects exact input rules, and revises the same draft', async () => {
    const created = await request(app.getHttpServer())
      .put(`/projects/${projectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 0,
        distributions: [
          {
            boqItemId: firstItemId,
            periodStartDate: '2026-09-01',
            periodEndDate: '2026-09-07',
            plannedIncrementalQuantity: '5',
          },
        ],
      })
      .expect(200);
    planId = created.body.executionPlanVersionId;
    planRevision = created.body.revision;
    expect(planRevision).toBe(1);

    const incomplete = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-plan`)
      .set(auth(authorizedToken))
      .expect(200);
    expect(incomplete.body.readinessState).toBe('REVISION_IN_PROGRESS');
    expect(incomplete.body.plannedCurve.state).toBe('INCOMPLETE');
    expect(
      incomplete.body.blockers.map((value: { code: string }) => value.code),
    ).toEqual(
      expect.arrayContaining([
        'PLANNED_QUANTITY_INCOMPLETE',
        'MISSING_WORK_ITEM_DISTRIBUTION',
      ]),
    );

    const beforeInvalid = await prisma.executionPlanDistribution.findMany({
      where: { executionPlanVersionId: planId },
      orderBy: { id: 'asc' },
    });
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 1,
        distributions: [
          {
            boqItemId: firstItemId,
            periodStartDate: '2026-09-01',
            periodEndDate: '2026-09-07',
            plannedIncrementalQuantity: '5',
          },
          {
            boqItemId: firstItemId,
            periodStartDate: '2026-09-07',
            periodEndDate: '2026-09-14',
            plannedIncrementalQuantity: '5',
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 1,
        distributions: [
          {
            boqItemId: firstItemId,
            periodStartDate: '2026-02-30',
            periodEndDate: '2026-03-01',
            plannedIncrementalQuantity: '1',
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 1,
        distributions: [
          {
            boqItemId: firstItemId,
            periodStartDate: '2026-09-01',
            periodEndDate: '2026-09-01',
            plannedIncrementalQuantity: '0',
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 1,
        distributions: [
          {
            boqItemId: foreignItemId,
            periodStartDate: '2026-09-01',
            periodEndDate: '2026-09-01',
            plannedIncrementalQuantity: '1',
          },
        ],
      })
      .expect(400);
    expect(
      await prisma.executionPlanDistribution.findMany({
        where: { executionPlanVersionId: planId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(beforeInvalid);

    const revised = await request(app.getHttpServer())
      .put(`/projects/${projectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 1,
        distributions: [
          {
            boqItemId: firstItemId,
            periodStartDate: '2026-09-01',
            periodEndDate: '2026-09-07',
            plannedIncrementalQuantity: '5',
          },
          {
            boqItemId: firstItemId,
            periodStartDate: '2026-09-08',
            periodEndDate: '2026-09-14',
            plannedIncrementalQuantity: '5',
          },
          {
            boqItemId: secondItemId,
            periodStartDate: '2026-09-08',
            periodEndDate: '2026-09-14',
            plannedIncrementalQuantity: '4',
          },
        ],
      })
      .expect(200);
    expect(revised.body.executionPlanVersionId).toBe(planId);
    planRevision = revised.body.revision;
    expect(planRevision).toBe(2);

    await request(app.getHttpServer())
      .put(`/projects/${projectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({ expectedRevision: 1, distributions: [] })
      .expect(409);

    const ready = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-plan`)
      .set(auth(authorizedToken))
      .expect(200);
    expect(ready.body.readinessState).toBe('READY_FOR_LOCK');
    expect(ready.body.capabilities.canLock).toBe(true);
    expect(ready.body.plannedCurve).toEqual({
      state: 'COMPLETE',
      reason: null,
      points: [
        {
          periodEndDate: '2026-09-07',
          knownWeightedPlannedProgressPercent: '30',
        },
        {
          periodEndDate: '2026-09-14',
          knownWeightedPlannedProgressPercent: '100',
        },
      ],
    });
  });

  it('rejects stale, cross-project, permission-only, and revoked-authority lock attempts with zero mutation', async () => {
    await request(app.getHttpServer())
      .get(`/projects/${foreignProjectId}/execution-plan`)
      .set(auth(authorizedToken))
      .expect(403);

    const before = await prisma.executionPlanVersion.findUniqueOrThrow({
      where: { id: planId },
    });
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({ executionPlanVersionId: planId, expectedRevision: 1 })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/execution-plan/lock`)
      .set(auth(permissionOnlyToken))
      .send({ executionPlanVersionId: planId, expectedRevision: planRevision })
      .expect(403);

    await prisma.positionAuthority.updateMany({
      where: { positionId: authorizedPositionId },
      data: { isActive: false, revokedAt: new Date() },
    });
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({ executionPlanVersionId: planId, expectedRevision: planRevision })
      .expect(403);
    const after = await prisma.executionPlanVersion.findUniqueOrThrow({
      where: { id: planId },
    });
    expect(after).toEqual(before);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .status,
    ).toBe('PLANNED');
    await prisma.positionAuthority.updateMany({
      where: { positionId: authorizedPositionId },
      data: { isActive: true, revokedAt: null },
    });
  });

  it('rolls back the plan transition when project activation fails inside the transaction', async () => {
    const created = await request(app.getHttpServer())
      .put(`/projects/${atomicProjectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 0,
        distributions: [
          {
            boqItemId: atomicItemId,
            periodStartDate: '2026-09-01',
            periodEndDate: '2026-09-30',
            plannedIncrementalQuantity: '10',
          },
        ],
      })
      .expect(200);
    atomicPlanId = created.body.executionPlanVersionId;
    atomicPlanRevision = created.body.revision;

    const serviceWithSeam = plans as unknown as {
      activateProjectWithinLock: () => Promise<never>;
    };
    const failure = jest
      .spyOn(serviceWithSeam, 'activateProjectWithinLock')
      .mockRejectedValueOnce(new Error('SIMULATED_PROJECT_ACTIVATION_FAILURE'));
    const failedLock = await request(app.getHttpServer())
      .post(`/projects/${atomicProjectId}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({
        executionPlanVersionId: atomicPlanId,
        expectedRevision: atomicPlanRevision,
      });
    failure.mockRestore();
    expect(failedLock.status).toBe(500);

    expect(
      (
        await prisma.executionPlanVersion.findUniqueOrThrow({
          where: { id: atomicPlanId },
        })
      ).status,
    ).toBe('DRAFT');
    expect(
      (
        await prisma.project.findUniqueOrThrow({
          where: { id: atomicProjectId },
        })
      ).status,
    ).toBe('PLANNED');
  });

  it('locks and activates atomically, is idempotent, and makes every ordinary plan write fail closed', async () => {
    const distributionsBefore = await prisma.executionPlanDistribution.findMany(
      {
        where: { executionPlanVersionId: planId },
        orderBy: { id: 'asc' },
      },
    );
    const locked = await request(app.getHttpServer())
      .post(`/projects/${projectId}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({ executionPlanVersionId: planId, expectedRevision: planRevision })
      .expect(201);
    expect(locked.body).toMatchObject({
      changed: true,
      executionPlanVersionId: planId,
      status: 'LOCKED',
      revision: planRevision,
      projectStatus: 'ACTIVE',
      baselineId,
      authorityCode: 'EXECUTION_PLAN_LOCK',
      lockedByPositionId: authorizedPositionId,
    });
    const settled = await prisma.executionPlanVersion.findUniqueOrThrow({
      where: { id: planId },
    });
    expect(settled).toMatchObject({
      status: 'LOCKED',
      revision: planRevision,
      lockedByAccountId: authorizedAccountId,
      lockedByPositionId: authorizedPositionId,
      lockedFromRevision: planRevision,
      lockedFromProjectStatus: 'PLANNED',
      lockedAuthorityCode: 'EXECUTION_PLAN_LOCK',
    });
    expect(settled.lockedAt).not.toBeNull();
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .status,
    ).toBe('ACTIVE');

    const repeated = await request(app.getHttpServer())
      .post(`/projects/${projectId}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({ executionPlanVersionId: planId, expectedRevision: planRevision })
      .expect(201);
    expect(repeated.body.changed).toBe(false);
    expect(new Date(repeated.body.lockedAt)).toEqual(settled.lockedAt);

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({
        executionPlanVersionId: randomUUID(),
        expectedRevision: planRevision,
      })
      .expect(409);
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({ expectedRevision: planRevision, distributions: [] })
      .expect(409);

    expect(
      await prisma.executionPlanDistribution.findMany({
        where: { executionPlanVersionId: planId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(distributionsBefore);
    const lockedAfter = await prisma.executionPlanVersion.findUniqueOrThrow({
      where: { id: planId },
    });
    expect(lockedAfter.lockedAt).toEqual(settled.lockedAt);
    expect(lockedAfter.lockedByAccountId).toBe(settled.lockedByAccountId);
    expect(lockedAfter.lockedFromProjectStatus).toBe(
      settled.lockedFromProjectStatus,
    );
  });

  it('keeps the historical locked plan readable and permits the existing Actual path only after lock', async () => {
    const readiness = await request(app.getHttpServer())
      .get(`/projects/${projectId}/execution-plan`)
      .set(auth(authorizedToken))
      .expect(200);
    expect(readiness.body).toMatchObject({
      projectStatus: 'ACTIVE',
      readinessState: 'LOCKED_FOR_EXECUTION',
      plan: {
        id: planId,
        status: 'LOCKED',
        revision: planRevision,
        authority: {
          code: 'EXECUTION_PLAN_LOCK',
          positionId: authorizedPositionId,
        },
      },
      capabilities: { canEditDraft: false, canLock: false },
      plannedCurve: { state: 'COMPLETE' },
    });
    expect(readiness.body.plannedCurve.points.at(-1)).toEqual({
      periodEndDate: '2026-09-14',
      knownWeightedPlannedProgressPercent: '100',
    });

    const submitted = await request(app.getHttpServer())
      .post(`/projects/${projectId}/progress/field`)
      .set(auth(authorizedToken))
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: firstItemId,
            installedQuantity: '1',
            workDate: '2026-09-15',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(201);
    expect(submitted.body.entryIds).toHaveLength(1);
  });

  it('adopts one legacy ACTIVE project without rewriting its status or lock provenance', async () => {
    const initialReadiness = await request(app.getHttpServer())
      .get(`/projects/${legacyProjectId}/execution-plan`)
      .set(auth(authorizedToken))
      .expect(200);
    expect(initialReadiness.body).toMatchObject({
      projectStatus: 'ACTIVE',
      readinessState: 'PLAN_NOT_READY',
      plan: null,
      blockers: [{ code: 'LEGACY_ACTIVE_PROJECT_REQUIRES_PLAN_ADOPTION' }],
      capabilities: { canEditDraft: true, canLock: false },
    });

    const progressBefore = await prisma.progressReport.count({
      where: { projectId: legacyProjectId },
    });
    const actualPayload = {
      commandId: randomUUID(),
      entries: [
        {
          boqItemId: legacyItemId,
          installedQuantity: '1',
          workDate: '2026-09-15',
          captureMethod: 'FIELD_OBSERVATION',
        },
      ],
    };
    const beforePlan = await request(app.getHttpServer())
      .post(`/projects/${legacyProjectId}/progress/field`)
      .set(auth(authorizedToken))
      .send(actualPayload)
      .expect(409);
    expect(beforePlan.body.message).toBe('EXECUTION_PLAN_NOT_LOCKED');
    expect(
      await prisma.progressReport.count({
        where: { projectId: legacyProjectId },
      }),
    ).toBe(progressBefore);

    const created = await request(app.getHttpServer())
      .put(`/projects/${legacyProjectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 0,
        distributions: [
          {
            boqItemId: legacyItemId,
            periodStartDate: '2026-09-01',
            periodEndDate: '2026-09-07',
            plannedIncrementalQuantity: '10',
          },
        ],
      })
      .expect(200);
    const legacyPlanId = created.body.executionPlanVersionId as string;
    expect(
      await prisma.executionPlanVersion.count({
        where: { projectId: legacyProjectId },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.project.findUniqueOrThrow({
          where: { id: legacyProjectId },
        })
      ).status,
    ).toBe('ACTIVE');

    const revised = await request(app.getHttpServer())
      .put(`/projects/${legacyProjectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 1,
        distributions: [
          {
            boqItemId: legacyItemId,
            periodStartDate: '2026-09-01',
            periodEndDate: '2026-09-07',
            plannedIncrementalQuantity: '4',
          },
          {
            boqItemId: legacyItemId,
            periodStartDate: '2026-09-08',
            periodEndDate: '2026-09-14',
            plannedIncrementalQuantity: '6',
          },
        ],
      })
      .expect(200);
    expect(revised.body).toMatchObject({
      executionPlanVersionId: legacyPlanId,
      revision: 2,
    });
    expect(
      await prisma.executionPlanVersion.count({
        where: { projectId: legacyProjectId },
      }),
    ).toBe(1);

    const draftReadiness = await request(app.getHttpServer())
      .get(`/projects/${legacyProjectId}/execution-plan`)
      .set(auth(authorizedToken))
      .expect(200);
    expect(draftReadiness.body).toMatchObject({
      projectStatus: 'ACTIVE',
      readinessState: 'READY_FOR_LOCK',
      plan: { id: legacyPlanId, status: 'DRAFT', revision: 2 },
      capabilities: { canEditDraft: true, canLock: true },
    });
    await request(app.getHttpServer())
      .post(`/projects/${legacyProjectId}/progress/field`)
      .set(auth(authorizedToken))
      .send({ ...actualPayload, commandId: randomUUID() })
      .expect(409);

    const distributionsBeforeLock =
      await prisma.executionPlanDistribution.findMany({
        where: { executionPlanVersionId: legacyPlanId },
        orderBy: { id: 'asc' },
      });
    const locked = await request(app.getHttpServer())
      .post(`/projects/${legacyProjectId}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({
        executionPlanVersionId: legacyPlanId,
        expectedRevision: 2,
      })
      .expect(201);
    expect(locked.body).toMatchObject({
      changed: true,
      executionPlanVersionId: legacyPlanId,
      status: 'LOCKED',
      projectStatus: 'ACTIVE',
      baselineId: legacyBaselineId,
      lockedFromProjectStatus: 'ACTIVE',
    });
    const settled = await prisma.executionPlanVersion.findUniqueOrThrow({
      where: { id: legacyPlanId },
    });
    expect(settled).toMatchObject({
      status: 'LOCKED',
      revision: 2,
      lockedFromProjectStatus: 'ACTIVE',
    });
    expect(
      (
        await prisma.project.findUniqueOrThrow({
          where: { id: legacyProjectId },
        })
      ).status,
    ).toBe('ACTIVE');

    const repeated = await request(app.getHttpServer())
      .post(`/projects/${legacyProjectId}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({
        executionPlanVersionId: legacyPlanId,
        expectedRevision: 2,
      })
      .expect(201);
    expect(repeated.body).toMatchObject({
      changed: false,
      lockedFromProjectStatus: 'ACTIVE',
    });
    const settledAgain = await prisma.executionPlanVersion.findUniqueOrThrow({
      where: { id: legacyPlanId },
    });
    expect(settledAgain.lockedAt).toEqual(settled.lockedAt);
    expect(settledAgain.lockedByAccountId).toBe(settled.lockedByAccountId);
    expect(settledAgain.lockedByPositionId).toBe(settled.lockedByPositionId);
    expect(settledAgain.lockedFromProjectStatus).toBe('ACTIVE');

    await request(app.getHttpServer())
      .put(`/projects/${legacyProjectId}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({ expectedRevision: 2, distributions: [] })
      .expect(409);
    expect(
      await prisma.executionPlanDistribution.findMany({
        where: { executionPlanVersionId: legacyPlanId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(distributionsBeforeLock);

    const submitted = await request(app.getHttpServer())
      .post(`/projects/${legacyProjectId}/progress/field`)
      .set(auth(authorizedToken))
      .send({ ...actualPayload, commandId: randomUUID() })
      .expect(201);
    expect(submitted.body.entryIds).toHaveLength(1);
  });

  it('gates only DRAFT-to-LOCKED against a PROVEN Day-1 and reports the earliest Planned credit conflict', async () => {
    const basis = await createPlanBasis('ANCHOR-GATE', ['10', '4']);
    await assignAuthorizedToProject(basis.project.id);
    await activateWorkPeriodAnchor(basis.project.id, '2026-05-18').expect(200);

    const created = await request(app.getHttpServer())
      .put(`/projects/${basis.project.id}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 0,
        distributions: [
          {
            boqItemId: basis.items[0].id,
            periodStartDate: '2026-05-10',
            periodEndDate: '2026-05-17',
            plannedIncrementalQuantity: '10',
          },
          {
            boqItemId: basis.items[1].id,
            periodStartDate: '2026-05-10',
            periodEndDate: '2026-05-16',
            plannedIncrementalQuantity: '4',
          },
        ],
      })
      .expect(200);
    const targetPlanId = (created.body as { executionPlanVersionId: string })
      .executionPlanVersionId;

    const blocked = await request(app.getHttpServer())
      .post(`/projects/${basis.project.id}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({
        executionPlanVersionId: targetPlanId,
        expectedRevision: 1,
      })
      .expect(409);
    expect(blocked.body).toMatchObject({
      state: 'CONFLICT',
      code: 'WORK_PERIOD_ANCHOR_PLANNED_FACT_BEFORE_ANCHOR',
      baselineId: basis.baseline.id,
      executionPlanVersionId: targetPlanId,
      boqItemId: basis.items[1].id,
      earliestConflictingDate: '2026-05-16',
    });
    expect(
      await prisma.executionPlanVersion.findUniqueOrThrow({
        where: { id: targetPlanId },
        select: { status: true, revision: true },
      }),
    ).toEqual({ status: 'DRAFT', revision: 1 });
    expect(
      (
        await prisma.project.findUniqueOrThrow({
          where: { id: basis.project.id },
          select: { status: true },
        })
      ).status,
    ).toBe('PLANNED');

    const revised = await request(app.getHttpServer())
      .put(`/projects/${basis.project.id}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 1,
        distributions: [
          {
            boqItemId: basis.items[0].id,
            periodStartDate: '2026-05-10',
            periodEndDate: '2026-05-18',
            plannedIncrementalQuantity: '10',
          },
          {
            boqItemId: basis.items[1].id,
            periodStartDate: '2026-05-10',
            periodEndDate: '2026-05-19',
            plannedIncrementalQuantity: '4',
          },
        ],
      })
      .expect(200);
    expect((revised.body as { revision: number }).revision).toBe(2);
    await request(app.getHttpServer())
      .post(`/projects/${basis.project.id}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({
        executionPlanVersionId: targetPlanId,
        expectedRevision: 2,
      })
      .expect(201);
  });

  it('fails Plan LOCK closed when governed anchor provenance no longer matches Project.startDate', async () => {
    const basis = await createPlanBasis('ANCHOR-INVALID', ['10']);
    await assignAuthorizedToProject(basis.project.id);
    await activateWorkPeriodAnchor(basis.project.id, '2026-05-18').expect(200);
    await prisma.project.update({
      where: { id: basis.project.id },
      data: { startDate: new Date('2026-05-19T00:00:00.000Z') },
    });
    const created = await request(app.getHttpServer())
      .put(`/projects/${basis.project.id}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 0,
        distributions: [
          {
            boqItemId: basis.items[0].id,
            periodStartDate: '2026-05-18',
            periodEndDate: '2026-05-20',
            plannedIncrementalQuantity: '10',
          },
        ],
      })
      .expect(200);
    const targetPlanId = (created.body as { executionPlanVersionId: string })
      .executionPlanVersionId;

    const blocked = await request(app.getHttpServer())
      .post(`/projects/${basis.project.id}/execution-plan/lock`)
      .set(auth(authorizedToken))
      .send({
        executionPlanVersionId: targetPlanId,
        expectedRevision: 1,
      })
      .expect(409);
    expect(blocked.body).toMatchObject({
      code: 'WORK_PERIOD_ANCHOR_PROVENANCE_INVALID',
      reason: 'GOVERNED_ANCHOR_START_DATE_MISMATCH',
    });
    expect(
      (
        await prisma.executionPlanVersion.findUniqueOrThrow({
          where: { id: targetPlanId },
          select: { status: true },
        })
      ).status,
    ).toBe('DRAFT');
  });

  it('serializes initial anchor activation against a conflicting Plan LOCK so both cannot succeed', async () => {
    const basis = await createPlanBasis('ANCHOR-LOCK-RACE', ['10']);
    await assignAuthorizedToProject(basis.project.id);
    const created = await request(app.getHttpServer())
      .put(`/projects/${basis.project.id}/execution-plan/draft`)
      .set(auth(authorizedToken))
      .send({
        expectedRevision: 0,
        distributions: [
          {
            boqItemId: basis.items[0].id,
            periodStartDate: '2026-05-10',
            periodEndDate: '2026-05-17',
            plannedIncrementalQuantity: '10',
          },
        ],
      })
      .expect(200);
    const targetPlanId = (created.body as { executionPlanVersionId: string })
      .executionPlanVersionId;

    const [anchorResponse, lockResponse] = await Promise.all([
      activateWorkPeriodAnchor(basis.project.id, '2026-05-18'),
      request(app.getHttpServer())
        .post(`/projects/${basis.project.id}/execution-plan/lock`)
        .set(auth(authorizedToken))
        .send({
          executionPlanVersionId: targetPlanId,
          expectedRevision: 1,
        }),
    ]);
    expect(
      [anchorResponse.status, lockResponse.status].filter(
        (status) => status === 409,
      ),
    ).toHaveLength(1);
    expect(
      [anchorResponse.status, lockResponse.status].filter((status) =>
        [200, 201].includes(status),
      ),
    ).toHaveLength(1);

    const [anchor, plan] = await Promise.all([
      request(app.getHttpServer())
        .get(`/projects/${basis.project.id}/work-period-anchor`)
        .set(auth(authorizedToken))
        .expect(200),
      prisma.executionPlanVersion.findUniqueOrThrow({
        where: { id: targetPlanId },
        select: { status: true },
      }),
    ]);
    const anchorBody = anchor.body as {
      state: 'NOT_PROVEN' | 'PROVEN' | 'INVALID_PROVENANCE';
      anchorDate?: string;
    };
    expect(anchorBody.state === 'PROVEN' && plan.status === 'LOCKED').toBe(
      false,
    );
    if (anchorBody.state === 'PROVEN') {
      expect(anchorBody.anchorDate).toBe('2026-05-18');
      expect(plan.status).toBe('DRAFT');
    } else {
      expect(anchorBody.state).toBe('NOT_PROVEN');
      expect(plan.status).toBe('LOCKED');
    }
  }, 30_000);

  it('database constraints preserve plan identity and refuse orphaning locked history', async () => {
    await expect(
      prisma.executionPlanVersion.create({
        data: {
          projectId,
          baselineId: atomicBaselineId,
          versionNumber: 99,
          revision: 1,
          createdByAccountId: authorizedAccountId,
          lastEditedByAccountId: authorizedAccountId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.projectBaseline.delete({ where: { id: baselineId } }),
    ).rejects.toThrow();
    await expect(
      prisma.boqItem.delete({ where: { id: firstItemId } }),
    ).rejects.toThrow();

    const persisted = await prisma.executionPlanVersion.findUniqueOrThrow({
      where: { id: planId },
      include: { distributions: true },
    });
    expect(persisted.status).toBe('LOCKED');
    expect(persisted.distributions).toHaveLength(3);
  });
});

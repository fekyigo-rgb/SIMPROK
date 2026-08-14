import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Progress Security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let workspaceAId: string;
  let workspaceBId: string;
  
  let projectAId: string;
  let projectBId: string;
  let boqItemAId: string;
  let boqItemNoActualId: string;
  let boqItemRecordedZeroId: string;
  let baselineAId: string;
  let submitAccountId: string;

  let userViewEmail = 'prog.view.sec@test.local';
  let userSubmitEmail = 'prog.submit.sec@test.local';
  let userCrossEmail = 'prog.cross.sec@test.local';
  let userNoAccessEmail = 'prog.noaccess.sec@test.local';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();

    // Setup two orgs and workspaces
    const orgA = await prisma.organization.create({
      data: { name: 'Org Prog Sec A', type: 'COMPANY' }
    });
    const wsA = await prisma.workspace.create({
      data: { name: 'WS A Prog Sec', organizationId: orgA.id }
    });
    workspaceAId = wsA.id;

    const orgB = await prisma.organization.create({
      data: { name: 'Org Prog Sec B', type: 'COMPANY' }
    });
    const wsB = await prisma.workspace.create({
      data: { name: 'WS B Prog Sec', organizationId: orgB.id }
    });
    workspaceBId = wsB.id;

    // Create projects
    const projA = await prisma.project.create({
      data: {
        name: 'Project A Prog Sec',
        code: 'PROGA-SEC',
        workspaceId: wsA.id,
        organizationId: orgA.id,
        status: 'ACTIVE',
      }
    });
    projectAId = projA.id;

    const projB = await prisma.project.create({
      data: {
        name: 'Project B Prog Sec',
        code: 'PROGB-SEC',
        workspaceId: wsB.id,
        organizationId: orgB.id,
        status: 'ACTIVE',
      }
    });
    projectBId = projB.id;

    // Setup Baseline and BOQ for Project A so progress submission succeeds
    const boqStruct = await prisma.boqStructure.create({
      data: { projectId: projectAId, name: 'Main BOQ', version: 1 }
    });
    const boqItem = await prisma.boqItem.create({
      data: { boqStructureId: boqStruct.id, wbsCode: '1.1', name: 'Item', quantity: 10, unit: 'm3' }
    });
    boqItemAId = boqItem.id;
    const boqItemNoActual = await prisma.boqItem.create({
      data: { boqStructureId: boqStruct.id, wbsCode: '1.2', name: 'Item Without Actual', quantity: 5, unit: 'm3', sortOrder: 1 }
    });
    boqItemNoActualId = boqItemNoActual.id;
    const boqItemRecordedZero = await prisma.boqItem.create({
      data: { boqStructureId: boqStruct.id, wbsCode: '1.3', name: 'Item With Recorded Zero', quantity: 3, unit: 'm3', sortOrder: 2 }
    });
    boqItemRecordedZeroId = boqItemRecordedZero.id;
    const rab = await prisma.rabDocument.create({
      data: { projectId: projectAId, boqStructureId: boqStruct.id, name: 'RAB', version: 1, totalBaseCost: 1000, totalFinalCost: 1000, status: 'APPROVED' }
    });
    const baseline = await prisma.projectBaseline.create({
      data: { projectId: projectAId, rabDocumentId: rab.id, versionNumber: 1, status: 'ACTIVE', approvedAt: new Date() }
    });
    baselineAId = baseline.id;

    // Setup permissions
    const permView = await prisma.permission.findUniqueOrThrow({
      where: { code: 'PROJECT_VIEW' },
    });
    const permSubmit = await prisma.permission.findUniqueOrThrow({
      where: { code: 'FIELD_PROGRESS_SUBMIT' },
    });

    // Setup roles in Workspaces
    const roleViewA = await prisma.role.create({
      data: {
        name: 'Viewer A', code: 'ROLE_PROG_VIEW_A', workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: permView.id }] }
      }
    });
    const roleSubmitA = await prisma.role.create({
      data: {
        name: 'Submitter A', code: 'ROLE_PROG_SUBMIT_A', workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: permView.id }, { permissionId: permSubmit.id }] }
      }
    });
    const roleSubmitB = await prisma.role.create({
      data: {
        name: 'Submitter B', code: 'ROLE_PROG_SUBMIT_B', workspaceId: workspaceBId,
        rolePermissions: { create: [{ permissionId: permView.id }, { permissionId: permSubmit.id }] }
      }
    });

    // Setup accounts
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    async function createUser(email: string, wsId: string, roleId: string, assignProjectId?: string) {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' }
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id, workspaceId: wsId, status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] }
        }
      });
      await prisma.user.create({
        data: { workspaceMembershipId: membership.id, workspaceId: wsId, fullName: email, status: 'ACTIVE' }
      });
      if (assignProjectId) {
        await prisma.projectAssignment.create({
          data: {
            workspaceMembershipId: membership.id,
            projectId: assignProjectId,
            roleInProject: 'MEMBER',
            isPrimaryAssignment: true,
            status: 'ASSIGNED'
          }
        });
      }
      return account;
    }

    await createUser(userViewEmail, workspaceAId, roleViewA.id, projectAId);
    const submitAccount = await createUser(userSubmitEmail, workspaceAId, roleSubmitA.id, projectAId);
    submitAccountId = submitAccount.id;
    await createUser(userCrossEmail, workspaceBId, roleSubmitB.id, projectBId);
    await createUser(userNoAccessEmail, workspaceAId, roleViewA.id); // No project assignment

    const submitUser = await prisma.user.findFirstOrThrow({
      where: { membership: { accountId: submitAccount.id, workspaceId: workspaceAId } },
    });
    const progressPosition = await prisma.position.create({
      data: { workspaceId: workspaceAId, code: 'PROGRESS_AUTHORITY_TEST', name: 'Configured Progress Authority' },
    });
    await prisma.positionAssignment.create({
      data: { positionId: progressPosition.id, userId: submitUser.id, isActive: true },
    });
    for (const code of ['FIELD_PROGRESS_VERIFY', 'FIELD_PROGRESS_CORRECT', 'FIELD_PROGRESS_ACCEPT']) {
      const authority = await prisma.authority.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      await prisma.positionAuthority.create({
        data: { positionId: progressPosition.id, authorityId: authority.id },
      });
    }
  });

  afterAll(async () => {
    // Cleanup
    const emails = [userViewEmail, userSubmitEmail, userCrossEmail, userNoAccessEmail];
    const accounts = await prisma.account.findMany({ where: { email: { in: emails } } });
    const accountIds = accounts.map(a => a.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map(m => m.id);

    await prisma.progressAuditEvent.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    await prisma.progressEntry.deleteMany({ where: { progressReport: { projectId: { in: [projectAId, projectBId] } } } });
    await prisma.progressReport.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    
    await prisma.projectAssignment.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });

    await prisma.role.deleteMany({ where: { code: { in: ['ROLE_PROG_VIEW_A', 'ROLE_PROG_SUBMIT_A', 'ROLE_PROG_SUBMIT_B'] } } });
    const progressPositions = await prisma.position.findMany({ where: { workspaceId: workspaceAId, code: 'PROGRESS_AUTHORITY_TEST' } });
    await prisma.positionAssignment.deleteMany({ where: { positionId: { in: progressPositions.map((position) => position.id) } } });
    await prisma.positionAuthority.deleteMany({ where: { positionId: { in: progressPositions.map((position) => position.id) } } });
    await prisma.position.deleteMany({ where: { id: { in: progressPositions.map((position) => position.id) } } });

    await prisma.projectBaseline.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    await prisma.rabDocument.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    await prisma.boqItem.deleteMany({ where: { boqStructure: { projectId: { in: [projectAId, projectBId] } } } });
    await prisma.boqStructure.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectAId, projectBId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['Org Prog Sec A', 'Org Prog Sec B'] } } });

    await app.close();
    await prisma.$disconnect();
  });

  const login = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return res.body.access_token;
  };

  it('1. no token -> POST /projects/:id/progress/field returns 401', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .send({ commandId: randomUUID(), entries: [] })
      .expect(401);
  });

  it('2. authenticated user without project access -> rejected', async () => {
    const token = await login(userNoAccessEmail);
    const beforeReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    const beforeEntries = await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } });

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), entries: [] })
      .expect(403);

    const afterReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    const afterEntries = await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } });
    expect(afterReports).toBe(beforeReports);
    expect(afterEntries).toBe(beforeEntries);
  });

  it('3. project-assigned user with PROJECT_VIEW only -> POST progress rejected 403', async () => {
    const token = await login(userViewEmail);
    const beforeReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    const beforeEntries = await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } });

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), entries: [] })
      .expect(403);

    const afterReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    const afterEntries = await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } });
    expect(afterReports).toBe(beforeReports);
    expect(afterEntries).toBe(beforeEntries);
  });

  it('4. project-assigned user with FIELD_PROGRESS_SUBMIT -> accepted', async () => {
    const token = await login(userSubmitEmail);
    const beforeReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    const beforeEntries = await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } });
    
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [{
          boqItemId: boqItemAId,
          installedQuantity: '2',
          workDate: new Date().toISOString(),
          captureMethod: 'FIELD_OBSERVATION'
        }, {
          boqItemId: boqItemRecordedZeroId,
          installedQuantity: '0',
          workDate: new Date().toISOString(),
          captureMethod: 'FIELD_OBSERVATION'
        }]
      })
      .expect(201);

    const afterReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    const afterEntries = await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } });
    expect(afterReports).toBe(beforeReports + 1);
    expect(afterEntries).toBe(beforeEntries + 2);

    // Verify relation matches the target project
    const latestReport = await prisma.progressReport.findFirst({
      where: { projectId: projectAId },
      orderBy: { createdAt: 'desc' },
      include: {
        project: true,
        entries: true,
      }
    });

    expect(latestReport).toBeDefined();
    expect(latestReport!.projectId).toBe(projectAId);
    expect(latestReport!.project.workspaceId).toBe(workspaceAId);
    expect(latestReport!.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ boqItemId: boqItemAId, recordedByAccountId: submitAccountId, actualCost: null, earnedValue: null }),
      expect.objectContaining({ boqItemId: boqItemRecordedZeroId }),
    ]));
  });

  it('5. cross-tenant user cannot submit progress to another workspace project', async () => {
    const token = await login(userCrossEmail);
    const beforeReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    const beforeEntries = await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } });

    // Try to submit to Project A using Workspace B user
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [{
          boqItemId: boqItemAId,
          installedQuantity: '2',
          workDate: new Date().toISOString(),
          captureMethod: 'FIELD_OBSERVATION'
        }]
      })
      .expect(404); // ProjectAccessGuard usually returns 404 for cross-tenant

    const afterReports = await prisma.progressReport.count({ where: { projectId: projectAId } });
    const afterEntries = await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } });
    expect(afterReports).toBe(beforeReports);
    expect(afterEntries).toBe(beforeEntries);
  });

  // MON-02A Truth Surface Tests

  it('6. authorized assigned user -> GET /monitoring succeeds and proves truth contract (unsupported != zero, actual absent != zero)', async () => {
    const token = await login(userViewEmail);
    const readPlanningTruth = async () => {
      const baseline = await prisma.projectBaseline.findUniqueOrThrow({
        where: { id: baselineAId },
        select: {
          id: true,
          projectId: true,
          rabDocumentId: true,
          versionNumber: true,
          status: true,
          approvedAt: true,
          approvedByPositionId: true,
          justification: true,
          rabDocument: {
            select: {
              id: true,
              boqStructureId: true,
              version: true,
              status: true,
              totalBaseCost: true,
              totalFinalCost: true,
            },
          },
        },
      });
      const items = await prisma.boqItem.findMany({
        where: { boqStructureId: baseline.rabDocument.boqStructureId },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          parentId: true,
          wbsNodeId: true,
          wbsCode: true,
          name: true,
          itemType: true,
          quantity: true,
          unit: true,
          sortOrder: true,
        },
      });

      return {
        baseline: {
          ...baseline,
          approvedAt: baseline.approvedAt.toISOString(),
          rabDocument: {
            ...baseline.rabDocument,
            totalBaseCost: baseline.rabDocument.totalBaseCost?.toString() ?? null,
            totalFinalCost: baseline.rabDocument.totalFinalCost?.toString() ?? null,
          },
        },
        items: items.map((item) => ({
          ...item,
          quantity: item.quantity.toString(),
        })),
      };
    };

    const planningTruthBefore = await readPlanningTruth();
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    const planningTruthAfter = await readPlanningTruth();

    const body = res.body;
    expect(body.projectId).toBe(projectAId);
    expect(body.baseline).toBeDefined();

    expect(planningTruthAfter).toEqual(planningTruthBefore);

    // Truth Contract: UNAVAILABLE != ZERO
    expect(body.unavailable).toEqual(expect.arrayContaining([
      'plannedStart',
      'plannedFinish',
    ]));
    expect(body).not.toHaveProperty('plannedStart');
    expect(body).not.toHaveProperty('plannedFinish');
    expect(body.baseline).not.toHaveProperty('plannedStart');
    expect(body.baseline).not.toHaveProperty('plannedFinish');

    const recordedItem = body.items.find((i: any) => i.id === boqItemAId);
    expect(recordedItem).toBeDefined();
    expect(recordedItem.planned.quantity).toBe('10');
    expect(recordedItem.actual.state).toBe('RECORDED');
    expect(recordedItem.actual.latestRecord.installedQuantity).toBe('2');

    const absentItem = body.items.find((i: any) => i.id === boqItemNoActualId);
    expect(absentItem).toBeDefined();
    expect(absentItem.actual).toMatchObject({
      state: 'NOT_YET_RECORDED',
      latestRecord: null,
    });
    expect(absentItem.actual).not.toHaveProperty('installedQuantity');

    const recordedZeroItem = body.items.find((i: any) => i.id === boqItemRecordedZeroId);
    expect(recordedZeroItem).toBeDefined();
    expect(recordedZeroItem.actual.state).toBe('RECORDED');
    expect(recordedZeroItem.actual.latestRecord.installedQuantity).toBe('0');
    expect(recordedZeroItem.actual).not.toEqual(absentItem.actual);
  });

  it('7. non-assigned user -> GET /monitoring is rejected', async () => {
    const token = await login(userNoAccessEmail);
    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);
  });

  it('8. cross-tenant user -> GET /monitoring is rejected', async () => {
    const token = await login(userCrossEmail);
    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(404);
  });

  it('9. MON-03 governed Actual -> trusted actor, optional evidence, idempotent retry, authority transitions, correction, audit, readback, immutable baseline', async () => {
    const submitToken = await login(userSubmitEmail);
    const viewToken = await login(userViewEmail);
    const baselineBefore = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
      include: { rabDocument: true },
    });
    const itemBefore = await prisma.boqItem.findUniqueOrThrow({ where: { id: boqItemAId } });
    const commandId = randomUUID();
    const payload = {
      commandId,
      accountId: '00000000-0000-4000-8000-000000000999',
      workspaceId: workspaceBId,
      projectId: projectBId,
      entries: [{
        boqItemId: boqItemAId,
        installedQuantity: '3.25',
        workDate: '2026-08-31T00:00:00.000Z',
        captureMethod: 'FIELD_OBSERVATION',
      }],
    };

    const created = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send(payload)
      .expect(201);
    const entryId = created.body.entryIds[0];
    expect(created.body.replayed).toBe(false);

    const replay = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send(payload)
      .expect(201);
    expect(replay.body).toMatchObject({ entryIds: [entryId], replayed: true });

    const original = await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(original.recordedByAccountId).toBe(submitAccountId);
    expect(original.actualCost).toBeNull();
    expect(original.earnedValue).toBeNull();
    expect(original.evidenceReferences).toBeNull();
    expect(await prisma.progressReport.count({ where: { commandId } })).toBe(1);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
      .set('Authorization', `Bearer ${viewToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({})
      .expect(403);
    expect((await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } })).status).toBe('SUBMITTED');

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({ reason: 'Configured authority verification' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/accept`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({ reason: 'Configured authority acceptance' })
      .expect(201);

    const correctionCommandId = randomUUID();
    const corrected = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/corrections`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: correctionCommandId,
        installedQuantity: '4.00',
        workDate: '2026-08-31T00:00:00.000Z',
        captureMethod: 'FIELD_REMEASUREMENT',
        reason: 'Corrected after field remeasurement',
        evidenceReferences: [{ url: 'https://evidence.example/measurement-01', label: 'Measurement reference' }],
      })
      .expect(201);
    const correctionId = corrected.body.entryId;
    expect(correctionId).not.toBe(entryId);

    const [preservedOriginal, correction] = await Promise.all([
      prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } }),
      prisma.progressEntry.findUniqueOrThrow({ where: { id: correctionId } }),
    ]);
    expect(preservedOriginal.installedQuantity.toString()).toBe('3.25');
    expect(preservedOriginal.status).toBe('RETURNED_FOR_CORRECTION');
    expect(correction.supersedesEntryId).toBe(entryId);
    expect(correction.installedQuantity.toString()).toBe('4');
    expect(correction.revision).toBe(preservedOriginal.revision + 1);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/corrections`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        installedQuantity: '5',
        workDate: '2026-08-31T00:00:00.000Z',
        captureMethod: 'FIELD_REMEASUREMENT',
        reason: 'Stale competing correction',
      })
      .expect(409);

    const history = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/items/${boqItemAId}/history`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(history.body.availableActions).toEqual({ verify: true, correct: true, accept: true });
    expect(history.body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: entryId, status: 'RETURNED_FOR_CORRECTION' }),
      expect.objectContaining({ id: correctionId, supersedesEntryId: entryId, status: 'SUBMITTED' }),
    ]));
    expect(await prisma.progressAuditEvent.count({ where: { projectId: projectAId, progressEntryId: { in: [entryId, correctionId] } } })).toBe(5);

    const monitoring = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${viewToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    const monitoredItem = monitoring.body.items.find((item: any) => item.id === boqItemAId);
    expect(monitoredItem.actual.effectiveRecord).toMatchObject({
      id: correctionId,
      installedQuantity: '4',
      supersedesEntryId: entryId,
      captureMethod: 'FIELD_REMEASUREMENT',
    });

    const baselineAfter = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
      include: { rabDocument: true },
    });
    const itemAfter = await prisma.boqItem.findUniqueOrThrow({ where: { id: boqItemAId } });
    expect(baselineAfter).toEqual(baselineBefore);
    expect(itemAfter).toEqual(itemBefore);
  });

  it('10. MON-03 wrong-project item and invalid quantity leave zero partial mutation', async () => {
    const token = await login(userSubmitEmail);
    const foreignBoq = await prisma.boqStructure.create({ data: { projectId: projectBId, name: 'Foreign BOQ', version: 1 } });
    const foreignItem = await prisma.boqItem.create({ data: { boqStructureId: foreignBoq.id, wbsCode: 'X', name: 'Foreign Item', quantity: 1, unit: 'm3' } });
    const before = {
      reports: await prisma.progressReport.count({ where: { projectId: projectAId } }),
      entries: await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } }),
      audits: await prisma.progressAuditEvent.count({ where: { projectId: projectAId } }),
    };

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), entries: [{ boqItemId: foreignItem.id, installedQuantity: '1', workDate: new Date().toISOString(), captureMethod: 'FIELD_OBSERVATION' }] })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), entries: [{ boqItemId: boqItemAId, installedQuantity: '-1', workDate: new Date().toISOString(), captureMethod: 'FIELD_OBSERVATION' }] })
      .expect(400);

    expect({
      reports: await prisma.progressReport.count({ where: { projectId: projectAId } }),
      entries: await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } }),
      audits: await prisma.progressAuditEvent.count({ where: { projectId: projectAId } }),
    }).toEqual(before);
  });

  it('11. MON-03 audit failure rolls back the complete Actual command', async () => {
    const token = await login(userSubmitEmail);
    const before = {
      reports: await prisma.progressReport.count({ where: { projectId: projectAId } }),
      entries: await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } }),
      audits: await prisma.progressAuditEvent.count({ where: { projectId: projectAId } }),
    };

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION mon03_reject_progress_audit() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'MON03_TEST_AUDIT_FAILURE';
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER mon03_reject_progress_audit
      BEFORE INSERT ON progress_audit_events
      FOR EACH ROW EXECUTE FUNCTION mon03_reject_progress_audit();
    `);
    try {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/field`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({
          commandId: randomUUID(),
          entries: [{
            boqItemId: boqItemAId,
            installedQuantity: '6.50',
            workDate: '2026-08-31T00:00:00.000Z',
            captureMethod: 'FIELD_OBSERVATION',
          }],
        })
        .expect(500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS mon03_reject_progress_audit ON progress_audit_events');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS mon03_reject_progress_audit()');
    }

    expect({
      reports: await prisma.progressReport.count({ where: { projectId: projectAId } }),
      entries: await prisma.progressEntry.count({ where: { progressReport: { projectId: projectAId } } }),
      audits: await prisma.progressAuditEvent.count({ where: { projectId: projectAId } }),
    }).toEqual(before);
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { ProgressService } from '../../src/progress/progress.service';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

interface SemanticHistoryLeaf {
  id: string;
  supersedesEntryId: string | null;
  semanticAuthority: {
    state: 'PROVEN' | 'NOT_PROVEN' | 'STALE' | 'INVALID_PROVENANCE';
    proof: {
      actorDisplayName: string | null;
      authorityCode: string;
    } | null;
  };
}

interface SemanticHistoryBody {
  semanticVerification: {
    state: 'VALID' | 'INVALID_LINEAGE';
    contextDigest: string | null;
    invalidReason: string | null;
    currentLeaves: SemanticHistoryLeaf[];
  };
  availableActions: { semanticAttestEntryIds: string[] };
  entries: Array<{ id: string; isCurrentLineageLeaf: boolean }>;
}

interface SemanticAttestationResponseBody {
  entryId: string;
  semanticAuthority: 'PROVEN' | 'STALE';
  replayed: boolean;
}

interface ErrorResponseBody {
  message: string;
}

interface EntryResponseBody {
  entryId: string;
}
type Law1MonitoringQuantity =
  | {
      state: 'COMPLETE';
      currentOfficialQuantity: string;
    }
  | {
      state: 'INCOMPLETE';
      knownEligibleQuantitySubtotal: string;
    }
  | {
      state:
        | 'NOT_YET_RECORDED'
        | 'NO_ELIGIBLE_CURRENT_FACT'
        | 'INVALID_NUMERIC_FACT'
        | 'SEMANTICS_UNPROVEN';
    }
  | {
      state: 'INVALID_LINEAGE';
      reason: string;
    };

type Law2MonitoringProgress =
  | {
      state: 'COMPLETE';
      rawPhysicalProgressPercent: string;
      boundedContributionProgressPercent: string;
    }
  | {
      state: 'INCOMPLETE';
      knownProgressSubtotalPercent?: string;
    }
  | {
      state: 'UNAVAILABLE';
      reason:
        | 'PLANNED_QUANTITY_UNAVAILABLE'
        | 'PLANNED_QUANTITY_INVALID'
        | 'PLANNED_QUANTITY_ZERO'
        | 'SAME_WORK_ITEM_UNIT_CONTEXT_UNAVAILABLE';
    }
  | {
      state:
        | 'NOT_YET_RECORDED'
        | 'NO_ELIGIBLE_CURRENT_FACT'
        | 'INVALID_NUMERIC_FACT'
        | 'SEMANTICS_UNPROVEN';
    }
  | {
      state: 'INVALID_LINEAGE';
      reason: string;
    };

type Law3MonitoringProgress =
  | {
      state: 'COMPLETE';
      currentOfficialRabWeightedPhysicalProgressPercent: string;
    }
  | {
      state: 'INCOMPLETE';
      knownWeightedContributionSubtotalPercent: string;
    }
  | {
      state: 'UNAVAILABLE';
      reason: string;
    };

interface Law1MonitoringItem {
  id: string;
  currentOfficialQuantity: Law1MonitoringQuantity | null;
  currentOfficialItemProgress: Law2MonitoringProgress | null;
  weight: {
    own: {
      state: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
      percentage: string | null;
      reason: string | null;
    };
    subtree: {
      state: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
      percentage: string | null;
      reason: string | null;
    };
  };
}

interface Law1MonitoringBody {
  currentOfficialRabWeightedPhysicalProgress: Law3MonitoringProgress;
  weight: {
    completeness: 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';
    reason: string | null;
  };
  items: Law1MonitoringItem[];
}

describe('Progress Security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let progressService: ProgressService;

  let workspaceAId: string;
  let workspaceBId: string;

  let projectAId: string;
  let projectBId: string;
  let boqFolderAId: string;
  let boqItemAId: string;
  let boqItemNoActualId: string;
  let boqItemRecordedZeroId: string;
  let baselineAId: string;
  let submitAccountId: string;
  let projectSettingsPermissionId: string;
  let verifyCombinedPolicyId: string;
  let acceptCombinedPolicyId: string;

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
    progressService = app.get(ProgressService);

    // Setup two orgs and workspaces
    const orgA = await prisma.organization.create({
      data: { name: 'Org Prog Sec A', type: 'COMPANY' },
    });
    const wsA = await prisma.workspace.create({
      data: { name: 'WS A Prog Sec', organizationId: orgA.id },
    });
    workspaceAId = wsA.id;

    const orgB = await prisma.organization.create({
      data: { name: 'Org Prog Sec B', type: 'COMPANY' },
    });
    const wsB = await prisma.workspace.create({
      data: { name: 'WS B Prog Sec', organizationId: orgB.id },
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
        timeZone: 'Asia/Makassar',
      },
    });
    projectAId = projA.id;

    const projB = await prisma.project.create({
      data: {
        name: 'Project B Prog Sec',
        code: 'PROGB-SEC',
        workspaceId: wsB.id,
        organizationId: orgB.id,
        status: 'ACTIVE',
      },
    });
    projectBId = projB.id;

    // Setup Baseline and BOQ for Project A so progress submission succeeds
    const boqStruct = await prisma.boqStructure.create({
      data: { projectId: projectAId, name: 'Main BOQ', version: 1 },
    });
    const boqFolder = await prisma.boqItem.create({
      data: {
        boqStructureId: boqStruct.id,
        wbsCode: '1',
        name: 'Structural Folder',
        itemType: 'FOLDER',
        quantity: 0,
        unit: '',
        sortOrder: 0,
      },
    });
    boqFolderAId = boqFolder.id;
    const boqItem = await prisma.boqItem.create({
      data: {
        boqStructureId: boqStruct.id,
        parentId: boqFolder.id,
        wbsCode: '1.1',
        name: 'Item',
        quantity: 10,
        unit: 'm3',
        unitPrice: 60,
        lineTotal: 600,
        priceOrigin: 'MANUAL_CLIENT',
        sortOrder: 1,
      },
    });
    boqItemAId = boqItem.id;
    const boqItemNoActual = await prisma.boqItem.create({
      data: {
        boqStructureId: boqStruct.id,
        parentId: boqFolder.id,
        wbsCode: '1.2',
        name: 'Item Without Actual',
        quantity: 5,
        unit: 'm3',
        unitPrice: 60,
        lineTotal: 300,
        priceOrigin: 'MANUAL_CLIENT',
        sortOrder: 2,
      },
    });
    boqItemNoActualId = boqItemNoActual.id;
    const boqItemRecordedZero = await prisma.boqItem.create({
      data: {
        boqStructureId: boqStruct.id,
        parentId: boqFolder.id,
        wbsCode: '1.3',
        name: 'Item With Recorded Zero',
        quantity: 4,
        unit: 'm3',
        unitPrice: 25,
        lineTotal: 100,
        priceOrigin: 'MANUAL_CLIENT',
        sortOrder: 3,
      },
    });
    boqItemRecordedZeroId = boqItemRecordedZero.id;
    const rab = await prisma.rabDocument.create({
      data: {
        projectId: projectAId,
        boqStructureId: boqStruct.id,
        name: 'RAB',
        version: 1,
        totalBaseCost: 1000,
        totalFinalCost: 1000,
        status: 'APPROVED',
      },
    });
    const baseline = await prisma.projectBaseline.create({
      data: {
        projectId: projectAId,
        rabDocumentId: rab.id,
        versionNumber: 1,
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });
    baselineAId = baseline.id;

    // Project B carries a legitimate active Baseline with no Actual so the
    // empty-effective-set contract is proven through an authorized GET.
    const boqStructB = await prisma.boqStructure.create({
      data: { projectId: projectBId, name: 'Main BOQ B', version: 1 },
    });
    await prisma.boqItem.create({
      data: {
        boqStructureId: boqStructB.id,
        wbsCode: '1',
        name: 'Item B Without Actual',
        quantity: 1,
        unit: 'unit',
        unitPrice: 1,
        lineTotal: 1,
        priceOrigin: 'MANUAL_CLIENT',
      },
    });
    const rabB = await prisma.rabDocument.create({
      data: {
        projectId: projectBId,
        boqStructureId: boqStructB.id,
        name: 'RAB B',
        version: 1,
        totalBaseCost: 1,
        totalFinalCost: 1,
        status: 'APPROVED',
      },
    });
    await prisma.projectBaseline.create({
      data: {
        projectId: projectBId,
        rabDocumentId: rabB.id,
        versionNumber: 1,
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });

    // Setup permissions
    const permView = await prisma.permission.upsert({
      where: { code: 'PROJECT_VIEW' },
      update: {},
      create: {
        code: 'PROJECT_VIEW',
        name: 'View Project',
      },
    });
    const permSubmit = await prisma.permission.upsert({
      where: { code: 'FIELD_PROGRESS_SUBMIT' },
      update: {},
      create: {
        code: 'FIELD_PROGRESS_SUBMIT',
        name: 'Submit Field Progress',
      },
    });
    const permProjectCreate = await prisma.permission.upsert({
      where: { code: 'PROJECT_CREATE' },
      update: {},
      create: {
        code: 'PROJECT_CREATE',
        name: 'Create Project',
      },
    });
    const permCorrect = await prisma.permission.upsert({
      where: { code: 'FIELD_PROGRESS_CORRECT' },
      update: {},
      create: {
        code: 'FIELD_PROGRESS_CORRECT',
        name: 'Correct Field Progress',
      },
    });
    const permVerify = await prisma.permission.upsert({
      where: { code: 'FIELD_PROGRESS_VERIFY' },
      update: {},
      create: {
        code: 'FIELD_PROGRESS_VERIFY',
        name: 'Verify Field Progress',
      },
    });
    const permAccept = await prisma.permission.upsert({
      where: { code: 'FIELD_PROGRESS_ACCEPT' },
      update: {},
      create: {
        code: 'FIELD_PROGRESS_ACCEPT',
        name: 'Accept Field Progress',
      },
    });
    const permProjectSettings = await prisma.permission.upsert({
      where: { code: 'PROJECT_SETTINGS_MANAGE' },
      update: {},
      create: {
        code: 'PROJECT_SETTINGS_MANAGE',
        name: 'Manage Project Settings',
      },
    });
    projectSettingsPermissionId = permProjectSettings.id;

    // Setup roles in Workspaces
    const roleViewA = await prisma.role.create({
      data: {
        name: 'Viewer A',
        code: 'ROLE_PROG_VIEW_A',
        workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: permView.id }] },
      },
    });
    const roleSubmitA = await prisma.role.create({
      data: {
        name: 'Submitter A',
        code: 'ROLE_PROG_SUBMIT_A',
        workspaceId: workspaceAId,
        rolePermissions: {
          create: [
            { permissionId: permView.id },
            { permissionId: permSubmit.id },
            { permissionId: permCorrect.id },
            { permissionId: permVerify.id },
            { permissionId: permAccept.id },
            { permissionId: permProjectCreate.id },
            { permissionId: permProjectSettings.id },
          ],
        },
      },
    });
    const roleSubmitB = await prisma.role.create({
      data: {
        name: 'Submitter B',
        code: 'ROLE_PROG_SUBMIT_B',
        workspaceId: workspaceBId,
        rolePermissions: {
          create: [
            { permissionId: permView.id },
            { permissionId: permSubmit.id },
          ],
        },
      },
    });

    // Setup accounts
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    async function createUser(
      email: string,
      wsId: string,
      roleId: string,
      assignProjectId?: string,
    ) {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' },
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId: wsId,
          status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] },
        },
      });
      await prisma.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: wsId,
          fullName: email,
          status: 'ACTIVE',
        },
      });
      if (assignProjectId) {
        await prisma.projectAssignment.create({
          data: {
            workspaceMembershipId: membership.id,
            projectId: assignProjectId,
            roleInProject: 'MEMBER',
            isPrimaryAssignment: true,
            status: 'ASSIGNED',
          },
        });
      }
      return account;
    }

    await createUser(userViewEmail, workspaceAId, roleViewA.id, projectAId);
    const submitAccount = await createUser(
      userSubmitEmail,
      workspaceAId,
      roleSubmitA.id,
      projectAId,
    );
    submitAccountId = submitAccount.id;
    await createUser(userCrossEmail, workspaceBId, roleSubmitB.id, projectBId);
    await createUser(userNoAccessEmail, workspaceAId, roleViewA.id); // No project assignment

    const submitUser = await prisma.user.findFirstOrThrow({
      where: {
        membership: { accountId: submitAccount.id, workspaceId: workspaceAId },
      },
    });
    const progressPosition = await prisma.position.create({
      data: {
        workspaceId: workspaceAId,
        code: 'PROGRESS_AUTHORITY_TEST',
        name: 'Configured Progress Authority',
      },
    });
    await prisma.positionAssignment.create({
      data: {
        positionId: progressPosition.id,
        userId: submitUser.id,
        isActive: true,
      },
    });
    const progressAuthorities = new Map<string, string>();
    for (const code of [
      'FIELD_PROGRESS_VERIFY',
      'FIELD_PROGRESS_CORRECT',
      'FIELD_PROGRESS_ACCEPT',
    ]) {
      const authority = await prisma.authority.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
      progressAuthorities.set(code, authority.id);
      await prisma.positionAuthority.create({
        data: { positionId: progressPosition.id, authorityId: authority.id },
      });
    }
    const verifyPolicy = await prisma.approvalMatrix.create({
      data: {
        workspaceId: workspaceAId,
        authorityId: progressAuthorities.get('FIELD_PROGRESS_VERIFY')!,
        objectType: 'FIELD_PROGRESS_VERIFY_COMBINED_RESPONSIBILITY',
        requiredPositionId: progressPosition.id,
      },
    });
    verifyCombinedPolicyId = verifyPolicy.id;
    const acceptPolicy = await prisma.approvalMatrix.create({
      data: {
        workspaceId: workspaceAId,
        authorityId: progressAuthorities.get('FIELD_PROGRESS_ACCEPT')!,
        objectType: 'FIELD_PROGRESS_ACCEPT_COMBINED_RESPONSIBILITY',
        requiredPositionId: progressPosition.id,
      },
    });
    acceptCombinedPolicyId = acceptPolicy.id;
  });

  afterAll(async () => {
    // Cleanup
    const emails = [
      userViewEmail,
      userSubmitEmail,
      userCrossEmail,
      userNoAccessEmail,
    ];
    const accounts = await prisma.account.findMany({
      where: { email: { in: emails } },
    });
    const accountIds = accounts.map((a) => a.id);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { accountId: { in: accountIds } },
    });
    const membershipIds = memberships.map((m) => m.id);

    await prisma.$executeRawUnsafe(
      'ALTER TABLE progress_audit_events DISABLE TRIGGER progress_audit_events_immutable_trigger',
    );
    await prisma.progressAuditEvent.deleteMany({
      where: { projectId: { in: [projectAId, projectBId] } },
    });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE progress_audit_events ENABLE TRIGGER progress_audit_events_immutable_trigger',
    );
    await prisma.progressEntry.deleteMany({
      where: {
        progressReport: { projectId: { in: [projectAId, projectBId] } },
      },
    });
    await prisma.progressReport.deleteMany({
      where: { projectId: { in: [projectAId, projectBId] } },
    });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE project_time_zone_events DISABLE TRIGGER project_time_zone_events_immutable_trigger',
    );
    await prisma.projectTimeZoneEvent.deleteMany({
      where: { projectId: { in: [projectAId, projectBId] } },
    });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE project_time_zone_events ENABLE TRIGGER project_time_zone_events_immutable_trigger',
    );

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

    await prisma.role.deleteMany({
      where: {
        code: {
          in: ['ROLE_PROG_VIEW_A', 'ROLE_PROG_SUBMIT_A', 'ROLE_PROG_SUBMIT_B'],
        },
      },
    });
    const progressPositions = await prisma.position.findMany({
      where: { workspaceId: workspaceAId, code: 'PROGRESS_AUTHORITY_TEST' },
    });
    await prisma.positionAssignment.deleteMany({
      where: {
        positionId: { in: progressPositions.map((position) => position.id) },
      },
    });
    await prisma.positionAuthority.deleteMany({
      where: {
        positionId: { in: progressPositions.map((position) => position.id) },
      },
    });
    await prisma.approvalMatrix.deleteMany({
      where: { id: { in: [verifyCombinedPolicyId, acceptCombinedPolicyId] } },
    });
    await prisma.position.deleteMany({
      where: { id: { in: progressPositions.map((position) => position.id) } },
    });

    await prisma.projectBaseline.deleteMany({
      where: { projectId: { in: [projectAId, projectBId] } },
    });
    await prisma.rabDocument.deleteMany({
      where: { projectId: { in: [projectAId, projectBId] } },
    });
    await prisma.boqItem.deleteMany({
      where: { boqStructure: { projectId: { in: [projectAId, projectBId] } } },
    });
    await prisma.boqStructure.deleteMany({
      where: { projectId: { in: [projectAId, projectBId] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [projectAId, projectBId] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceAId, workspaceBId] } },
    });
    await prisma.organization.deleteMany({
      where: { name: { in: ['Org Prog Sec A', 'Org Prog Sec B'] } },
    });

    await app.close();
    await prisma.$disconnect();
  });

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return (res.body as { access_token: string }).access_token;
  };

  const createSemanticWorkItem = async (name: string) => {
    const baseline = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
      include: { rabDocument: true },
    });
    return prisma.boqItem.create({
      data: {
        boqStructureId: baseline.rabDocument.boqStructureId,
        wbsCode: `MON04-${randomUUID().slice(0, 8)}`,
        name,
        quantity: 20,
        unit: 'm3',
        unitPrice: 1,
        lineTotal: 20,
        priceOrigin: 'MANUAL_CLIENT',
      },
    });
  };

  const submitSemanticRoot = async (
    token: string,
    boqItemId: string,
    installedQuantity: string,
    workDate = '2026-08-25',
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId,
            installedQuantity,
            workDate,
            captureMethod: 'FIELD_MEASUREMENT',
            evidenceReferences: [
              {
                url: `https://evidence.example/${randomUUID()}`,
                label: 'Field measurement',
              },
            ],
          },
        ],
      })
      .expect(201);
    return (response.body as { entryIds: string[] }).entryIds[0];
  };

  const transitionSemanticRoot = async (
    token: string,
    entryId: string,
    action: 'verify' | 'accept',
  ) =>
    request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/${action}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), reason: `MON04 ${action}` })
      .expect(201);

  const semanticHistory = async (
    token: string,
    boqItemId: string,
  ): Promise<SemanticHistoryBody> => {
    const response = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/items/${boqItemId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    return response.body as SemanticHistoryBody;
  };

  const semanticContextDigest = (history: SemanticHistoryBody): string => {
    if (!history.semanticVerification.contextDigest) {
      throw new Error('Expected a valid semantic verification context');
    }
    return history.semanticVerification.contextDigest;
  };

  const attestSemantics = (
    token: string,
    entryId: string,
    contextDigest: string,
    commandId = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post(
        `/projects/${projectAId}/progress/entries/${entryId}/semantic-attestations`,
      )
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId, contextDigest, confirmed: true });

  const successfulSemanticProofCount = (entryIds: string[]) =>
    prisma.progressAuditEvent.count({
      where: {
        progressEntryId: { in: entryIds },
        action: 'ACTUAL_SEMANTIC_AUTHORITY_CONFIRMED',
        outcome: 'SUCCESS',
      },
    });

  it('1. no token -> POST /projects/:id/progress/field returns 401', async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .send({ commandId: randomUUID(), entries: [] })
      .expect(401);
  });

  it('2. authenticated user without project access -> rejected', async () => {
    const token = await login(userNoAccessEmail);
    const beforeReports = await prisma.progressReport.count({
      where: { projectId: projectAId },
    });
    const beforeEntries = await prisma.progressEntry.count({
      where: { progressReport: { projectId: projectAId } },
    });

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), entries: [] })
      .expect(403);

    const afterReports = await prisma.progressReport.count({
      where: { projectId: projectAId },
    });
    const afterEntries = await prisma.progressEntry.count({
      where: { progressReport: { projectId: projectAId } },
    });
    expect(afterReports).toBe(beforeReports);
    expect(afterEntries).toBe(beforeEntries);
  });

  it('3. project-assigned user with PROJECT_VIEW only -> POST progress rejected 403', async () => {
    const token = await login(userViewEmail);
    const beforeReports = await prisma.progressReport.count({
      where: { projectId: projectAId },
    });
    const beforeEntries = await prisma.progressEntry.count({
      where: { progressReport: { projectId: projectAId } },
    });

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), entries: [] })
      .expect(403);

    const afterReports = await prisma.progressReport.count({
      where: { projectId: projectAId },
    });
    const afterEntries = await prisma.progressEntry.count({
      where: { progressReport: { projectId: projectAId } },
    });
    expect(afterReports).toBe(beforeReports);
    expect(afterEntries).toBe(beforeEntries);
  });

  it('4. project-assigned user with FIELD_PROGRESS_SUBMIT -> accepted', async () => {
    const token = await login(userSubmitEmail);
    const beforeReports = await prisma.progressReport.count({
      where: { projectId: projectAId },
    });
    const beforeEntries = await prisma.progressEntry.count({
      where: { progressReport: { projectId: projectAId } },
    });

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: boqItemAId,
            installedQuantity: '2',
            workDate: '2026-08-31',
            captureMethod: 'FIELD_OBSERVATION',
          },
          {
            boqItemId: boqItemRecordedZeroId,
            installedQuantity: '0',
            workDate: '2026-08-31',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(201);

    const afterReports = await prisma.progressReport.count({
      where: { projectId: projectAId },
    });
    const afterEntries = await prisma.progressEntry.count({
      where: { progressReport: { projectId: projectAId } },
    });
    expect(afterReports).toBe(beforeReports + 1);
    expect(afterEntries).toBe(beforeEntries + 2);

    // Verify relation matches the target project
    const latestReport = await prisma.progressReport.findFirst({
      where: { projectId: projectAId },
      orderBy: { createdAt: 'desc' },
      include: {
        project: true,
        entries: true,
      },
    });

    expect(latestReport).toBeDefined();
    expect(latestReport!.projectId).toBe(projectAId);
    expect(latestReport!.project.workspaceId).toBe(workspaceAId);
    expect(latestReport!.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          boqItemId: boqItemAId,
          recordedByAccountId: submitAccountId,
          actualCost: null,
          earnedValue: null,
        }),
        expect.objectContaining({ boqItemId: boqItemRecordedZeroId }),
      ]),
    );
  });

  it('5. cross-tenant user cannot submit progress to another workspace project', async () => {
    const token = await login(userCrossEmail);
    const beforeReports = await prisma.progressReport.count({
      where: { projectId: projectAId },
    });
    const beforeEntries = await prisma.progressEntry.count({
      where: { progressReport: { projectId: projectAId } },
    });

    // Try to submit to Project A using Workspace B user
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: boqItemAId,
            installedQuantity: '2',
            workDate: '2026-08-31',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(404); // ProjectAccessGuard usually returns 404 for cross-tenant

    const afterReports = await prisma.progressReport.count({
      where: { projectId: projectAId },
    });
    const afterEntries = await prisma.progressEntry.count({
      where: { progressReport: { projectId: projectAId } },
    });
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
          unitPrice: true,
          lineTotal: true,
          sortOrder: true,
        },
      });

      return {
        baseline: {
          ...baseline,
          approvedAt: baseline.approvedAt.toISOString(),
          rabDocument: {
            ...baseline.rabDocument,
            totalBaseCost:
              baseline.rabDocument.totalBaseCost?.toString() ?? null,
            totalFinalCost:
              baseline.rabDocument.totalFinalCost?.toString() ?? null,
          },
        },
        items: items.map((item) => ({
          ...item,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice?.toString() ?? null,
          lineTotal: item.lineTotal?.toString() ?? null,
        })),
      };
    };

    const planningTruthBefore = await readPlanningTruth();
    const domainCountsBefore = await Promise.all([
      prisma.progressReport.count({ where: { projectId: projectAId } }),
      prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      prisma.progressAuditEvent.count({ where: { projectId: projectAId } }),
      prisma.deviationSignal.count({ where: { projectId: projectAId } }),
      prisma.projectBaseline.count({ where: { projectId: projectAId } }),
      prisma.rabDocument.count({ where: { projectId: projectAId } }),
      prisma.boqItem.count({
        where: { boqStructure: { projectId: projectAId } },
      }),
    ]);
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    const planningTruthAfter = await readPlanningTruth();
    const domainCountsAfter = await Promise.all([
      prisma.progressReport.count({ where: { projectId: projectAId } }),
      prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      prisma.progressAuditEvent.count({ where: { projectId: projectAId } }),
      prisma.deviationSignal.count({ where: { projectId: projectAId } }),
      prisma.projectBaseline.count({ where: { projectId: projectAId } }),
      prisma.rabDocument.count({ where: { projectId: projectAId } }),
      prisma.boqItem.count({
        where: { boqStructure: { projectId: projectAId } },
      }),
    ]);

    const body = res.body;
    expect(body.projectId).toBe(projectAId);
    expect(body.baseline).toMatchObject({ id: baselineAId, versionNumber: 1 });
    expect(body.weight).toEqual({
      basis: 'ACTIVE_BASELINE_RAB_TOTAL_BASE_COST',
      completeness: 'COMPLETE',
      reason: null,
      denominator: { state: 'AVAILABLE', value: '1000.00' },
      eligibleWorkItemCount: 3,
      weightedWorkItemCount: 3,
      unavailableWorkItemCount: 0,
    });

    expect(planningTruthAfter).toEqual(planningTruthBefore);
    expect(domainCountsAfter).toEqual(domainCountsBefore);

    expect(body.items.map((item: any) => item.id)).toEqual([
      boqFolderAId,
      boqItemAId,
      boqItemNoActualId,
      boqItemRecordedZeroId,
    ]);
    const folder = body.items.find((item: any) => item.id === boqFolderAId);
    expect(folder).toMatchObject({
      parentId: null,
      itemType: 'FOLDER',
      sortOrder: 0,
      actual: null,
      weight: {
        own: { state: 'NOT_APPLICABLE', percentage: null },
        subtree: { state: 'AVAILABLE', percentage: '100' },
        cumulative: { state: 'AVAILABLE', percentage: '100' },
      },
    });

    // Truth Contract: UNAVAILABLE != ZERO
    expect(body.unavailable).toEqual(
      expect.arrayContaining(['plannedStart', 'plannedFinish']),
    );
    expect(body).not.toHaveProperty('plannedStart');
    expect(body).not.toHaveProperty('plannedFinish');
    expect(body.baseline).not.toHaveProperty('plannedStart');
    expect(body.baseline).not.toHaveProperty('plannedFinish');

    const recordedItem = body.items.find((i: any) => i.id === boqItemAId);
    expect(recordedItem).toBeDefined();
    expect(recordedItem.parentId).toBe(boqFolderAId);
    expect(recordedItem.planned.quantity).toBe('10');
    expect(recordedItem.actual.state).toBe('RECORDED');
    expect(recordedItem.actual.effectiveRecord.installedQuantity).toBe('2');
    expect(recordedItem.weight).toMatchObject({
      own: { state: 'AVAILABLE', percentage: '60' },
      cumulative: { state: 'AVAILABLE', percentage: '60' },
    });

    const absentItem = body.items.find((i: any) => i.id === boqItemNoActualId);
    expect(absentItem).toBeDefined();
    expect(absentItem.actual).toMatchObject({
      state: 'NOT_YET_RECORDED',
      effectiveRecord: null,
      latestRecord: null,
    });
    expect(absentItem.actual).not.toHaveProperty('installedQuantity');
    expect(absentItem.weight).toMatchObject({
      own: { state: 'AVAILABLE', percentage: '30' },
      cumulative: { state: 'AVAILABLE', percentage: '90' },
    });

    const recordedZeroItem = body.items.find(
      (i: any) => i.id === boqItemRecordedZeroId,
    );
    expect(recordedZeroItem).toBeDefined();
    expect(recordedZeroItem.actual.state).toBe('RECORDED');
    expect(recordedZeroItem.actual.effectiveRecord.installedQuantity).toBe('0');
    expect(recordedZeroItem.actual).not.toEqual(absentItem.actual);
    expect(recordedZeroItem.weight).toMatchObject({
      own: { state: 'AVAILABLE', percentage: '10' },
      cumulative: { state: 'AVAILABLE', percentage: '100' },
    });

    const effectiveEntryIds = [
      recordedItem.actual.effectiveRecord.id,
      recordedZeroItem.actual.effectiveRecord.id,
    ];
    const latestEffectiveEntry = await prisma.progressEntry.findFirstOrThrow({
      where: { id: { in: effectiveEntryIds } },
      orderBy: { createdAt: 'desc' },
    });
    expect(body.freshness).toEqual({
      dataThrough: {
        state: 'RECORDED',
        workDate: '2026-08-31T00:00:00.000Z',
      },
      lastRecordedAt: {
        state: 'RECORDED',
        recordedAt: latestEffectiveEntry.createdAt.toISOString(),
      },
    });
  });

  it('6a. authorized project with no effective Actual returns no fake freshness date', async () => {
    const token = await login(userCrossEmail);
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectBId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceBId)
      .expect(200);

    expect(res.body.baseline).toMatchObject({ versionNumber: 1 });
    expect(res.body.freshness).toEqual({
      dataThrough: { state: 'NOT_YET_RECORDED', workDate: null },
      lastRecordedAt: { state: 'NOT_YET_RECORDED', recordedAt: null },
    });
    expect(res.body.items[0].actual).toMatchObject({
      state: 'NOT_YET_RECORDED',
      effectiveRecord: null,
    });
  });

  it('6b. a newer raw non-effective record cannot advance effective freshness', async () => {
    const token = await login(userViewEmail);
    const before = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    const rawReport = await prisma.progressReport.create({
      data: {
        projectId: projectAId,
        baselineId: baselineAId,
        periodStartDate: new Date('2099-12-31T00:00:00.000Z'),
        periodEndDate: new Date('2099-12-31T00:00:00.000Z'),
        status: 'SUBMITTED',
        entries: {
          create: {
            boqItemId: boqItemNoActualId,
            installedQuantity: 999,
            workDate: new Date('2099-12-31T00:00:00.000Z'),
            createdAt: new Date('2099-12-31T23:59:00.000Z'),
            status: 'RETURNED_FOR_CORRECTION',
            captureMethod: 'FIELD_OBSERVATION',
            revision: 1,
          },
        },
      },
    });

    try {
      const after = await request(app.getHttpServer())
        .get(`/projects/${projectAId}/progress/monitoring`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(after.body.freshness).toEqual(before.body.freshness);
      expect(
        after.body.items.find((item: any) => item.id === boqItemNoActualId)
          .actual,
      ).toMatchObject({
        state: 'NOT_YET_RECORDED',
        effectiveRecord: null,
      });
    } finally {
      await prisma.progressReport.delete({ where: { id: rawReport.id } });
    }
  });

  it('6c. Monitoring fails closed when more than one ACTIVE Baseline exists', async () => {
    const token = await login(userViewEmail);
    const canonicalBaseline = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
    });
    const competing = await prisma.projectBaseline.create({
      data: {
        projectId: projectAId,
        rabDocumentId: canonicalBaseline.rabDocumentId,
        versionNumber: 999,
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });

    try {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectAId}/progress/monitoring`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .expect(409);
      expect(res.body.message).toBe('MULTIPLE_ACTIVE_BASELINES');
    } finally {
      await prisma.projectBaseline.delete({ where: { id: competing.id } });
    }
  });

  it('6d. Monitoring keeps the existing no-Baseline fail-closed contract', async () => {
    const token = await login(userViewEmail);
    const canonicalBaseline = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
      select: { status: true },
    });
    await prisma.projectBaseline.update({
      where: { id: baselineAId },
      data: { status: 'DRAFT' },
    });

    try {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectAId}/progress/monitoring`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(res.body).toMatchObject({
        projectId: projectAId,
        baseline: null,
        items: [],
        freshness: {
          dataThrough: { state: 'UNAVAILABLE', workDate: null },
          lastRecordedAt: { state: 'UNAVAILABLE', recordedAt: null },
        },
        weight: {
          completeness: 'UNAVAILABLE',
          reason: 'BASELINE_VALUE_UNAVAILABLE',
          denominator: { state: 'UNAVAILABLE', value: null },
          eligibleWorkItemCount: 0,
          weightedWorkItemCount: 0,
          unavailableWorkItemCount: 0,
        },
      });
    } finally {
      await prisma.projectBaseline.update({
        where: { id: baselineAId },
        data: { status: canonicalBaseline.status },
      });
    }
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
    const itemBefore = await prisma.boqItem.findUniqueOrThrow({
      where: { id: boqItemAId },
    });
    const commandId = randomUUID();
    const payload = {
      commandId,
      accountId: '00000000-0000-4000-8000-000000000999',
      workspaceId: workspaceBId,
      projectId: projectBId,
      entries: [
        {
          boqItemId: boqItemAId,
          installedQuantity: '3.25',
          workDate: '2026-08-31',
          captureMethod: 'FIELD_OBSERVATION',
        },
      ],
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

    const original = await prisma.progressEntry.findUniqueOrThrow({
      where: { id: entryId },
    });
    expect(original.recordedByAccountId).toBe(submitAccountId);
    expect(original.actualCost).toBeNull();
    expect(original.earnedValue).toBeNull();
    expect(original.evidenceReferences).toBeNull();
    expect(await prisma.progressReport.count({ where: { commandId } })).toBe(1);

    const verifyCommandId = randomUUID();
    const viewAccount = await prisma.account.findUniqueOrThrow({
      where: { email: userViewEmail },
    });
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
      .set('Authorization', `Bearer ${viewToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID() })
      .expect(403);
    expect(
      (await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } }))
        .status,
    ).toBe('SUBMITTED');
    const deniedVerifyAudit = await prisma.progressAuditEvent.findFirstOrThrow({
      where: {
        projectId: projectAId,
        action: 'ACTUAL_VERIFY',
        outcome: 'DENIED',
        targetEntityId: entryId,
      },
    });
    expect(deniedVerifyAudit).toMatchObject({
      progressEntryId: null,
      workspaceId: workspaceAId,
      actorAccountId: viewAccount.id,
      actorType: 'USER',
      eventType: 'ACTUAL_PROGRESS',
      reasonCode: null,
      reasonText: null,
      errorCode: 'TECHNICAL_PERMISSION_DENIED',
      sourceModule: 'FIELD_PROGRESS',
      targetEntityType: 'PROGRESS_ENTRY',
      businessCommandId: expect.any(String),
      commandId: expect.any(String),
    });
    expect(deniedVerifyAudit.schemaVersion).toBe(1);
    expect(deniedVerifyAudit.occurredAt).toBeInstanceOf(Date);
    expect(deniedVerifyAudit.recordedAt).toBeInstanceOf(Date);

    const verified = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: verifyCommandId,
        reason: 'Configured authority verification',
      })
      .expect(201);
    expect(verified.body).toMatchObject({ entryId, status: 'VERIFIED' });
    const verifyReplay = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: verifyCommandId,
        reason: 'Configured authority verification',
      })
      .expect(201);
    expect(verifyReplay.body.replayed).toBe(true);

    const acceptCommandId = randomUUID();
    const accepted = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/accept`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: acceptCommandId,
        reason: 'Configured authority acceptance',
      })
      .expect(201);
    expect(accepted.body).toMatchObject({ entryId, status: 'ACCEPTED' });
    const acceptReplay = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/accept`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: acceptCommandId,
        reason: 'Configured authority acceptance',
      })
      .expect(201);
    expect(acceptReplay.body.replayed).toBe(true);

    const correctionCommandId = randomUUID();
    const correctionPayload = {
      commandId: correctionCommandId,
      installedQuantity: '4.00',
      workDate: '2026-08-31',
      captureMethod: 'FIELD_REMEASUREMENT',
      reasonCode: 'MEASUREMENT_UPDATE',
      reasonText: 'Corrected after field remeasurement',
      evidenceReferences: [
        {
          url: 'https://evidence.example/measurement-01',
          label: 'Measurement reference',
        },
      ],
    };
    const corrected = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/corrections`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send(correctionPayload)
      .expect(201);
    const correctionId = corrected.body.entryId;
    expect(correctionId).not.toBe(entryId);
    const correctionReplay = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/corrections`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send(correctionPayload)
      .expect(201);
    expect(correctionReplay.body).toMatchObject({
      entryId: correctionId,
      replayed: true,
    });

    const [preservedOriginal, correction] = await Promise.all([
      prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } }),
      prisma.progressEntry.findUniqueOrThrow({ where: { id: correctionId } }),
    ]);
    expect(preservedOriginal.installedQuantity.toString()).toBe('3.25');
    expect(preservedOriginal.status).toBe('ACCEPTED');
    expect(correction.supersedesEntryId).toBe(entryId);
    expect(correction.installedQuantity.toString()).toBe('4');
    expect(correction.correctionReasonCode).toBe('MEASUREMENT_UPDATE');
    expect(correction.correctionReason).toBe(
      'Corrected after field remeasurement',
    );
    expect(correction.revision).toBe(preservedOriginal.revision + 1);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/corrections`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        installedQuantity: '5',
        workDate: '2026-08-31',
        captureMethod: 'FIELD_REMEASUREMENT',
        reasonCode: 'MEASUREMENT_UPDATE',
        reasonText: 'Stale competing correction',
      })
      .expect(409);

    const history = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/items/${boqItemAId}/history`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(history.body.availableActions).toEqual({
      verify: true,
      correct: false,
      accept: false,
      semanticAttestEntryIds: [],
    });
    expect(history.body.effectiveEntryId).toBe(entryId);
    expect(history.body.governanceEntryId).toBe(correctionId);
    expect(
      history.body.entries.find((entry: any) => entry.id === entryId)
        .timeline[0],
    ).toHaveProperty('occurredAt');
    expect(history.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: entryId, status: 'ACCEPTED' }),
        expect.objectContaining({
          id: correctionId,
          supersedesEntryId: entryId,
          status: 'SUBMITTED',
        }),
      ]),
    );

    const monitoringBeforeCorrectionAcceptance = await request(
      app.getHttpServer(),
    )
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${viewToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(
      monitoringBeforeCorrectionAcceptance.body.items.find(
        (item: any) => item.id === boqItemAId,
      ).actual.effectiveRecord.id,
    ).toBe(entryId);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${correctionId}/verify`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), reason: 'Correction verification' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${correctionId}/accept`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), reason: 'Correction acceptance' })
      .expect(201);

    const finalHistory = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/items/${boqItemAId}/history`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(finalHistory.body.effectiveEntryId).toBe(correctionId);
    expect(finalHistory.body.governanceEntryId).toBe(correctionId);
    expect(
      await prisma.progressAuditEvent.count({
        where: {
          projectId: projectAId,
          progressEntryId: { in: [entryId, correctionId] },
        },
      }),
    ).toBe(7);
    const successAudits = await prisma.progressAuditEvent.findMany({
      where: {
        projectId: projectAId,
        progressEntryId: { in: [entryId, correctionId] },
      },
      orderBy: { occurredAt: 'asc' },
    });
    expect(successAudits).toHaveLength(7);
    expect(
      successAudits.map((event) => ({
        schemaVersion: event.schemaVersion,
        eventType: event.eventType,
        outcome: event.outcome,
        workspaceId: event.workspaceId,
        actorType: event.actorType,
        sourceModule: event.sourceModule,
        targetEntityType: event.targetEntityType,
        targetEntityId: event.targetEntityId,
        hasRecordedAt: event.recordedAt instanceof Date,
        hasCorrelation: !!event.correlationId && !!event.requestId,
      })),
    ).toEqual(
      successAudits.map((event) => ({
        schemaVersion: 1,
        eventType: 'ACTUAL_PROGRESS',
        outcome: 'SUCCESS',
        workspaceId: workspaceAId,
        actorType: 'USER',
        sourceModule: 'FIELD_PROGRESS',
        targetEntityType: 'PROGRESS_ENTRY',
        targetEntityId: event.progressEntryId,
        hasRecordedAt: true,
        hasCorrelation: true,
      })),
    );

    const monitoring = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${viewToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(monitoring.body.projectTimeZone).toBe('Asia/Makassar');
    const monitoredItem = monitoring.body.items.find(
      (item: any) => item.id === boqItemAId,
    );
    expect(monitoredItem.actual.effectiveRecord).toMatchObject({
      id: correctionId,
      installedQuantity: '4',
      supersedesEntryId: entryId,
      captureMethod: 'FIELD_REMEASUREMENT',
    });
    expect(monitoredItem.actual.effectiveRecord.id).toBe(
      finalHistory.body.effectiveEntryId,
    );

    const baselineAfter = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
      include: { rabDocument: true },
    });
    const itemAfter = await prisma.boqItem.findUniqueOrThrow({
      where: { id: boqItemAId },
    });
    expect(baselineAfter).toEqual(baselineBefore);
    expect(itemAfter).toEqual(itemBefore);
  });

  it('10. MON-03 wrong-project item and invalid quantity leave zero partial mutation', async () => {
    const token = await login(userSubmitEmail);
    const foreignBoq = await prisma.boqStructure.create({
      data: { projectId: projectBId, name: 'Foreign BOQ', version: 1 },
    });
    const foreignItem = await prisma.boqItem.create({
      data: {
        boqStructureId: foreignBoq.id,
        wbsCode: 'X',
        name: 'Foreign Item',
        quantity: 1,
        unit: 'm3',
      },
    });
    const before = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    };

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: foreignItem.id,
            installedQuantity: '1',
            workDate: '2026-08-31',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: boqItemAId,
            installedQuantity: '-1',
            workDate: '2026-08-31',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(400);

    const after = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    };
    expect(after).toEqual({
      reports: before.reports,
      entries: before.entries,
      audits: before.audits + 1,
    });
    const denied = await prisma.progressAuditEvent.findFirstOrThrow({
      where: {
        projectId: projectAId,
        outcome: 'DENIED',
        action: 'ACTUAL_SUBMIT',
        errorCode: 'TARGET_SCOPE_DENIED',
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(denied).toMatchObject({
      progressEntryId: null,
      targetEntityType: 'PROJECT',
      targetEntityId: projectAId,
      workspaceId: workspaceAId,
    });
  });

  it('11. MON-03 audit failure rolls back the complete Actual command', async () => {
    const token = await login(userSubmitEmail);
    const before = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
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
          entries: [
            {
              boqItemId: boqItemAId,
              installedQuantity: '6.50',
              workDate: '2026-08-31',
              captureMethod: 'FIELD_OBSERVATION',
            },
          ],
        })
        .expect(500);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS mon03_reject_progress_audit ON progress_audit_events',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS mon03_reject_progress_audit()',
      );
    }

    expect({
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    }).toEqual(before);
  });

  it('11b. MON-03 denial audit failure still rejects the command and leaves zero domain mutation', async () => {
    const submitToken = await login(userSubmitEmail);
    const viewToken = await login(userViewEmail);
    const submitted = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${submitToken}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: boqItemAId,
            installedQuantity: '6.75',
            workDate: '2026-08-31',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(201);
    const entryId = submitted.body.entryIds[0] as string;
    const before = {
      status: (
        await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } })
      ).status,
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    };

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION mon03_reject_progress_denial_audit() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'MON03_TEST_DENIAL_AUDIT_FAILURE';
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER mon03_reject_progress_denial_audit
      BEFORE INSERT ON progress_audit_events
      FOR EACH ROW EXECUTE FUNCTION mon03_reject_progress_denial_audit();
    `);
    try {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
        .set('Authorization', `Bearer ${viewToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ commandId: randomUUID(), reason: 'Denied audit failure proof' })
        .expect(503);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS mon03_reject_progress_denial_audit ON progress_audit_events',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS mon03_reject_progress_denial_audit()',
      );
    }

    expect({
      status: (
        await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } })
      ).status,
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    }).toEqual(before);
  });

  it('12. MON-03 audit ledger allows runtime INSERT but rejects runtime UPDATE and DELETE at PostgreSQL boundary', async () => {
    const audit = await prisma.progressAuditEvent.findFirstOrThrow({
      where: { projectId: projectAId, outcome: 'SUCCESS' },
    });
    const insertedId = randomUUID();
    const [runtimeRole] = await prisma.$queryRaw<
      Array<{ rolsuper: boolean; rolcreaterole: boolean }>
    >`SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
    expect(runtimeRole).toEqual({ rolsuper: false, rolcreaterole: false });

    await prisma.$executeRawUnsafe(`
      INSERT INTO progress_audit_events (
        "id", "schemaVersion", "eventType", "outcome", "workspaceId",
        "projectId", "progressEntryId", "actorAccountId",
        "actorMembershipId", "actorType", "action", "sourceModule",
        "targetEntityType", "targetEntityId", "occurredAt", "recordedAt"
      )
      SELECT '${insertedId}'::uuid, 1, 'ACTUAL_PROGRESS', 'SUCCESS',
             "workspaceId", "projectId", "progressEntryId",
             "actorAccountId", "actorMembershipId", 'USER',
             'AUDIT_RUNTIME_INSERT_PROOF', 'FIELD_PROGRESS',
             'PROGRESS_ENTRY', "targetEntityId", CURRENT_TIMESTAMP,
             CURRENT_TIMESTAMP
        FROM progress_audit_events
       WHERE "id" = '${audit.id}'::uuid
    `);
    expect(
      await prisma.progressAuditEvent.findUnique({ where: { id: insertedId } }),
    ).toMatchObject({ id: insertedId, action: 'AUDIT_RUNTIME_INSERT_PROOF' });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE progress_audit_events SET reason = 'tampered' WHERE id = '${insertedId}'::uuid`,
      ),
    ).rejects.toThrow('PROGRESS_AUDIT_APPEND_ONLY');
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM progress_audit_events WHERE id = '${insertedId}'::uuid`,
      ),
    ).rejects.toThrow('PROGRESS_AUDIT_APPEND_ONLY');
    expect(
      await prisma.progressAuditEvent.findUnique({ where: { id: insertedId } }),
    ).toMatchObject({ id: insertedId, reason: null });
  });

  it('13. inactive trusted User is rejected with zero progress mutation and one safe denial audit', async () => {
    const token = await login(userSubmitEmail);
    const user = await prisma.user.findFirstOrThrow({
      where: { membership: { accountId: submitAccountId } },
    });
    const before = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    };
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'SUSPENDED' },
    });
    try {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/field`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({
          commandId: randomUUID(),
          entries: [
            {
              boqItemId: boqItemAId,
              installedQuantity: '1',
              workDate: '2026-08-31',
              captureMethod: 'FIELD_OBSERVATION',
            },
          ],
        })
        .expect(403);
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
    }
    const after = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    };
    expect(after).toEqual({
      reports: before.reports,
      entries: before.entries,
      audits: before.audits + 1,
    });
    const denied = await prisma.progressAuditEvent.findFirstOrThrow({
      where: {
        projectId: projectAId,
        action: 'ACTUAL_SUBMIT',
        outcome: 'DENIED',
        errorCode: 'ACTIVE_PROJECT_ACTOR_REQUIRED',
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(denied.progressEntryId).toBeNull();
  });

  it('14. SUBMITTED correction returns original while VERIFIED correction preserves verified history', async () => {
    const token = await login(userSubmitEmail);
    const submitOne = async (boqItemId: string) => {
      const response = await request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/field`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({
          commandId: randomUUID(),
          entries: [
            {
              boqItemId,
              installedQuantity: '1',
              workDate: '2026-08-30',
              captureMethod: 'FIELD_OBSERVATION',
            },
          ],
        })
        .expect(201);
      return response.body.entryIds[0] as string;
    };
    const correctOne = async (entryId: string) =>
      request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/entries/${entryId}/corrections`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({
          commandId: randomUUID(),
          installedQuantity: '2',
          workDate: '2026-08-30',
          captureMethod: 'FIELD_REMEASUREMENT',
          reasonCode: 'FIELD_FACT_CORRECTION',
          reasonText: 'Lawful correction',
        })
        .expect(201);

    const submittedId = await submitOne(boqItemNoActualId);
    await correctOne(submittedId);
    expect(
      (
        await prisma.progressEntry.findUniqueOrThrow({
          where: { id: submittedId },
        })
      ).status,
    ).toBe('RETURNED_FOR_CORRECTION');

    const verifiedId = await submitOne(boqItemRecordedZeroId);
    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${verifiedId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID() })
      .expect(201);
    await correctOne(verifiedId);
    expect(
      (
        await prisma.progressEntry.findUniqueOrThrow({
          where: { id: verifiedId },
        })
      ).status,
    ).toBe('VERIFIED');
  });

  it('14b. same-actor verification and acceptance require explicit ApprovalMatrix combined-responsibility policy', async () => {
    const token = await login(userSubmitEmail);
    const boqStructure = await prisma.boqStructure.findFirstOrThrow({
      where: { projectId: projectAId },
    });
    const item = await prisma.boqItem.create({
      data: {
        boqStructureId: boqStructure.id,
        wbsCode: `SOD-${randomUUID().slice(0, 8)}`,
        name: 'Separation policy proof',
        quantity: 1,
        unit: 'm3',
      },
    });
    const submitted = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: item.id,
            installedQuantity: '1',
            workDate: '2026-08-30',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(201);
    const entryId = submitted.body.entryIds[0] as string;

    await prisma.approvalMatrix.update({
      where: { id: verifyCombinedPolicyId },
      data: { isActive: false },
    });
    const deniedVerifyCommand = randomUUID();
    try {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({ commandId: deniedVerifyCommand })
        .expect(403);
    } finally {
      await prisma.approvalMatrix.update({
        where: { id: verifyCombinedPolicyId },
        data: { isActive: true },
      });
    }
    expect(
      (await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } }))
        .status,
    ).toBe('SUBMITTED');
    expect(
      await prisma.progressAuditEvent.findFirstOrThrow({
        where: {
          businessCommandId: deniedVerifyCommand,
          outcome: 'DENIED',
        },
      }),
    ).toMatchObject({
      errorCode: 'SEPARATION_OF_DUTIES_DENIED',
      reasonCode: null,
      progressEntryId: null,
    });

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID() })
      .expect(201);

    await prisma.approvalMatrix.update({
      where: { id: acceptCombinedPolicyId },
      data: { isActive: false },
    });
    const deniedAcceptCommand = randomUUID();
    try {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/entries/${entryId}/accept`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({ commandId: deniedAcceptCommand })
        .expect(403);
    } finally {
      await prisma.approvalMatrix.update({
        where: { id: acceptCombinedPolicyId },
        data: { isActive: true },
      });
    }
    expect(
      (await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } }))
        .status,
    ).toBe('VERIFIED');
    expect(
      await prisma.progressAuditEvent.findFirstOrThrow({
        where: {
          businessCommandId: deniedAcceptCommand,
          outcome: 'DENIED',
        },
      }),
    ).toMatchObject({
      errorCode: 'SEPARATION_OF_DUTIES_DENIED',
      reasonCode: null,
    });

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID() })
      .expect(201);
    expect(
      (await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } }))
        .status,
    ).toBe('ACCEPTED');
  });

  it('15. ASSIGNED ProjectAssignment with revokedAt is rejected inside the write transaction with zero mutation', async () => {
    const membership = await prisma.workspaceMembership.findFirstOrThrow({
      where: { accountId: submitAccountId, workspaceId: workspaceAId },
    });
    const assignment = await prisma.projectAssignment.findFirstOrThrow({
      where: { workspaceMembershipId: membership.id, projectId: projectAId },
    });
    const access = {
      projectId: projectAId,
      workspaceId: workspaceAId,
      projectStatus: 'ACTIVE' as const,
      membershipId: membership.id,
      assignmentId: assignment.id,
      roleInProject: assignment.roleInProject,
      isPrimaryAssignment: assignment.isPrimaryAssignment,
      roles: ['ROLE_PROG_SUBMIT_A'],
    };
    const before = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    };
    await prisma.projectAssignment.update({
      where: { id: assignment.id },
      data: { status: 'ASSIGNED', revokedAt: new Date() },
    });
    const commandId = randomUUID();
    try {
      await expect(
        progressService.submitFieldProgress(
          projectAId,
          {
            commandId,
            entries: [
              {
                boqItemId: boqItemAId,
                installedQuantity: '1',
                workDate: '2026-08-31',
                captureMethod: 'FIELD_OBSERVATION',
              },
            ],
          },
          submitAccountId,
          access,
        ),
      ).rejects.toThrow('PROJECT_ASSIGNMENT_REVOKED');
    } finally {
      await prisma.projectAssignment.update({
        where: { id: assignment.id },
        data: { status: 'ASSIGNED', revokedAt: null },
      });
    }
    const after = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
    };
    expect(after).toEqual({
      reports: before.reports,
      entries: before.entries,
      audits: before.audits + 1,
    });
    const denial = await prisma.progressAuditEvent.findFirstOrThrow({
      where: {
        projectId: projectAId,
        action: 'ACTUAL_SUBMIT',
        outcome: 'DENIED',
        businessCommandId: commandId,
      },
    });
    expect(denial).toMatchObject({
      progressEntryId: null,
      errorCode: 'PROJECT_ASSIGNMENT_REVOKED',
      targetEntityType: 'PROJECT',
      targetEntityId: projectAId,
      workspaceId: workspaceAId,
    });
  });

  it('16. revoked PositionAuthority is retained but denied with zero transition mutation', async () => {
    const token = await login(userSubmitEmail);
    const submitted = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: boqItemRecordedZeroId,
            installedQuantity: '2',
            workDate: '2026-09-01',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(201);
    const entryId = submitted.body.entryIds[0];
    const authorityGrant = await prisma.positionAuthority.findFirstOrThrow({
      where: {
        position: {
          workspaceId: workspaceAId,
          assignments: {
            some: { user: { membership: { accountId: submitAccountId } } },
          },
        },
        authority: { code: 'FIELD_PROGRESS_VERIFY' },
      },
    });
    const before = {
      status: (
        await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } })
      ).status,
      audits: await prisma.progressAuditEvent.count({
        where: { progressEntryId: entryId },
      }),
    };
    await prisma.positionAuthority.update({
      where: { id: authorityGrant.id },
      data: { isActive: false, revokedAt: new Date() },
    });
    const deniedCommandId = randomUUID();
    try {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/entries/${entryId}/verify`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({ commandId: deniedCommandId, reason: 'Must be denied' })
        .expect(403);
    } finally {
      await prisma.positionAuthority.update({
        where: { id: authorityGrant.id },
        data: { isActive: true, revokedAt: null },
      });
    }
    expect({
      status: (
        await prisma.progressEntry.findUniqueOrThrow({ where: { id: entryId } })
      ).status,
      audits: await prisma.progressAuditEvent.count({
        where: { progressEntryId: entryId },
      }),
    }).toEqual(before);
    const denial = await prisma.progressAuditEvent.findFirstOrThrow({
      where: {
        projectId: projectAId,
        action: 'ACTUAL_VERIFY',
        outcome: 'DENIED',
        businessCommandId: deniedCommandId,
      },
    });
    expect(denial).toMatchObject({
      progressEntryId: null,
      targetEntityType: 'PROGRESS_ENTRY',
      targetEntityId: entryId,
      errorCode: 'DECISION_AUTHORITY_REVOKED',
    });
  });

  it('17. simultaneous identical submit retries create one business mutation and payload drift conflicts', async () => {
    const token = await login(userSubmitEmail);
    const commandId = randomUUID();
    const payload = {
      commandId,
      entries: [
        {
          boqItemId: boqItemAId,
          installedQuantity: '7.12',
          workDate: '2026-09-01',
          captureMethod: 'FIELD_MEASUREMENT',
        },
      ],
    };
    const [left, right] = await Promise.all([
      request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/field`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send(payload),
      request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/field`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send(payload),
    ]);
    expect([left.status, right.status]).toEqual([201, 201]);
    expect([left.body.replayed, right.body.replayed].sort()).toEqual([
      false,
      true,
    ]);
    expect(await prisma.progressReport.count({ where: { commandId } })).toBe(1);
    expect(
      await prisma.progressEntry.count({
        where: { progressReport: { commandId } },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        ...payload,
        entries: [{ ...payload.entries[0], installedQuantity: '8' }],
      })
      .expect(409);
  });

  it('18. simultaneous verify, accept, and correction retries create exactly one business effect each', async () => {
    const token = await login(userSubmitEmail);
    const boqStructure = await prisma.boqStructure.findFirstOrThrow({
      where: { projectId: projectAId },
    });
    const item = await prisma.boqItem.create({
      data: {
        boqStructureId: boqStructure.id,
        wbsCode: `CONCURRENT-${randomUUID().slice(0, 8)}`,
        name: 'Concurrent transition item',
        quantity: 20,
        unit: 'm3',
      },
    });
    const submitCommandId = randomUUID();
    const submitted = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: submitCommandId,
        entries: [
          {
            boqItemId: item.id,
            installedQuantity: '6',
            workDate: '2026-09-02',
            captureMethod: 'FIELD_MEASUREMENT',
          },
        ],
      })
      .expect(201);
    const entryId = submitted.body.entryIds[0];

    const transition = (
      action: 'verify' | 'accept',
      commandId: string,
      reason: string,
    ) =>
      request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/entries/${entryId}/${action}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({ commandId, reason });

    const verifyCommandId = randomUUID();
    const verifyResponses = await Promise.all([
      transition('verify', verifyCommandId, 'Concurrent verification'),
      transition('verify', verifyCommandId, 'Concurrent verification'),
    ]);
    expect(verifyResponses.map((response) => response.status)).toEqual([
      201, 201,
    ]);
    expect(
      verifyResponses.map((response) => response.body.replayed).sort(),
    ).toEqual([false, true]);

    const acceptCommandId = randomUUID();
    const acceptResponses = await Promise.all([
      transition('accept', acceptCommandId, 'Concurrent acceptance'),
      transition('accept', acceptCommandId, 'Concurrent acceptance'),
    ]);
    expect(acceptResponses.map((response) => response.status)).toEqual([
      201, 201,
    ]);
    expect(
      acceptResponses.map((response) => response.body.replayed).sort(),
    ).toEqual([false, true]);

    const correctionCommandId = randomUUID();
    const correctionPayload = {
      commandId: correctionCommandId,
      installedQuantity: '7',
      workDate: '2026-09-03',
      captureMethod: 'FIELD_OBSERVATION',
      reasonCode: 'MEASUREMENT_UPDATE',
      reasonText: 'Concurrent correction',
    };
    const correctionRequest = () =>
      request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/entries/${entryId}/corrections`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send(correctionPayload);
    const correctionResponses = await Promise.all([
      correctionRequest(),
      correctionRequest(),
    ]);
    expect(correctionResponses.map((response) => response.status)).toEqual([
      201, 201,
    ]);
    expect(
      correctionResponses.map((response) => response.body.replayed).sort(),
    ).toEqual([false, true]);
    const correctionIds = new Set(
      correctionResponses.map((response) => response.body.entryId),
    );
    expect(correctionIds.size).toBe(1);
    expect(
      await prisma.progressEntry.count({
        where: { supersedesEntryId: entryId },
      }),
    ).toBe(1);
    expect(
      await prisma.progressAuditEvent.count({
        where: {
          progressEntryId: entryId,
          action: 'ACTUAL_VERIFIED',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.progressAuditEvent.count({
        where: {
          progressEntryId: entryId,
          action: 'ACTUAL_ACCEPTED',
        },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${entryId}/corrections`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ ...correctionPayload, installedQuantity: '8' })
      .expect(409);
  });

  it('19. Field and Monitoring ignore a later-created historical-baseline entry as current truth', async () => {
    const token = await login(userSubmitEmail);
    const activeBaseline = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
    });
    const historicalBaseline = await prisma.projectBaseline.create({
      data: {
        projectId: projectAId,
        rabDocumentId: activeBaseline.rabDocumentId,
        versionNumber: 0,
        status: 'SUPERSEDED',
        approvedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const historicalReport = await prisma.progressReport.create({
      data: {
        projectId: projectAId,
        baselineId: historicalBaseline.id,
        periodStartDate: new Date('2027-01-01T00:00:00.000Z'),
        periodEndDate: new Date('2027-01-01T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });
    const historicalEntry = await prisma.progressEntry.create({
      data: {
        progressReportId: historicalReport.id,
        boqItemId: boqItemAId,
        installedQuantity: 99,
        workDate: new Date('2027-01-01T00:00:00.000Z'),
        captureMethod: 'LEGACY_IMPORT',
        status: 'LEGACY_UNSPECIFIED',
      },
    });
    const history = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/items/${boqItemAId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(history.body.projectTimeZone).toBe('Asia/Makassar');
    const monitoring = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    const monitored = monitoring.body.items.find(
      (item: any) => item.id === boqItemAId,
    );
    expect(history.body.entries.map((entry: any) => entry.id)).toContain(
      historicalEntry.id,
    );
    expect(history.body.effectiveEntryId).not.toBe(historicalEntry.id);
    expect(history.body.effectiveEntryId).toBe(
      monitored.actual.effectiveRecord.id,
    );
  });

  it('20. workDate is a Project business date while recordedAt remains server-controlled', async () => {
    const token = await login(userSubmitEmail);
    const before = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
    };
    const forgedRecordedAt = '1999-01-01T00:00:00.000Z';

    const created = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        recordedAt: forgedRecordedAt,
        entries: [
          {
            boqItemId: boqItemAId,
            installedQuantity: '1.25',
            workDate: '2000-01-01',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(201);
    const entry = await prisma.progressEntry.findUniqueOrThrow({
      where: { id: created.body.entryIds[0] },
    });
    expect(entry.workDate?.toISOString()).toBe('2000-01-01T00:00:00.000Z');
    expect(entry.createdAt.toISOString()).not.toBe(forgedRecordedAt);
    expect(entry.createdAt.toISOString().slice(0, 10)).not.toBe(
      entry.workDate?.toISOString().slice(0, 10),
    );

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/field`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        entries: [
          {
            boqItemId: boqItemAId,
            installedQuantity: '1.25',
            workDate: '2000-01-01T00:00:00.000Z',
            captureMethod: 'FIELD_OBSERVATION',
          },
        ],
      })
      .expect(400);
    expect({
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
    }).toEqual({
      reports: before.reports + 1,
      entries: before.entries + 1,
    });
  });

  it('21. Project timezone has a governed update path after active baseline without mutating baseline truth', async () => {
    const token = await login(userSubmitEmail);
    await prisma.project.update({
      where: { id: projectAId },
      data: { timeZone: null },
    });
    const baselineBefore = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
      include: { rabDocument: true },
    });
    const eventsBefore = await prisma.projectTimeZoneEvent.count({
      where: { projectId: projectAId },
    });
    const configurationAuditsBefore = await prisma.progressAuditEvent.count({
      where: {
        projectId: projectAId,
        eventType: 'PROJECT_CONFIGURATION',
      },
    });
    const submitRole = await prisma.role.findUniqueOrThrow({
      where: {
        workspaceId_code: {
          workspaceId: workspaceAId,
          code: 'ROLE_PROG_SUBMIT_A',
        },
      },
    });
    await prisma.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId: submitRole.id,
          permissionId: projectSettingsPermissionId,
        },
      },
    });
    const deniedCommandId = randomUUID();
    try {
      await request(app.getHttpServer())
        .patch(`/projects/${projectAId}/time-zone`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({ commandId: deniedCommandId, timeZone: 'Asia/Jayapura' })
        .expect(403);
    } finally {
      await prisma.rolePermission.create({
        data: {
          roleId: submitRole.id,
          permissionId: projectSettingsPermissionId,
        },
      });
    }
    expect(
      await prisma.projectTimeZoneEvent.count({
        where: { projectId: projectAId },
      }),
    ).toBe(eventsBefore);
    const deniedAudit = await prisma.progressAuditEvent.findFirstOrThrow({
      where: {
        projectId: projectAId,
        eventType: 'PROJECT_CONFIGURATION',
        action: 'PROJECT_TIME_ZONE_UPDATE',
        outcome: 'DENIED',
        businessCommandId: deniedCommandId,
      },
    });
    expect(deniedAudit).toMatchObject({
      sourceModule: 'PROJECT_GOVERNANCE',
      targetEntityType: 'PROJECT',
      targetEntityId: projectAId,
      reasonCode: null,
      errorCode: 'TECHNICAL_PERMISSION_DENIED',
      actorType: 'USER',
    });

    const updateCommandId = randomUUID();
    const updated = await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/time-zone`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: updateCommandId,
        timeZone: 'Asia/Jayapura',
        reason: 'Configure Project timezone for MON-03 proof',
      })
      .expect(200);
    expect(updated.body.timeZone).toBe('Asia/Jayapura');
    expect(
      await prisma.projectTimeZoneEvent.count({
        where: { projectId: projectAId },
      }),
    ).toBe(eventsBefore + 1);
    const event = await prisma.projectTimeZoneEvent.findFirstOrThrow({
      where: { projectId: projectAId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(event).toMatchObject({
      projectId: projectAId,
      workspaceId: workspaceAId,
      actorAccountId: submitAccountId,
      previousTimeZone: null,
      nextTimeZone: 'Asia/Jayapura',
      action: 'PROJECT_TIME_ZONE_UPDATED',
      commandId: updateCommandId,
    });
    const successAudit = await prisma.progressAuditEvent.findFirstOrThrow({
      where: {
        projectId: projectAId,
        eventType: 'PROJECT_CONFIGURATION',
        action: 'PROJECT_TIME_ZONE_UPDATED',
        outcome: 'SUCCESS',
        businessCommandId: updateCommandId,
      },
    });
    expect(successAudit).toMatchObject({
      actorType: 'USER',
      sourceModule: 'PROJECT_GOVERNANCE',
      targetEntityType: 'PROJECT_TIME_ZONE_EVENT',
      targetEntityId: event.id,
      reasonCode: null,
      errorCode: null,
    });
    expect(successAudit.recordedAt).toBeInstanceOf(Date);
    expect(successAudit.correlationId).toBeTruthy();
    expect(successAudit.requestId).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/time-zone`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: updateCommandId,
        timeZone: 'Asia/Jayapura',
        reason: 'Configure Project timezone for MON-03 proof',
      })
      .expect(200);
    expect(
      await prisma.projectTimeZoneEvent.count({
        where: { projectId: projectAId },
      }),
    ).toBe(eventsBefore + 1);
    expect(
      await prisma.progressAuditEvent.count({
        where: {
          projectId: projectAId,
          eventType: 'PROJECT_CONFIGURATION',
        },
      }),
    ).toBe(configurationAuditsBefore + 2);
    expect(
      await prisma.projectBaseline.findUniqueOrThrow({
        where: { id: baselineAId },
        include: { rabDocument: true },
      }),
    ).toEqual(baselineBefore);

    const monitoring = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(monitoring.body.projectTimeZone).toBe('Asia/Jayapura');

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/time-zone`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ commandId: randomUUID(), timeZone: 'Invalid/NotAZone' })
      .expect(400);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectAId } }))
        .timeZone,
    ).toBe('Asia/Jayapura');
    expect(
      await prisma.projectTimeZoneEvent.count({
        where: { projectId: projectAId },
      }),
    ).toBe(eventsBefore + 1);

    await expect(
      prisma.projectTimeZoneEvent.update({
        where: { id: event.id },
        data: { reason: 'tampered' },
      }),
    ).rejects.toThrow('PROJECT_TIME_ZONE_HISTORY_APPEND_ONLY');
    await expect(
      prisma.projectTimeZoneEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow('PROJECT_TIME_ZONE_HISTORY_APPEND_ONLY');
  });

  it('MON04 T1 - a single current root can receive explicit durable semantic authority', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T1 single root');
    const entryId = await submitSemanticRoot(token, item.id, '4');
    await transitionSemanticRoot(token, entryId, 'verify');

    const before = await semanticHistory(token, item.id);
    expect(before.semanticVerification).toMatchObject({
      state: 'VALID',
      currentLeaves: [
        {
          id: entryId,
          semanticAuthority: { state: 'NOT_PROVEN', proof: null },
        },
      ],
    });
    expect(before.availableActions.semanticAttestEntryIds).toEqual([entryId]);

    const attested = await attestSemantics(
      token,
      entryId,
      semanticContextDigest(before),
    ).expect(201);
    expect(attested.body as SemanticAttestationResponseBody).toMatchObject({
      entryId,
      semanticAuthority: 'PROVEN',
      replayed: false,
    });
    expect(await successfulSemanticProofCount([entryId])).toBe(1);

    const after = await semanticHistory(token, item.id);
    expect(
      after.semanticVerification.currentLeaves[0].semanticAuthority,
    ).toMatchObject({
      state: 'PROVEN',
      proof: {
        actorDisplayName: userSubmitEmail,
        authorityCode: 'FIELD_PROGRESS_VERIFY',
      },
    });
  });

  it('MON04 T2 - two independent current roots are both present in the attested context', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T2 two roots');
    const rootA = await submitSemanticRoot(token, item.id, '3');
    const rootB = await submitSemanticRoot(token, item.id, '4');
    await transitionSemanticRoot(token, rootA, 'verify');
    await transitionSemanticRoot(token, rootB, 'verify');

    const history = await semanticHistory(token, item.id);
    expect(
      history.semanticVerification.currentLeaves.map((leaf) => leaf.id).sort(),
    ).toEqual([rootA, rootB].sort());

    await attestSemantics(token, rootA, semanticContextDigest(history)).expect(
      201,
    );
    const proof = await prisma.progressAuditEvent.findFirstOrThrow({
      where: {
        progressEntryId: rootA,
        action: 'ACTUAL_SEMANTIC_AUTHORITY_CONFIRMED',
        outcome: 'SUCCESS',
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(
      (proof.metadata as { currentLeafIds: string[] }).currentLeafIds.sort(),
    ).toEqual([rootA, rootB].sort());
  });

  it('MON04 T3 - correction context uses only the current leaf and marks its predecessor historical', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T3 correction');
    const originalId = await submitSemanticRoot(token, item.id, '2');
    await transitionSemanticRoot(token, originalId, 'verify');
    const correction = await request(app.getHttpServer())
      .post(
        `/projects/${projectAId}/progress/entries/${originalId}/corrections`,
      )
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        installedQuantity: '2.5',
        workDate: '2026-08-26',
        captureMethod: 'FIELD_MEASUREMENT',
        reasonCode: 'MEASUREMENT_UPDATE',
        reasonText: 'T3 correction',
      })
      .expect(201);
    const correctionId = (correction.body as EntryResponseBody).entryId;
    await transitionSemanticRoot(token, correctionId, 'verify');

    const history = await semanticHistory(token, item.id);
    expect(history.semanticVerification.currentLeaves).toEqual([
      expect.objectContaining({
        id: correctionId,
        supersedesEntryId: originalId,
      }),
    ]);
    expect(
      history.entries.find((entry) => entry.id === originalId)
        ?.isCurrentLineageLeaf,
    ).toBe(false);
    expect(
      history.entries.find((entry) => entry.id === correctionId)
        ?.isCurrentLineageLeaf,
    ).toBe(true);
  });

  it('MON04 T4 - invalid lineage fails closed while another safe item remains functional', async () => {
    const token = await login(userSubmitEmail);
    const invalidItem = await createSemanticWorkItem('MON04 T4 invalid');
    const rootA = await submitSemanticRoot(token, invalidItem.id, '1');
    const rootB = await submitSemanticRoot(token, invalidItem.id, '2');
    await prisma.progressEntry.update({
      where: { id: rootA },
      data: {
        supersedesEntryId: rootB,
        correctionReasonCode: 'MEASUREMENT_UPDATE',
        correctionReason: 'Hostile cycle fixture A',
      },
    });
    await prisma.progressEntry.update({
      where: { id: rootB },
      data: {
        supersedesEntryId: rootA,
        correctionReasonCode: 'MEASUREMENT_UPDATE',
        correctionReason: 'Hostile cycle fixture B',
      },
    });

    const invalidHistory = await semanticHistory(token, invalidItem.id);
    expect(invalidHistory.semanticVerification).toMatchObject({
      state: 'INVALID_LINEAGE',
      invalidReason: 'CYCLE',
      contextDigest: null,
      currentLeaves: [],
    });
    await attestSemantics(token, rootA, '0'.repeat(64)).expect(409);
    expect(await successfulSemanticProofCount([rootA, rootB])).toBe(0);

    const safeItem = await createSemanticWorkItem('MON04 T4 safe');
    const safeRoot = await submitSemanticRoot(token, safeItem.id, '3');
    await transitionSemanticRoot(token, safeRoot, 'verify');
    const safeHistory = await semanticHistory(token, safeItem.id);
    expect(safeHistory.semanticVerification).toMatchObject({
      state: 'VALID',
      currentLeaves: [expect.objectContaining({ id: safeRoot })],
    });
  });

  it('MON04 T5 - lifecycle verification alone leaves semantic authority NOT_PROVEN', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T5 lifecycle only');
    const entryId = await submitSemanticRoot(token, item.id, '5');
    await transitionSemanticRoot(token, entryId, 'verify');

    const entry = await prisma.progressEntry.findUniqueOrThrow({
      where: { id: entryId },
    });
    const history = await semanticHistory(token, item.id);
    expect(entry.status).toBe('VERIFIED');
    expect(
      history.semanticVerification.currentLeaves[0].semanticAuthority,
    ).toEqual({ state: 'NOT_PROVEN', proof: null });
    expect(await successfulSemanticProofCount([entryId])).toBe(0);
  });

  it('MON04 T6 - an existing ACCEPTED fact receives no invented semantic backfill', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T6 accepted legacy');
    const membership = await prisma.workspaceMembership.findFirstOrThrow({
      where: { accountId: submitAccountId, workspaceId: workspaceAId },
    });
    const report = await prisma.progressReport.create({
      data: {
        projectId: projectAId,
        baselineId: baselineAId,
        periodStartDate: new Date('2026-08-25T00:00:00.000Z'),
        periodEndDate: new Date('2026-08-25T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });
    const legacy = await prisma.progressEntry.create({
      data: {
        progressReportId: report.id,
        boqItemId: item.id,
        installedQuantity: 6,
        status: 'ACCEPTED',
        captureMethod: 'LEGACY_UNSPECIFIED',
        recordedByAccountId: submitAccountId,
        recordedByMembershipId: membership.id,
        workDate: new Date('2026-08-25T00:00:00.000Z'),
      },
    });

    const history = await semanticHistory(token, item.id);
    expect(history.semanticVerification.currentLeaves[0]).toMatchObject({
      id: legacy.id,
      lifecycleStatus: 'ACCEPTED',
      semanticAuthority: { state: 'NOT_PROVEN', proof: null },
    });
    expect(await successfulSemanticProofCount([legacy.id])).toBe(0);
  });

  it('MON04 T7 - a real attestation/new-root race never leaves the old context PROVEN', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T7 stale new root');
    const rootA = await submitSemanticRoot(token, item.id, '1');
    const rootB = await submitSemanticRoot(token, item.id, '2');
    await transitionSemanticRoot(token, rootA, 'verify');
    await transitionSemanticRoot(token, rootB, 'verify');
    const opened = await semanticHistory(token, item.id);

    const [attestation, rootC] = await Promise.all([
      attestSemantics(token, rootA, semanticContextDigest(opened)),
      submitSemanticRoot(token, item.id, '3'),
    ]);

    expect([201, 409]).toContain(attestation.status);
    if (attestation.status === 409) {
      expect((attestation.body as ErrorResponseBody).message).toBe(
        'SEMANTIC_CONTEXT_STALE',
      );
    }

    const finalHistory = await semanticHistory(token, item.id);
    expect(
      finalHistory.semanticVerification.currentLeaves
        .map((leaf) => leaf.id)
        .sort(),
    ).toEqual([rootA, rootB, rootC].sort());
    expect(
      finalHistory.semanticVerification.currentLeaves.find(
        (leaf) => leaf.id === rootA,
      )?.semanticAuthority.state,
    ).toBe(attestation.status === 201 ? 'STALE' : 'NOT_PROVEN');
    expect(await successfulSemanticProofCount([rootA, rootB, rootC])).toBe(
      attestation.status === 201 ? 1 : 0,
    );
  });

  it('MON04 T8 - a real attestation/correction race completes without deadlock or stale PROVEN truth', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T8 stale correction');
    const rootA = await submitSemanticRoot(token, item.id, '1');
    await transitionSemanticRoot(token, rootA, 'verify');
    const opened = await semanticHistory(token, item.id);

    const [attestation, corrected] = await Promise.all([
      attestSemantics(token, rootA, semanticContextDigest(opened)),
      request(app.getHttpServer())
        .post(`/projects/${projectAId}/progress/entries/${rootA}/corrections`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({
          commandId: randomUUID(),
          installedQuantity: '1.25',
          workDate: '2026-08-26',
          captureMethod: 'FIELD_MEASUREMENT',
          reasonCode: 'MEASUREMENT_UPDATE',
          reasonText: 'T8 correction race',
        })
        .expect(201),
    ]);

    expect([201, 409]).toContain(attestation.status);
    if (attestation.status === 409) {
      expect((attestation.body as ErrorResponseBody).message).toBe(
        'SEMANTIC_TARGET_NOT_CURRENT',
      );
    }

    const correctionId = (corrected.body as EntryResponseBody).entryId;
    const finalHistory = await semanticHistory(token, item.id);
    expect(finalHistory.semanticVerification.currentLeaves).toEqual([
      expect.objectContaining({
        id: correctionId,
        supersedesEntryId: rootA,
        semanticAuthority: { state: 'NOT_PROVEN', proof: null },
      }),
    ]);
    expect(
      finalHistory.entries.find((entry) => entry.id === rootA)
        ?.isCurrentLineageLeaf,
    ).toBe(false);
    expect(
      finalHistory.entries.find((entry) => entry.id === correctionId)
        ?.isCurrentLineageLeaf,
    ).toBe(true);
    expect(await successfulSemanticProofCount([rootA, correctionId])).toBe(
      attestation.status === 201 ? 1 : 0,
    );
  });

  it('MON04 T9 - successful proof persists exact append-only machine-readable provenance', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T9 provenance');
    const entryId = await submitSemanticRoot(token, item.id, '9');
    await transitionSemanticRoot(token, entryId, 'verify');
    const history = await semanticHistory(token, item.id);
    const commandId = randomUUID();
    const contextDigest = semanticContextDigest(history);

    await attestSemantics(token, entryId, contextDigest, commandId).expect(201);
    const proof = await prisma.progressAuditEvent.findUniqueOrThrow({
      where: { commandId },
    });
    expect(proof).toMatchObject({
      schemaVersion: 1,
      eventType: 'ACTUAL_PROGRESS',
      outcome: 'SUCCESS',
      workspaceId: workspaceAId,
      projectId: projectAId,
      progressEntryId: entryId,
      actorAccountId: submitAccountId,
      actorType: 'USER',
      action: 'ACTUAL_SEMANTIC_AUTHORITY_CONFIRMED',
      authorityCode: 'FIELD_PROGRESS_VERIFY',
      sourceModule: 'FIELD_PROGRESS',
      targetEntityType: 'PROGRESS_ENTRY',
      targetEntityId: entryId,
      businessCommandId: commandId,
      commandId,
      entityVersionBefore: 1,
      entityVersionAfter: 1,
    });
    expect(proof.occurredAt).toBeInstanceOf(Date);
    expect(proof.recordedAt).toBeInstanceOf(Date);
    expect(proof.commandFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.metadata).toEqual({
      policyVersion: 'MON04_CURRENT_NUMERIC_LAW_V1',
      attestationType: 'DISTINCT_INCREMENT_NON_OVERLAP_CONFIRMED',
      contextVersion: 1,
      activeBaselineId: baselineAId,
      boqItemId: item.id,
      contextDigest,
      currentLeafIds: [entryId],
      explicitConfirmation: true,
    });

    const readback = await semanticHistory(token, item.id);
    expect(
      readback.semanticVerification.currentLeaves[0].semanticAuthority.state,
    ).toBe('PROVEN');
  });

  it('MON04 T11 - foreign tenant and inactive-Baseline facts cannot receive or enter active semantic proof', async () => {
    const token = await login(userSubmitEmail);
    const crossTenantToken = await login(userCrossEmail);
    const item = await createSemanticWorkItem('MON04 T11 scope');
    const entryId = await submitSemanticRoot(token, item.id, '11');
    await transitionSemanticRoot(token, entryId, 'verify');
    const activeContext = await semanticHistory(token, item.id);

    const crossTenant = await attestSemantics(
      crossTenantToken,
      entryId,
      semanticContextDigest(activeContext),
    );
    expect([403, 404]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toContain(entryId);

    const oldStructure = await prisma.boqStructure.create({
      data: {
        projectId: projectAId,
        name: `MON04 old ${randomUUID()}`,
        version: 99,
      },
    });
    const oldItem = await prisma.boqItem.create({
      data: {
        boqStructureId: oldStructure.id,
        wbsCode: `OLD-${randomUUID().slice(0, 8)}`,
        name: 'Inactive Baseline item',
        quantity: 1,
        unit: 'm3',
      },
    });
    const oldRab = await prisma.rabDocument.create({
      data: {
        projectId: projectAId,
        boqStructureId: oldStructure.id,
        name: `MON04 old RAB ${randomUUID()}`,
        version: 99,
        status: 'APPROVED',
      },
    });
    const oldBaseline = await prisma.projectBaseline.create({
      data: {
        projectId: projectAId,
        rabDocumentId: oldRab.id,
        versionNumber: 99,
        status: 'SUPERSEDED',
        approvedAt: new Date(),
      },
    });
    const oldReport = await prisma.progressReport.create({
      data: {
        projectId: projectAId,
        baselineId: oldBaseline.id,
        periodStartDate: new Date('2026-08-25T00:00:00.000Z'),
        periodEndDate: new Date('2026-08-25T00:00:00.000Z'),
        status: 'SUBMITTED',
      },
    });
    const oldEntry = await prisma.progressEntry.create({
      data: {
        progressReportId: oldReport.id,
        boqItemId: oldItem.id,
        installedQuantity: 1,
        status: 'VERIFIED',
        captureMethod: 'LEGACY_UNSPECIFIED',
      },
    });

    const inactive = await attestSemantics(
      token,
      oldEntry.id,
      '0'.repeat(64),
    ).expect(409);
    expect((inactive.body as ErrorResponseBody).message).toBe(
      'SEMANTIC_TARGET_NOT_ACTIVE_BASELINE',
    );
    expect(await successfulSemanticProofCount([entryId, oldEntry.id])).toBe(0);
  });

  it('MON04 T12 - simultaneous identical attestation commands append one proof and replay deterministically', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T12 replay');
    const entryId = await submitSemanticRoot(token, item.id, '12');
    await transitionSemanticRoot(token, entryId, 'verify');
    const history = await semanticHistory(token, item.id);
    const commandId = randomUUID();
    const contextDigest = semanticContextDigest(history);

    const [left, right] = await Promise.all([
      attestSemantics(token, entryId, contextDigest, commandId),
      attestSemantics(token, entryId, contextDigest, commandId),
    ]);
    expect([left.status, right.status]).toEqual([201, 201]);
    expect(
      [
        (left.body as SemanticAttestationResponseBody).replayed,
        (right.body as SemanticAttestationResponseBody).replayed,
      ].sort(),
    ).toEqual([false, true]);
    expect(await successfulSemanticProofCount([entryId])).toBe(1);

    await attestSemantics(token, entryId, 'f'.repeat(64), commandId).expect(
      409,
    );
    expect(await successfulSemanticProofCount([entryId])).toBe(1);
  });

  it('MON04 T13 - SUBMITTED to VERIFIED to ACCEPTED creates no implicit semantic proof', async () => {
    const token = await login(userSubmitEmail);
    const item = await createSemanticWorkItem('MON04 T13 no implicit proof');
    const entryId = await submitSemanticRoot(token, item.id, '13');
    await transitionSemanticRoot(token, entryId, 'verify');
    await transitionSemanticRoot(token, entryId, 'accept');

    const entry = await prisma.progressEntry.findUniqueOrThrow({
      where: { id: entryId },
    });
    const history = await semanticHistory(token, item.id);
    expect(entry.status).toBe('ACCEPTED');
    expect(
      history.semanticVerification.currentLeaves[0].semanticAuthority,
    ).toEqual({ state: 'NOT_PROVEN', proof: null });
    expect(await successfulSemanticProofCount([entryId])).toBe(0);
  });

  it('22. history projection is project-assignment and tenant isolated without raw audit internals', async () => {
    const assignedToken = await login(userSubmitEmail);
    const allowed = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/items/${boqItemAId}/history`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(JSON.stringify(allowed.body)).not.toContain('commandFingerprint');
    expect(JSON.stringify(allowed.body)).not.toContain('actorMembershipId');

    const nonAssignedToken = await login(userNoAccessEmail);
    await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/items/${boqItemAId}/history`)
      .set('Authorization', `Bearer ${nonAssignedToken}`)
      .set('x-workspace-id', workspaceAId)
      .expect(403);

    const crossTenantToken = await login(userCrossEmail);
    const crossTenant = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/items/${boqItemAId}/history`)
      .set('Authorization', `Bearer ${crossTenantToken}`)
      .set('x-workspace-id', workspaceBId);
    expect([403, 404]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toContain(boqItemAId);
  });
  it('MON04 LAW1 consumer - Monitoring uses canonical quantity truth', async () => {
    const token = await login(userSubmitEmail);

    const attestCurrentContext = async (
      boqItemId: string,
      entryIds: string[],
    ) => {
      const history = await semanticHistory(token, boqItemId);
      const contextDigest = semanticContextDigest(history);

      for (const entryId of entryIds) {
        await attestSemantics(token, entryId, contextDigest).expect(201);
      }
    };

    // A. No Actual -> NOT_YET_RECORDED.
    const itemA = await createSemanticWorkItem('LAW1 consumer A no actual');

    // B. One VERIFIED + semantic PROVEN quantity 4 -> COMPLETE(4).
    const itemB = await createSemanticWorkItem('LAW1 consumer B single proven');
    const rootB = await submitSemanticRoot(token, itemB.id, '4');
    await transitionSemanticRoot(token, rootB, 'verify');
    await attestCurrentContext(itemB.id, [rootB]);

    // C. Two independent VERIFIED + PROVEN roots 3 + 4 -> COMPLETE(7).
    const itemC = await createSemanticWorkItem(
      'LAW1 consumer C additive roots',
    );
    const rootC1 = await submitSemanticRoot(token, itemC.id, '3');
    const rootC2 = await submitSemanticRoot(token, itemC.id, '4');
    await transitionSemanticRoot(token, rootC1, 'verify');
    await transitionSemanticRoot(token, rootC2, 'verify');
    await attestCurrentContext(itemC.id, [rootC1, rootC2]);

    // D. VERIFIED + PROVEN 3 plus distinct SUBMITTED 4
    // -> INCOMPLETE with known subtotal 3.
    const itemD = await createSemanticWorkItem('LAW1 consumer D incomplete');
    const rootD1 = await submitSemanticRoot(token, itemD.id, '3');
    await submitSemanticRoot(token, itemD.id, '4');
    await transitionSemanticRoot(token, rootD1, 'verify');
    await attestCurrentContext(itemD.id, [rootD1]);

    // E. Lifecycle eligible but semantic proof absent
    // -> SEMANTICS_UNPROVEN.
    const itemE = await createSemanticWorkItem(
      'LAW1 consumer E semantics unproven',
    );
    const rootE = await submitSemanticRoot(token, itemE.id, '4');
    await transitionSemanticRoot(token, rootE, 'verify');

    // F. A previously eligible/proven predecessor must never reappear
    // after an ineligible correction successor becomes current.
    const itemF = await createSemanticWorkItem('LAW1 consumer F no fallback');
    const rootF = await submitSemanticRoot(token, itemF.id, '4');
    await transitionSemanticRoot(token, rootF, 'verify');
    await attestCurrentContext(itemF.id, [rootF]);

    await request(app.getHttpServer())
      .post(`/projects/${projectAId}/progress/entries/${rootF}/corrections`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({
        commandId: randomUUID(),
        installedQuantity: '5',
        workDate: '2026-08-26',
        captureMethod: 'FIELD_MEASUREMENT',
        reasonCode: 'MEASUREMENT_UPDATE',
        reasonText: 'LAW1 consumer no-fallback correction',
      })
      .expect(201);

    // G. Proven numeric zero is an official COMPLETE(0),
    // not NOT_YET_RECORDED.
    const itemG = await createSemanticWorkItem('LAW1 consumer G proven zero');
    const rootG = await submitSemanticRoot(token, itemG.id, '0');
    await transitionSemanticRoot(token, rootG, 'verify');
    await attestCurrentContext(itemG.id, [rootG]);

    const monitoring = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    const monitoringBody = monitoring.body as unknown as Law1MonitoringBody;

    const resultFor = (boqItemId: string) =>
      monitoringBody.items.find((item) => item.id === boqItemId)
        ?.currentOfficialQuantity;
    expect(resultFor(itemA.id)).toEqual({
      state: 'NOT_YET_RECORDED',
    });

    expect(resultFor(itemB.id)).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '4',
    });

    expect(resultFor(itemC.id)).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '7',
    });

    expect(resultFor(itemD.id)).toEqual({
      state: 'INCOMPLETE',
      knownEligibleQuantitySubtotal: '3',
    });

    expect(resultFor(itemE.id)).toEqual({
      state: 'SEMANTICS_UNPROVEN',
    });

    expect(resultFor(itemF.id)).toEqual({
      state: 'NO_ELIGIBLE_CURRENT_FACT',
    });

    expect(resultFor(itemG.id)).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '0',
    });
  });

  it('MON04 LAW2 consumer - Monitoring exposes canonical WORK_ITEM physical progress without erasing LAW1 truth', async () => {
    const token = await login(userSubmitEmail);

    /*
     * Reuse the established MON04 acceptance-fixture pattern:
     * create test-only WORK_ITEM rows in the same canonical Active-Baseline
     * BOQ structure. No production planning write path is changed here.
     *
     * Crucially, this test NEVER updates an existing WORK_ITEM denominator
     * after Actual is created. Every LAW2 test item is born with the planned
     * quantity/unit that the consumer must read.
     */
    const baseline = await prisma.projectBaseline.findUniqueOrThrow({
      where: { id: baselineAId },
      include: { rabDocument: true },
    });

    const createLaw2WorkItem = async (
      name: string,
      plannedQuantity: number,
      unit: string,
      lineTotal: number | null = plannedQuantity,
    ) =>
      prisma.boqItem.create({
        data: {
          boqStructureId: baseline.rabDocument.boqStructureId,
          wbsCode: `LAW2-${randomUUID().slice(0, 8)}`,
          name,
          itemType: 'WORK_ITEM',
          quantity: plannedQuantity,
          unit,
          unitPrice: lineTotal === null ? null : 1,
          lineTotal,
          priceOrigin: lineTotal === null ? null : 'MANUAL_CLIENT',
        },
      });

    const attestCurrentContext = async (
      boqItemId: string,
      entryIds: string[],
    ) => {
      const history = await semanticHistory(token, boqItemId);
      const contextDigest = semanticContextDigest(history);

      for (const entryId of entryIds) {
        await attestSemantics(token, entryId, contextDigest).expect(201);
      }
    };

    const proveCompleteQuantity = async (
      boqItemId: string,
      installedQuantity: string,
    ) => {
      const entryId = await submitSemanticRoot(
        token,
        boqItemId,
        installedQuantity,
      );

      await transitionSemanticRoot(token, entryId, 'verify');
      await attestCurrentContext(boqItemId, [entryId]);

      return entryId;
    };

    // A. No Actual is not numeric zero.
    const noActual = await createLaw2WorkItem(
      'LAW2 consumer A no actual',
      8,
      'm3',
      8,
    );

    // B. Proven numeric zero -> official 0%, not unavailable.
    const provenZero = await createLaw2WorkItem(
      'LAW2 consumer B proven zero',
      8,
      'm3',
      8,
    );
    await proveCompleteQuantity(provenZero.id, '0');

    // C. COMPLETE(4) / Planned(8) -> RAW 50 / BOUNDED 50.
    const halfComplete = await createLaw2WorkItem(
      'LAW2 consumer C fifty percent',
      8,
      'm3',
      8,
    );
    await proveCompleteQuantity(halfComplete.id, '4');

    // D. Actual > Planned preserves RAW truth above 100.
    const overPlanned = await createLaw2WorkItem(
      'LAW2 consumer D over planned',
      8,
      'm3',
      8,
    );
    await proveCompleteQuantity(overPlanned.id, '12');

    // E. Planned zero blocks division but MUST NOT erase COMPLETE(4).
    const zeroDenominator = await createLaw2WorkItem(
      'LAW2 consumer E zero denominator',
      0,
      'm3',
      0,
    );
    await proveCompleteQuantity(zeroDenominator.id, '4');

    // F. Blank contextual unit blocks LAW2 numeric progress but MUST NOT
    // erase the canonical LAW1 quantity.
    const blankUnit = await createLaw2WorkItem(
      'LAW2 consumer F blank unit',
      8,
      '',
      8,
    );
    await proveCompleteQuantity(blankUnit.id, '4');

    // G. Known subtotal is diagnostic only, never official COMPLETE.
    const incomplete = await createLaw2WorkItem(
      'LAW2 consumer G incomplete subtotal',
      20,
      'm3',
      20,
    );
    const incompleteProvenRoot = await submitSemanticRoot(
      token,
      incomplete.id,
      '3',
    );
    await submitSemanticRoot(token, incomplete.id, '4');
    await transitionSemanticRoot(token, incompleteProvenRoot, 'verify');
    await attestCurrentContext(incomplete.id, [incompleteProvenRoot]);

    // H. H2-A1 independence:
    // lineTotal intentionally unavailable, therefore item weight is
    // unavailable, while LAW2 quantity/planned/unit truth remains sufficient.
    const weightIndependent = await createLaw2WorkItem(
      'LAW2 consumer H H2-A1 independent',
      8,
      'm3',
      null,
    );
    await proveCompleteQuantity(weightIndependent.id, '4');

    /*
     * Snapshot AFTER all test setup and BEFORE the Monitoring GET.
     * The GET itself must remain read-only.
     */
    const domainBeforeRead = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
      deviations: await prisma.deviationSignal.count({
        where: { projectId: projectAId },
      }),
    };

    const monitoring = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/progress/monitoring`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    const domainAfterRead = {
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
      deviations: await prisma.deviationSignal.count({
        where: { projectId: projectAId },
      }),
    };

    expect(domainAfterRead).toEqual(domainBeforeRead);

    const body = monitoring.body as unknown as Law1MonitoringBody;

    const rowFor = (boqItemId: string): Law1MonitoringItem => {
      const row = body.items.find((item) => item.id === boqItemId);

      if (!row) {
        throw new Error(`Expected Monitoring row ${boqItemId}`);
      }

      return row;
    };

    /*
     * Structural rows never acquire official WORK_ITEM progress.
     */
    expect(rowFor(boqFolderAId).currentOfficialQuantity).toBeNull();
    expect(rowFor(boqFolderAId).currentOfficialItemProgress).toBeNull();

    /*
     * A. Missing fact remains missing — never coerced to numeric zero.
     */
    expect(rowFor(noActual.id).currentOfficialQuantity).toEqual({
      state: 'NOT_YET_RECORDED',
    });
    expect(rowFor(noActual.id).currentOfficialItemProgress).toEqual({
      state: 'NOT_YET_RECORDED',
    });

    /*
     * B. Proven numeric zero is true official 0%.
     */
    expect(rowFor(provenZero.id).currentOfficialQuantity).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '0',
    });
    expect(rowFor(provenZero.id).currentOfficialItemProgress).toEqual({
      state: 'COMPLETE',
      rawPhysicalProgressPercent: '0',
      boundedContributionProgressPercent: '0',
    });

    /*
     * C. Nominal official result.
     */
    expect(rowFor(halfComplete.id).currentOfficialQuantity).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '4',
    });
    expect(rowFor(halfComplete.id).currentOfficialItemProgress).toEqual({
      state: 'COMPLETE',
      rawPhysicalProgressPercent: '50',
      boundedContributionProgressPercent: '50',
    });

    /*
     * D. RAW truth is not capped; only contribution is bounded.
     */
    expect(rowFor(overPlanned.id).currentOfficialQuantity).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '12',
    });
    expect(rowFor(overPlanned.id).currentOfficialItemProgress).toEqual({
      state: 'COMPLETE',
      rawPhysicalProgressPercent: '150',
      boundedContributionProgressPercent: '100',
    });

    /*
     * E. Downstream denominator failure MUST preserve LAW1 COMPLETE(4).
     */
    expect(rowFor(zeroDenominator.id).currentOfficialQuantity).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '4',
    });
    expect(rowFor(zeroDenominator.id).currentOfficialItemProgress).toEqual({
      state: 'UNAVAILABLE',
      reason: 'PLANNED_QUANTITY_ZERO',
    });

    /*
     * F. Downstream unit-context failure MUST also preserve LAW1 COMPLETE(4).
     */
    expect(rowFor(blankUnit.id).currentOfficialQuantity).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '4',
    });
    expect(rowFor(blankUnit.id).currentOfficialItemProgress).toEqual({
      state: 'UNAVAILABLE',
      reason: 'SAME_WORK_ITEM_UNIT_CONTEXT_UNAVAILABLE',
    });

    /*
     * G. INCOMPLETE subtotal remains diagnostic and is never promoted
     * to official COMPLETE progress.
     */
    expect(rowFor(incomplete.id).currentOfficialQuantity).toEqual({
      state: 'INCOMPLETE',
      knownEligibleQuantitySubtotal: '3',
    });
    expect(rowFor(incomplete.id).currentOfficialItemProgress).toEqual({
      state: 'INCOMPLETE',
      knownProgressSubtotalPercent: '15',
    });

    /*
     * H. H2-A1 independence:
     * item weight is unavailable because lineTotal is unavailable,
     * while LAW2 remains officially COMPLETE from its own lawful inputs.
     */
    expect(rowFor(weightIndependent.id).weight.own).toEqual({
      state: 'UNAVAILABLE',
      percentage: null,
      reason: 'ITEM_VALUE_UNAVAILABLE',
    });
    expect(rowFor(weightIndependent.id).currentOfficialQuantity).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: '4',
    });
    expect(rowFor(weightIndependent.id).currentOfficialItemProgress).toEqual({
      state: 'COMPLETE',
      rawPhysicalProgressPercent: '50',
      boundedContributionProgressPercent: '50',
    });
  });

  it('MON04 LAW3 consumer - Monitoring aggregates WORK_ITEM-only H2-A1 weights over the same LAW2 truth', async () => {
    const token = await login(userSubmitEmail);

    /*
     * This final suite case reuses Project A, its authorized actor, semantic
     * helpers, route, and suite-owned cleanup. A dedicated Active Baseline
     * isolates LAW3 arithmetic from the preceding LAW1/LAW2 matrices.
     */
    await prisma.projectBaseline.update({
      where: { id: baselineAId },
      data: { status: 'DRAFT' },
    });
    const structure = await prisma.boqStructure.create({
      data: {
        projectId: projectAId,
        name: 'MON04 LAW3 canonical E2E BOQ',
        version: 2,
      },
    });
    const folder = await prisma.boqItem.create({
      data: {
        boqStructureId: structure.id,
        wbsCode: 'LAW3-F',
        name: 'LAW3 structural folder',
        itemType: 'FOLDER',
        quantity: 0,
        unit: '',
        sortOrder: 0,
      },
    });
    const createLaw3WorkItem = async (params: {
      name: string;
      wbsCode: string;
      lineTotal: number;
      sortOrder: number;
      parentId?: string;
    }) =>
      prisma.boqItem.create({
        data: {
          boqStructureId: structure.id,
          parentId: params.parentId,
          wbsCode: params.wbsCode,
          name: params.name,
          itemType: 'WORK_ITEM',
          quantity: 10,
          unit: 'm3',
          unitPrice: 1,
          lineTotal: params.lineTotal,
          priceOrigin: 'MANUAL_CLIENT',
          sortOrder: params.sortOrder,
        },
      });
    const itemA = await createLaw3WorkItem({
      name: 'LAW3 child A over progress',
      wbsCode: 'LAW3-F.1',
      lineTotal: 300,
      sortOrder: 1,
      parentId: folder.id,
    });
    const itemB = await createLaw3WorkItem({
      name: 'LAW3 child B half progress',
      wbsCode: 'LAW3-F.2',
      lineTotal: 300,
      sortOrder: 2,
      parentId: folder.id,
    });
    const provenZero = await createLaw3WorkItem({
      name: 'LAW3 positive weight proven zero',
      wbsCode: 'LAW3-ZP',
      lineTotal: 400,
      sortOrder: 3,
    });
    const zeroWeightUnresolved = await createLaw3WorkItem({
      name: 'LAW3 exact zero weight unresolved',
      wbsCode: 'LAW3-ZW',
      lineTotal: 0,
      sortOrder: 4,
    });
    const rab = await prisma.rabDocument.create({
      data: {
        projectId: projectAId,
        boqStructureId: structure.id,
        name: 'MON04 LAW3 canonical E2E RAB',
        version: 2,
        totalBaseCost: 1000,
        totalFinalCost: 1000,
        status: 'APPROVED',
      },
    });
    const law3Baseline = await prisma.projectBaseline.create({
      data: {
        projectId: projectAId,
        rabDocumentId: rab.id,
        versionNumber: 2,
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });

    const proveCompleteQuantity = async (
      boqItemId: string,
      installedQuantity: string,
    ) => {
      const entryId = await submitSemanticRoot(
        token,
        boqItemId,
        installedQuantity,
        '2026-08-29',
      );
      await transitionSemanticRoot(token, entryId, 'verify');
      const history = await semanticHistory(token, boqItemId);
      await attestSemantics(
        token,
        entryId,
        semanticContextDigest(history),
      ).expect(201);
    };

    await proveCompleteQuantity(itemA.id, '15');
    await proveCompleteQuantity(itemB.id, '5');
    await proveCompleteQuantity(provenZero.id, '0');

    const getMonitoring = async () =>
      request(app.getHttpServer())
        .get(`/projects/${projectAId}/progress/monitoring`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
    const readFootprint = async () => ({
      reports: await prisma.progressReport.count({
        where: { projectId: projectAId },
      }),
      entries: await prisma.progressEntry.count({
        where: { progressReport: { projectId: projectAId } },
      }),
      audits: await prisma.progressAuditEvent.count({
        where: { projectId: projectAId },
      }),
      deviations: await prisma.deviationSignal.count({
        where: { projectId: projectAId },
      }),
      activeBaseline: await prisma.projectBaseline.count({
        where: { projectId: projectAId, status: 'ACTIVE' },
      }),
      boqItems: await prisma.boqItem.count({
        where: { boqStructureId: structure.id },
      }),
    });

    const footprintBefore = await readFootprint();
    const completeRead = await getMonitoring();
    const repeatedCompleteRead = await getMonitoring();
    const footprintAfter = await readFootprint();
    const completeBody = completeRead.body as unknown as Law1MonitoringBody;
    const repeatedCompleteBody =
      repeatedCompleteRead.body as unknown as Law1MonitoringBody;
    const completeRowFor = (boqItemId: string): Law1MonitoringItem => {
      const row = completeBody.items.find((item) => item.id === boqItemId);
      if (!row) throw new Error(`Expected LAW3 Monitoring row ${boqItemId}`);
      return row;
    };

    expect(footprintAfter).toEqual(footprintBefore);
    expect(
      repeatedCompleteBody.currentOfficialRabWeightedPhysicalProgress,
    ).toEqual(completeBody.currentOfficialRabWeightedPhysicalProgress);
    expect(completeBody.currentOfficialRabWeightedPhysicalProgress).toEqual({
      state: 'COMPLETE',
      currentOfficialRabWeightedPhysicalProgressPercent: '45',
    });
    expect(completeRowFor(folder.id)).toMatchObject({
      currentOfficialQuantity: null,
      currentOfficialItemProgress: null,
      weight: {
        own: { state: 'NOT_APPLICABLE', percentage: null },
      },
    });
    expect(completeRowFor(folder.id).weight.subtree).toEqual({
      state: 'AVAILABLE',
      percentage: '60',
      reason: null,
    });
    expect(completeRowFor(itemA.id)).toMatchObject({
      currentOfficialQuantity: {
        state: 'COMPLETE',
        currentOfficialQuantity: '15',
      },
      currentOfficialItemProgress: {
        state: 'COMPLETE',
        rawPhysicalProgressPercent: '150',
        boundedContributionProgressPercent: '100',
      },
      weight: { own: { state: 'AVAILABLE', percentage: '30' } },
    });
    expect(completeRowFor(itemB.id)).toMatchObject({
      currentOfficialItemProgress: {
        state: 'COMPLETE',
        rawPhysicalProgressPercent: '50',
        boundedContributionProgressPercent: '50',
      },
      weight: { own: { state: 'AVAILABLE', percentage: '30' } },
    });
    expect(completeRowFor(provenZero.id)).toMatchObject({
      currentOfficialQuantity: {
        state: 'COMPLETE',
        currentOfficialQuantity: '0',
      },
      currentOfficialItemProgress: {
        state: 'COMPLETE',
        rawPhysicalProgressPercent: '0',
        boundedContributionProgressPercent: '0',
      },
      weight: { own: { state: 'AVAILABLE', percentage: '40' } },
    });
    expect(completeRowFor(zeroWeightUnresolved.id)).toMatchObject({
      currentOfficialQuantity: { state: 'NOT_YET_RECORDED' },
      currentOfficialItemProgress: { state: 'NOT_YET_RECORDED' },
      weight: { own: { state: 'AVAILABLE', percentage: '0' } },
    });

    /* Positive unresolved physical truth keeps the subtotal diagnostic. */
    const positiveWeightUnresolved = await createLaw3WorkItem({
      name: 'LAW3 positive weight unresolved',
      wbsCode: 'LAW3-U',
      lineTotal: 200,
      sortOrder: 5,
    });
    await prisma.rabDocument.update({
      where: { id: rab.id },
      data: { totalBaseCost: 1200, totalFinalCost: 1200 },
    });
    const incompleteRead = await getMonitoring();
    const incompleteBody = incompleteRead.body as unknown as Law1MonitoringBody;

    expect(incompleteBody.weight).toEqual({
      completeness: 'COMPLETE',
      reason: null,
      basis: 'ACTIVE_BASELINE_RAB_TOTAL_BASE_COST',
      denominator: { state: 'AVAILABLE', value: '1200.00' },
      eligibleWorkItemCount: 5,
      weightedWorkItemCount: 5,
      unavailableWorkItemCount: 0,
    });
    expect(incompleteBody.currentOfficialRabWeightedPhysicalProgress).toEqual({
      state: 'INCOMPLETE',
      knownWeightedContributionSubtotalPercent: '37.5',
    });
    expect(
      incompleteBody.currentOfficialRabWeightedPhysicalProgress,
    ).not.toHaveProperty('currentOfficialRabWeightedPhysicalProgressPercent');
    expect(
      incompleteBody.items.find(
        (item) => item.id === positiveWeightUnresolved.id,
      )?.currentOfficialItemProgress,
    ).toEqual({ state: 'NOT_YET_RECORDED' });

    /* Missing weight is coverage-incomplete, never an assumed zero weight. */
    await prisma.boqItem.update({
      where: { id: positiveWeightUnresolved.id },
      data: { unitPrice: null, lineTotal: null, priceOrigin: null },
    });
    await prisma.rabDocument.update({
      where: { id: rab.id },
      data: { totalBaseCost: 1000, totalFinalCost: 1000 },
    });
    const coverageRead = await getMonitoring();
    const coverageBody = coverageRead.body as unknown as Law1MonitoringBody;
    const unavailableWeightRow = coverageBody.items.find(
      (item) => item.id === positiveWeightUnresolved.id,
    );

    expect(coverageBody.weight).toMatchObject({
      completeness: 'INCOMPLETE',
      reason: 'INCOMPLETE_BASELINE_VALUE_COVERAGE',
    });
    expect(unavailableWeightRow?.weight.own).toEqual({
      state: 'UNAVAILABLE',
      percentage: null,
      reason: 'ITEM_VALUE_UNAVAILABLE',
    });
    expect(coverageBody.currentOfficialRabWeightedPhysicalProgress).toEqual({
      state: 'INCOMPLETE',
      knownWeightedContributionSubtotalPercent: '45',
    });

    /* Global H2-A1 unavailability blocks LAW3 but preserves LAW1/LAW2 rows. */
    await prisma.rabDocument.update({
      where: { id: rab.id },
      data: { totalBaseCost: null },
    });
    const unavailableRead = await getMonitoring();
    const unavailableBody =
      unavailableRead.body as unknown as Law1MonitoringBody;
    const unavailableItemA = unavailableBody.items.find(
      (item) => item.id === itemA.id,
    );

    expect(unavailableBody.weight).toMatchObject({
      completeness: 'UNAVAILABLE',
      reason: 'BASELINE_VALUE_UNAVAILABLE',
    });
    expect(unavailableBody.currentOfficialRabWeightedPhysicalProgress).toEqual({
      state: 'UNAVAILABLE',
      reason: 'BASELINE_VALUE_UNAVAILABLE',
    });
    expect(unavailableItemA).toMatchObject({
      currentOfficialQuantity: {
        state: 'COMPLETE',
        currentOfficialQuantity: '15',
      },
      currentOfficialItemProgress: {
        state: 'COMPLETE',
        rawPhysicalProgressPercent: '150',
        boundedContributionProgressPercent: '100',
      },
    });
    expect(law3Baseline.status).toBe('ACTIVE');
  });
});

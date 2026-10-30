import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

describe('Project intake context security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let workspaceAId: string;
  let workspaceBId: string;
  let projectAId: string;
  let lockedProjectId: string;
  let projectBId: string;
  let regionCountryId: string;
  let regionOldId: string;
  let regionNewId: string;

  const emails = {
    activeCreator: 'p7c.active.creator@test.local',
    priceManager: 'p7c.price.manager@test.local',
    viewOnly: 'p7c.view.only@test.local',
    noAssignment: 'p7c.no.assignment@test.local',
    inactive: 'p7c.inactive@test.local',
    crossTenant: 'p7c.cross@test.local',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

    const [projectView, projectCreate, settingsManage] = await Promise.all([
      prisma.permission.findUniqueOrThrow({
        where: { code: 'PROJECT_VIEW' },
      }),
      prisma.permission.findUniqueOrThrow({
        where: { code: 'PROJECT_CREATE' },
      }),
      prisma.permission.findUniqueOrThrow({
        where: { code: 'PROJECT_SETTINGS_MANAGE' },
      }),
    ]);

    const orgA = await prisma.organization.create({ data: { name: 'P7C Intake Org A', type: 'COMPANY' } });
    const orgB = await prisma.organization.create({ data: { name: 'P7C Intake Org B', type: 'COMPANY' } });
    const workspaceA = await prisma.workspace.create({ data: { name: 'P7C Intake WS A', organizationId: orgA.id } });
    const workspaceB = await prisma.workspace.create({ data: { name: 'P7C Intake WS B', organizationId: orgB.id } });
    workspaceAId = workspaceA.id;
    workspaceBId = workspaceB.id;

    const roleCreateA = await prisma.role.create({
      data: {
        name: 'P7C Intake Creator A',
        code: 'P7C_INTAKE_CREATE_A',
        workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: projectView.id }, { permissionId: projectCreate.id }] },
      },
    });
    const rolePriceManagerA = await prisma.role.create({
      data: {
        name: 'F03A Price Preference Manager',
        code: 'P7C_PRICE_MANAGER_A',
        workspaceId: workspaceAId,
        rolePermissions: { create: [
          { permissionId: projectView.id },
          { permissionId: projectCreate.id },
          { permissionId: settingsManage.id },
        ] },
      },
    });
    const roleViewA = await prisma.role.create({
      data: {
        name: 'P7C Intake Viewer A',
        code: 'P7C_INTAKE_VIEW_A',
        workspaceId: workspaceAId,
        rolePermissions: { create: [{ permissionId: projectView.id }] },
      },
    });
    const roleCreateB = await prisma.role.create({
      data: {
        name: 'P7C Intake Creator B',
        code: 'P7C_INTAKE_CREATE_B',
        workspaceId: workspaceBId,
        rolePermissions: { create: [{ permissionId: projectView.id }, { permissionId: projectCreate.id }] },
      },
    });

    const [projectA, lockedProject, projectB] = await Promise.all([
      prisma.project.create({
        data: { name: 'P7C Intake Project A', code: 'P7C-INTAKE-A', workspaceId: workspaceAId, organizationId: orgA.id },
      }),
      prisma.project.create({
        data: { name: 'P7C Intake Locked Project', code: 'P7C-INTAKE-LOCKED', workspaceId: workspaceAId, organizationId: orgA.id },
      }),
      prisma.project.create({
        data: { name: 'P7C Intake Project B', code: 'P7C-INTAKE-B', workspaceId: workspaceBId, organizationId: orgB.id },
      }),
    ]);
    projectAId = projectA.id;
    lockedProjectId = lockedProject.id;
    projectBId = projectB.id;

    // RAB-37: isolated canonical Region lineage fixture, no production data.
    const country = await prisma.region.create({
      data: { code: 'P7C-REG-COUNTRY', name: 'P7C Test Country', administrativeLevel: 'COUNTRY', isActive: true },
    });
    const oldRegion = await prisma.region.create({
      data: { code: 'P7C-REG-OLD', name: 'P7C Test Province', parentId: country.id, administrativeLevel: 'PROVINCE', isActive: true },
    });
    const newRegion = await prisma.region.create({
      data: { code: 'P7C-REG-NEW', name: 'P7C Test City', parentId: oldRegion.id, administrativeLevel: 'REGENCY_CITY', isActive: true },
    });
    regionCountryId = country.id;
    regionOldId = oldRegion.id;
    regionNewId = newRegion.id;
    await prisma.projectRegionSelection.create({ data: { projectId: projectAId, regionId: regionOldId } });

    async function createAccount(email: string, workspaceId: string, roleId: string, status: 'ACTIVE' | 'INACTIVE', projectId?: string) {
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: email, status: 'ACTIVE' },
      });
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId,
          status,
          membershipRoles: { create: [{ roleId }] },
        },
      });
      await prisma.user.create({
        data: { workspaceMembershipId: membership.id, workspaceId, fullName: email, status: 'ACTIVE' },
      });
      if (projectId) {
        await prisma.projectAssignment.create({
          data: {
            workspaceMembershipId: membership.id,
            projectId,
            roleInProject: 'MEMBER',
            isPrimaryAssignment: true,
            status: 'ASSIGNED',
          },
        });
      }
      return membership.id;
    }

    const activeMembershipId = await createAccount(emails.activeCreator, workspaceAId, roleCreateA.id, 'ACTIVE', projectAId);
    await prisma.projectAssignment.create({
      data: {
        workspaceMembershipId: activeMembershipId,
        projectId: lockedProjectId,
        roleInProject: 'MEMBER',
        isPrimaryAssignment: false,
        status: 'ASSIGNED',
      },
    });
    const priceManagerMembershipId = await createAccount(
      emails.priceManager, workspaceAId, rolePriceManagerA.id, 'ACTIVE', projectAId,
    );
    await prisma.projectAssignment.create({
      data: {
        workspaceMembershipId: priceManagerMembershipId,
        projectId: lockedProjectId,
        roleInProject: 'MEMBER',
        isPrimaryAssignment: false,
        status: 'ASSIGNED',
      },
    });
    await createAccount(emails.viewOnly, workspaceAId, roleViewA.id, 'ACTIVE', projectAId);
    await createAccount(emails.noAssignment, workspaceAId, roleCreateA.id, 'ACTIVE');
    await createAccount(emails.inactive, workspaceAId, roleCreateA.id, 'INACTIVE', projectAId);
    await createAccount(emails.crossTenant, workspaceBId, roleCreateB.id, 'ACTIVE', projectBId);

    const structure = await prisma.boqStructure.create({
      data: { projectId: lockedProjectId, name: 'Locked BOQ', version: 1, status: 'APPROVED' },
    });
    const rab = await prisma.rabDocument.create({
      data: {
        projectId: lockedProjectId,
        boqStructureId: structure.id,
        name: 'Locked RAB',
        version: 1,
        totalBaseCost: 1,
        totalFinalCost: 1,
        status: 'APPROVED',
      },
    });
    await prisma.projectBaseline.create({
      data: {
        projectId: lockedProjectId,
        rabDocumentId: rab.id,
        versionNumber: 1,
        status: 'ACTIVE',
        approvedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    const accounts = await prisma.account.findMany({ where: { email: { in: Object.values(emails) } } });
    const accountIds = accounts.map((account) => account.id);
    const memberships = await prisma.workspaceMembership.findMany({ where: { accountId: { in: accountIds } } });
    const membershipIds = memberships.map((membership) => membership.id);
    const projectIds = [projectAId, lockedProjectId, projectBId].filter(Boolean);

    await prisma.projectBaseline.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.rabDocument.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.boqItem.deleteMany({ where: { boqStructure: { projectId: { in: projectIds } } } });
    await prisma.boqStructure.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.projectAssignment.deleteMany({ where: { OR: [{ workspaceMembershipId: { in: membershipIds } }, { projectId: { in: projectIds } }] } });
    await prisma.user.deleteMany({ where: { workspaceMembershipId: { in: membershipIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.role.deleteMany({ where: { code: { in: ['P7C_INTAKE_CREATE_A', 'P7C_INTAKE_VIEW_A', 'P7C_INTAKE_CREATE_B', 'P7C_PRICE_MANAGER_A'] } } });
    await prisma.projectRegionSelection.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.region.deleteMany({ where: { id: regionNewId } });
    await prisma.region.deleteMany({ where: { id: regionOldId } });
    await prisma.region.deleteMany({ where: { id: regionCountryId } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId].filter(Boolean) } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['P7C Intake Org A', 'P7C Intake Org B'] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return response.body.access_token;
  };

  it('F03A: project-managed intent is permissioned, CAS-locked, stored and reversible without auto-price selection', async () => {
    let token = await login(emails.activeCreator);
    const url = `/projects/${projectAId}/intake-context`;
    const req = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).patch(url)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send(body);
    const initial = await prisma.project.findUniqueOrThrow({ where: { id: projectAId } });
    expect(initial.priceSelectionPreferenceMode).toBeNull();
    expect(initial.priceSelectionPreferencePolicyVersion).toBeNull();

    // PROJECT_CREATE alone cannot silently acquire the price-choice power.
    await req({ priceSelectionPreferenceMode: 'LOWEST', expectedPriceSelectionPreferenceMode: null })
      .expect(403);
    // Never grant/revoke permissions on the RAB-37 creator fixture:
    // an independently assigned Project manager is the authorized actor.
    token = await login(emails.priceManager);
    {
      await req({ priceSelectionPreferenceMode: 'LOWEST' }).expect(400);
      const updated = await req({
        priceSelectionPreferenceMode: 'LOWEST',
        expectedPriceSelectionPreferenceMode: null,
      }).expect(200);
      expect(updated.body.priceSelectionPreferenceMode).toBe('LOWEST');
      expect(updated.body.priceSelectionPreferencePolicyVersion)
        .toBe('F03A_PROJECT_PRICE_INTENT_V1');
      const read = await request(app.getHttpServer()).get(url)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(read.body).toMatchObject({
        priceSelectionPreferenceMode: 'LOWEST',
        priceSelectionPreferencePolicyVersion: 'F03A_PROJECT_PRICE_INTENT_V1',
        priceSelectionAuthority: 'INTENT_ONLY_NOT_ACTIVE',
      });
      const stale = await req({
        priceSelectionPreferenceMode: 'HIGHEST',
        expectedPriceSelectionPreferenceMode: null,
      }).expect(409);
      expect(stale.body.message).toContain('PROJECT_PRICE_PREFERENCE_CHANGED_RELOAD');
      await req({
        priceSelectionPreferenceMode: 'MIDDLE',
        expectedPriceSelectionPreferenceMode: 'LOWEST',
      }).expect(200);
      await req({
        priceSelectionPreferenceMode: 'HIGHEST',
        expectedPriceSelectionPreferenceMode: 'MIDDLE',
        locationRegionIds: [regionNewId],
        expectedLocationRegionIds: [regionOldId],
      }).expect(400);
      await req({ priceSelectionPreferenceMode: 'NOT_PROVEN', expectedPriceSelectionPreferenceMode: 'MIDDLE' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/projects/${lockedProjectId}/intake-context`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-workspace-id', workspaceAId)
        .send({ priceSelectionPreferenceMode: 'LOWEST', expectedPriceSelectionPreferenceMode: null })
        .expect(409);
      await req({
        priceSelectionPreferenceMode: null,
        expectedPriceSelectionPreferenceMode: 'MIDDLE',
      }).expect(200);
      const final = await prisma.project.findUniqueOrThrow({ where: { id: projectAId } });
      expect(final.priceSelectionPreferenceMode).toBeNull();
      expect(final.priceSelectionPreferencePolicyVersion).toBeNull();
      expect(final.workspaceId).toBe(initial.workspaceId);
      expect(final.organizationId).toBe(initial.organizationId);
      expect(final.mainMaterialSpec).toBe(initial.mainMaterialSpec);
      expect(final.budgetBaseline?.toString()).toBe(initial.budgetBaseline?.toString());
    }
  }, 60_000);

  it('RAB-37: authenticated saved-project Region PATCH persists and reads back without rewriting project identity', async () => {
    const token = await login(emails.activeCreator);
    const before = await prisma.project.findUniqueOrThrow({ where: { id: projectAId } });
    const response = await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ locationRegionIds: [regionNewId], expectedLocationRegionIds: [regionOldId] })
      .expect(200);
    expect(response.body.locationRegionIds).toEqual([regionNewId]);
    const reread = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);
    expect(reread.body.locationSelections.map((x: { id: string }) => x.id))
      .toEqual([regionNewId]);
    const after = await prisma.project.findUniqueOrThrow({ where: { id: projectAId } });
    expect(after.id).toBe(before.id);
    expect(after.workspaceId).toBe(before.workspaceId);
    expect(after.organizationId).toBe(before.organizationId);
    const stale = await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ locationRegionIds: [regionOldId], expectedLocationRegionIds: [regionOldId] })
      .expect(409);
    expect(stale.body.message).toContain('PROJECT_REGION_SELECTION_CHANGED_RELOAD');
    const stored = await prisma.projectRegionSelection.findMany({ where: { projectId: projectAId } });
    expect(stored.map((x) => x.regionId)).toEqual([regionNewId]);
  });

  it('RAB-37: cannot change project Region when official baseline is ACTIVE', async () => {
    const token = await login(emails.activeCreator);
    await request(app.getHttpServer())
      .patch(`/projects/${lockedProjectId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ locationRegionIds: [regionNewId], expectedLocationRegionIds: [] })
      .expect(409);
    expect(await prisma.projectRegionSelection.count({ where: { projectId: lockedProjectId } }))
      .toBe(0);
  });

  it('allows assigned PROJECT_CREATE user to update intake context before official baseline', async () => {
    const token = await login(emails.activeCreator);

    const response = await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '250000000.00', mainMaterialSpec: ' Beton K-300 ' })
      .expect(200);

    expect(response.body.budgetBaseline).toBe('250000000');
    expect(response.body.mainMaterialSpec).toBe('Beton K-300');
  });

  it('rejects assigned PROJECT_VIEW user without PROJECT_CREATE on PATCH', async () => {
    const token = await login(emails.viewOnly);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '1' })
      .expect(403);
  });

  it('rejects user without project assignment', async () => {
    const token = await login(emails.noAssignment);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '1' })
      .expect(403);
  });

  it('rejects inactive membership', async () => {
    const token = await login(emails.inactive);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '1' })
      .expect(404);
  });

  it('rejects workspace other than project tenant without leakage', async () => {
    const token = await login(emails.crossTenant);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceBId)
      .send({ budgetBaseline: '1' })
      .expect(404);
  });

  it('returns 404 for unknown projectId', async () => {
    const token = await login(emails.activeCreator);

    await request(app.getHttpServer())
      .patch('/projects/10000000-0000-4000-8000-000000009999/intake-context')
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '1' })
      .expect(404);
  });

  it('ignores workspaceId and organizationId in body', async () => {
    const token = await login(emails.activeCreator);

    await request(app.getHttpServer())
      .patch(`/projects/${projectAId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '2', workspaceId: workspaceBId, organizationId: 'attack' })
      .expect(200);

    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectAId } });
    expect(project.workspaceId).toBe(workspaceAId);
    expect(project.budgetBaseline?.toString()).toBe('2');
  });

  it('serves GET intake-mode with PROJECT_VIEW', async () => {
    const token = await login(emails.viewOnly);

    const response = await request(app.getHttpServer())
      .get(`/projects/${projectAId}/intake-mode`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .expect(200);

    expect(response.body).toMatchObject({
      boq: { status: 'EMPTY' },
      pagu: { status: 'AVAILABLE' },
      mode: 'E',
    });
  });

  it('blocks PATCH when official active baseline exists', async () => {
    const token = await login(emails.activeCreator);

    await request(app.getHttpServer())
      .patch(`/projects/${lockedProjectId}/intake-context`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-workspace-id', workspaceAId)
      .send({ budgetBaseline: '3' })
      .expect(409);
  });
});

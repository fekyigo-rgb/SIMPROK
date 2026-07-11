import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { IntelligenceEvidenceService } from '../../src/intelligence/intelligence-evidence.service';
import { IntelligenceEvidenceRecord } from '../../src/intelligence/constitutional-ai-boundary.service';

describe('Intelligence evidence append-only persistence (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let service: IntelligenceEvidenceService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = new PrismaClient();
    service = app.get(IntelligenceEvidenceService);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  async function cleanup() {
    await prisma.intelligenceEvidence.deleteMany({
      where: { requestId: { startsWith: 'p8a-1b-' } },
    });
    await prisma.project.deleteMany({
      where: { code: { startsWith: 'P8A-1B-' } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { account: { email: { contains: '@p8a-1b.test' } } },
    });
    await prisma.workspace.deleteMany({
      where: { name: { startsWith: 'P8A-1B Workspace' } },
    });
    await prisma.organization.deleteMany({
      where: { name: { startsWith: 'P8A-1B Org' } },
    });
    await prisma.account.deleteMany({
      where: { email: { contains: '@p8a-1b.test' } },
    });
  }

  async function createTenant(label: 'A' | 'B') {
    const organization = await prisma.organization.create({
      data: { name: `P8A-1B Org ${label}`, type: 'COMPANY' },
    });
    const workspace = await prisma.workspace.create({
      data: { name: `P8A-1B Workspace ${label}`, organizationId: organization.id },
    });
    const account = await prisma.account.create({
      data: {
        email: `account-${label.toLowerCase()}@p8a-1b.test`,
        passwordHash: 'not-used',
        displayName: `P8A-1B Account ${label}`,
        status: 'ACTIVE',
      },
    });
    await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId: workspace.id,
        status: 'ACTIVE',
      },
    });
    const project = await prisma.project.create({
      data: {
        name: `P8A-1B Project ${label}`,
        code: `P8A-1B-${label}`,
        workspaceId: workspace.id,
        organizationId: organization.id,
      },
    });

    return { organization, workspace, account, project };
  }

  function evidenceFor(
    tenant: Awaited<ReturnType<typeof createTenant>>,
    requestId: string,
  ): IntelligenceEvidenceRecord {
    return {
      requestId,
      workspaceId: tenant.workspace.id,
      organizationId: tenant.organization.id,
      projectId: tenant.project.id,
      accountId: tenant.account.id,
      providerIdentifier: 'unconnected-provider',
      modelIdentifier: 'unconnected-model',
      policyVersion: 'P8A-1',
      promptInputHash: `hash:${requestId}`,
      status: 'READY',
      sourceReferences: [`project:${tenant.project.id}`],
      toolsRequested: ['READ_PROJECT_CONTEXT'],
      toolsAllowed: ['READ_PROJECT_CONTEXT'],
      toolsDenied: [],
      ahspCandidates: [],
      selectedAhspIds: [],
      selectedBasicPriceIds: [],
      efPermission: 'NOT_ALLOWED',
      efReferences: [],
      confidence: [0.9],
      reasonCodes: ['MATCHED_WORK_TYPE'],
      policyRejections: [],
      timestamp: new Date().toISOString(),
    };
  }

  it('keeps evidence tenant-scoped across two workspaces', async () => {
    await cleanup();
    const tenantA = await createTenant('A');
    const tenantB = await createTenant('B');

    await service.append(evidenceFor(tenantA, 'p8a-1b-request-a'));
    await service.append(evidenceFor(tenantB, 'p8a-1b-request-b'));

    const workspaceARecords = await prisma.intelligenceEvidence.findMany({
      where: { workspaceId: tenantA.workspace.id, organizationId: tenantA.organization.id },
      select: { requestId: true, workspaceId: true, organizationId: true },
    });
    const workspaceBRecords = await prisma.intelligenceEvidence.findMany({
      where: { workspaceId: tenantB.workspace.id, organizationId: tenantB.organization.id },
      select: { requestId: true, workspaceId: true, organizationId: true },
    });

    expect(workspaceARecords).toHaveLength(1);
    expect(workspaceARecords[0]).toMatchObject({
      requestId: 'p8a-1b-request-a',
      workspaceId: tenantA.workspace.id,
      organizationId: tenantA.organization.id,
    });
    expect(workspaceBRecords).toHaveLength(1);
    expect(workspaceBRecords[0]).toMatchObject({
      requestId: 'p8a-1b-request-b',
      workspaceId: tenantB.workspace.id,
      organizationId: tenantB.organization.id,
    });
  });
});

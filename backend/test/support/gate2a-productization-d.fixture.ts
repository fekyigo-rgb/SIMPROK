import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

export const PRODUCTIZATION_D_BROWSER_PASSWORD = 'Gate2aKernel!';
export const PRODUCTIZATION_D_CALCULATION_DATE = '2026-07-31';
export const PRODUCTIZATION_D_BROWSER_CREDENTIAL_SOURCE =
  'backend/test/support/gate2a-productization-d.fixture.ts#PRODUCTIZATION_D_BROWSER_PASSWORD';

const FIXTURE_LABELS =
  'TEST_FIXTURE_ONLY OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION';

export interface Gate2aPositiveFixture {
  tag: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  boqStructureId: string;
  boqItemId: string;
  ahspId: string;
  ahspVersionId: string;
  occurrenceId: string;
  resourceCatalogId: string;
  basicPriceId: string;
  submissionId: string;
  reviewId: string;
  browserActorEmail: string;
  browserActorToken: string;
  verifierToken: string;
  publisherToken: string;
  createdPermissionIds: string[];
  accountIds: string[];
  membershipIds: string[];
}

interface CreateFixtureOptions {
  prisma: PrismaClient;
  app: INestApplication;
  tag?: string;
}

async function login(app: INestApplication, email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PRODUCTIZATION_D_BROWSER_PASSWORD })
    .expect(201);
  return response.body.access_token as string;
}

export async function createGate2aPositiveFixture({
  prisma,
  app,
  tag = `GATE2A${Date.now()}`,
}: CreateFixtureOptions): Promise<Gate2aPositiveFixture> {
  const createdPermissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];

  const organization = await prisma.organization.create({
    data: { name: `${tag} Org`, type: 'COMPANY' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: `${tag} WS`, organizationId: organization.id },
  });
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      organizationId: organization.id,
      code: `${tag}-P`,
      name: `${tag} Productization D Project`,
      status: 'PLANNED',
    },
  });

  const ensurePermission = async (code: string) => {
    const permission =
      (await prisma.permission.findUnique({ where: { code } })) ??
      (await prisma.permission.create({
        data: {
          code,
          name: `${tag} ${code}`,
          description: FIXTURE_LABELS,
        },
      }));
    if (permission.name.startsWith(tag)) {
      createdPermissionIds.push(permission.id);
    }
    return permission;
  };

  const createActor = async (
    suffix: string,
    permissionCodes: string[],
    assignedProjectIds: string[],
  ) => {
    const permissions = await Promise.all(
      permissionCodes.map(ensurePermission),
    );
    const role = await prisma.role.create({
      data: {
        workspaceId: workspace.id,
        code: `${tag}_${suffix.toUpperCase()}`,
        name: `${tag} ${suffix}`,
        rolePermissions: {
          create: permissions.map((permission) => ({
            permissionId: permission.id,
          })),
        },
      },
    });
    const email = `${tag}.${suffix}@test.local`.toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(PRODUCTIZATION_D_BROWSER_PASSWORD, 10),
        displayName: suffix,
        status: 'ACTIVE',
      },
    });
    accountIds.push(account.id);
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId: workspace.id,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: role.id }] },
      },
    });
    membershipIds.push(membership.id);
    await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId: workspace.id,
        fullName: suffix,
        status: 'ACTIVE',
      },
    });
    for (const projectId of assignedProjectIds) {
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
    return { email };
  };

  const browserActor = await createActor(
    'editor',
    ['PROJECT_VIEW', 'RAB_VIEW', 'RAB_DRAFT_EDIT'],
    [project.id],
  );
  const verifier = await createActor('verifier', ['BASIC_PRICE_VERIFY'], []);
  const publisher = await createActor('publisher', ['BASIC_PRICE_PUBLISH'], []);
  const browserActorToken = await login(app, browserActor.email);
  const verifierToken = await login(app, verifier.email);
  const publisherToken = await login(app, publisher.email);

  const resourceCatalog = await prisma.resourceCatalog.create({
    data: {
      workspaceId: workspace.id,
      name: `${tag} Besi Beton`,
      type: 'MATERIAL',
      baseUnit: 'Kg',
    },
  });
  const submission = await prisma.priceSubmission.create({
    data: {
      workspaceId: workspace.id,
      organizationId: organization.id,
      resourceId: resourceCatalog.id,
      regionId: null,
      sourceOrigin: 'SUPPLIER',
      sourceType: 'MARKET_SURVEY',
      status: 'UNDER_REVIEW',
    },
  });
  const revision = await prisma.priceSubmissionRevision.create({
    data: {
      submissionId: submission.id,
      revisionNumber: 1,
      value: '100000.00',
      effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
      validationPassed: true,
    },
  });
  await prisma.priceSubmission.update({
    where: { id: submission.id },
    data: { currentRevisionId: revision.id },
  });
  const review = await prisma.priceSubmissionReview.create({
    data: {
      priceSubmissionId: submission.id,
      workspaceId: workspace.id,
      organizationId: organization.id,
      slaState: 'OPEN',
      openedAt: new Date(),
    },
  });

  const acceptResponse = await request(app.getHttpServer())
    .post(`/basic-price-reviews/${review.id}/accept`)
    .set('Authorization', `Bearer ${verifierToken}`)
    .set('x-workspace-id', workspace.id)
    .send({ explicitGeneralRegion: true })
    .expect(201);
  const basicPriceId = acceptResponse.body.basicPriceId as string;
  await request(app.getHttpServer())
    .post(`/basic-price-publications/${basicPriceId}/publish`)
    .set('Authorization', `Bearer ${publisherToken}`)
    .set('x-workspace-id', workspace.id)
    .expect(201);

  const ahsp = await prisma.aHSP.create({
    data: {
      workspaceId: workspace.id,
      workType: `${tag} Besi Beton`,
      methodType: 'MANUAL',
      locationType: 'GENERAL',
      methodName: `${tag} Besi Beton method`,
    },
  });
  const ahspVersion = await prisma.aHSPVersion.create({
    data: {
      ahspId: ahsp.id,
      workspaceId: workspace.id,
      versionNumber: 1,
      outputUnit: 'Kg',
      regulationReference: `${tag} ${FIXTURE_LABELS}`,
    },
  });
  const ahspResource = await prisma.aHSPResource.create({
    data: {
      ahspVersionId: ahspVersion.id,
      resourceId: `${tag} Besi Beton`,
      resourceType: 'MATERIAL',
      coefficient: '2.000000',
      baseUnit: 'Kg',
    },
  });
  const occurrence = await prisma.projectAhspOccurrence.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      ahspVersionId: ahspVersion.id,
      idempotencyKey: `${tag}-positive-occurrence`,
      resourceResolutions: {
        create: [
          {
            ahspResourceId: ahspResource.id,
            rawAhspResourceRef: ahspResource.resourceId,
            rawAhspResourceType: 'MATERIAL',
            ahspCoefficient: '2.000000',
            ahspUnit: 'Kg',
            status: 'RESOLVED',
            selectionMode: 'AUTO_SELECTED',
            resourceCatalogId: resourceCatalog.id,
            selectedBasicPriceId: basicPriceId,
            canonicalUnit: 'Kg',
            sourcePriceValue: '100000.00',
            sourceUnit: 'Kg',
            adaptedPriceValue: '100000.00',
            selectedSourceOrigin: 'SUPPLIER',
            selectedFreshnessStatus: 'CURRENT',
            selectedEffectiveDate: new Date('2026-01-01T00:00:00.000Z'),
            resolutionMethod: 'EXACT_DETERMINISTIC',
            reasonCodes: ['TEST_FIXTURE_ONLY'],
            explanation: FIXTURE_LABELS,
            policyVersion: FIXTURE_LABELS,
          },
        ],
      },
    },
  });
  const structure = await prisma.boqStructure.create({
    data: {
      projectId: project.id,
      name: 'Working Draft',
      version: 1,
      status: 'DRAFT',
    },
  });
  const item = await prisma.boqItem.create({
    data: {
      boqStructureId: structure.id,
      wbsCode: '1.1',
      name: `${tag} Besi Beton`,
      itemType: 'WORK_ITEM',
      quantity: '5',
      unit: 'Kg',
      unitPrice: null,
      lineTotal: null,
      ahspVersionId: ahspVersion.id,
    },
  });

  return {
    tag,
    organizationId: organization.id,
    workspaceId: workspace.id,
    projectId: project.id,
    boqStructureId: structure.id,
    boqItemId: item.id,
    ahspId: ahsp.id,
    ahspVersionId: ahspVersion.id,
    occurrenceId: occurrence.id,
    resourceCatalogId: resourceCatalog.id,
    basicPriceId,
    submissionId: submission.id,
    reviewId: review.id,
    browserActorEmail: browserActor.email,
    browserActorToken,
    verifierToken,
    publisherToken,
    createdPermissionIds,
    accountIds,
    membershipIds,
  };
}

export async function cleanupGate2aPositiveFixture(
  prisma: PrismaClient,
  fixture: Gate2aPositiveFixture,
): Promise<void> {
  await prisma.rabDocument.deleteMany({
    where: { projectId: fixture.projectId },
  });
  await prisma.boqItem.deleteMany({
    where: { boqStructureId: fixture.boqStructureId },
  });
  await prisma.boqStructure.deleteMany({
    where: { id: fixture.boqStructureId },
  });
  await prisma.projectAhspResourceResolution.deleteMany({
    where: { occurrenceId: fixture.occurrenceId },
  });
  await prisma.projectAhspOccurrence.deleteMany({
    where: { id: fixture.occurrenceId },
  });
  await prisma.aHSPResource.deleteMany({
    where: { ahspVersionId: fixture.ahspVersionId },
  });
  await prisma.aHSPVersion.deleteMany({
    where: { id: fixture.ahspVersionId },
  });
  await prisma.aHSP.deleteMany({ where: { id: fixture.ahspId } });
  await prisma.basicPricePublicationAudit.deleteMany({
    where: { basicPriceId: fixture.basicPriceId },
  });
  await prisma.basicPrice.deleteMany({
    where: { id: fixture.basicPriceId },
  });
  await prisma.resourceCatalog.deleteMany({
    where: { id: fixture.resourceCatalogId },
  });
  await prisma.priceSubmissionReviewDecision.deleteMany({
    where: { reviewId: fixture.reviewId },
  });
  await prisma.priceSubmissionReview.deleteMany({
    where: { id: fixture.reviewId },
  });
  await prisma.priceSubmissionAudit.deleteMany({
    where: { submissionId: fixture.submissionId },
  });
  await prisma.priceSubmissionRevision.deleteMany({
    where: { submissionId: fixture.submissionId },
  });
  await prisma.priceSubmission.deleteMany({
    where: { id: fixture.submissionId },
  });
  await prisma.projectAssignment.deleteMany({
    where: { workspaceMembershipId: { in: fixture.membershipIds } },
  });
  await prisma.user.deleteMany({
    where: { workspaceMembershipId: { in: fixture.membershipIds } },
  });
  await prisma.workspaceMembership.deleteMany({
    where: { id: { in: fixture.membershipIds } },
  });
  await prisma.role.deleteMany({
    where: { code: { startsWith: fixture.tag } },
  });
  await prisma.permission.deleteMany({
    where: { id: { in: fixture.createdPermissionIds } },
  });
  await prisma.account.deleteMany({
    where: { id: { in: fixture.accountIds } },
  });
  await prisma.project.deleteMany({ where: { id: fixture.projectId } });
  await prisma.workspace.deleteMany({ where: { id: fixture.workspaceId } });
  await prisma.organization.deleteMany({
    where: { id: fixture.organizationId },
  });
}

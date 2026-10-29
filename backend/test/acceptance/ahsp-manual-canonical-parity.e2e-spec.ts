import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * AHSP Manual E2E parity: ONE browser-equivalent HTTP route through the
 * real Nest guards, canonical AHSP writers, Unit Kernel and real PostgreSQL.
 * Only the dedicated simprok_e2e lifecycle may run this suite.
 * All fixture data is removed after the test; never create a second engine.
 */
describe('AHSP Manual → real database → canonical readback (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = 'AHSPPARITY' + randomUUID().slice(0, 8);
  const methodName = tag + ' Pemeliharaan Jembatan';
  const categoryName = tag + ' Bina Marga';
  const subcategoryName = tag + ' Jembatan';
  const scopeName = tag + ' Pemeliharaan';
  let app: INestApplication | undefined;
  let workspaceId: string;
  let actorToken: string;
  let foreignToken: string;
  let rootId: string;
  let parentWasCreated = false;
  let ahspId: string | undefined;
  const localNodeIds: string[] = [];

  beforeAll(async () => {
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'assigned@test.local' },
    });
    const membership = await prisma.workspaceMembership.findFirstOrThrow({
      where: { accountId: account.id, status: 'ACTIVE' },
    });
    workspaceId = membership.workspaceId;

    // The official vocabulary root can be reused; if missing, create only
    // the test's one valid root and restore the pre-test state afterwards.
    const existingRoot = await prisma.constructionClassificationNode.findFirst({
      where: {
        level: 'JENIS_PENGADAAN',
        name: 'Pekerjaan Konstruksi',
        workspaceId: null,
      },
    });
    const root = existingRoot ?? await prisma.constructionClassificationNode.create({
      data: {
        level: 'JENIS_PENGADAAN',
        name: 'Pekerjaan Konstruksi',
        normalizedName: 'pekerjaan konstruksi',
        workspaceId: null,
        parentId: null,
      },
    });
    parentWasCreated = !existingRoot;
    rootId = root.id;

    let parentId = root.id;
    for (const [level, name] of [
      ['KATEGORI', categoryName],
      ['SUBKATEGORI', subcategoryName],
      ['JENIS_PEKERJAAN', scopeName],
    ] as const) {
      const node = await prisma.constructionClassificationNode.create({
        data: {
          level,
          name,
          normalizedName: name.toLocaleLowerCase('en-US'),
          workspaceId,
          parentId,
        },
      });
      localNodeIds.push(node.id);
      parentId = node.id;
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = async (email: string) => {
      const response = await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'Test1234!' })
        .expect(201);
      return response.body.access_token as string;
    };
    actorToken = await login('assigned@test.local');
    foreignToken = await login('crosstenant@test.local');
  }, 120_000);

  afterAll(async () => {
    try {
      if (ahspId) {
        await prisma.ahspClassificationAssignment.deleteMany({ where: { ahspId } });
        await prisma.aHSPResource.deleteMany({ where: { ahspVersion: { ahspId } } });
        await prisma.aHSPAuditLog.deleteMany({ where: { ahspId } });
        await prisma.aHSPVersion.deleteMany({ where: { ahspId } });
        await prisma.aHSP.deleteMany({ where: { id: ahspId } });
      }
      for (const id of [...localNodeIds].reverse()) {
        await prisma.constructionClassificationNode.delete({ where: { id } });
      }
      if (parentWasCreated && rootId) {
        await prisma.constructionClassificationNode.delete({ where: { id: rootId } });
      }
    } finally {
      await app?.close();
      await prisma.$disconnect();
    }
  }, 120_000);

  const asActor = () => request(app!.getHttpServer())
    .post('/ahsp/manual')
    .set('Authorization', 'Bearer ' + actorToken)
    .set('x-workspace-id', workspaceId);

  it('saves one AHSP transaction and reads the SAME canonical parent, unit and classification', async () => {
    const created = await asActor().send({
      workType: scopeName,
      methodName,
      code: null,
      fieldCategory: categoryName,
      subCategory: subcategoryName,
      classification: 'Pekerjaan Konstruksi',
      outputUnit: 'M1',
      regulationReference: 'Acuan E2E AHSP',
      issuerInstitution: 'Penerbit E2E AHSP',
      resources: [],
      jenisPengadaanRootId: rootId,
      leafNodeIds: [localNodeIds[2]],
      pendingPaths: [],
    }).expect(201);

    expect(created.body.disposition).toBe('CREATED');
    expect(typeof created.body.id).toBe('string');
    expect(typeof created.body.resourceReviewPrepared).toBe('boolean');
    ahspId = created.body.id as string;

    const stored = await prisma.aHSP.findUniqueOrThrow({
      where: { id: ahspId },
      include: {
        versions: { include: { outputUnitDefinition: true } },
        classificationAssignments: true,
      },
    });
    expect(stored.workspaceId).toBe(workspaceId);
    expect(stored.workType).toBe(scopeName);
    expect(stored.fieldCategory).toBe(categoryName);
    expect(stored.subCategory).toBe(subcategoryName);
    expect(stored.versions).toHaveLength(1);
    expect(stored.versions[0].outputUnit).toBe('M1');
    expect(stored.versions[0].outputUnitDefinition?.code).toBe('M1');
    expect(stored.versions[0].regulationReference).toBe('Acuan E2E AHSP');
    expect(stored.versions[0].issuerInstitution).toBe('Penerbit E2E AHSP');
    expect(stored.classificationAssignments).toHaveLength(1);
    expect(stored.classificationAssignments[0].leafNodeId).toBe(localNodeIds[2]);

    const detail = await request(app!.getHttpServer())
      .get('/ahsp/' + ahspId)
      .set('Authorization', 'Bearer ' + actorToken)
      .set('x-workspace-id', workspaceId)
      .expect(200);
    expect(detail.body.id).toBe(ahspId);
    expect(detail.body.versions[0].outputUnit).toBe('M1');
    expect(detail.body.versions[0].outputUnitCode).toBe('M1');
    expect(detail.body.versions[0].regulationReference).toBe('Acuan E2E AHSP');

    const paths = await request(app!.getHttpServer())
      .get('/ahsp/' + ahspId + '/classification-assignments')
      .set('Authorization', 'Bearer ' + actorToken)
      .set('x-workspace-id', workspaceId)
      .expect(200);
    expect(paths.body).toHaveLength(1);
    expect(paths.body[0].leafNodeId).toBe(localNodeIds[2]);
    expect(paths.body[0].path.map((node: { name: string }) => node.name)).toEqual([
      'Pekerjaan Konstruksi', categoryName, subcategoryName, scopeName,
    ]);

    const listing = await request(app!.getHttpServer())
      .get('/ahsp')
      .set('Authorization', 'Bearer ' + actorToken)
      .set('x-workspace-id', workspaceId)
      .expect(200);
    const row = (listing.body as Array<{id: string; versions: Array<{outputUnit: string; outputUnitDefinition: {code: string; symbol: string} | null}>}>)
      .find((item) => item.id === ahspId);
    expect(row).toBeDefined();
    expect(row?.versions[0]?.outputUnit).toBe('M1');
    expect(row?.versions[0]?.outputUnitDefinition?.code).toBe('M1');
  }, 45_000);

  it('rejects duplication and foreign visibility without creating a second AHSP', async () => {
    expect(ahspId).toBeDefined();
    await asActor().send({
      workType: scopeName,
      methodName,
      outputUnit: 'M1',
      resources: [],
      leafNodeIds: [localNodeIds[2]],
      jenisPengadaanRootId: rootId,
      pendingPaths: [],
    }).expect(409);

    const count = await prisma.aHSP.count({
      where: { workspaceId, workType: scopeName, methodName },
    });
    expect(count).toBe(1);

    await request(app!.getHttpServer())
      .get('/ahsp/' + ahspId)
      .set('Authorization', 'Bearer ' + foreignToken)
      .set('x-workspace-id', workspaceId)
      .expect(403);
  }, 30_000);
});

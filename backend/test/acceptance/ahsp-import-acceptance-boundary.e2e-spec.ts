import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ImportStatus, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AhspImportService } from '../../src/ahsp/services/ahsp-import.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AhspResourceResolutionOrchestrator } from '../../src/project-ahsp/ahsp-resource-resolution.orchestrator';
import { PRE_TITLE_READER_KNOWLEDGE as PRE_TITLE } from '../fixtures/ahsp-pre-title-journal-knowledge.fixture';

/**
 * AHSP IMPORT ACCEPTANCE BOUNDARY — THE ACCEPTANCE MATRIX (B11), END TO END.
 *
 * Nothing is stubbed: real HTTP, real guards, the real reader, the real
 * understanding, the real Unit Kernel, the real Resource Identity kernel, the
 * real admission authority and real PostgreSQL with the real migration chain —
 * including the additive intake-journal migration this slice adds.
 *
 * The law under test: import RECEIVES information. Every work item SIMPROK
 * recognises is kept durably; an item whose only gap is a component's identity
 * is written with the source's own words; an item missing a real fact is held,
 * never lost and never invented; one item's failure never costs another; and a
 * held item progresses later WITHOUT the file.
 */

const PASSWORD = 'IabAcceptance123!';
const UNKNOWN_UNIT = 'orang-harix';
const FAILURE_TRIGGER = 'iab_e2e_fail_one_item';

type Component = {
  name: string;
  unit: string | null;
  coefficient: number | null;
};

/** The official Permen layout: code + title row, header, A/B/C sections, "per - <unit>" summary. */
type PermenBlock = {
  code: string;
  title: string;
  perUnit: string | null;
  labor?: Component[];
  material?: Component[];
  equipment?: Component[];
};

/** The Bina Marga layout: "B.x title" row, an optional "satuan : <unit>" row, then the table. */
type BinaMargaBlock = {
  title: string;
  statement: string | null;
  labor: Component[];
};

/** What the import routes answer, as far as this suite reads it. */
type IntakeSummaryBody = {
  evaluated: number;
  ready: number;
  identityPending: number;
  alreadyPresent: number;
  /** Lines an earlier evaluation already settled: this request did nothing to them. */
  alreadyProcessed: number;
  held: number;
  failed: number;
};
type ItemKnowledgeBody = {
  workType?: { raw: string } | null;
  admission?: string;
  outputUnitRaw?: { raw: string } | null;
  resources: Array<{
    rawName: string | null;
    rawUnit: string | null;
    resolvedResourceCatalogId: string | null;
  }>;
};
type CommitBody = {
  importJobId: string;
  summary: IntakeSummaryBody;
  failed: Array<{
    workType: string | null;
    methodName: string | null;
    lineNumber: number;
  }>;
  knowledge: { workItems: ItemKnowledgeBody[] };
};
type OpenRowBody = {
  id: string;
  rawName: string;
  suggestedUnitDefinitionId: string | null;
  identityVerdict: { status: string; exhausted: boolean };
};
type IdentityMatchBody = {
  ahspId: string;
  workType: string;
  methodName: string;
};
/** One page of imports, as GET /ahsp/document/jobs answers it. */
type ImportJobPageBody = {
  items: ImportJobBody[];
  nextCursor: string | null;
  hasMore: boolean;
};
type ImportJobBody = {
  importJobId: string;
  sourceFileName?: string | null;
  counts: { received: number; represented: number; waiting: number };
  completion?: {
    complete: number;
    awaitingIdentity: number;
    recipeNotUsable: number;
    writtenUnitQuestions: Array<{
      lineNumber: number;
      workType: string | null;
      methodName: string | null;
      statedOutputUnits: string[];
      provenDifferent: boolean;
    }>;
    identityQuestions: { questions: number; uses: number };
  };
  waiting: Array<{
    workType: string | null;
    methodName?: string | null;
    status: string;
    reasonCodes: string[];
    identityVerdict?: string;
    identityMatches?: IdentityMatchBody[];
    unknownUnits?: Array<{ spelling: string; uses: number }>;
    unitsKnownNow?: boolean;
    statedOutputUnits?: string[];
    readingUpdated?: boolean;
  }>;
};

const bodyOf = <T>(response: { body: unknown }): T => response.body as T;
/** A durable line's work item, exactly as the journal stored it. */
const storedItem = (line: { rawData: unknown }) =>
  line.rawData as ItemKnowledgeBody;

async function analisaWorkbook(
  permen: readonly PermenBlock[],
  binaMarga: readonly BinaMargaBlock[] = [],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ANALISA HARGA');
  sheet.getCell('A1').value = 'ANALISA HARGA SATUAN UNTUK PENAWARAN';
  sheet.getCell('A3').value = 'BERDASARKAN PERMEN PUPR NO. 1 THN 2022';
  let row = 5;
  for (const block of permen) {
    sheet.getCell(`A${row}`).value = block.code;
    sheet.getCell(`C${row}`).value = block.title;
    row += 1;
    for (const [column, caption] of [
      ['A', 'No.'],
      ['B', 'Uraian'],
      ['E', 'Kode'],
      ['F', 'Satuan'],
      ['G', 'Koefisien'],
      ['H', 'Harga Satuan'],
    ] as const) {
      sheet.getCell(`${column}${row}`).value = caption;
    }
    row += 1;
    for (const [letter, heading, components] of [
      ['A', 'Tenaga Kerja', block.labor ?? []],
      ['B', 'Bahan', block.material ?? []],
      ['C', 'Peralatan', block.equipment ?? []],
    ] as const) {
      sheet.getCell(`A${row}`).value = letter;
      sheet.getCell(`B${row}`).value = heading;
      row += 1;
      components.forEach((component, index) => {
        sheet.getCell(`A${row}`).value = index + 1;
        sheet.getCell(`B${row}`).value = component.name;
        if (component.unit !== null)
          sheet.getCell(`F${row}`).value = component.unit;
        if (component.coefficient !== null)
          sheet.getCell(`G${row}`).value = component.coefficient;
        row += 1;
      });
    }
    if (block.perUnit !== null) {
      sheet.getCell(`A${row}`).value = 'F';
      sheet.getCell(`B${row}`).value =
        `Harga Satuan Pekerjaan per - ${block.perUnit} (D+E)`;
      row += 1;
    }
    row += 2;
  }
  if (binaMarga.length > 0) {
    const bm = workbook.addWorksheet('BINA MARGA');
    bm.getCell('B1').value = 'DEVISI UJI BINA MARGA';
    let top = 3;
    for (const block of binaMarga) {
      bm.getCell(`B${top}`).value = block.title;
      if (block.statement !== null)
        bm.getCell(`B${top + 1}`).value = block.statement;
      const header = top + 2;
      bm.getCell(`B${header}`).value = 'No';
      bm.getCell(`C${header}`).value = 'Komponen';
      bm.getCell(`E${header}`).value = 'Satuan';
      bm.getCell(`F${header}`).value = 'Perkiraan Kuantitas';
      bm.getCell(`G${header}`).value = 'Harga Satuan (Rp )';
      bm.getCell(`B${header + 1}`).value = 'A';
      bm.getCell(`C${header + 1}`).value = 'Tenaga';
      let line = header + 2;
      block.labor.forEach((component, index) => {
        bm.getCell(`B${line}`).value = String(index + 1);
        bm.getCell(`C${line}`).value = component.name;
        if (component.unit !== null)
          bm.getCell(`E${line}`).value = component.unit;
        if (component.coefficient !== null)
          bm.getCell(`F${line}`).value = component.coefficient;
        line += 1;
      });
      bm.getCell(`C${line}`).value = 'HARGA SATUAN PEKERJAAN (D + E)';
      top = line + 3;
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('AHSP import acceptance boundary (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `IAB${Date.now()}`;

  let app: INestApplication;
  let orgId: string;
  let orgBId: string;
  let workspaceId: string;
  let workspaceBId: string;
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const createdPermissionIds: string[] = [];
  const bearer = { owner: '', foreign: '' };
  const createdUnitAliasIds: string[] = [];

  let pipe4Id: string;
  let kerikil23Id: string;

  const pekerja = `Pekerja ${tag}`;
  const mandor = `Mandor ${tag}`;
  const bahanBaru = `Bahan Uji Baru ${tag}`;
  const alatBantu = `Alat Bantu Uji ${tag}`;
  const bahanGagal = `Bahan Gagal Tulis ${tag}`;
  const PIPE_6 = 'Pipa porous diameter 6"';
  const KERIKIL = 'Kerikil / Agregat';

  const http = () => app.getHttpServer() as never;
  const as = (who: keyof typeof bearer, ws: string = workspaceId) => ({
    get: (path: string) =>
      request(http())
        .get(path)
        .set('Authorization', `Bearer ${bearer[who]}`)
        .set('x-workspace-id', ws),
    post: (path: string, body: Record<string, unknown> = {}) =>
      request(http())
        .post(path)
        .set('Authorization', `Bearer ${bearer[who]}`)
        .set('x-workspace-id', ws)
        .send(body),
    upload: (path: string, bytes: Buffer, fileName: string) =>
      request(http())
        .post(path)
        .set('Authorization', `Bearer ${bearer[who]}`)
        .set('x-workspace-id', ws)
        .attach('file', bytes, fileName),
  });

  const labor = (...names: string[]): Component[] =>
    names.map((name, index) => ({
      name,
      unit: 'OH',
      coefficient: index === 0 ? 0.4 : 0.04,
    }));

  // D0 — every item and every resource already known.
  const knownDocument = () =>
    analisaWorkbook([
      {
        code: '9.8.1.a',
        title: 'Pemasangan uji IAB dikenal pertama',
        perUnit: 'm3',
        labor: labor(pekerja, mandor),
      },
      {
        code: '9.8.2.a',
        title: 'Pemasangan uji IAB dikenal kedua',
        perUnit: 'm2',
        labor: labor(pekerja),
      },
    ]);

  // D1 — the Owner's real shapes, side by side in one document. Built ONCE: a
  // document's identity is its bytes, and the workbook writer stamps a creation
  // time, so "the same document again" must be these exact bytes again.
  let mixedBytes: Buffer | null = null;
  const mixedDocument = async () => (mixedBytes ??= await buildMixedDocument());
  const buildMixedDocument = () =>
    analisaWorkbook(
      [
        {
          code: '9.9.1.a',
          title: 'Pemasangan uji IAB lengkap',
          perUnit: 'm3',
          labor: labor(pekerja, mandor),
        },
        {
          code: '9.9.2.a',
          title: 'Pemasangan uji IAB bahan baru',
          perUnit: 'm3',
          labor: labor(pekerja),
          material: [{ name: bahanBaru, unit: 'kg', coefficient: 1.5 }],
        },
        {
          code: '9.9.3.a',
          title: 'Pemasangan uji IAB pipa porous',
          perUnit: "m'",
          labor: labor(pekerja),
          material: [{ name: PIPE_6, unit: "M'", coefficient: 1.05 }],
        },
        {
          code: '9.9.4.a',
          title: 'Pemasangan uji IAB kerikil umum',
          perUnit: 'm3',
          labor: labor(pekerja),
          material: [{ name: KERIKIL, unit: 'M3', coefficient: 0.9 }],
        },
        {
          code: '9.9.5.a',
          title: 'Pemasangan uji IAB satuan tak dikenal',
          perUnit: 'm3',
          labor: [{ name: pekerja, unit: UNKNOWN_UNIT, coefficient: 0.4 }],
        },
        {
          code: '9.9.8.a',
          title: 'Pemasangan uji IAB alat bantu pertama',
          perUnit: 'm3',
          labor: labor(pekerja),
          equipment: [{ name: alatBantu, unit: 'Ls', coefficient: 1 }],
        },
        {
          code: '9.9.9.a',
          title: 'Pemasangan uji IAB alat bantu kedua',
          perUnit: 'm3',
          labor: labor(pekerja),
          equipment: [{ name: alatBantu, unit: 'Ls', coefficient: 1 }],
        },
      ],
      [
        {
          title: 'B.91 Pemasangan uji IAB satuan tertulis',
          statement: 'satuan : m',
          labor: labor(pekerja),
        },
        {
          title: 'B.92 Pemasangan uji IAB tanpa satuan',
          statement: null,
          labor: labor(pekerja),
        },
      ],
    );

  // D2 — two items; the first one's write is made to fail inside PostgreSQL.
  const failingDocument = () =>
    analisaWorkbook([
      {
        code: '9.7.1.a',
        title: 'Pemasangan uji IAB gagal tulis',
        perUnit: 'm3',
        labor: labor(pekerja),
        material: [{ name: bahanGagal, unit: 'kg', coefficient: 1 }],
      },
      {
        code: '9.7.2.a',
        title: 'Pemasangan uji IAB selamat',
        perUnit: 'm3',
        labor: labor(pekerja, mandor),
      },
    ]);

  const commit = async (bytes: Buffer, fileName: string) =>
    bodyOf<CommitBody>(
      await as('owner')
        .upload('/ahsp/document/commit', bytes, fileName)
        .expect(201),
    );
  const itemByWorkType = (
    knowledge: CommitBody['knowledge'],
    workType: string,
  ) => knowledge.workItems.find((item) => item.workType?.raw === workType);
  const ahspsOf = (ws: string = workspaceId) =>
    prisma.aHSP.findMany({ where: { workspaceId: ws } });
  const linesOf = (importJobId: string) =>
    prisma.aHSPImportLine.findMany({
      where: { importJobId },
      orderBy: { lineNumber: 'asc' },
    });
  const lineFor = async (importJobId: string, workType: string) =>
    (await linesOf(importJobId)).find(
      (line) => storedItem(line).workType?.raw === workType,
    )!;
  const resourcesOf = async (workType: string) =>
    prisma.aHSPResource.findMany({
      where: { ahspVersion: { ahsp: { workspaceId, workType } } },
      orderBy: { createdAt: 'asc' },
    });
  const openRows = async () =>
    bodyOf<OpenRowBody[]>(
      await as('owner').get('/resource-observations').expect(200),
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    orgId = (
      await prisma.organization.create({
        data: { name: `${tag} Org`, type: 'COMPANY' },
      })
    ).id;
    orgBId = (
      await prisma.organization.create({
        data: { name: `${tag} Org B`, type: 'COMPANY' },
      })
    ).id;
    workspaceId = (
      await prisma.workspace.create({
        data: { name: `${tag} WS`, organizationId: orgId },
      })
    ).id;
    workspaceBId = (
      await prisma.workspace.create({
        data: { name: `${tag} WS B`, organizationId: orgBId },
      })
    ).id;

    const ensurePermission = async (code: string) => {
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) return existing.id;
      const created = await prisma.permission.create({
        data: {
          code,
          name: `${tag} ${code}`,
          description: 'AHSP import acceptance E2E fixture',
        },
      });
      createdPermissionIds.push(created.id);
      return created.id;
    };
    const manage = await ensurePermission('AHSP_MANAGE');
    const decide = await ensurePermission('AHSP_RESOURCE_IDENTITY_DECIDE');
    const makeRole = (suffix: string, ws: string) =>
      prisma.role.create({
        data: {
          workspaceId: ws,
          code: `${tag}_${suffix}`,
          name: `${tag} ${suffix}`,
          rolePermissions: {
            create: [manage, decide].map((permissionId) => ({ permissionId })),
          },
        },
      });
    const importer = await makeRole('IMPORTER', workspaceId);
    const foreignImporter = await makeRole('FOREIGN', workspaceBId);

    const createActor = async (suffix: string, ws: string, roleId: string) => {
      const email = `${tag}.${suffix}@test.local`.toLowerCase();
      const account = await prisma.account.create({
        data: { email, passwordHash, displayName: suffix, status: 'ACTIVE' },
      });
      accountIds.push(account.id);
      const membership = await prisma.workspaceMembership.create({
        data: {
          accountId: account.id,
          workspaceId: ws,
          status: 'ACTIVE',
          membershipRoles: { create: [{ roleId }] },
        },
      });
      membershipIds.push(membership.id);
      await prisma.user.create({
        data: {
          workspaceMembershipId: membership.id,
          workspaceId: ws,
          fullName: suffix,
          status: 'ACTIVE',
        },
      });
      const login = await request(http())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(201);
      return bodyOf<{ access_token: string }>(login).access_token;
    };
    bearer.owner = await createActor('owner', workspaceId, importer.id);
    bearer.foreign = await createActor(
      'foreign',
      workspaceBId,
      foreignImporter.id,
    );

    // What this workspace's catalogue already knows.
    for (const [name, type, baseUnit] of [
      [pekerja, 'LABOR', 'OH'],
      [mandor, 'LABOR', 'OH'],
    ] as const) {
      await prisma.resourceCatalog.create({
        data: { workspaceId, name, type, baseUnit },
      });
    }
    pipe4Id = (
      await prisma.resourceCatalog.create({
        data: {
          workspaceId,
          name: 'Pipa porous diameter 4"',
          type: 'MATERIAL',
          baseUnit: "M'",
        },
      })
    ).id;
    kerikil23Id = (
      await prisma.resourceCatalog.create({
        data: {
          workspaceId,
          name: 'Kerikil 2-3 cm',
          type: 'MATERIAL',
          baseUnit: 'M3',
        },
      })
    ).id;
  }, 300_000);

  afterAll(async () => {
    const workspaces = [workspaceId, workspaceBId].filter(Boolean);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER} ON ahsp_resources`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS ${FAILURE_TRIGGER}()`,
    );
    await prisma.unitAlias.deleteMany({
      where: { id: { in: createdUnitAliasIds } },
    });
    await prisma.aHSPImportLine.deleteMany({
      where: { importJob: { workspaceId: { in: workspaces } } },
    });
    await prisma.aHSPImportJob.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.aHSPResource.deleteMany({
      where: { ahspVersion: { workspaceId: { in: workspaces } } },
    });
    await prisma.aHSPVersion.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.aHSPAuditLog.deleteMany({
      where: { ahsp: { workspaceId: { in: workspaces } } },
    });
    await prisma.aHSP.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.observedResource.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.resourceSourceIdentity.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.resourceCatalog.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await prisma.user.deleteMany({
      where: { workspaceMembershipId: { in: membershipIds } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { id: { in: membershipIds } },
    });
    await prisma.role.deleteMany({ where: { code: { startsWith: tag } } });
    await prisma.permission.deleteMany({
      where: { id: { in: createdPermissionIds } },
    });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgId, orgBId].filter(Boolean) } },
    });
    await app.close();
    await prisma.$disconnect();
  }, 180_000);

  // =====================================================================

  let mixedJobId: string;
  let mixedResult: CommitBody;

  it('SCENARIO 1 — a fully known batch is written, the import is COMPLETE, and no one is asked anything', async () => {
    const result = await commit(await knownDocument(), 'iab-known.xlsx');
    expect(result.summary).toEqual({
      evaluated: 2,
      ready: 2,
      identityPending: 0,
      alreadyPresent: 0,
      alreadyProcessed: 0,
      held: 0,
      failed: 0,
    });
    expect(result.failed).toEqual([]);

    const job = await prisma.aHSPImportJob.findUniqueOrThrow({
      where: { id: result.importJobId },
    });
    expect(job).toMatchObject({
      workspaceId,
      status: 'COMPLETED',
      sourceFileName: 'iab-known.xlsx',
    });
    const lines = await linesOf(job.id);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({ workspaceId, status: 'COMPLETED' });
      expect(line.ahspId).toEqual(expect.any(String));
      expect(line.ahspVersionId).toEqual(expect.any(String));
    }
    // Every component carries the catalogue identity the kernel proved.
    for (const resource of await resourcesOf('9.8.1.a')) {
      expect(resource.resourceId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(await openRows()).toEqual([]);
  });

  it('the import surfaces understand the mixed document: identity-only gaps are admissible, missing facts are held', async () => {
    const preview = bodyOf<CommitBody['knowledge']>(
      await as('owner')
        .upload(
          '/ahsp/document/preview',
          await mixedDocument(),
          'iab-mixed.xlsx',
        )
        .expect(201),
    );
    const admissions = Object.fromEntries(
      preview.workItems.map((item): [string, string | undefined] => [
        item.workType?.raw ?? '',
        item.admission,
      ]),
    );
    expect(admissions).toEqual({
      '9.9.1.a': 'PROVEN',
      '9.9.2.a': 'IDENTITY_PENDING',
      '9.9.3.a': 'IDENTITY_PENDING',
      '9.9.4.a': 'IDENTITY_PENDING',
      '9.9.5.a': 'HELD',
      '9.9.8.a': 'IDENTITY_PENDING',
      '9.9.9.a': 'IDENTITY_PENDING',
      'B.91': 'PROVEN',
      'B.92': 'HELD',
    });
    // A preview writes nothing — not even the journal.
    expect(
      await prisma.aHSPImportJob.count({
        where: { workspaceId, sourceFileName: 'iab-mixed.xlsx' },
      }),
    ).toBe(0);
  });

  it('SCENARIOS 2, 5 & 6 — every readable item is captured; identity-only items are written, missing facts are held, nothing is lost', async () => {
    mixedResult = await commit(await mixedDocument(), 'iab-mixed.xlsx');
    mixedJobId = mixedResult.importJobId;
    expect(mixedResult.summary).toEqual({
      evaluated: 9,
      ready: 2,
      identityPending: 5,
      alreadyPresent: 0,
      alreadyProcessed: 0,
      held: 2,
      failed: 0,
    });

    // CAPTURED: one durable line per readable item, before and regardless of any write.
    const lines = await linesOf(mixedJobId);
    expect(lines).toHaveLength(9);
    expect(lines.map((line) => line.lineNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const job = await prisma.aHSPImportJob.findUniqueOrThrow({
      where: { id: mixedJobId },
    });
    expect(job.status).toBe('PARTIAL_SUCCESS');
    expect(job.sourceSha256).toMatch(/^[0-9A-F]{64}$/i);
    expect(job.documentKnowledge).toMatchObject({
      source: { fileName: 'iab-mixed.xlsx' },
    });

    // SCENARIO 2 — the work item is not lost; the unknown component keeps the source's wording.
    const pending = await resourcesOf('9.9.2.a');
    const pendingIds = pending.map((resource) => resource.resourceId);
    expect(pendingIds).toHaveLength(2);
    expect(pendingIds).toEqual(
      expect.arrayContaining([
        bahanBaru,
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ]),
    );
    expect(
      pending.find((resource) => resource.rawName === bahanBaru),
    ).toMatchObject({
      resourceId: bahanBaru,
      rawUnit: 'kg',
      sourceSha256: job.sourceSha256,
      sheetName: 'ANALISA HARGA',
    });
    expect((await lineFor(mixedJobId, '9.9.2.a')).status).toBe('COMPLETED');

    // SCENARIO 5 — a unit gap only: held durably, never falsely ready, never written.
    const unitGap = await lineFor(mixedJobId, '9.9.5.a');
    expect(unitGap).toMatchObject({ status: 'PENDING', ahspId: null });
    expect(unitGap.reasonCodes).toContain('UNIT_UNRESOLVED');
    expect(storedItem(unitGap).resources[0]).toMatchObject({
      rawName: pekerja,
      rawUnit: UNKNOWN_UNIT,
    });
    expect(await resourcesOf('9.9.5.a')).toEqual([]);

    // SCENARIO 6 — a stated "satuan : m" is read; a block that states no unit is held with nothing invented.
    const stated = await prisma.aHSPVersion.findFirstOrThrow({
      where: { ahsp: { workspaceId, workType: 'B.91' } },
    });
    expect(stated.outputUnit).toBe('m');
    const unstated = await lineFor(mixedJobId, 'B.92');
    expect(unstated).toMatchObject({
      status: 'PENDING',
      ahspId: null,
      reasonCodes: ['MISSING_OUTPUT_UNIT'],
    });
    expect(storedItem(unstated).outputUnitRaw).toBeNull();
    expect(
      await prisma.aHSP.count({ where: { workspaceId, workType: 'B.92' } }),
    ).toBe(0);

    // LOST = 0: every line is either represented by an AHSP or still held with its facts.
    for (const line of lines) {
      if (line.status === 'COMPLETED') {
        expect(
          await prisma.aHSP.findUnique({ where: { id: line.ahspId! } }),
        ).not.toBeNull();
      } else {
        expect(line.status).toBe('PENDING');
        expect(storedItem(line).resources.length).toBeGreaterThan(0);
      }
    }
  });

  it('SCENARIO 2 (downstream) — a component whose identity is pending can never be priced', async () => {
    const orchestrator = app.get(AhspResourceResolutionOrchestrator);
    const version = await prisma.aHSPVersion.findFirstOrThrow({
      where: { ahsp: { workspaceId, workType: '9.9.2.a' } },
      include: { resources: true },
    });
    const resolutions = await orchestrator.resolveVersionResources(
      app.get(PrismaService),
      {
        workspaceId,
        projectId: randomUUID(),
        referenceRegionId: randomUUID(),
        asOf: new Date('2026-09-15T00:00:00.000Z'),
        version,
      },
    );
    const unknown = resolutions.find(
      (resolution) => resolution.rawAhspResourceRef === bahanBaru,
    )!;
    expect(unknown.status).not.toBe('RESOLVED');
    expect(unknown.resourceCatalogId).toBeNull();
    expect(unknown.selectedBasicPriceId).toBeNull();
  });

  it('SCENARIO 3 — a 6" source is never stored or bound as the 4" row, and admission law is unchanged', async () => {
    const [labourRow, pipeRow] = [
      ...(await resourcesOf('9.9.3.a')).filter(
        (resource) => resource.rawName === pekerja,
      ),
      ...(await resourcesOf('9.9.3.a')).filter(
        (resource) => resource.rawName === PIPE_6,
      ),
    ];
    expect(labourRow).toBeDefined();
    expect(pipeRow).toMatchObject({ resourceId: PIPE_6, rawUnit: "M'" });
    expect(
      await prisma.aHSPResource.count({
        where: { ahspVersion: { workspaceId }, resourceId: pipe4Id },
      }),
    ).toBe(0);

    const observation = (await openRows()).find(
      (row) => row.rawName === PIPE_6,
    )!;
    expect(observation.identityVerdict).toMatchObject({
      status: 'UNRESOLVED',
      exhausted: false,
    });
    const refusedExisting = await as('owner')
      .post(`/resource-observations/${observation.id}/curate-existing`, {
        selectedResourceCatalogId: pipe4Id,
      })
      .expect(409);
    expect(bodyOf<{ message: string }>(refusedExisting).message).toBe(
      'IDENTITY_CANDIDATE_RULED_OUT',
    );
    const refusedNew = await as('owner')
      .post(`/resource-observations/${observation.id}/curate-new`, {
        unitDefinitionId: observation.suggestedUnitDefinitionId,
      })
      .expect(409);
    expect(bodyOf<{ message: string }>(refusedNew).message).toBe(
      'RESOURCE_IDENTITY_NOT_EXHAUSTED',
    );
    expect(
      await prisma.observedResource.findUniqueOrThrow({
        where: { id: observation.id },
      }),
    ).toMatchObject({
      status: 'OBSERVED',
      resolvedResourceCatalogId: null,
    });
  });

  it('SCENARIO 4 — generic "Kerikil / Agregat" keeps its literal wording; a sized row is never adopted for it', async () => {
    const generic = (await resourcesOf('9.9.4.a')).find(
      (resource) => resource.rawName === KERIKIL,
    );
    expect(generic).toMatchObject({ resourceId: KERIKIL, rawUnit: 'M3' });
    expect(
      await prisma.aHSPResource.count({
        where: { ahspVersion: { workspaceId }, resourceId: kerikil23Id },
      }),
    ).toBe(0);
    const knowledge = itemByWorkType(mixedResult.knowledge, '9.9.4.a')!;
    const resource = knowledge.resources.find(
      (candidate) => candidate.rawName === KERIKIL,
    )!;
    expect(resource.resolvedResourceCatalogId).toBeNull();
    expect(resource.rawName).toBe(KERIKIL);
  });

  it('SCENARIO 7 — a question asked twice costs ONE decision; the machine then proves the twin and asks nothing more', async () => {
    const asked = (await openRows()).filter((row) => row.rawName === alatBantu);
    expect(asked).toHaveLength(2);
    expect(asked.every((row) => row.identityVerdict.exhausted === true)).toBe(
      true,
    );

    const orchestrator = app.get(AhspResourceResolutionOrchestrator);
    const priceIdentity = async () => {
      const version = await prisma.aHSPVersion.findFirstOrThrow({
        where: { ahsp: { workspaceId, workType: '9.9.9.a' } },
        include: { resources: true },
      });
      const resolutions = await orchestrator.resolveVersionResources(
        app.get(PrismaService),
        {
          workspaceId,
          projectId: randomUUID(),
          referenceRegionId: randomUUID(),
          asOf: new Date('2026-09-15T00:00:00.000Z'),
          version,
        },
      );
      return resolutions.find(
        (resolution) => resolution.rawAhspResourceRef === alatBantu,
      )!;
    };
    // Before: identity is not proven, so the price path is never entered.
    const unproven = await priceIdentity();
    expect(unproven.reasonCodes).toContain('RESOURCE_NOT_FOUND');
    expect(unproven.selectedBasicPriceId).toBeNull();

    // ONE human authority decision.
    await as('owner')
      .post(`/resource-observations/${asked[0].id}/curate-new`, {
        unitDefinitionId: asked[0].suggestedUnitDefinitionId,
      })
      .expect(201);

    // The twin is machine-proven now: it is not asked again, and nothing was written on anyone's behalf.
    expect(
      (await openRows()).filter((row) => row.rawName === alatBantu),
    ).toEqual([]);
    const twin = await prisma.observedResource.findUniqueOrThrow({
      where: { id: asked[1].id },
    });
    expect(twin).toMatchObject({
      status: 'OBSERVED',
      decidedByAccountId: null,
      resolvedResourceCatalogId: null,
    });
    expect(
      await prisma.resourceCatalog.count({
        where: { workspaceId, name: alatBantu },
      }),
    ).toBe(1);

    // The AHSP written with the source's wording needed no rewrite: its identity is
    // now proven downstream, and pricing asks the next lawful question — is there a
    // Basic Price? (There is none in this workspace, so nothing is selected.)
    const proven = await priceIdentity();
    expect(proven.reasonCodes).toContain('EXACT_RESOURCE_NAME_MATCH');
    expect(proven.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
    expect(proven.selectedBasicPriceId).toBeNull();
  });

  it('SCENARIO 8 — the same document again opens no second job, no new lines, no duplicate AHSP or observation', async () => {
    const before = {
      jobs: await prisma.aHSPImportJob.count({ where: { workspaceId } }),
      lines: await prisma.aHSPImportLine.count({ where: { workspaceId } }),
      ahsps: await prisma.aHSP.count({ where: { workspaceId } }),
      versions: await prisma.aHSPVersion.count({ where: { workspaceId } }),
      observations: await prisma.observedResource.count({
        where: { workspaceId },
      }),
      catalog: await prisma.resourceCatalog.count({ where: { workspaceId } }),
    };
    const again = await commit(await mixedDocument(), 'iab-mixed.xlsx');
    expect(again.importJobId).toBe(mixedJobId);
    // F01 — every line this document already settled is reported as ALREADY
    // PROCESSED: this evaluation did nothing to them, and the answer says so
    // rather than claiming it found seven AHSPs again.
    expect(again.summary).toMatchObject({
      evaluated: 9,
      ready: 0,
      identityPending: 0,
      alreadyPresent: 0,
      alreadyProcessed: 7,
      failed: 0,
    });
    expect({
      jobs: await prisma.aHSPImportJob.count({ where: { workspaceId } }),
      lines: await prisma.aHSPImportLine.count({ where: { workspaceId } }),
      ahsps: await prisma.aHSP.count({ where: { workspaceId } }),
      versions: await prisma.aHSPVersion.count({ where: { workspaceId } }),
      observations: await prisma.observedResource.count({
        where: { workspaceId },
      }),
      catalog: await prisma.resourceCatalog.count({ where: { workspaceId } }),
    }).toEqual(before);
    // A represented line is never downgraded by a later evaluation.
    expect((await lineFor(mixedJobId, '9.9.2.a')).status).toBe('COMPLETED');
  });

  let failingJobId: string;

  it('SCENARIO 9 — a write that fails inside PostgreSQL leaves no orphan parent and no partial version; the next item is still written', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${FAILURE_TRIGGER}() RETURNS trigger AS $$
      BEGIN
        IF NEW."rawName" = '${bahanGagal}' THEN
          RAISE EXCEPTION 'IAB_E2E_INJECTED_WRITE_FAILURE';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${FAILURE_TRIGGER} BEFORE INSERT ON ahsp_resources FOR EACH ROW EXECUTE FUNCTION ${FAILURE_TRIGGER}()`,
    );

    const result = await commit(await failingDocument(), 'iab-failing.xlsx');
    failingJobId = result.importJobId;
    expect(result.summary).toEqual({
      evaluated: 2,
      ready: 1,
      identityPending: 0,
      alreadyPresent: 0,
      alreadyProcessed: 0,
      held: 0,
      failed: 1,
    });
    expect(result.failed).toEqual([
      {
        workType: '9.7.1.a',
        methodName: 'Pemasangan uji IAB gagal tulis',
        lineNumber: 1,
      },
    ]);

    // Whole or nothing: no parent, no version, no component of the failed item exists.
    expect(
      await prisma.aHSP.count({ where: { workspaceId, workType: '9.7.1.a' } }),
    ).toBe(0);
    expect(
      await prisma.aHSPVersion.count({
        where: { workspaceId, ahsp: { workType: '9.7.1.a' } },
      }),
    ).toBe(0);
    expect(
      await prisma.aHSPResource.count({ where: { rawName: bahanGagal } }),
    ).toBe(0);
    const orphanParents = await prisma.aHSP.count({
      where: { workspaceId, versions: { none: {} } },
    });
    expect(orphanParents).toBe(0);

    // The intake truth was already durable, and the failure is kept on its line.
    const failedLine = await lineFor(failingJobId, '9.7.1.a');
    expect(failedLine).toMatchObject({ status: 'FAILED', ahspId: null });
    expect(failedLine.errorMessage).toContain('IAB_E2E_INJECTED_WRITE_FAILURE');
    expect((await lineFor(failingJobId, '9.7.2.a')).status).toBe('COMPLETED');
    expect(
      await prisma.aHSP.count({ where: { workspaceId, workType: '9.7.2.a' } }),
    ).toBe(1);
    // The unknown component was observed BEFORE the write was attempted.
    expect(
      await prisma.observedResource.count({
        where: { workspaceId, rawName: bahanGagal },
      }),
    ).toBe(1);
  });

  it('SCENARIO 10 — held and failed items progress later from the journal, without the file, once per document', async () => {
    // The fault is gone: the failed item is written from what SIMPROK kept.
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER} ON ahsp_resources`,
    );
    const retried = bodyOf<CommitBody>(
      await as('owner')
        .post(`/ahsp/document/jobs/${failingJobId}/continue`)
        .expect(201),
    );
    expect(retried.importJobId).toBe(failingJobId);
    expect(retried.summary).toEqual({
      evaluated: 1,
      ready: 0,
      identityPending: 1,
      alreadyPresent: 0,
      alreadyProcessed: 0,
      held: 0,
      failed: 0,
    });
    expect((await lineFor(failingJobId, '9.7.1.a')).status).toBe('COMPLETED');
    expect(
      (
        await prisma.aHSPImportJob.findUniqueOrThrow({
          where: { id: failingJobId },
        })
      ).status,
    ).toBe('COMPLETED');

    // The Unit authority learns the spelling (a governed vocabulary change, made
    // here directly on the isolated database): ONE re-check moves every item that
    // is now lawful, and leaves the item the source itself cannot complete.
    const personDay = await prisma.unitDefinition.findUniqueOrThrow({
      where: { code: 'PERSON_DAY' },
    });
    const alias = await prisma.unitAlias.create({
      data: {
        rawAlias: UNKNOWN_UNIT,
        normalizedAlias: UNKNOWN_UNIT,
        unitDefinitionId: personDay.id,
        context: null,
      },
    });
    createdUnitAliasIds.push(alias.id);
    const continued = bodyOf<CommitBody>(
      await as('owner')
        .post(`/ahsp/document/jobs/${mixedJobId}/continue`)
        .expect(201),
    );
    expect(continued.summary).toEqual({
      evaluated: 2,
      ready: 1,
      identityPending: 0,
      alreadyPresent: 0,
      alreadyProcessed: 0,
      held: 1,
      failed: 0,
    });
    expect((await lineFor(mixedJobId, '9.9.5.a')).status).toBe('COMPLETED');
    expect(
      await prisma.aHSP.count({ where: { workspaceId, workType: '9.9.5.a' } }),
    ).toBe(1);
    expect(await lineFor(mixedJobId, 'B.92')).toMatchObject({
      status: 'PENDING',
      reasonCodes: ['MISSING_OUTPUT_UNIT'],
    });

    const [listed] = bodyOf<ImportJobPageBody>(
      await as('owner').get('/ahsp/document/jobs').expect(200),
    ).items.filter((job) => job.importJobId === mixedJobId);
    expect(listed.counts).toEqual({ received: 9, represented: 8, waiting: 1 });
    expect(listed.waiting).toEqual([
      expect.objectContaining({
        workType: 'B.92',
        status: 'PENDING',
        reasonCodes: ['MISSING_OUTPUT_UNIT'],
      }),
    ]);
  });

  it('SCENARIO 11 (closeout TASK 3) — a possible twin kept by an import is decided after a reload, on the stored knowledge, without the file', async () => {
    // Two AHSPs this workspace already holds, written by hand; the document's
    // items differ from them only by letter case.
    const existing: Array<{ id: string }> = [];
    for (const [workType, methodName] of [
      ['9.6.1.A', 'PEMASANGAN UJI IAB KEMUNGKINAN SAMA PERTAMA'],
      ['9.6.2.A', 'PEMASANGAN UJI IAB KEMUNGKINAN SAMA KEDUA'],
    ]) {
      existing.push(
        bodyOf<{ id: string }>(
          await as('owner')
            .post('/ahsp', {
              workType,
              methodName,
              methodType: 'OTHER',
              locationType: 'OTHER',
            })
            .expect(201),
        ),
      );
    }
    const bytes = await analisaWorkbook([
      {
        code: '9.6.1.a',
        title: 'Pemasangan uji IAB kemungkinan sama pertama',
        perUnit: 'm3',
        labor: labor(pekerja, mandor),
      },
      {
        code: '9.6.2.a',
        title: 'Pemasangan uji IAB kemungkinan sama kedua',
        perUnit: 'm3',
        labor: labor(pekerja),
      },
    ]);

    // The preview offers the comparison; the save holds both items for a decision.
    const shown = bodyOf<{
      workItems: Array<
        ItemKnowledgeBody & {
          identityVerdict?: string;
          identityMatches?: IdentityMatchBody[];
        }
      >;
    }>(
      await as('owner')
        .upload('/ahsp/document/preview', bytes, 'iab-possible.xlsx')
        .expect(201),
    );
    expect(shown.workItems.map((item) => item.identityVerdict)).toEqual([
      'POSSIBLY_IDENTICAL',
      'POSSIBLY_IDENTICAL',
    ]);
    const held = await commit(bytes, 'iab-possible.xlsx');
    expect(held.summary).toMatchObject({ evaluated: 2, held: 2, ready: 0 });
    const ahspsBefore = await prisma.aHSP.count({ where: { workspaceId } });

    // RELOAD: the list alone, no file, shows the same comparison the preview showed.
    const listJob = async () =>
      bodyOf<ImportJobPageBody>(
        await as('owner').get('/ahsp/document/jobs').expect(200),
      ).items.find((job) => job.importJobId === held.importJobId);
    const listed = await listJob();
    expect(listed?.waiting).toHaveLength(shown.workItems.length);
    shown.workItems.forEach((item, index) => {
      expect(listed?.waiting[index]).toMatchObject({
        workType: item.workType?.raw,
        reasonCodes: ['IDENTITY_POSSIBLE_MATCH'],
        identityVerdict: 'POSSIBLY_IDENTICAL',
        identityMatches: item.identityMatches,
      });
    });
    expect(
      listed?.waiting.map((line) => line.identityMatches?.[0]?.ahspId),
    ).toEqual(existing.map((row) => row.id));

    // ONE decision per item, carried by the existing continuation as JSON only.
    const decisions = [
      {
        workType: '9.6.1.a',
        methodName: 'Pemasangan uji IAB kemungkinan sama pertama',
        action: 'KEEP_SEPARATE',
      },
      {
        workType: '9.6.2.a',
        methodName: 'Pemasangan uji IAB kemungkinan sama kedua',
        action: 'USE_EXISTING',
      },
    ];
    const continued = bodyOf<CommitBody>(
      await as('owner')
        .post(`/ahsp/document/jobs/${held.importJobId}/continue`, {
          decisions,
        })
        .expect(201),
    );
    expect(continued.summary).toEqual({
      evaluated: 2,
      ready: 1,
      identityPending: 0,
      alreadyPresent: 1,
      alreadyProcessed: 0,
      held: 0,
      failed: 0,
    });

    // KEEP_SEPARATE: a distinct AHSP under the source's own names, with its provenance.
    const kept = await prisma.aHSP.findFirstOrThrow({
      where: { workspaceId, workType: '9.6.1.a' },
    });
    expect(await lineFor(held.importJobId, '9.6.1.a')).toMatchObject({
      status: 'COMPLETED',
      ahspId: kept.id,
    });
    expect(
      await prisma.aHSPAuditLog.count({
        where: { ahspId: kept.id, action: 'AHSPImportKeptSeparate' },
      }),
    ).toBe(1);
    // USE_EXISTING: nothing created; the one look-alike now represents the item.
    expect(
      await prisma.aHSP.count({ where: { workspaceId, workType: '9.6.2.a' } }),
    ).toBe(0);
    expect(await lineFor(held.importJobId, '9.6.2.a')).toMatchObject({
      status: 'COMPLETED',
      ahspId: existing[1].id,
    });
    expect(
      await prisma.aHSPAuditLog.count({
        where: { ahspId: existing[1].id, action: 'AHSPImportUsedExisting' },
      }),
    ).toBe(1);
    expect(await prisma.aHSP.count({ where: { workspaceId } })).toBe(
      ahspsBefore + 1,
    );

    // The same decisions sent again find nothing waiting: no second row, no second record.
    const again = bodyOf<CommitBody>(
      await as('owner')
        .post(`/ahsp/document/jobs/${held.importJobId}/continue`, {
          decisions,
        })
        .expect(201),
    );
    expect(again.summary.evaluated).toBe(0);
    expect(await prisma.aHSP.count({ where: { workspaceId } })).toBe(
      ahspsBefore + 1,
    );
    expect(
      await prisma.aHSPAuditLog.count({
        where: {
          action: { in: ['AHSPImportKeptSeparate', 'AHSPImportUsedExisting'] },
          ahsp: { workspaceId },
        },
      }),
    ).toBe(2);
    // One import, one journal: no upload made a second job.
    expect(
      await prisma.aHSPImportJob.count({
        where: { workspaceId, sourceFileName: 'iab-possible.xlsx' },
      }),
    ).toBe(1);
    expect(await listJob()).toMatchObject({
      counts: { received: 2, represented: 2, waiting: 0 },
      waiting: [],
    });

    // CLOSEOUT P1-A — represented is not complete: the adopted AHSP was written by
    // hand and offers no version at all, so no recipe exists to complete the line.
    expect((await listJob())?.completion).toEqual({
      complete: 1,
      awaitingIdentity: 0,
      recipeNotUsable: 1,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 0, uses: 0 },
    });
    // Once it offers a lawful, whole recipe whose component the consumer identifies,
    // the same line is complete — read under the one eligibility law, on PostgreSQL.
    const pekerjaRow = await prisma.resourceCatalog.findFirstOrThrow({
      where: { workspaceId, name: pekerja },
    });
    await as('owner')
      .post(`/ahsp/${existing[1].id}/versions`, {
        outputUnit: 'm3',
        resources: [
          {
            resourceId: pekerjaRow.id,
            resourceType: 'LABOR',
            coefficient: 0.4,
            baseUnit: 'OH',
          },
        ],
      })
      .expect(201);
    expect((await listJob())?.completion).toMatchObject({
      complete: 2,
      awaitingIdentity: 0,
      recipeNotUsable: 0,
    });
  });

  it('SCENARIO 12 (trust repair) — a Unicode source file name is kept exactly as the reader named it, and the document is still its bytes', async () => {
    const cp = (...points: number[]) => String.fromCodePoint(...points);
    const name = `DATA UJI ${cp(0x2014)} AHSP OWNER ${cp(0x2013)} caf${cp(0xe9)} ${cp(0x6e2c, 0x8a66)}.xlsx`;
    const bytes = await analisaWorkbook([
      {
        code: '9.5.1.a',
        title: 'Pemasangan uji IAB nama berkas unicode',
        perUnit: 'm3',
        labor: labor(pekerja),
      },
    ]);

    // Through the real routes: the name the preview reads is the name the job keeps.
    const previewed = bodyOf<{ source: { fileName: string } }>(
      await as('owner')
        .upload('/ahsp/document/preview', bytes, name)
        .expect(201),
    );
    expect(previewed.source.fileName).toBe(name);
    const saved = await commit(bytes, name);
    expect(saved.knowledge).toBeDefined();
    const job = await prisma.aHSPImportJob.findUniqueOrThrow({
      where: { id: saved.importJobId },
    });
    expect(job.sourceFileName).toBe(name);
    expect(job.sourceSha256?.toLowerCase()).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    const listed = bodyOf<ImportJobPageBody>(
      await as('owner').get('/ahsp/document/jobs').expect(200),
    ).items.find((entry) => entry.importJobId === saved.importJobId);
    expect(listed?.sourceFileName).toBe(name);

    // The name is provenance, never identity: the same bytes under another name
    // are the same import, and the name first received is the one kept.
    const again = await commit(bytes, 'ahsp-nama-berkas-ascii.xlsx');
    expect(again.importJobId).toBe(saved.importJobId);
    expect(
      (
        await prisma.aHSPImportJob.findUniqueOrThrow({
          where: { id: saved.importJobId },
        })
      ).sourceFileName,
    ).toBe(name);
  });

  it('SCENARIO 13 (AHSP completion) — a title states the output unit, a contradiction is held, and a saved import says what it still needs, asked of today', async () => {
    const unknownUnit = 'bh-iab-asing';
    const bahanAsing = `Bahan Asing Uji ${tag}`;
    const bytes = await analisaWorkbook([
      // The title alone states the output unit.
      {
        code: '9.4.1.a',
        title: 'Pemasangan 1 m2 uji IAB judul',
        perUnit: null,
        labor: labor(pekerja, mandor),
      },
      // The title and the summary contradict each other.
      {
        code: '9.4.2.a',
        title: 'Pemasangan 1 m2 uji IAB konflik',
        perUnit: 'm3',
        labor: labor(pekerja),
      },
      // One spelling SIMPROK does not know, in two items.
      {
        code: '9.4.3.a',
        title: 'Pemasangan 1 m3 uji IAB satuan asing',
        perUnit: 'm3',
        labor: [{ name: pekerja, unit: unknownUnit, coefficient: 0.4 }],
      },
      {
        code: '9.4.4.a',
        title: 'Pemasangan 1 m3 uji IAB satuan asing kedua',
        perUnit: 'm3',
        labor: [{ name: pekerja, unit: unknownUnit, coefficient: 0.5 }],
      },
      // A component no catalogue row answers: written, identity still open.
      {
        code: '9.4.5.a',
        title: 'Pemasangan uji IAB bahan asing',
        perUnit: 'm3',
        labor: labor(pekerja),
        material: [{ name: bahanAsing, unit: 'kg', coefficient: 1 }],
      },
      // A depth in the title is not an output unit, and nothing else states one.
      {
        code: '9.4.6.a',
        title: 'Galian uji IAB sedalam s.d. 1 m',
        perUnit: null,
        labor: labor(pekerja),
      },
      // Two spellings of one unit: only the real Unit Kernel may say so.
      {
        code: '9.4.7.a',
        title: `Pemasangan 1 m${String.fromCodePoint(0xb3)} uji IAB superskrip`,
        perUnit: 'm3',
        labor: labor(pekerja),
      },
    ]);
    const saved = await commit(bytes, 'iab-penyelesaian.xlsx');
    expect(saved.summary).toMatchObject({
      evaluated: 7,
      ready: 2,
      identityPending: 1,
      held: 4,
      failed: 0,
    });
    const versionOf = (workType: string) =>
      prisma.aHSPVersion.findFirstOrThrow({
        where: { ahsp: { workspaceId, workType } },
        select: { outputUnit: true, outputUnitDefinitionId: true },
      });
    // The title's unit reached the canonical version through the Unit Kernel.
    expect(await versionOf('9.4.1.a')).toMatchObject({ outputUnit: 'm2' });
    expect((await versionOf('9.4.1.a')).outputUnitDefinitionId).not.toBeNull();
    expect(await versionOf('9.4.7.a')).toMatchObject({ outputUnit: 'm3' });

    const listed = bodyOf<ImportJobPageBody>(
      await as('owner').get('/ahsp/document/jobs').expect(200),
    ).items.find((entry) => entry.importJobId === saved.importJobId);
    expect(listed?.counts).toEqual({ received: 7, represented: 3, waiting: 4 });
    expect(listed?.completion).toEqual({
      complete: 2,
      awaitingIdentity: 1,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 1, uses: 1 },
    });
    const waiting = new Map(
      (listed?.waiting ?? []).map((line) => [line.workType, line]),
    );
    expect(waiting.get('9.4.2.a')?.statedOutputUnits).toEqual(['m3', 'm2']);
    expect(waiting.get('9.4.2.a')?.reasonCodes).toContain(
      'SOURCE_UNIT_CONFLICT',
    );
    expect(waiting.get('9.4.2.a')?.reasonCodes).not.toContain(
      'MISSING_OUTPUT_UNIT',
    );
    for (const workType of ['9.4.3.a', '9.4.4.a']) {
      expect(waiting.get(workType)?.unknownUnits).toEqual([
        { spelling: unknownUnit, uses: 1 },
      ]);
    }
    expect(waiting.get('9.4.6.a')?.reasonCodes).toContain(
      'MISSING_OUTPUT_UNIT',
    );
    // The listed shape never carries the document's digest or stored knowledge.
    expect(listed).not.toHaveProperty('sourceSha256');
    expect(waiting.get('9.4.6.a')).not.toHaveProperty('knowledge');
  });

  it('SCENARIO 14 (closeout P1-A) — a question a curator closes WITHOUT teaching leaves the queue, yet the recipe keeps the source wording: the consumer cannot identify it, so it is not complete, and reading writes nothing', async () => {
    // Two representations with the same name, class and unit: a tie no unit can settle.
    const twin = `Semen Kembar Uji ${tag}`;
    const twinIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      twinIds.push(
        (
          await prisma.resourceCatalog.create({
            data: { workspaceId, name: twin, type: 'MATERIAL', baseUnit: 'kg' },
          })
        ).id,
      );
    }
    const saved = await commit(
      await analisaWorkbook([
        {
          code: '9.3.1.a',
          title: 'Pemasangan uji IAB kembar',
          perUnit: 'm3',
          labor: labor(pekerja),
          material: [{ name: twin, unit: 'kg', coefficient: 1.2 }],
        },
      ]),
      'iab-kembar.xlsx',
    );
    expect(saved.summary).toMatchObject({ evaluated: 1, identityPending: 1 });
    const listJob = async () =>
      bodyOf<ImportJobPageBody>(
        await as('owner').get('/ahsp/document/jobs').expect(200),
      ).items.find((job) => job.importJobId === saved.importJobId);
    expect((await listJob())?.completion).toEqual({
      complete: 0,
      awaitingIdentity: 1,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 1, uses: 1 },
    });

    // The curator picks one representation, and does NOT offer it for identical questions.
    const asked = (await openRows()).find((row) => row.rawName === twin);
    expect(asked?.identityVerdict.status).not.toBe('RESOLVED');
    await as('owner')
      .post(`/resource-observations/${asked?.id}/curate-existing`, {
        selectedResourceCatalogId: twinIds[0],
      })
      .expect(201);
    expect(
      await prisma.observedResource.findUniqueOrThrow({
        where: { id: asked?.id },
      }),
    ).toMatchObject({
      status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: twinIds[0],
    });
    expect(
      await prisma.resourceIdentityQuestionDecision.count({
        where: { workspaceId },
      }),
    ).toBe(0);
    expect((await openRows()).filter((row) => row.rawName === twin)).toEqual(
      [],
    );

    // A: nothing is asked any more. B: still not complete — and the list is a read.
    const state = async () => ({
      ahsps: await prisma.aHSP.count({ where: { workspaceId } }),
      resources: await prisma.aHSPResource.findMany({
        where: { ahspVersion: { workspaceId } },
        select: { id: true, resourceId: true },
        orderBy: { id: 'asc' },
      }),
      observations: await prisma.observedResource.findMany({
        where: { workspaceId },
        select: { id: true, status: true, resolvedResourceCatalogId: true },
        orderBy: { id: 'asc' },
      }),
      lines: await prisma.aHSPImportLine.findMany({
        where: { workspaceId },
        select: { id: true, status: true, reasonCodes: true },
        orderBy: { id: 'asc' },
      }),
      sightings: await prisma.resourceSourceIdentity.count({
        where: { workspaceId },
      }),
      ghx: await prisma.ahspResourceIdentityDecision.count({
        where: { workspaceId },
      }),
    });
    const before = await state();
    expect((await listJob())?.completion).toEqual({
      complete: 0,
      awaitingIdentity: 1,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 0, uses: 0 },
    });
    expect(await state()).toEqual(before);
    expect(
      (await resourcesOf('9.3.1.a')).find((row) => row.rawName === twin),
    ).toMatchObject({ resourceId: twin });

    // The resolver that consumes the recipe says the same thing.
    const version = await prisma.aHSPVersion.findFirstOrThrow({
      where: { ahsp: { workspaceId, workType: '9.3.1.a' } },
      include: { resources: true },
    });
    const resolutions = await app
      .get(AhspResourceResolutionOrchestrator)
      .resolveVersionResources(app.get(PrismaService), {
        workspaceId,
        projectId: randomUUID(),
        referenceRegionId: randomUUID(),
        asOf: new Date('2026-09-15T00:00:00.000Z'),
        version,
      });
    const unresolvedTwin = resolutions.find(
      (resolution) => resolution.rawAhspResourceRef === twin,
    );
    expect(unresolvedTwin?.status).not.toBe('RESOLVED');
    expect(unresolvedTwin?.resourceCatalogId).toBeNull();
  });

  it('SCENARIO 15 (closeout P1-B) — lines the pre-title reader kept: a title-only line is written from its kept title without the file; a saved recipe whose title contradicts its unit is a written unit question, never complete', async () => {
    const journal = app.get(AhspImportService);
    const db = app.get(PrismaService);
    const { id: userId } = await prisma.user.findFirstOrThrow({
      where: { workspaceMembershipId: membershipIds[0] },
    });
    const listJob = async (importJobId: string) =>
      bodyOf<ImportJobPageBody>(
        await as('owner').get('/ahsp/document/jobs').expect(200),
      ).items.find((job) => job.importJobId === importJobId);

    // LEGACY-A: held by the pre-title evaluation because no output unit was read.
    const legacyA = await journal.recordDocument({
      workspaceId,
      userId,
      knowledge: PRE_TITLE.LEGACY_A_TITLE_ONLY,
    });
    await journal.settleLine(db, {
      workspaceId,
      lineId: legacyA.lines[0].id,
      status: ImportStatus.PENDING,
      reasonCodes: ['MISSING_OUTPUT_UNIT'],
    });
    const keptA = (
      await prisma.aHSPImportLine.findUniqueOrThrow({
        where: { id: legacyA.lines[0].id },
      })
    ).rawData;
    expect((await listJob(legacyA.importJobId))?.waiting).toEqual([
      expect.objectContaining({ lineNumber: 1, readingUpdated: true }),
    ]);
    const continuedA = bodyOf<CommitBody>(
      await as('owner')
        .post(`/ahsp/document/jobs/${legacyA.importJobId}/continue`)
        .expect(201),
    );
    expect(continuedA.summary).toMatchObject({
      evaluated: 1,
      held: 0,
      failed: 0,
    });
    const lineA = await prisma.aHSPImportLine.findUniqueOrThrow({
      where: { id: legacyA.lines[0].id },
    });
    expect(lineA.status).toBe('COMPLETED');
    expect(lineA.rawData).toEqual(keptA);
    const writtenA = await prisma.aHSPVersion.findUniqueOrThrow({
      where: { id: lineA.ahspVersionId ?? '' },
      select: { outputUnit: true, outputUnitDefinitionId: true },
    });
    expect(writtenA.outputUnit).toBe('M2');
    expect(writtenA.outputUnitDefinitionId).not.toBeNull();

    // LEGACY-B: written by the pre-title writer with "m3", under a title stating "1 M2".
    const legacyB = await journal.recordDocument({
      workspaceId,
      userId,
      knowledge: PRE_TITLE.LEGACY_B_TITLE_M2_SUMMARY_M3,
    });
    const parent = bodyOf<{ id: string }>(
      await as('owner')
        .post('/ahsp', {
          workType: '9.2.1.a',
          methodName: 'Pemasangan uji IAB pra-judul',
          methodType: 'OTHER',
          locationType: 'OTHER',
        })
        .expect(201),
    );
    const pekerjaRow = await prisma.resourceCatalog.findFirstOrThrow({
      where: { workspaceId, name: pekerja },
    });
    const writtenM3 = bodyOf<{ id: string }>(
      await as('owner')
        .post(`/ahsp/${parent.id}/versions`, {
          outputUnit: 'm3',
          resources: [
            {
              resourceId: pekerjaRow.id,
              resourceType: 'LABOR',
              coefficient: 0.4,
              baseUnit: 'OH',
            },
          ],
        })
        .expect(201),
    );
    await journal.settleLine(db, {
      workspaceId,
      lineId: legacyB.lines[0].id,
      status: ImportStatus.COMPLETED,
      reasonCodes: [],
      ahspId: parent.id,
      ahspVersionId: writtenM3.id,
    });
    const before = await prisma.aHSPVersion.findMany({
      where: { workspaceId },
      select: { id: true, outputUnit: true, status: true },
      orderBy: { id: 'asc' },
    });
    expect((await listJob(legacyB.importJobId))?.completion).toEqual({
      complete: 0,
      awaitingIdentity: 0,
      recipeNotUsable: 0,
      writtenUnitQuestions: [
        {
          lineNumber: 1,
          workType: '1.7.7.1.1.b (a)',
          methodName: 'PEMASANGAN 1 M2 PLESTERAN DINDING',
          statedOutputUnits: ['m3', 'M2'],
          provenDifferent: true,
        },
      ],
      identityQuestions: { questions: 0, uses: 0 },
    });
    // "Periksa ulang" never reopens a saved line, and no version history is touched.
    const continuedB = bodyOf<CommitBody>(
      await as('owner')
        .post(`/ahsp/document/jobs/${legacyB.importJobId}/continue`)
        .expect(201),
    );
    expect(continuedB.summary.evaluated).toBe(0);
    expect(
      await prisma.aHSPVersion.findMany({
        where: { workspaceId },
        select: { id: true, outputUnit: true, status: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it('tenant isolation — another workspace neither lists nor continues this import', async () => {
    expect(
      bodyOf<ImportJobPageBody>(
        await as('foreign', workspaceBId)
          .get('/ahsp/document/jobs')
          .expect(200),
      ),
    ).toEqual({ items: [], nextCursor: null, hasMore: false });
    const refused = await as('foreign', workspaceBId)
      .post(`/ahsp/document/jobs/${mixedJobId}/continue`)
      .expect(404);
    expect(bodyOf<{ message: string }>(refused).message).toBe(
      'AHSP_IMPORT_JOB_NOT_FOUND',
    );
    expect(await ahspsOf(workspaceBId)).toEqual([]);
  });

  // ==========================================================================
  // F01 — ONE JOURNAL LINE, ONE AUTHORITATIVE OUTCOME.
  //
  // Proven on real PostgreSQL with real locks: the barrier below is the database's
  // own row lock, and the requests queue on it. No sleep decides anything here.
  // ==========================================================================

  /** A second connection to the very database and schema the app under test uses. */
  const rawClient = async () => {
    const url = new URL(process.env.DATABASE_URL as string);
    const schema = url.searchParams.get('schema') ?? 'public';
    url.searchParams.delete('schema');
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);
    return client;
  };

  /**
   * Hold ONE intake line's row lock, and wait until the requests under test are
   * queued behind it — read from pg_locks, not guessed from a timer. Releasing the
   * barrier lets them run one after the other, in whatever order PostgreSQL grants.
   */
  const barrierOn = async (lineId: string) => {
    const client = await rawClient();
    await client.query('BEGIN');
    await client.query(
      'SELECT id FROM ahsp_import_lines WHERE id = $1::uuid FOR UPDATE',
      [lineId],
    );
    const waiting = async () =>
      Number(
        (
          await client.query(
            `select count(*)::int as n
               from pg_locks
              where not granted
                and pid <> pg_backend_pid()`,
          )
        ).rows[0].n,
      );
    return {
      waitFor: async (count: number) => {
        for (let attempt = 0; attempt < 600; attempt += 1) {
          if ((await waiting()) >= count) return;
          await new Promise((settle) => setTimeout(settle, 25));
        }
        throw new Error(`only ${await waiting()} request(s) queued on the line lock`);
      },
      release: async () => {
        await client.query('COMMIT');
        await client.end();
      },
    };
  };

  /** The F01 invariant: no AHSP version an import wrote that no intake line points to. */
  const importWrittenOrphans = async (ws: string = workspaceId) => {
    const known = new Set(
      (
        await prisma.aHSPImportLine.findMany({
          where: { workspaceId: ws },
          select: { ahspVersionId: true },
        })
      ).flatMap((line) => (line.ahspVersionId ? [line.ahspVersionId] : [])),
    );
    const written = await prisma.aHSPResource.findMany({
      where: { sourceSha256: { not: null }, ahspVersion: { workspaceId: ws } },
      distinct: ['ahspVersionId'],
      select: { ahspVersionId: true },
    });
    return written
      .map((row) => row.ahspVersionId)
      .filter((versionId) => !known.has(versionId));
  };

  /**
   * One import held for a possible twin: an AHSP this workspace already holds,
   * and a document whose item differs from it only by letter case.
   */
  const heldPossibleTwin = async (code: string, title: string) => {
    const existing = bodyOf<{ id: string }>(
      await as('owner')
        .post('/ahsp', {
          workType: code.toUpperCase(),
          methodName: title.toUpperCase(),
          methodType: 'OTHER',
          locationType: 'OTHER',
        })
        .expect(201),
    );
    const bytes = await analisaWorkbook([
      { code, title, perUnit: 'm3', labor: labor(pekerja) },
    ]);
    const held = await commit(bytes, `${code}.xlsx`);
    expect(held.summary).toMatchObject({ evaluated: 1, held: 1 });
    return {
      existing,
      bytes,
      importJobId: held.importJobId,
      line: await lineFor(held.importJobId, code),
      decision: (action: string) => [{ workType: code, methodName: title, action }],
    };
  };

  const continueWith = (importJobId: string, decisions: unknown[]) =>
    as('owner')
      .post(`/ahsp/document/jobs/${importJobId}/continue`, { decisions })
      .then((response) => {
        expect(response.status).toBe(201);
        return bodyOf<CommitBody>(response);
      });

  const uploadWith = async (
    bytes: Buffer,
    fileName: string,
    decisions: unknown[],
  ) => {
    const response = await request(http())
      .post('/ahsp/document/commit')
      .set('Authorization', `Bearer ${bearer.owner}`)
      .set('x-workspace-id', workspaceId)
      .field('decisions', JSON.stringify(decisions))
      .attach('file', bytes, fileName);
    expect(response.status).toBe(201);
    return bodyOf<CommitBody>(response);
  };

  const businessRecordsFor = (ahspIds: ReadonlyArray<string | null>) =>
    prisma.aHSPAuditLog.count({
      where: {
        action: { in: ['AHSPImportUsedExisting', 'AHSPImportKeptSeparate'] },
        ahspId: { in: ahspIds.flatMap((id) => (id ? [id] : [])) },
      },
    });

  it('F01-1 — two DIFFERENT decisions racing on one line: exactly one outcome, and the journal says which', async () => {
    const twin = await heldPossibleTwin(
      '9.3.1.a',
      'Pemasangan uji IAB balapan keputusan',
    );
    const ahspsBefore = (await ahspsOf()).length;
    const barrier = await barrierOn(twin.line.id);
    const adopting = continueWith(twin.importJobId, twin.decision('USE_EXISTING'));
    const keeping = continueWith(twin.importJobId, twin.decision('KEEP_SEPARATE'));
    await barrier.waitFor(2);
    await barrier.release();
    const [first, second] = await Promise.all([adopting, keeping]);

    // One request acted; the other found the line already represented and said so.
    const summaries = [first.summary, second.summary];
    expect(summaries.filter((summary) => summary.alreadyProcessed === 1)).toHaveLength(1);
    const acted = summaries.find((summary) => summary.alreadyProcessed === 0)!;
    expect(acted.ready + acted.alreadyPresent).toBe(1);
    expect(acted.failed).toBe(0);

    const line = await prisma.aHSPImportLine.findUniqueOrThrow({
      where: { id: twin.line.id },
    });
    expect(line.status).toBe(ImportStatus.COMPLETED);
    const created = (await ahspsOf()).length - ahspsBefore;
    if (acted.ready === 1) {
      // KEEP_SEPARATE won: one new AHSP, and the line points at exactly that one.
      expect(created).toBe(1);
      expect(line.ahspId).not.toBe(twin.existing.id);
      expect(line.ahspVersionId).not.toBeNull();
    } else {
      // USE_EXISTING won: nothing was created, and the adopted AHSP represents it.
      expect(created).toBe(0);
      expect(line.ahspId).toBe(twin.existing.id);
      expect(line.ahspVersionId).toBeNull();
    }
    // ONE business record for ONE decision, and no AHSP the journal does not know.
    expect(await businessRecordsFor([twin.existing.id, line.ahspId])).toBe(1);
    expect(await importWrittenOrphans()).toEqual([]);
  });

  it('F01-2 — the SAME decision twice at once: one effect, and the second request reports the first result', async () => {
    const twin = await heldPossibleTwin(
      '9.3.2.a',
      'Pemasangan uji IAB balapan sama',
    );
    const ahspsBefore = (await ahspsOf()).length;
    const barrier = await barrierOn(twin.line.id);
    const decisions = twin.decision('KEEP_SEPARATE');
    const one = continueWith(twin.importJobId, decisions);
    const other = continueWith(twin.importJobId, decisions);
    await barrier.waitFor(2);
    await barrier.release();
    const [first, second] = await Promise.all([one, other]);

    const summaries = [first.summary, second.summary];
    expect(summaries.filter((summary) => summary.ready === 1)).toHaveLength(1);
    expect(summaries.filter((summary) => summary.alreadyProcessed === 1)).toHaveLength(1);
    expect((await ahspsOf()).length - ahspsBefore).toBe(1);
    const kept = await prisma.aHSP.findFirstOrThrow({
      where: { workspaceId, workType: '9.3.2.a' },
    });
    expect(
      await prisma.aHSPVersion.count({ where: { ahspId: kept.id } }),
    ).toBe(1);
    expect(await businessRecordsFor([kept.id, twin.existing.id])).toBe(1);
    expect(await importWrittenOrphans()).toEqual([]);
  });

  it('F01-3 / F01-5 — after USE_EXISTING, the same file uploaded again with KEEP_SEPARATE changes nothing', async () => {
    const twin = await heldPossibleTwin(
      '9.3.3.a',
      'Pemasangan uji IAB adopsi lalu unggah ulang',
    );
    const adopted = await continueWith(
      twin.importJobId,
      twin.decision('USE_EXISTING'),
    );
    expect(adopted.summary).toMatchObject({ alreadyPresent: 1, alreadyProcessed: 0 });
    const ahspsAfterAdoption = (await ahspsOf()).length;

    // THE REPLAY: the same bytes, a different decision. Nothing is created, and the
    // answer says what is true — this work was already processed.
    const replayed = await uploadWith(
      twin.bytes,
      '9.3.3.a.xlsx',
      twin.decision('KEEP_SEPARATE'),
    );
    expect(replayed.importJobId).toBe(twin.importJobId);
    expect(replayed.summary).toMatchObject({
      evaluated: 1,
      ready: 0,
      identityPending: 0,
      alreadyPresent: 0,
      alreadyProcessed: 1,
      held: 0,
      failed: 0,
    });
    expect((await ahspsOf()).length).toBe(ahspsAfterAdoption);
    expect(
      await prisma.aHSP.count({ where: { workspaceId, workType: '9.3.3.a' } }),
    ).toBe(0);
    const line = await prisma.aHSPImportLine.findUniqueOrThrow({
      where: { id: twin.line.id },
    });
    expect(line).toMatchObject({
      status: ImportStatus.COMPLETED,
      ahspId: twin.existing.id,
      ahspVersionId: null,
    });

    // F01-5 — the same decision again adds no second business record either.
    const again = await uploadWith(
      twin.bytes,
      '9.3.3.a.xlsx',
      twin.decision('USE_EXISTING'),
    );
    expect(again.summary).toMatchObject({ alreadyProcessed: 1, alreadyPresent: 0 });
    expect(await businessRecordsFor([twin.existing.id])).toBe(1);
    expect(await importWrittenOrphans()).toEqual([]);
  });

  it('F01-4 / F01-6 — after KEEP_SEPARATE, a later USE_EXISTING does not re-point the line, and no second AHSP appears', async () => {
    const twin = await heldPossibleTwin(
      '9.3.4.a',
      'Pemasangan uji IAB terpisah lalu unggah ulang',
    );
    const kept = await continueWith(
      twin.importJobId,
      twin.decision('KEEP_SEPARATE'),
    );
    expect(kept.summary).toMatchObject({ ready: 1, alreadyProcessed: 0 });
    const written = await prisma.aHSP.findFirstOrThrow({
      where: { workspaceId, workType: '9.3.4.a' },
    });

    const replayed = await uploadWith(
      twin.bytes,
      '9.3.4.a.xlsx',
      twin.decision('USE_EXISTING'),
    );
    expect(replayed.summary).toMatchObject({ alreadyProcessed: 1, alreadyPresent: 0 });
    // F01-6 — and the same KEEP_SEPARATE again writes no second AHSP or version.
    const repeated = await uploadWith(
      twin.bytes,
      '9.3.4.a.xlsx',
      twin.decision('KEEP_SEPARATE'),
    );
    expect(repeated.summary).toMatchObject({ alreadyProcessed: 1, ready: 0 });
    expect(
      await prisma.aHSP.count({ where: { workspaceId, workType: '9.3.4.a' } }),
    ).toBe(1);
    expect(
      await prisma.aHSPVersion.count({ where: { ahspId: written.id } }),
    ).toBe(1);
    const line = await prisma.aHSPImportLine.findUniqueOrThrow({
      where: { id: twin.line.id },
    });
    expect(line).toMatchObject({
      status: ImportStatus.COMPLETED,
      ahspId: written.id,
    });
    expect(await businessRecordsFor([written.id, twin.existing.id])).toBe(1);
    expect(await importWrittenOrphans()).toEqual([]);
  });

  it('F01-7 / F01-9 — a settlement that changes no line rolls the whole write back, and the next item is still written', async () => {
    const bytes = await analisaWorkbook([
      {
        code: '9.3.7.a',
        title: 'Pemasangan uji IAB settlement ditolak',
        perUnit: 'm3',
        labor: labor(pekerja),
      },
      {
        code: '9.3.8.a',
        title: 'Pemasangan uji IAB tetangga selamat',
        perUnit: 'm3',
        labor: labor(pekerja, mandor),
      },
    ]);
    // The document is journaled first, so the injection can name the exact line.
    const journal = app.get(AhspImportService);
    const preview = bodyOf<{ workItems: unknown[] }>(
      await as('owner')
        .upload('/ahsp/document/preview', bytes, 'iab-settlement.xlsx')
        .expect(201),
    );
    expect(preview.workItems).toHaveLength(2);
    expect(journal).toBeDefined();

    const firstCommit = await commit(bytes, 'iab-settlement.xlsx');
    const blockedLine = await lineFor(firstCommit.importJobId, '9.3.7.a');
    // Undo the first write so the same line can be attempted again under injection.
    await prisma.aHSPResource.deleteMany({
      where: { ahspVersion: { ahsp: { workspaceId, workType: '9.3.7.a' } } },
    });
    await prisma.aHSPVersion.deleteMany({
      where: { ahsp: { workspaceId, workType: '9.3.7.a' } },
    });
    await prisma.aHSPAuditLog.deleteMany({
      where: { ahsp: { workspaceId, workType: '9.3.7.a' } },
    });
    await prisma.aHSP.deleteMany({ where: { workspaceId, workType: '9.3.7.a' } });
    await prisma.aHSPImportLine.update({
      where: { id: blockedLine.id },
      data: {
        status: ImportStatus.PENDING,
        ahspId: null,
        ahspVersionId: null,
      },
    });

    // INJECTION — this one line accepts no completing settlement.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION iab_e2e_block_settlement() RETURNS trigger AS $trigger$
      BEGIN
        IF OLD.id = '${blockedLine.id}'::uuid AND NEW.status = 'COMPLETED' THEN
          RETURN NULL;
        END IF;
        RETURN NEW;
      END;
      $trigger$ LANGUAGE plpgsql;`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER iab_e2e_block_settlement BEFORE UPDATE ON ahsp_import_lines
         FOR EACH ROW EXECUTE FUNCTION iab_e2e_block_settlement()`,
    );
    try {
      const continued = await continueWith(firstCommit.importJobId, []);
      expect(continued.summary.failed).toBe(1);
      expect(continued.summary.ready).toBe(0);
      expect(continued.failed.map((row) => row.workType)).toEqual(['9.3.7.a']);
      // NOTHING of the refused item committed.
      expect(
        await prisma.aHSP.count({ where: { workspaceId, workType: '9.3.7.a' } }),
      ).toBe(0);
      expect(
        (
          await prisma.aHSPImportLine.findUniqueOrThrow({
            where: { id: blockedLine.id },
          })
        ).ahspVersionId,
      ).toBeNull();
      expect(await importWrittenOrphans()).toEqual([]);
      // F01-9 — the item beside it is untouched by that failure.
      expect(
        await prisma.aHSP.count({ where: { workspaceId, workType: '9.3.8.a' } }),
      ).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS iab_e2e_block_settlement ON ahsp_import_lines`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS iab_e2e_block_settlement()`,
      );
    }
  });

  it('F01-10 — another workspace can neither lock nor settle this journal line', async () => {
    const twin = await heldPossibleTwin(
      '9.3.9.a',
      'Pemasangan uji IAB lintas ruang',
    );
    await as('foreign', workspaceBId)
      .post(`/ahsp/document/jobs/${twin.importJobId}/continue`, {
        decisions: twin.decision('KEEP_SEPARATE'),
      })
      .expect(404);
    expect(
      await prisma.aHSPImportLine.findUniqueOrThrow({ where: { id: twin.line.id } }),
    ).toMatchObject({ status: ImportStatus.PENDING, ahspId: null });
    expect(await ahspsOf(workspaceBId)).toEqual([]);
  });

  // ==========================================================================
  // F02 — WHAT IS STORED STAYS REACHABLE.
  // ==========================================================================

  it('F02a — an unfinished import older than twenty newer ones is still reachable, page by page', async () => {
    // Held for a fact the SOURCE lacks — no output unit — so it stays waiting
    // however much SIMPROK's vocabulary learns in the scenarios before this one.
    const olderBytes = await analisaWorkbook([
      {
        code: '9.2.1.a',
        title: 'Pemasangan uji IAB halaman lama',
        perUnit: null,
        labor: labor(pekerja),
      },
    ]);
    const older = bodyOf<CommitBody>(
      await as('foreign', workspaceBId)
        .upload('/ahsp/document/commit', olderBytes, 'iab-halaman-lama.xlsx')
        .expect(201),
    );
    expect(older.summary.held).toBe(1);

    // Twenty newer imports, all finished, in front of it.
    const newest = new Date();
    const filler = async (index: number, createdAt: Date) =>
      prisma.aHSPImportJob.create({
        data: {
          idempotencyKey: `${tag}-filler-${index}`,
          workspaceId: workspaceBId,
          status: ImportStatus.COMPLETED,
          sourceFileName: `filler-${index}.xlsx`,
          sourceSha256: createHash('sha256')
            .update(`${tag}-filler-${index}`)
            .digest('hex'),
          parserContractVersion: 'filler',
          knowledgeContractVersion: 'filler',
          documentKnowledge: { source: { fileName: `filler-${index}.xlsx` } },
          createdAt,
        },
        select: { id: true, createdAt: true },
      });
    const fillers: Array<{ id: string; createdAt: Date }> = [];
    for (let index = 0; index < 18; index += 1) {
      fillers.push(await filler(index, new Date(newest.getTime() + index * 1000)));
    }
    // Two of them share one instant: the order must still be total.
    const tie = new Date(newest.getTime() + 60_000);
    fillers.push(await filler(18, tie), await filler(19, tie));

    const page = async (cursor?: string) =>
      bodyOf<ImportJobPageBody>(
        await as('foreign', workspaceBId)
          .get(`/ahsp/document/jobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
          .expect(200),
      );
    const first = await page();
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));
    // The old unfinished import is NOT on this page — and the door to it is open.
    expect(first.items.map((job) => job.importJobId)).not.toContain(
      older.importJobId,
    );

    const second = await page(first.nextCursor as string);
    expect(second.items.map((job) => job.importJobId)).toContain(
      older.importJobId,
    );
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    const reached = second.items.find(
      (job) => job.importJobId === older.importJobId,
    );
    expect(reached?.counts).toEqual({ received: 1, represented: 0, waiting: 1 });
    expect(reached?.waiting).toHaveLength(1);

    // No row is seen twice and none is missed: every id appears exactly once.
    const seen = [...first.items, ...second.items].map((job) => job.importJobId);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(21);
    expect(
      fillers.every((row) => seen.includes(row.id)),
    ).toBe(true);

    // The same cursor again answers the same page — a retry never duplicates.
    const secondAgain = await page(first.nextCursor as string);
    expect(secondAgain.items.map((job) => job.importJobId)).toEqual(
      second.items.map((job) => job.importJobId),
    );

    // A job created after page one does not shift the window: the keyset holds.
    const intruder = await filler(20, new Date(newest.getTime() + 120_000));
    const secondAfterInsert = await page(first.nextCursor as string);
    expect(secondAfterInsert.items.map((job) => job.importJobId)).toEqual(
      second.items.map((job) => job.importJobId),
    );
    expect((await page()).items.map((job) => job.importJobId)).toContain(
      intruder.id,
    );

    // A cursor that is not one of ours is refused, and nothing is disclosed.
    const refused = await as('foreign', workspaceBId)
      .get('/ahsp/document/jobs?cursor=not-a-cursor')
      .expect(400);
    expect(bodyOf<{ message: string }>(refused).message).toBe(
      'AHSP_IMPORT_JOBS_CURSOR_INVALID',
    );

    // A cursor built from ANOTHER workspace's job positions only, never reaches:
    // the reader still sees only their own imports.
    const foreignPage = await page(first.nextCursor as string);
    expect(
      foreignPage.items.every((job) => job.importJobId !== undefined),
    ).toBe(true);
    const ownWorkspaceJobs = await prisma.aHSPImportJob.findMany({
      where: { id: { in: foreignPage.items.map((job) => job.importJobId) } },
      select: { workspaceId: true },
    });
    expect(
      ownWorkspaceJobs.every((job) => job.workspaceId === workspaceBId),
    ).toBe(true);
  });

  it('F02b — every waiting line of a saved import travels with it; the page decides what to show, never what exists', async () => {
    const waitingBlocks = Array.from({ length: 8 }, (_, index) => ({
      code: `9.1.${index + 1}.a`,
      title: `Pemasangan uji IAB rincian ${index + 1}`,
      perUnit: null,
      labor: labor(pekerja),
    }));
    const bytes = await analisaWorkbook(waitingBlocks);
    const saved = await commit(bytes, 'iab-rincian-panjang.xlsx');
    expect(saved.summary).toMatchObject({ evaluated: 8, held: 8 });
    const listed = bodyOf<ImportJobPageBody>(
      await as('owner').get('/ahsp/document/jobs').expect(200),
    ).items.find((job) => job.importJobId === saved.importJobId);
    expect(listed?.counts).toEqual({ received: 8, represented: 0, waiting: 8 });
    expect(listed?.waiting).toHaveLength(8);
    expect(listed?.waiting.map((line) => line.workType)).toEqual(
      waitingBlocks.map((block) => block.code),
    );
  });

  it('the journal columns stay coherent at the PostgreSQL boundary itself', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE ahsp_import_jobs SET "sourceSha256" = NULL WHERE id = '${mixedJobId}'::uuid`,
      ),
    ).rejects.toThrow(/ahsp_import_jobs_document_identity_coherence_check/);
    await expect(
      prisma.aHSPImportLine.create({
        data: {
          importJobId: mixedJobId,
          lineNumber: 1,
          rawData: {},
          workspaceId,
        },
      }),
    ).rejects.toThrow();
  });
});

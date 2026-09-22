import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConstructionClassificationLevel } from '@prisma/client';
import { ConstructionClassificationService } from './construction-classification.service';
import {
  assertLawfulParentRelation,
  normalizeClassificationName,
} from './construction-classification.policy';
import {
  JENIS_PENGADAAN_OPTIONS,
  JENIS_PENGADAAN_WITH_BIDANG,
} from './jenis-pengadaan.vocabulary';

type Row = {
  id: string;
  level: ConstructionClassificationLevel;
  name: string;
  normalizedName: string;
  code: string | null;
  parentId: string | null;
  workspaceId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function uuid() {
  return crypto.randomUUID();
}

function createPrismaFake() {
  const rows: Row[] = [];

  function filterRows(where: Record<string, unknown>): Row[] {
    return rows.filter((row) => rowMatches(row, where));
  }

  function rowMatches(row: Row, where: Record<string, unknown>): boolean {
    if (Array.isArray(where.AND)) {
      return (where.AND as Array<Record<string, unknown>>).every((c) =>
        rowMatches(row, c),
      );
    }
    if (where.isActive !== undefined && row.isActive !== where.isActive) {
      return false;
    }
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.level !== undefined && row.level !== where.level) return false;
    if ('parentId' in where && row.parentId !== where.parentId) return false;
    if (
      where.normalizedName !== undefined &&
      typeof where.normalizedName === 'string' &&
      row.normalizedName !== where.normalizedName
    ) {
      return false;
    }

    const hasOr = Array.isArray(where.OR);
    if ('workspaceId' in where && !hasOr) {
      if (row.workspaceId !== where.workspaceId) return false;
    }

    if (hasOr) {
      const ors = where.OR as Array<Record<string, unknown>>;
      const visibilityStyle = ors.every(
        (c) => 'workspaceId' in c && Object.keys(c).length === 1,
      );
      if (visibilityStyle) {
        const visOk = ors.some((c) => row.workspaceId === c.workspaceId);
        if (!visOk) return false;
      } else {
        const textOk = ors.some((clause) => {
          if (
            clause.normalizedName &&
            typeof clause.normalizedName === 'object'
          ) {
            const c = (clause.normalizedName as { contains?: string }).contains;
            return c ? row.normalizedName.includes(c) : false;
          }
          if (clause.name && typeof clause.name === 'object') {
            const c = (clause.name as { contains?: string }).contains;
            return c
              ? row.name.toLowerCase().includes(String(c).toLowerCase())
              : false;
          }
          if (clause.code && typeof clause.code === 'object') {
            const c = (clause.code as { contains?: string }).contains;
            return c && row.code
              ? row.code.toLowerCase().includes(String(c).toLowerCase())
              : false;
          }
          if ('workspaceId' in clause) {
            return row.workspaceId === clause.workspaceId;
          }
          return false;
        });
        if (!textOk) return false;
      }
    }
    return true;
  }

  const client = {
    constructionClassificationNode: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        filterRows(where)[0] ?? null,
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
      }) => {
        void orderBy;
        let out = filterRows(where);
        if (typeof take === 'number') out = out.slice(0, take);
        return out;
      },
      create: async ({
        data,
      }: {
        data: Omit<Row, 'id' | 'createdAt' | 'updatedAt'> & Partial<Row>;
      }) => {
        const clash = rows.find(
          (r) =>
            r.isActive &&
            r.level === data.level &&
            r.normalizedName === data.normalizedName &&
            r.parentId === (data.parentId ?? null) &&
            r.workspaceId === (data.workspaceId ?? null),
        );
        if (clash) {
          const { Prisma } = await import('@prisma/client');
          throw new Prisma.PrismaClientKnownRequestError('Unique', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const row: Row = {
          id: uuid(),
          level: data.level!,
          name: data.name!,
          normalizedName: data.normalizedName!,
          code: data.code ?? null,
          parentId: data.parentId ?? null,
          workspaceId: data.workspaceId ?? null,
          isActive: data.isActive ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(row);
        return row;
      },
    },
    _rows: rows,
  };

  return client;
}

describe('AHSP Slice 1 — Shared Classification Foundation', () => {
  const wsA = '10000000-0000-4000-8000-0000000000a1';
  const wsB = '10000000-0000-4000-8000-0000000000b2';

  function harness() {
    const prisma = createPrismaFake();
    const service = new ConstructionClassificationService(
      prisma as unknown as ConstructorParameters<
        typeof ConstructionClassificationService
      >[0],
    );
    return { prisma, service };
  }

  // ---- policy unit (lineage law) ----

  it('T-S1-05 policy: illegal parent-level relation rejected', () => {
    const v = assertLawfulParentRelation({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      parent: {
        id: 'p',
        level: ConstructionClassificationLevel.JENIS_PENGADAAN,
        isActive: true,
        workspaceId: null,
      },
      workspaceId: wsA,
    });
    expect(v).toBe('PARENT_LEVEL_MISMATCH');
  });

  it('normalizeClassificationName collapses whitespace/case', () => {
    expect(normalizeClassificationName('  Drainase   Jalan ')).toBe(
      'drainase jalan',
    );
  });

  // ---- service ----

  it('T-S1-01 valid JENIS_PENGADAAN root creation/read', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
      parentId: null,
    });
    expect(root.level).toBe(ConstructionClassificationLevel.JENIS_PENGADAAN);
    expect(root.parentId).toBeNull();
    expect(root.workspaceId).toBeNull();
    const read = await service.getById({ id: root.id, workspaceId: wsA });
    expect(read.id).toBe(root.id);
  });

  it('T-S1-02 Kategori requires Jenis Pengadaan parent', async () => {
    const { service } = harness();
    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.KATEGORI,
        name: 'Bina Marga',
        workspaceId: wsA,
        parentId: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const kat = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Bina Marga',
      workspaceId: wsA,
      parentId: root.id,
    });
    expect(kat.parentId).toBe(root.id);
  });

  it('T-S1-03 Subkategori requires Kategori parent', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.SUBKATEGORI,
        name: 'Jalan',
        workspaceId: wsA,
        parentId: root.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const kat = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Bina Marga',
      workspaceId: wsA,
      parentId: root.id,
    });
    const sub = await service.createNode({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: 'Jalan',
      workspaceId: wsA,
      parentId: kat.id,
    });
    expect(sub.parentId).toBe(kat.id);
  });

  it('T-S1-04 Jenis Pekerjaan requires Subkategori parent', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const kat = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Bina Marga',
      workspaceId: wsA,
      parentId: root.id,
    });
    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.JENIS_PEKERJAAN,
        name: 'Lapisan Aspal',
        workspaceId: wsA,
        parentId: kat.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const sub = await service.createNode({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: 'Jalan',
      workspaceId: wsA,
      parentId: kat.id,
    });
    const jp = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PEKERJAAN,
      name: 'Lapisan Aspal',
      workspaceId: wsA,
      parentId: sub.id,
    });
    expect(jp.level).toBe(ConstructionClassificationLevel.JENIS_PEKERJAAN);
  });

  it('T-S1-05 service: illegal parent-level relation rejected', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.JENIS_PEKERJAAN,
        name: 'X',
        workspaceId: wsA,
        parentId: root.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('T-S1-06 GLOBAL node visible to workspace', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pengadaan Barang',
      workspaceId: null,
    });
    await expect(
      service.getById({ id: root.id, workspaceId: wsA }),
    ).resolves.toMatchObject({ id: root.id });
  });

  it('T-S1-07 workspace node visible to its workspace', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const kat = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Custom WS-A',
      workspaceId: wsA,
      parentId: root.id,
    });
    await expect(
      service.getById({ id: kat.id, workspaceId: wsA }),
    ).resolves.toMatchObject({ id: kat.id });
  });

  it('T-S1-08 workspace A node invisible to workspace B', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const kat = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Private A',
      workspaceId: wsA,
      parentId: root.id,
    });
    await expect(
      service.getById({ id: kat.id, workspaceId: wsB }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('T-S1-09 workspace custom creation does NOT create/promote GLOBAL node', async () => {
    const { service, prisma } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const kat = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Local Only',
      workspaceId: wsA,
      parentId: root.id,
    });
    expect(kat.workspaceId).toBe(wsA);
    const globals = prisma._rows.filter(
      (r) => r.workspaceId === null && r.normalizedName === 'local only',
    );
    expect(globals).toHaveLength(0);
  });

  it('T-S1-10 duplicate within same lawful identity scope rejected', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Drainase',
      workspaceId: wsA,
      parentId: root.id,
    });
    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.KATEGORI,
        name: '  drainase ',
        workspaceId: wsA,
        parentId: root.id,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('T-S1-11 same label under distinct lawful parent does not collapse', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const kat1 = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Bina Marga',
      workspaceId: wsA,
      parentId: root.id,
    });
    const kat2 = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Cipta Karya',
      workspaceId: wsA,
      parentId: root.id,
    });
    const a = await service.createNode({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: 'Drainase',
      workspaceId: wsA,
      parentId: kat1.id,
    });
    const b = await service.createNode({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: 'Drainase',
      workspaceId: wsA,
      parentId: kat2.id,
    });
    expect(a.id).not.toBe(b.id);
    expect(a.parentId).toBe(kat1.id);
    expect(b.parentId).toBe(kat2.id);
  });

  it('T-S1-12 full lineage Jenis Pengadaan → … → Jenis Pekerjaan', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const kat = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Bina Marga',
      workspaceId: wsA,
      parentId: root.id,
    });
    const sub = await service.createNode({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: 'Jalan',
      workspaceId: wsA,
      parentId: kat.id,
    });
    const jp = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PEKERJAAN,
      name: 'Aspal',
      workspaceId: wsA,
      parentId: sub.id,
    });
    const lineage = await service.getLineage({
      id: jp.id,
      workspaceId: wsA,
    });
    expect(lineage.path.map((p) => p.level)).toEqual([
      ConstructionClassificationLevel.JENIS_PENGADAAN,
      ConstructionClassificationLevel.KATEGORI,
      ConstructionClassificationLevel.SUBKATEGORI,
      ConstructionClassificationLevel.JENIS_PEKERJAAN,
    ]);
    expect(lineage.path.map((p) => p.name)).toEqual([
      'Pekerjaan Konstruksi',
      'Bina Marga',
      'Jalan',
      'Aspal',
    ]);
  });

  it('T-S1-13 canonical name/code search works', async () => {
    const { service } = harness();
    // Fix search visibility: create via service then search with patched method
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
      code: 'JP-PK',
    });
    const hits = await service.search({
      workspaceId: wsA,
      query: 'JP-PK',
    });
    // Note: if visibility OR overwritten, search may still find by text on all rows
    // in our fake (no visibility filter on search OR path). Assert name/code hit.
    expect(hits.some((h) => h.id === root.id)).toBe(true);
    const byName = await service.search({
      workspaceId: wsA,
      query: 'pekerjaan',
    });
    expect(byName.some((h) => h.id === root.id)).toBe(true);
  });

  it('T-S1-14 global search is not hard-locked to one selected parent', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const kat1 = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Alpha',
      workspaceId: wsA,
      parentId: root.id,
    });
    const kat2 = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Beta',
      workspaceId: wsA,
      parentId: root.id,
    });
    const s1 = await service.createNode({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: 'SharedLabel',
      workspaceId: wsA,
      parentId: kat1.id,
    });
    const s2 = await service.createNode({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: 'SharedLabel',
      workspaceId: wsA,
      parentId: kat2.id,
    });
    const preferred = await service.search({
      workspaceId: wsA,
      query: 'SharedLabel',
      preferredParentId: kat1.id,
    });
    expect(preferred.map((p) => p.id)).toContain(s1.id);
    expect(preferred.map((p) => p.id)).toContain(s2.id);
    expect(preferred[0].id).toBe(s1.id);
  });

  it('T-S1-15 existing Jenis Pengadaan authority is reused, not duplicated', () => {
    const sharedPath = join(
      process.cwd(),
      '..',
      'shared',
      'jenis-pengadaan.vocabulary.json',
    );
    const shared = JSON.parse(readFileSync(sharedPath, 'utf8')) as {
      jenisPengadaanOptions: string[];
      jenisPengadaanWithBidang: string[];
    };

    // ONE write authority: shared JSON. Backend + frontend are consumers.
    expect(JENIS_PENGADAAN_OPTIONS).toEqual(shared.jenisPengadaanOptions);
    expect(JENIS_PENGADAAN_WITH_BIDANG).toEqual(
      shared.jenisPengadaanWithBidang,
    );

    const fePath = join(
      __dirname,
      '..',
      '..',
      '..',
      'frontend',
      'src',
      'jenisPengadaanVocabulary.ts',
    );
    const feSrc = readFileSync(fePath, 'utf8');
    expect(feSrc).toContain('shared/jenis-pengadaan.vocabulary.json');
    expect(feSrc).not.toMatch(/'Pengadaan Barang'/);

    const bePath = join(__dirname, 'jenis-pengadaan.vocabulary.ts');
    const beSrc = readFileSync(bePath, 'utf8');
    expect(beSrc).toContain('shared/jenis-pengadaan.vocabulary.json');
    expect(beSrc).not.toMatch(/'Pengadaan Barang'/);

    const pagePath = join(
      __dirname,
      '..',
      '..',
      '..',
      'frontend',
      'src',
      'pages',
      'ProjectSetupPage.tsx',
    );
    const pageSrc = readFileSync(pagePath, 'utf8');
    expect(pageSrc).toContain('jenisPengadaanVocabulary');
    expect(pageSrc).toContain('JENIS_PENGADAAN_OPTIONS');
    expect(pageSrc).not.toMatch(
      /const kategoriOptions = \[\s*'Pengadaan Barang'/,
    );
  });

  it('root law: workspace cannot mint independent JENIS_PENGADAAN', async () => {
    const { service } = harness();
    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.JENIS_PENGADAAN,
        name: 'Pekerjaan Konstruksi',
        workspaceId: wsA,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('GLOBAL generic root law: out-of-vocabulary JENIS_PENGADAAN rejected before Prisma create', async () => {
    const { service, prisma } = harness();
    const originalCreate = prisma.constructionClassificationNode.create.bind(
      prisma.constructionClassificationNode,
    );
    let createCalls = 0;
    prisma.constructionClassificationNode.create = (async (args: {
      data: Omit<Row, 'id' | 'createdAt' | 'updatedAt'> & Partial<Row>;
    }) => {
      createCalls += 1;
      return originalCreate(args);
    }) as typeof prisma.constructionClassificationNode.create;

    // Name guaranteed absent from shared vocabulary (not in JENIS_PENGADAAN_OPTIONS).
    const alien = 'SIMPROK-ALIEN-JENIS-PENGADAAN-NOT-IN-VOCAB';
    expect(
      JENIS_PENGADAAN_OPTIONS.some(
        (opt) =>
          normalizeClassificationName(opt) ===
          normalizeClassificationName(alien),
      ),
    ).toBe(false);

    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.JENIS_PENGADAAN,
        name: alien,
        workspaceId: null,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'CLASSIFICATION_GLOBAL_ROOT_NOT_IN_VOCABULARY',
      }),
    });
    expect(createCalls).toBe(0);
    expect(prisma._rows).toHaveLength(0);
  });

  it('tenant/parent scope: workspace A cannot parent under workspace B', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const katB = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Belonging to B',
      workspaceId: wsB,
      parentId: root.id,
    });
    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.SUBKATEGORI,
        name: 'Child of foreign parent',
        workspaceId: wsA,
        parentId: katB.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tenant/parent scope: GLOBAL child cannot hang under workspace parent', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const katLocal = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Local Kat',
      workspaceId: wsA,
      parentId: root.id,
    });
    await expect(
      service.createNode({
        level: ConstructionClassificationLevel.SUBKATEGORI,
        name: 'Global under local',
        workspaceId: null,
        parentId: katLocal.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('visible GLOBAL reuse: workspace create matching GLOBAL reuses it', async () => {
    const { service, prisma } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    const globalKat = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Bina Marga',
      workspaceId: null,
      parentId: root.id,
    });
    const reused = await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Bina Marga',
      workspaceId: wsA,
      parentId: root.id,
    });
    expect(reused.id).toBe(globalKat.id);
    expect(reused.workspaceId).toBeNull();
    expect(
      prisma._rows.filter(
        (r) =>
          r.level === ConstructionClassificationLevel.KATEGORI &&
          r.normalizedName === 'bina marga',
      ),
    ).toHaveLength(1);
  });

  it('T-S1-16 ensureGlobalJenisPengadaanRoots provisions vocabulary only', async () => {
    const { service, prisma } = harness();
    const roots = await service.ensureGlobalJenisPengadaanRoots();
    expect(roots).toHaveLength(JENIS_PENGADAAN_OPTIONS.length);
    expect(prisma._rows.every((r) => r.workspaceId === null)).toBe(true);
    expect(
      prisma._rows.every(
        (r) => r.level === ConstructionClassificationLevel.JENIS_PENGADAAN,
      ),
    ).toBe(true);
    // Idempotent
    const again = await service.ensureGlobalJenisPengadaanRoots();
    expect(again).toHaveLength(JENIS_PENGADAAN_OPTIONS.length);
    expect(prisma._rows).toHaveLength(JENIS_PENGADAAN_OPTIONS.length);
  });

  it('listChildren returns GLOBAL + workspace children of parent', async () => {
    const { service } = harness();
    const root = await service.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      workspaceId: null,
    });
    await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Global Kat',
      workspaceId: null,
      parentId: root.id,
    });
    await service.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Local Kat',
      workspaceId: wsA,
      parentId: root.id,
    });
    const kids = await service.listChildren({
      parentId: root.id,
      workspaceId: wsA,
    });
    expect(kids.map((k) => k.name).sort()).toEqual(['Global Kat', 'Local Kat']);
    const kidsB = await service.listChildren({
      parentId: root.id,
      workspaceId: wsB,
    });
    expect(kidsB.map((k) => k.name)).toEqual(['Global Kat']);
  });
});

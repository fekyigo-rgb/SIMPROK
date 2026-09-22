import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AhspClassificationAssignmentProvenance,
  ConstructionClassificationLevel,
} from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConstructionClassificationService } from '../../construction-classification/construction-classification.service';
import { AhspClassificationAssignmentService } from './ahsp-classification-assignment.service';

type NodeRow = {
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

type AhspRow = {
  id: string;
  workspaceId: string | null;
  fieldCategory: string | null;
  subCategory: string | null;
  classification: string | null;
  deletedAt: Date | null;
};

type AssignmentRow = {
  id: string;
  ahspId: string;
  leafNodeId: string;
  provenance: AhspClassificationAssignmentProvenance;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date();
}

function createHarness() {
  const nodes: NodeRow[] = [];
  const ahsps: AhspRow[] = [];
  const assignments: AssignmentRow[] = [];

  function visibilityOk(row: NodeRow, workspaceId: string) {
    return (
      row.isActive &&
      (row.workspaceId === null || row.workspaceId === workspaceId)
    );
  }

  const classificationPrisma = {
    constructionClassificationNode: {
      findUnique: async (args: { where: { id: string } }) => {
        return nodes.find((row) => row.id === args.where.id) ?? null;
      },
      findFirst: async (args: { where: Record<string, unknown> }) => {
        const w = args.where;
        return (
          nodes.find((row) => {
            if (w.id !== undefined && row.id !== w.id) return false;
            if (w.isActive !== undefined && row.isActive !== w.isActive)
              return false;
            if (w.level !== undefined && row.level !== w.level) return false;
            if ('parentId' in w && row.parentId !== w.parentId) return false;
            if (
              typeof w.normalizedName === 'string' &&
              row.normalizedName !== w.normalizedName
            )
              return false;
            if ('workspaceId' in w && !Array.isArray(w.OR)) {
              if (row.workspaceId !== w.workspaceId) return false;
            }
            if (Array.isArray(w.OR)) {
              const ok = (w.OR as Array<{ workspaceId: string | null }>).some(
                (c) => row.workspaceId === c.workspaceId,
              );
              if (!ok) return false;
            }
            return true;
          }) ?? null
        );
      },
      findMany: async (args?: {
        where?: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
      }) => {
        if (!args?.where) return [...nodes];
        const w = args.where;
        return nodes.filter((row) => {
          if (w.isActive !== undefined && row.isActive !== w.isActive)
            return false;
          if (w.level !== undefined && row.level !== w.level) return false;
          if ('parentId' in w && row.parentId !== w.parentId) return false;
          if (Array.isArray(w.OR)) {
            const ok = (w.OR as Array<{ workspaceId: string | null }>).some(
              (c) => row.workspaceId === c.workspaceId,
            );
            if (!ok) return false;
          }
          if (Array.isArray(w.AND)) {
            // simplified: used by search; not needed for seedPath
            return true;
          }
          return true;
        });
      },
      create: async (args: {
        data: Omit<NodeRow, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
      }) => {
        const row: NodeRow = {
          id: args.data.id ?? uuid(),
          level: args.data.level,
          name: args.data.name,
          normalizedName: args.data.normalizedName,
          code: args.data.code ?? null,
          parentId: args.data.parentId ?? null,
          workspaceId: args.data.workspaceId ?? null,
          isActive: args.data.isActive ?? true,
          createdAt: now(),
          updatedAt: now(),
        };
        nodes.push(row);
        return row;
      },
    },
  };

  const classification = new ConstructionClassificationService(
    classificationPrisma as never,
  );

  const prisma = {
    aHSP: {
      findFirst: async (args: {
        where: { id: string; deletedAt: null };
        select?: Record<string, boolean>;
      }) => {
        const row = ahsps.find(
          (a) => a.id === args.where.id && a.deletedAt === null,
        );
        return row ?? null;
      },
    },
    ahspClassificationAssignment: {
      findUnique: async (args: {
        where: {
          ahspId_leafNodeId_provenance: {
            ahspId: string;
            leafNodeId: string;
            provenance: AhspClassificationAssignmentProvenance;
          };
        };
      }) => {
        const k = args.where.ahspId_leafNodeId_provenance;
        return (
          assignments.find(
            (a) =>
              a.ahspId === k.ahspId &&
              a.leafNodeId === k.leafNodeId &&
              a.provenance === k.provenance,
          ) ?? null
        );
      },
      findMany: async (args: {
        where: { ahspId: string; isActive?: boolean };
        select?: { leafNodeId: true };
        orderBy?: unknown;
      }) => {
        let rows = assignments.filter((a) => a.ahspId === args.where.ahspId);
        if (args.where.isActive !== undefined) {
          rows = rows.filter((a) => a.isActive === args.where.isActive);
        }
        if (args.select) {
          return rows.map((r) => ({ leafNodeId: r.leafNodeId }));
        }
        return rows;
      },
      create: async (args: {
        data: {
          ahspId: string;
          leafNodeId: string;
          provenance: AhspClassificationAssignmentProvenance;
        };
      }) => {
        const row: AssignmentRow = {
          id: uuid(),
          ahspId: args.data.ahspId,
          leafNodeId: args.data.leafNodeId,
          provenance: args.data.provenance,
          isActive: true,
          createdAt: now(),
          updatedAt: now(),
        };
        assignments.push(row);
        return row;
      },
    },
  };

  const service = new AhspClassificationAssignmentService(
    prisma as never,
    classification,
  );

  async function seedPath(input: {
    workspaceId: string | null;
    rootName: string;
    kategori: string;
    sub: string;
    jp: string;
  }) {
    const root = await classification.createNode({
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: input.rootName,
      workspaceId: null,
      parentId: null,
      allowIdempotentReuse: true,
    });
    const kat = await classification.createNode({
      level: ConstructionClassificationLevel.KATEGORI,
      name: input.kategori,
      workspaceId: input.workspaceId,
      parentId: root.id,
      allowIdempotentReuse: true,
    });
    const sub = await classification.createNode({
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: input.sub,
      workspaceId: input.workspaceId,
      parentId: kat.id,
      allowIdempotentReuse: true,
    });
    const jp = await classification.createNode({
      level: ConstructionClassificationLevel.JENIS_PEKERJAAN,
      name: input.jp,
      workspaceId: input.workspaceId,
      parentId: sub.id,
      allowIdempotentReuse: true,
    });
    return { root, kat, sub, jp };
  }

  function seedAhsp(input: {
    workspaceId: string | null;
    fieldCategory?: string | null;
    subCategory?: string | null;
    classification?: string | null;
  }) {
    const row: AhspRow = {
      id: uuid(),
      workspaceId: input.workspaceId,
      fieldCategory: input.fieldCategory ?? 'LEGACY_FIELD',
      subCategory: input.subCategory ?? 'LEGACY_SUB',
      classification: input.classification ?? 'LEGACY_CLASS',
      deletedAt: null,
    };
    ahsps.push(row);
    return row;
  }

  return {
    service,
    classification,
    nodes,
    ahsps,
    assignments,
    seedPath,
    seedAhsp,
    visibilityOk,
  };
}

describe('AhspClassificationAssignmentService (path assignment foundation)', () => {
  const WS = '11111111-1111-1111-1111-111111111111';
  const OTHER_WS = '22222222-2222-2222-2222-222222222222';

  it('T-A1: one AHSP can receive one lawful assignment', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'Bina Marga',
      sub: 'Drainase',
      jp: 'Gorong-gorong',
    });
    const view = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    expect(view.ahspId).toBe(ahsp.id);
    expect(view.leafNodeId).toBe(path.jp.id);
    expect(view.path.map((p) => p.level)).toEqual([
      ConstructionClassificationLevel.JENIS_PENGADAAN,
      ConstructionClassificationLevel.KATEGORI,
      ConstructionClassificationLevel.SUBKATEGORI,
      ConstructionClassificationLevel.JENIS_PEKERJAAN,
    ]);
  });

  it('T-A2/T-A3: same AHSP multiple lawful paths; path relationships intact', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const p1 = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'Bina Marga',
      sub: 'Drainase',
      jp: 'Gorong-gorong',
    });
    const p2 = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'Bina Marga',
      sub: 'Jalan',
      jp: 'Perkerasan',
    });
    await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: p1.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: p2.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    const listed = await h.service.listAssignments({
      ahspId: ahsp.id,
      actingWorkspaceId: WS,
    });
    expect(listed).toHaveLength(2);
    expect(listed[0].path[listed[0].path.length - 1].id).toBe(p1.jp.id);
    expect(listed[1].path[listed[1].path.length - 1].id).toBe(p2.jp.id);
    expect(listed[0].jenisPengadaanRootId).toBe(listed[1].jenisPengadaanRootId);
  });

  it('T-A4/T-A5: single Jenis Pengadaan root; different root rejected', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const p1 = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'Bina Marga',
      sub: 'Drainase',
      jp: 'Gorong-gorong',
    });
    const p2 = await h.seedPath({
      workspaceId: null,
      rootName: 'Jasa Lainnya',
      kategori: 'Perencanaan',
      sub: 'Teknik',
      jp: 'Desain',
    });
    await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: p1.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    await expect(
      h.service.addAssignment({
        ahspId: ahsp.id,
        leafNodeId: p2.jp.id,
        provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
        actingWorkspaceId: WS,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.addAssignment({
        ahspId: ahsp.id,
        leafNodeId: p2.jp.id,
        provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
        actingWorkspaceId: WS,
      }),
    ).rejects.toThrow('AHSP_CLASSIFICATION_ASSIGNMENT_JENIS_PENGADAAN_CONFLICT');
  });

  it('T-A6: GLOBAL canonical nodes may be assigned', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'Global Kat',
      sub: 'Global Sub',
      jp: 'Global JP',
    });
    expect(path.jp.workspaceId).toBeNull();
    const view = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      actingWorkspaceId: WS,
    });
    expect(view.leafNodeId).toBe(path.jp.id);
  });

  it('T-A7: workspace-local lawful nodes assignable in same workspace', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: WS,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'Local Kat',
      sub: 'Local Sub',
      jp: 'Local JP',
    });
    expect(path.jp.workspaceId).toBe(WS);
    const view = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    expect(view.leafNodeId).toBe(path.jp.id);
  });

  it('T-A8: cross-workspace node/path assignment rejected', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const foreign = await h.seedPath({
      workspaceId: OTHER_WS,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'Foreign Kat',
      sub: 'Foreign Sub',
      jp: 'Foreign JP',
    });
    await expect(
      h.service.addAssignment({
        ahspId: ahsp.id,
        leafNodeId: foreign.jp.id,
        provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
        actingWorkspaceId: WS,
      }),
    ).rejects.toThrow();
  });

  it('T-A9: duplicate same assignment is idempotent', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'K',
      sub: 'S',
      jp: 'J',
    });
    const a = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    const b = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    expect(b.id).toBe(a.id);
    expect(h.assignments).toHaveLength(1);
  });

  it('T-A10/T-A11: source-derived + human coexist; human does not overwrite source', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'K',
      sub: 'S',
      jp: 'J',
    });
    const source = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      actingWorkspaceId: WS,
    });
    const human = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    expect(source.id).not.toBe(human.id);
    expect(source.provenance).toBe(
      AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
    );
    expect(human.provenance).toBe(
      AhspClassificationAssignmentProvenance.HUMAN_ADDED,
    );
    const listed = await h.service.listAssignments({
      ahspId: ahsp.id,
      actingWorkspaceId: WS,
    });
    expect(listed).toHaveLength(2);
    expect(
      listed.some(
        (r) =>
          r.provenance === AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      ),
    ).toBe(true);
  });

  it('T-A12: legacy AHSP scalar fields remain unchanged', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({
      workspaceId: WS,
      fieldCategory: 'KEEP_A',
      subCategory: 'KEEP_B',
      classification: 'KEEP_C',
    });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'K',
      sub: 'S',
      jp: 'J',
    });
    await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    const row = h.ahsps.find((a) => a.id === ahsp.id)!;
    expect(row.fieldCategory).toBe('KEEP_A');
    expect(row.subCategory).toBe('KEEP_B');
    expect(row.classification).toBe('KEEP_C');
  });

  it('T-A13: assignment does NOT mint a new classification node', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'K',
      sub: 'S',
      jp: 'J',
    });
    const before = h.nodes.length;
    await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    expect(h.nodes.length).toBe(before);
  });

  it('T-A14: Slice-1 classification guards remain (workspace root forbidden)', async () => {
    const h = createHarness();
    await expect(
      h.classification.createNode({
        level: ConstructionClassificationLevel.JENIS_PENGADAAN,
        name: 'Pekerjaan Konstruksi',
        workspaceId: WS,
        parentId: null,
      }),
    ).rejects.toThrow('CLASSIFICATION_WORKSPACE_ROOT_FORBIDDEN');
  });

  it('T-A15: importer implementation files untouched by this seam', () => {
    const importSvc = join(
      __dirname,
      'ahsp-import.service.ts',
    );
    const canon = join(
      __dirname,
      'ahsp-document-canonicalization.service.ts',
    );
    expect(readFileSync(importSvc, 'utf8').length).toBeGreaterThan(100);
    expect(readFileSync(canon, 'utf8').length).toBeGreaterThan(100);
    // Assignment service must not import importer.
    const assignmentSrc = readFileSync(
      join(__dirname, 'ahsp-classification-assignment.service.ts'),
      'utf8',
    );
    expect(assignmentSrc).not.toMatch(/AhspImportService|ahsp-import\.service/);
    expect(assignmentSrc).not.toMatch(
      /AhspDocumentCanonicalizationService|ahsp-document-canonicalization/,
    );
  });

  it('T-A16: Resource / Unit / IQL not imported by assignment service', () => {
    const assignmentSrc = readFileSync(
      join(__dirname, 'ahsp-classification-assignment.service.ts'),
      'utf8',
    );
    expect(assignmentSrc).not.toMatch(
      /ResourceIdentity|ResourceAdmission|UnitKernel|identical-question|Iql/i,
    );
  });

  it('T-SEC-1: Workspace A cannot create/list assignment for AHSP owned by Workspace B', async () => {
    const h = createHarness();
    const foreignAhsp = h.seedAhsp({ workspaceId: OTHER_WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'K',
      sub: 'S',
      jp: 'J',
    });
    await expect(
      h.service.addAssignment({
        ahspId: foreignAhsp.id,
        leafNodeId: path.jp.id,
        provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
        actingWorkspaceId: WS,
      }),
    ).rejects.toThrow('AHSP_CLASSIFICATION_ASSIGNMENT_WORKSPACE_MISMATCH');
    await expect(
      h.service.listAssignments({
        ahspId: foreignAhsp.id,
        actingWorkspaceId: WS,
      }),
    ).rejects.toThrow('AHSP_CLASSIFICATION_ASSIGNMENT_WORKSPACE_MISMATCH');
  });

  it('T-SEC-2: Workspace A AHSP cannot assign Workspace B local leaf', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const foreign = await h.seedPath({
      workspaceId: OTHER_WS,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'Foreign Kat',
      sub: 'Foreign Sub',
      jp: 'Foreign JP',
    });
    await expect(
      h.service.addAssignment({
        ahspId: ahsp.id,
        leafNodeId: foreign.jp.id,
        provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
        actingWorkspaceId: WS,
      }),
    ).rejects.toThrow();
  });

  it('T-SEC-3: Workspace A AHSP may use lawful GLOBAL path', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'GKat',
      sub: 'GSub',
      jp: 'GJP',
    });
    const view = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      actingWorkspaceId: WS,
    });
    expect(view.leafNodeId).toBe(path.jp.id);
    expect(path.jp.workspaceId).toBeNull();
  });

  it('T-SEC-4: Workspace A AHSP may use lawful Workspace A local path', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: WS,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'AKat',
      sub: 'ASub',
      jp: 'AJP',
    });
    const view = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    expect(view.leafNodeId).toBe(path.jp.id);
    expect(path.jp.workspaceId).toBe(WS);
  });

  it('SOURCE_IDENTITY_SEPARATION: assignment does not mutate AHSP identity/import-facing fields', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({
      workspaceId: WS,
      fieldCategory: 'SRC_KEEP',
      subCategory: 'SUB_KEEP',
      classification: 'CLS_KEEP',
    });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'K',
      sub: 'S',
      jp: 'J',
    });
    const before = { ...h.ahsps.find((a) => a.id === ahsp.id)! };
    await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      actingWorkspaceId: WS,
    });
    await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      actingWorkspaceId: WS,
    });
    const after = h.ahsps.find((a) => a.id === ahsp.id)!;
    expect(after.id).toBe(before.id);
    expect(after.workspaceId).toBe(before.workspaceId);
    expect(after.fieldCategory).toBe(before.fieldCategory);
    expect(after.subCategory).toBe(before.subCategory);
    expect(after.classification).toBe(before.classification);
    expect(after.deletedAt).toBe(before.deletedAt);
    // Service source must not write import/source tables.
    const src = readFileSync(
      join(__dirname, 'ahsp-classification-assignment.service.ts'),
      'utf8',
    );
    expect(src).not.toMatch(
      /aHSP\.update|ahspImportJob|AHSPImport|sourceSha256|SourceEnvelope/,
    );
  });

  it('SOURCE_DUPLICATE_LAW: duplicate SOURCE_DERIVED same path is idempotent', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'K',
      sub: 'S',
      jp: 'J',
    });
    const a = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      actingWorkspaceId: WS,
    });
    const b = await h.service.addAssignment({
      ahspId: ahsp.id,
      leafNodeId: path.jp.id,
      provenance: AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      actingWorkspaceId: WS,
    });
    expect(b.id).toBe(a.id);
    expect(
      h.assignments.filter(
        (r) =>
          r.provenance === AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      ),
    ).toHaveLength(1);
  });

  it('rejects non-Jenis-Pekerjaan leaf', async () => {
    const h = createHarness();
    const ahsp = h.seedAhsp({ workspaceId: WS });
    const path = await h.seedPath({
      workspaceId: null,
      rootName: 'Pekerjaan Konstruksi',
      kategori: 'K',
      sub: 'S',
      jp: 'J',
    });
    await expect(
      h.service.addAssignment({
        ahspId: ahsp.id,
        leafNodeId: path.sub.id,
        provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
        actingWorkspaceId: WS,
      }),
    ).rejects.toThrow(
      'AHSP_CLASSIFICATION_ASSIGNMENT_LEAF_MUST_BE_JENIS_PEKERJAAN',
    );
  });

  it('rejects missing AHSP', async () => {
    const h = createHarness();
    await expect(
      h.service.addAssignment({
        ahspId: uuid(),
        leafNodeId: uuid(),
        provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
        actingWorkspaceId: WS,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

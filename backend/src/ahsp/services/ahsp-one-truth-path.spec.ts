/**
 * Contextual path materialization reuses ConstructionClassificationService.
 * No second node store. No global lower-level provisioning.
 */

import { BadRequestException } from '@nestjs/common';
import { ConstructionClassificationLevel } from '@prisma/client';
import { AhspImportAssistedClassificationService } from './ahsp-import-assisted-classification.service';
import {
  APPROVED_JENIS_PEKERJAAN,
  APPROVED_KATEGORI,
  APPROVED_SUBKATEGORI_BY_KATEGORI,
} from '../../construction-classification/construction-taxonomy.vocabulary';

type StoredNode = {
  id: string;
  level: ConstructionClassificationLevel;
  name: string;
  parentId: string | null;
  workspaceId: string | null;
};

describe('AHSP one-truth contextual path', () => {
  const nodes: StoredNode[] = [
    {
      id: 'root-pk',
      level: ConstructionClassificationLevel.JENIS_PENGADAAN,
      name: 'Pekerjaan Konstruksi',
      parentId: null,
      workspaceId: null,
    },
  ];

  const classification = {
    getById: jest.fn(async ({ id }: { id: string }) => {
      const found = nodes.find((node) => node.id === id);
      if (!found) throw new Error('missing');
      return found;
    }),
    listChildren: jest.fn(async ({ parentId }: { parentId: string }) =>
      nodes.filter((node) => node.parentId === parentId),
    ),
    createNode: jest.fn(
      async (input: {
        level: ConstructionClassificationLevel;
        name: string;
        parentId: string;
        workspaceId: string;
      }) => {
        const node: StoredNode = {
          id: 'node-' + nodes.length,
          level: input.level,
          name: input.name,
          parentId: input.parentId,
          workspaceId: input.workspaceId,
        };
        nodes.push(node);
        return node;
      },
    ),
    getLineage: jest.fn(async ({ id }: { id: string }) => {
      const node = nodes.find((item) => item.id === id);
      return { node, path: node ? [node] : [] };
    }),
  };

  const assignments = { addAssignment: jest.fn().mockResolvedValue({ id: 'asg' }) };
  const prisma = { aHSPImportJob: { findFirst: jest.fn(), update: jest.fn() } };
  let service: AhspImportAssistedClassificationService;

  beforeEach(() => {
    nodes.splice(1);
    jest.clearAllMocks();
    service = new AhspImportAssistedClassificationService(
      prisma as never,
      classification as never,
      assignments as never,
    );
  });

  it('keeps the approved lower-level counts and does not invent a global edge matrix', () => {
    expect(APPROVED_KATEGORI).toHaveLength(20);
    const edges = Object.values(APPROVED_SUBKATEGORI_BY_KATEGORI).reduce(
      (sum, names) => sum + names.length,
      0,
    );
    expect(edges).toBe(99);
    expect(new Set(Object.values(APPROVED_SUBKATEGORI_BY_KATEGORI).flat()).size).toBe(96);
    expect(APPROVED_JENIS_PEKERJAAN).toHaveLength(40);
    expect(APPROVED_SUBKATEGORI_BY_KATEGORI.Umum).toBeUndefined();
  });

  it('reuses the root, creates a missing workspace path once, and repeats without duplicates', async () => {
    const first = await service.materializeWorkspacePath({
      workspaceId: 'ws-a',
      rootId: 'root-pk',
      kategori: 'Cipta Karya',
      subkategori: 'Bangunan Gedung',
      jenisPekerjaan: 'Beton',
    });
    expect(first.workspaceId).toBe('ws-a');
    expect(first.level).toBe(ConstructionClassificationLevel.JENIS_PEKERJAAN);
    const created = classification.createNode.mock.calls.length;
    expect(created).toBe(3);
    for (const call of classification.createNode.mock.calls) {
      expect(call[0].workspaceId).toBe('ws-a');
      expect(call[0].workspaceId).not.toBeNull();
    }
    const second = await service.materializeWorkspacePath({
      workspaceId: 'ws-a',
      rootId: 'root-pk',
      kategori: 'Cipta Karya',
      subkategori: 'Bangunan Gedung',
      jenisPekerjaan: 'Beton',
    });
    expect(second.id).toBe(first.id);
    expect(classification.createNode).toHaveBeenCalledTimes(created);
  });

  it('keeps the same Jenis Pekerjaan name distinct under two Kategori parents', async () => {
    const bina = await service.materializeWorkspacePath({
      workspaceId: 'ws-a',
      rootId: 'root-pk',
      kategori: 'Bina Marga',
      subkategori: 'Jalan',
      jenisPekerjaan: 'Beton',
    });
    const transport = await service.materializeWorkspacePath({
      workspaceId: 'ws-a',
      rootId: 'root-pk',
      kategori: 'Transportasi & Perkeretaapian',
      subkategori: 'Jalan',
      jenisPekerjaan: 'Beton',
    });
    expect(bina.id).not.toBe(transport.id);
    expect(bina.parentId).not.toBe(transport.parentId);
  });

  it('refuses an invented subcategory for a kategori whose baseline children are undefined', async () => {
    await expect(
      service.materializeWorkspacePath({
        workspaceId: 'ws-a',
        rootId: 'root-pk',
        kategori: 'Umum',
        subkategori: 'Bangunan Gedung',
        jenisPekerjaan: 'Beton',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(classification.createNode).not.toHaveBeenCalled();
  });

  it('materializes a pending import path through the existing assignment writer', async () => {
    const result = await service.applyToAhsp({
      ahspId: 'ahsp-1',
      actingWorkspaceId: 'ws-a',
      actorAccountId: 'actor-1',
      context: {
        jenisPengadaanRootId: 'root-pk',
        paths: [],
        pendingPaths: [
          {
            kategori: 'Cipta Karya',
            subkategori: 'Bangunan Gedung',
            jenisPekerjaan: 'Beton',
          },
        ],
        dasarAcuan: null,
        penerbit: null,
      },
    });
    expect(result.applied).toBe(1);
    expect(assignments.addAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        ahspId: 'ahsp-1',
        provenance: 'HUMAN_ADDED',
        actingWorkspaceId: 'ws-a',
      }),
    );
    const leafId = assignments.addAssignment.mock.calls[0][0].leafNodeId as string;
    expect(nodes.some((node) => node.id === leafId && node.workspaceId === 'ws-a')).toBe(true);
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConstructionClassificationLevel as Level, Prisma } from '@prisma/client';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';

const ROOT = '11111111-1111-4111-8111-111111111111';
const CAT = '22222222-2222-4222-8222-222222222222';
const SUB = '33333333-3333-4333-8333-333333333333';

function harness() {
  const tx = {
    project: { create: jest.fn().mockResolvedValue({ id: 'project-created' }) },
    workspaceMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    projectAssignment: { create: jest.fn() },
    boqStructure: { create: jest.fn() },
    projectClassificationSelection: { createMany: jest.fn() },
    projectRegionSelection: { createMany: jest.fn() },
  };
  const prisma = {
    workspace: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const classification = {
    getById: jest.fn().mockResolvedValue({ id: ROOT, name: 'Pekerjaan Konstruksi', level: Level.JENIS_PENGADAAN }),
    createNode: jest.fn().mockImplementation(async ({ level }: { level: Level }) => ({
      id: level === Level.KATEGORI ? CAT : SUB,
      level,
    })),
    getLineage: jest.fn().mockImplementation(async ({ id }: { id: string }) => ({
      node: { id, level: id === ROOT ? Level.JENIS_PENGADAAN : id === CAT ? Level.KATEGORI : Level.SUBKATEGORI },
      path: [{ id: ROOT, level: Level.JENIS_PENGADAAN }],
    })),
  };
  const service = new ProjectService(
    prisma as any, {} as any, {} as any, undefined, undefined, classification as any,
  );
  return { service, tx, classification, prisma };
}

describe('RI-01 classification vocabulary activation (no new engine)', () => {
  it('converts a shared vocabulary path to persisted canonical ids atomically with project', async () => {
    const h = harness();
    const response = await h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-1',
      classificationNodeIds: [ROOT],
      classificationVocabularyPaths: [{ kategori: 'Cipta Karya', subkategori: 'Bangunan Gedung' }],
    }, 'workspace-1');
    expect(response.classificationNodeIds).toEqual([ROOT, CAT, SUB]);
    expect(h.classification.createNode).toHaveBeenNthCalledWith(1, {
      level: Level.KATEGORI, workspaceId: 'workspace-1', parentId: ROOT,
      name: 'Cipta Karya', allowIdempotentReuse: true,
    }, h.tx);
    expect(h.classification.createNode).toHaveBeenNthCalledWith(2, {
      level: Level.SUBKATEGORI, workspaceId: 'workspace-1', parentId: CAT,
      name: 'Bangunan Gedung', allowIdempotentReuse: true,
    }, h.tx);
    expect(h.tx.projectClassificationSelection.createMany).toHaveBeenCalledWith({
      data: [ROOT, CAT, SUB].map((classificationNodeId) => ({
        classificationNodeId, projectId: 'project-created',
      })),
    });
    expect(h.tx.project.create).toHaveBeenCalledTimes(1);
    expect(h.classification.getLineage).toHaveBeenCalledWith(
      { id: CAT, workspaceId: 'workspace-1' }, h.tx,
    );
  });

  it('resolves root via canonical lineage even when KATEGORI precedes the root ID', async () => {
    const h = harness();
    const response = await h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-UNORDERED',
      classificationNodeIds: [CAT, ROOT],
      classificationVocabularyPaths: [{ kategori: 'Cipta Karya', subkategori: 'Bangunan Gedung' }],
    }, 'workspace-1');
    expect(response.classificationNodeIds).toEqual([CAT, ROOT, SUB]);
    expect(h.classification.getLineage).toHaveBeenCalledWith(
      { id: CAT, workspaceId: 'workspace-1' }, h.tx,
    );
    expect(h.classification.getById).toHaveBeenCalledWith(
      { id: ROOT, workspaceId: 'workspace-1' }, h.tx,
    );
    expect(h.tx.projectClassificationSelection.createMany).toHaveBeenCalledTimes(1);
  });

  it('resolves the root when the selection provides only a canonical descendant', async () => {
    const h = harness();
    const response = await h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-DESCENDANT',
      classificationNodeIds: [CAT],
      classificationVocabularyPaths: [{ kategori: 'Cipta Karya' }],
    }, 'workspace-1');
    expect(response.classificationNodeIds).toEqual([CAT]);
    expect(h.classification.getLineage).toHaveBeenCalledWith(
      { id: CAT, workspaceId: 'workspace-1' }, h.tx,
    );
    expect(h.classification.getById).toHaveBeenCalledWith(
      { id: ROOT, workspaceId: 'workspace-1' }, h.tx,
    );
  });

  it('blocks construction vocabulary under Pengadaan Barang with no writes', async () => {
    const h = harness();
    h.classification.getById.mockResolvedValueOnce({ id: ROOT, name: 'Pengadaan Barang', level: Level.JENIS_PENGADAAN });
    await expect(h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-GOODS',
      classificationNodeIds: [ROOT],
      classificationVocabularyPaths: [{ kategori: 'Bina Marga' }],
    }, 'workspace-1')).rejects.toMatchObject({
      message: 'PROJECT_CLASSIFICATION_BASELINE_ROOT_UNSUPPORTED',
    });
    expect(h.classification.createNode).not.toHaveBeenCalled();
    expect(h.tx.project.create).not.toHaveBeenCalled();
  });

  it('keeps an AHSP-created canonical category under Pengadaan Barang', async () => {
    const h = harness();
    const response = await h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-GOODS-CANONICAL',
      classificationNodeIds: [ROOT, CAT],
    }, 'workspace-1');
    expect(response.classificationNodeIds).toEqual([ROOT, CAT]);
    expect(h.classification.createNode).not.toHaveBeenCalled();
    expect(h.tx.projectClassificationSelection.createMany).toHaveBeenCalledWith({
      data: [ROOT, CAT].map((classificationNodeId) => ({
        classificationNodeId, projectId: 'project-created',
      })),
    });
  });

  it('does not write a project or any unapproved category', async () => {
    const h = harness();
    await expect(h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-2',
      classificationNodeIds: [ROOT],
      classificationVocabularyPaths: [{ kategori: 'Untrusted new category' }],
    }, 'workspace-1')).rejects.toMatchObject({
      message: 'PROJECT_CLASSIFICATION_KATEGORI_NOT_APPROVED',
    });
    expect(h.classification.createNode).not.toHaveBeenCalled();
    expect(h.tx.project.create).not.toHaveBeenCalled();
  });

  it('blocks invented subkategori and does not materialize anything', async () => {
    const h = harness();
    await expect(h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-3',
      classificationNodeIds: [ROOT],
      classificationVocabularyPaths: [{ kategori: 'Cipta Karya', subkategori: 'Subkategori palsu' }],
    }, 'workspace-1')).rejects.toMatchObject({
      message: 'PROJECT_CLASSIFICATION_SUBKATEGORI_NOT_APPROVED',
    });
    expect(h.classification.createNode).not.toHaveBeenCalled();
    expect(h.tx.project.create).not.toHaveBeenCalled();
  });

  it('cannot use another workspace root, and cannot create a second root', async () => {
    const h = harness();
    h.classification.getById.mockRejectedValueOnce(new NotFoundException('CLASSIFICATION_NODE_NOT_FOUND'));
    await expect(h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-4', classificationNodeIds: [ROOT],
      classificationVocabularyPaths: [{ kategori: 'Cipta Karya' }],
    }, 'workspace-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.tx.project.create).not.toHaveBeenCalled();
    expect(h.classification.createNode).not.toHaveBeenCalled();
  });

  it('retries the full transaction after a real classification index collision', async () => {
    const h = harness();
    const unique = new Prisma.PrismaClientKnownRequestError('Classification identity collision', {
      code: 'P2002', clientVersion: 'test',
      meta: { target: 'construction_classification_nodes_workspace_identity_uidx' },
    });
    h.classification.createNode.mockRejectedValueOnce(unique);
    const response = await h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-RACE',
      classificationNodeIds: [ROOT],
      classificationVocabularyPaths: [{ kategori: 'Cipta Karya' }],
    }, 'workspace-1');
    expect(response.classificationNodeIds).toEqual([ROOT, CAT]);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(h.classification.createNode).toHaveBeenCalledTimes(2);
    expect(h.tx.project.create).toHaveBeenCalledTimes(1);
    expect(h.tx.projectClassificationSelection.createMany).toHaveBeenCalledTimes(1);
  });

  it('does not retry project-code collisions despite a vocabulary path', async () => {
    const h = harness();
    const unique = new Prisma.PrismaClientKnownRequestError('Project code collision', {
      code: 'P2002', clientVersion: 'test',
      meta: { target: ['workspaceId', 'code'] },
    });
    h.tx.project.create.mockRejectedValueOnce(unique);
    await expect(h.service.create({
      name: 'Pekerjaan', code: 'PRJVOC-CODE-409',
      classificationNodeIds: [ROOT],
      classificationVocabularyPaths: [{ kategori: 'Cipta Karya' }],
    }, 'workspace-1')).rejects.toMatchObject({ status: 409 });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.project.create).toHaveBeenCalledTimes(1);
  });

  it('does not retry classification collision without a vocabulary materialization', async () => {
    const h = harness();
    const unique = new Prisma.PrismaClientKnownRequestError('Unexpected identity collision', {
      code: 'P2002', clientVersion: 'test',
      meta: { target: 'construction_classification_nodes_workspace_identity_uidx' },
    });
    h.tx.project.create.mockRejectedValueOnce(unique);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(h.service.create({
        name: 'Pekerjaan', code: 'PRJVOC-NO-VOCAB',
        classificationNodeIds: [ROOT],
      }, 'workspace-1')).rejects.toMatchObject({ status: 500 });
    } finally {
      log.mockRestore();
    }
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('bounds classification conflict retries to three complete attempts', async () => {
    const h = harness();
    const unique = new Prisma.PrismaClientKnownRequestError('Repeat identity collision', {
      code: 'P2002', clientVersion: 'test',
      meta: { target: ['workspaceId', 'level', 'parentId', 'normalizedName'] },
    });
    h.classification.createNode.mockRejectedValue(unique);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(h.service.create({
        name: 'Pekerjaan', code: 'PRJVOC-THREE',
        classificationNodeIds: [ROOT],
        classificationVocabularyPaths: [{ kategori: 'Cipta Karya' }],
      }, 'workspace-1')).rejects.toMatchObject({ status: 500 });
    } finally {
      log.mockRestore();
    }
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(h.tx.project.create).not.toHaveBeenCalled();
  });

  it('DTO rejects malformed paths and fake UUIDs before handling the request', async () => {
    const valid = plainToInstance(CreateProjectDto, {
      name: 'Pekerjaan', code: 'PRJVOC-5', classificationNodeIds: [ROOT],
      classificationVocabularyPaths: [{ kategori: 'Cipta Karya' }],
    });
    expect(await validate(valid)).toHaveLength(0);
    const invalid = plainToInstance(CreateProjectDto, {
      name: 'Pekerjaan', code: 'PRJVOC-6', classificationNodeIds: ['vocab||bad'],
      classificationVocabularyPaths: [{ kategori: '' }],
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });
});

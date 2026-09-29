/**
 * T-IAC service connection — ConstructionClassificationService + AssignmentService
 * reused through AhspImportAssistedClassificationService (no second engines).
 */

import { BadRequestException } from '@nestjs/common';
import { ConstructionClassificationLevel } from '@prisma/client';
import { AhspImportAssistedClassificationService } from './ahsp-import-assisted-classification.service';
import { AhspClassificationAssignmentProvenance } from '@prisma/client';

describe('AhspImportAssistedClassificationService', () => {
  const classification = {
    ensureGlobalJenisPengadaanRoots: jest.fn().mockResolvedValue([]),
    listVisibleRoots: jest.fn().mockResolvedValue([
      {
        id: 'root-pk',
        level: ConstructionClassificationLevel.JENIS_PENGADAAN,
        name: 'Pekerjaan Konstruksi',
      },
    ]),
    listChildren: jest.fn().mockResolvedValue([]),
    search: jest.fn().mockResolvedValue([]),
    createNode: jest.fn(),
    getLineage: jest.fn(),
  };

  const assignments = {
    addAssignment: jest.fn().mockResolvedValue({ id: 'asg-1' }),
  };

  const prisma = {
    aHSPImportJob: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: AhspImportAssistedClassificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AhspImportAssistedClassificationService(
      prisma as never,
      classification as never,
      assignments as never,
    );
  });

  it('T-IAC-02/03: listRoots reuses ConstructionClassificationService + ensureGlobal', async () => {
    const roots = await service.listRoots('ws-a');
    expect(classification.ensureGlobalJenisPengadaanRoots).toHaveBeenCalled();
    expect(classification.listVisibleRoots).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
    });
    expect(roots[0].name).toBe('Pekerjaan Konstruksi');
  });

  it('T-IAC-10: createLocalNode refuses workspace Jenis Pengadaan root', async () => {
    await expect(
      service.createLocalNode({
        workspaceId: 'ws-a',
        level: ConstructionClassificationLevel.JENIS_PENGADAAN,
        name: 'Fake Root',
        parentId: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(classification.createNode).not.toHaveBeenCalled();
  });

  it('T-IAC-07/08/09: createLocalNode delegates KATEGORI to existing createNode', async () => {
    classification.createNode.mockResolvedValue({ id: 'k-1', name: 'Cipta Karya' });
    await service.createLocalNode({
      workspaceId: 'ws-a',
      level: ConstructionClassificationLevel.KATEGORI,
      name: 'Cipta Karya',
      parentId: 'root-pk',
    });
    expect(classification.createNode).toHaveBeenCalledWith(
      expect.objectContaining({
        level: ConstructionClassificationLevel.KATEGORI,
        workspaceId: 'ws-a',
        parentId: 'root-pk',
        allowIdempotentReuse: true,
      }),
    );
  });

  it('T-IAC-11/12/13: applyToAhsp maps FROM_SOURCE/FROM_USER and can apply both', async () => {
    classification.getLineage.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'root-pk') {
        return {
          node: {
            id: 'root-pk',
            level: ConstructionClassificationLevel.JENIS_PENGADAAN,
            workspaceId: null,
          },
          path: [
            {
              id: 'root-pk',
              level: ConstructionClassificationLevel.JENIS_PENGADAAN,
            },
          ],
        };
      }
      return {
        node: {
          id,
          level: ConstructionClassificationLevel.JENIS_PEKERJAAN,
          workspaceId: null,
        },
        path: [
          {
            id: 'root-pk',
            level: ConstructionClassificationLevel.JENIS_PENGADAAN,
          },
          { id, level: ConstructionClassificationLevel.JENIS_PEKERJAAN },
        ],
      };
    });

    const result = await service.applyToAhsp({
      ahspId: 'ahsp-1',
      actingWorkspaceId: 'ws-a',
      actorAccountId: 'actor-account',
      context: {
        jenisPengadaanRootId: 'root-pk',
        paths: [
          { leafNodeId: 'leaf-src', provenanceHint: 'FROM_SOURCE' },
          { leafNodeId: 'leaf-human', provenanceHint: 'FROM_USER' },
        ],
        dasarAcuan: null,
        penerbit: null,
      },
    });
    expect(result.applied).toBe(2);
    expect(assignments.addAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        leafNodeId: 'leaf-src',
        provenance: AhspClassificationAssignmentProvenance.SOURCE_DERIVED,
      }),
    );
    expect(assignments.addAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        leafNodeId: 'leaf-human',
        provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
      }),
    );
  });

  it('T-IAC-16: empty context applies nothing (retry without paths is noop)', async () => {
    const result = await service.applyToAhsp({
      ahspId: 'ahsp-1',
      actingWorkspaceId: 'ws-a',
      actorAccountId: 'actor-account',
      context: null,
    });
    expect(result.applied).toBe(0);
    expect(assignments.addAssignment).not.toHaveBeenCalled();
  });

  it('T-IAC-15: saveJobContext updates assisted JSON only — source identity fields unread for mutation', async () => {
    prisma.aHSPImportJob.findFirst.mockResolvedValue({
      id: 'job-1',
      sourceSha256: 'abc',
      sourceFileName: 'a.xlsx',
    });
    prisma.aHSPImportJob.update.mockResolvedValue({});
    classification.getLineage.mockImplementation(async ({ id }: { id: string }) => {
      if (id === 'root-pk') {
        return {
          node: {
            id: 'root-pk',
            level: ConstructionClassificationLevel.JENIS_PENGADAAN,
            workspaceId: null,
          },
          path: [
            { id: 'root-pk', level: ConstructionClassificationLevel.JENIS_PENGADAAN },
          ],
        };
      }
      return {
        node: {
          id: 'leaf-1',
          level: ConstructionClassificationLevel.JENIS_PEKERJAAN,
          workspaceId: null,
        },
        path: [
          { id: 'root-pk', level: ConstructionClassificationLevel.JENIS_PENGADAAN },
          { id: 'leaf-1', level: ConstructionClassificationLevel.JENIS_PEKERJAAN },
        ],
      };
    });

    await service.saveJobContext({
      workspaceId: 'ws-a',
      importJobId: 'job-1',
      context: {
        jenisPengadaanRootId: 'root-pk',
        paths: [{ leafNodeId: 'leaf-1', provenanceHint: 'FROM_USER' }],
        dasarAcuan: 'SE 1',
        penerbit: 'Instansi X',
      },
    });

    expect(prisma.aHSPImportJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        assistedClassificationContext: expect.objectContaining({
          penerbit: 'Instansi X',
          dasarAcuan: 'SE 1',
        }),
      },
    });
    const updateArg = prisma.aHSPImportJob.update.mock.calls[0][0];
    expect(updateArg.data.sourceSha256).toBeUndefined();
    expect(updateArg.data.sourceFileName).toBeUndefined();
  });
});

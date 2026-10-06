import { BadRequestException } from '@nestjs/common';
import { ImportStatus } from '@prisma/client';
import {
  AHSP_DOCUMENT_CONTRACT_VERSION,
  AHSP_DOCUMENT_REASON,
  type AhspDocumentKnowledge,
  type AhspResourceKnowledge,
} from '../document/ahsp-document-knowledge';
import { UNIT_REASON, UNIT_RESOLUTION_STATUS } from '../../unit-kernel/unit-kernel.contracts';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';
import { RealityNormalizationEngine } from './reality-normalization.engine';
import {
  inMemoryImportJournal,
  transactionalPrisma,
} from '../../../test/fixtures/ahsp-import-journal.fixture';

const WS = '11111111-1111-4111-8111-111111111111';
const TONNE = '10000000-0000-4000-8000-000000000327';
const PERSON_DAY = '10000000-0000-4000-8000-000000000001';
const EQUIPMENT_DAY = '10000000-0000-4000-8000-000000000260';

interface DecisionRow {
  workspaceId: string;
  importJobId: string;
  importLineId: string;
  occurrenceKey: string;
  unitDefinitionId: string;
  rawUnit: string;
  decidedByUserId: string;
}

function locator(raw: string, row: number) {
  return { sheetName: 'S', locator: 'A' + row, rowNumber: row, raw };
}

function material(name: string, rawUnit: string, row: number): AhspResourceKnowledge {
  return {
    status: 'READY',
    reasonCodes: [],
    group: 'MATERIAL',
    rawName: name,
    rawCode: null,
    rawUnit,
    coefficient: 1,
    nameEvidence: locator(name, row),
    codeEvidence: null,
    unitEvidence: locator(rawUnit, row),
    coefficientEvidence: locator('1', row),
    resolvedResourceCatalogId: null,
    resolvedBaseUnit: null,
  };
}

function equipment(name: string, rawUnit: string): AhspResourceKnowledge {
  return { ...material(name, rawUnit, 4), group: 'EQUIPMENT' };
}

function document(digest: string, resources: AhspResourceKnowledge[]): AhspDocumentKnowledge {
  return {
    contractVersion: AHSP_DOCUMENT_CONTRACT_VERSION,
    source: {
      fileName: digest + '.xlsx',
      contentDigestSha256: digest,
      readerId: 'reader',
      readerContractVersion: 'v1',
      byteSize: 8,
    },
    document: {
      title: null,
      regulationReference: null,
      effectiveDate: null,
      authorityProven: false,
    },
    status: 'UNRESOLVED',
    reasonCodes: [],
    workItems: [
      {
        status: 'UNRESOLVED',
        reasonCodes: [],
        workType: locator('B.1', 1),
        methodName: locator('Galian', 1),
        outputUnitRaw: locator('m3', 1),
        resolvedOutputUnit: null,
        regulationReference: null,
        effectiveDate: null,
        sheetName: 'S',
        resources,
      },
    ],
  };
}

describe('scoped AHSP import unit decision', () => {
  const decisions = new Map<string, DecisionRow>();
  const lines = new Map<string, {
    id: string;
    workspaceId: string;
    importJobId: string;
    lineNumber: number;
    status: ImportStatus;
    rawData: unknown;
  }>();
  const aliasCreate = jest.fn(() => {
    throw new Error('ALIAS_CREATED');
  });
  const definitionCreate = jest.fn(() => {
    throw new Error('UNIT_CREATED');
  });
  const units = {
    resolve: jest.fn(async (raw: string, _target: string, _catalog?: string, context?: string) => {
      if (raw === 'orang-hari' && context === 'EQUIPMENT') {
        return {
          status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
          sourceUnitDefinition: null,
          reasonCodes: [UNIT_REASON.RESOURCE_TYPE_UNIT_INCOMPATIBLE],
        };
      }
      if (raw === 'hari alat' && context === 'LABOR') {
        return {
          status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
          sourceUnitDefinition: null,
          reasonCodes: [UNIT_REASON.RESOURCE_TYPE_UNIT_INCOMPATIBLE],
        };
      }
      if (raw === 'tonne' || raw === 'TONNE') {
        return {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: TONNE },
          reasonCodes: [],
        };
      }
      if (raw === 'gram') {
        return {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: 'gram-id' },
          reasonCodes: [],
        };
      }
      if (raw === 'm3') {
        return {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: 'm3-id' },
          reasonCodes: [],
        };
      }
      return {
        status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
        sourceUnitDefinition: null,
        reasonCodes: [UNIT_REASON.UNKNOWN_UNIT_ALIAS],
      };
    }),
  };
  const definitions = new Map([
    [TONNE, { id: TONNE, code: 'TONNE', aliases: [{ rawAlias: 'tonne' }] }],
    [PERSON_DAY, { id: PERSON_DAY, code: 'PERSON_DAY', aliases: [{ rawAlias: 'orang-hari' }] }],
    [EQUIPMENT_DAY, { id: EQUIPMENT_DAY, code: 'EQUIPMENT_DAY', aliases: [{ rawAlias: 'hari alat' }] }],
    ['gram-id', { id: 'gram-id', code: 'GRAM', aliases: [{ rawAlias: 'gram' }] }],
  ]);
  const { prisma } = transactionalPrisma({
    unitAlias: { create: aliasCreate },
    unitDefinition: {
      create: definitionCreate,
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => definitions.get(where.id) ?? null),
    },
    aHSPImportLine: {
      findFirst: jest.fn(async ({ where }: { where: { workspaceId: string; importJobId: string; lineNumber: number } }) => {
        for (const line of lines.values()) {
          if (
            line.workspaceId === where.workspaceId &&
            line.importJobId === where.importJobId &&
            line.lineNumber === where.lineNumber
          ) {
            return line;
          }
        }
        return null;
      }),
    },
    ahspImportUnitDecision: {
      findMany: jest.fn(async ({ where }: { where: { workspaceId: string; importJobId: string | { in: string[] } } }) => {
        const jobs = typeof where.importJobId === 'string' ? [where.importJobId] : where.importJobId.in;
        return [...decisions.values()].filter(
          (row) => row.workspaceId === where.workspaceId && jobs.includes(row.importJobId),
        );
      }),
      deleteMany: jest.fn(async ({ where }: { where: { importLineId: string; occurrenceKey: string } }) => {
        const key = where.importLineId + ':' + where.occurrenceKey;
        const removed = decisions.delete(key);
        return { count: removed ? 1 : 0 };
      }),
      upsert: jest.fn(async ({
        where,
        create,
        update,
      }: {
        where: { importLineId_occurrenceKey: { importLineId: string; occurrenceKey: string } };
        create: DecisionRow;
        update: Pick<DecisionRow, 'unitDefinitionId' | 'rawUnit' | 'decidedByUserId'>;
      }) => {
        const key = where.importLineId_occurrenceKey.importLineId + ':' + where.importLineId_occurrenceKey.occurrenceKey;
        const existing = decisions.get(key);
        const row = existing ? { ...existing, ...update } : create;
        decisions.set(key, row);
        return row;
      }),
    },
  });
  const versionService = { createVersion: jest.fn(async () => ({ id: 'ver-1' })) };
  const ahspService = {
    create: jest.fn(async () => ({ id: 'ahsp-1' })),
    loadIdentitySurface: jest.fn(async () => []),
  };
  const identity = {
    loadEvidence: jest.fn(async () => ({ catalogCandidates: [], sourceSightings: [], reviewedMappings: [] })),
    resolve: jest.fn(async () => ({ status: 'RESOLVED', resolvedResourceCatalogId: 'catalog-pasir' })),
  };
  const observations = {
    observeMany: jest.fn(async () => undefined),
    decidedIdentityForSourceRows: jest.fn(async () => new Map()),
    acceptHumanDeclaredResourceIn: jest.fn(),
    openQuestionsBySource: jest.fn(async () => new Map()),
  };
  let journal: ReturnType<typeof inMemoryImportJournal>;
  let service: AhspDocumentCanonicalizationService;

  beforeEach(() => {
    decisions.clear();
    lines.clear();
    jest.clearAllMocks();
    units.resolve.mockImplementation(async (raw: string, _target: string, _catalog?: string, context?: string) => {
      if (raw === 'orang-hari' && context === 'EQUIPMENT') {
        return {
          status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
          sourceUnitDefinition: null,
          reasonCodes: [UNIT_REASON.RESOURCE_TYPE_UNIT_INCOMPATIBLE],
        };
      }
      if (raw === 'hari alat' && context === 'LABOR') {
        return {
          status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
          sourceUnitDefinition: null,
          reasonCodes: [UNIT_REASON.RESOURCE_TYPE_UNIT_INCOMPATIBLE],
        };
      }
      if (raw === 'tonne' || raw === 'TONNE') {
        return {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: TONNE },
          reasonCodes: [],
        };
      }
      if (raw === 'gram') {
        return {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: 'gram-id' },
          reasonCodes: [],
        };
      }
      if (raw === 'm3') {
        return {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: 'm3-id' },
          reasonCodes: [],
        };
      }
      return {
        status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
        sourceUnitDefinition: null,
        reasonCodes: [UNIT_REASON.UNKNOWN_UNIT_ALIAS],
      };
    });
    journal = inMemoryImportJournal();
    service = new AhspDocumentCanonicalizationService(
      ahspService as never,
      versionService as never,
      units as never,
      identity as never,
      prisma as never,
      observations as never,
      new RealityNormalizationEngine(),
      { logAction: jest.fn() } as never,
      journal as never,
      { retain: jest.fn() } as never,
      {
        saveJobContext: jest.fn(async ({ context }: { context: unknown }) => context),
        loadJobContext: jest.fn(async () => null),
        applyToAhsp: jest.fn(async () => ({ applied: 0 })),
      } as never,
    );
  });

  function holdLine(importJobId: string, lineNumber: number, resources: AhspResourceKnowledge[]) {
    const id = importJobId + '-line-' + lineNumber;
    lines.set(id, {
      id,
      workspaceId: WS,
      importJobId,
      lineNumber,
      status: ImportStatus.PENDING,
      rawData: document('held-' + importJobId, resources).workItems[0],
    });
    return id;
  }

  it('persists one canonical definition id for one slot and does not create catalog rows', async () => {
    holdLine('job-a', 1, [material('Pasir', 'ton', 2)]);
    const saved = await service.setUnitDecision({
      workspaceId: WS,
      importJobId: 'job-a',
      lineNumber: 1,
      occurrenceKey: 'resource:0',
      unitDefinitionId: TONNE,
      userId: 'user-1',
    });
    expect(saved.rawUnit).toBe('ton');
    expect(saved.unitDefinitionId).toBe(TONNE);
    expect(decisions.size).toBe(1);
    expect(aliasCreate).not.toHaveBeenCalled();
    expect(definitionCreate).not.toHaveBeenCalled();
  });

  it('rejects a unit the kernel does not know and a foreign resource family', async () => {
    holdLine('job-a', 1, [equipment('Excavator', 'hari')]);
    await expect(
      service.setUnitDecision({
        workspaceId: WS,
        importJobId: 'job-a',
        lineNumber: 1,
        occurrenceKey: 'resource:0',
        unitDefinitionId: 'missing',
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setUnitDecision({
        workspaceId: WS,
        importJobId: 'job-a',
        lineNumber: 1,
        occurrenceKey: 'resource:0',
        unitDefinitionId: PERSON_DAY,
        userId: 'user-1',
      }),
    ).rejects.toThrow('AHSP_IMPORT_UNIT_DECISION_INCOMPATIBLE');
    holdLine('job-b', 1, [material('Pekerja', 'orang-hari', 3)]);
    lines.get('job-b-line-1')!.rawData = document('labor', [{ ...material('Pekerja', 'orang-hari', 3), group: 'LABOR' }]).workItems[0];
    await expect(
      service.setUnitDecision({
        workspaceId: WS,
        importJobId: 'job-b',
        lineNumber: 1,
        occurrenceKey: 'resource:0',
        unitDefinitionId: EQUIPMENT_DAY,
        userId: 'user-1',
      }),
    ).rejects.toThrow('AHSP_IMPORT_UNIT_DECISION_INCOMPATIBLE');
    expect(decisions.size).toBe(0);
  });

  it('revises the same slot in place and clears it without a fake unit', async () => {
    holdLine('job-a', 1, [material('Pasir', 'ton', 2)]);
    await service.setUnitDecision({
      workspaceId: WS,
      importJobId: 'job-a',
      lineNumber: 1,
      occurrenceKey: 'resource:0',
      unitDefinitionId: TONNE,
      userId: 'user-1',
    });
    await service.setUnitDecision({
      workspaceId: WS,
      importJobId: 'job-a',
      lineNumber: 1,
      occurrenceKey: 'resource:0',
      unitDefinitionId: 'gram-id',
      userId: 'user-2',
    });
    expect(decisions.size).toBe(1);
    expect([...decisions.values()][0].unitDefinitionId).toBe('gram-id');
    expect([...decisions.values()][0].rawUnit).toBe('ton');
    await service.clearUnitDecision({
      workspaceId: WS,
      importJobId: 'job-a',
      lineNumber: 1,
      occurrenceKey: 'resource:0',
    });
    expect(decisions.size).toBe(0);
    const again = await service.clearUnitDecision({
      workspaceId: WS,
      importJobId: 'job-a',
      lineNumber: 1,
      occurrenceKey: 'resource:0',
    });
    expect(again).toEqual({ cleared: true });
    expect(aliasCreate).not.toHaveBeenCalled();
  });

  it('lets continue consume one slot and leave the other ton unresolved', async () => {
    const recorded = await journal.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge: document('digest-a', [material('Pasir', 'ton', 2), material('Kerikil', 'ton', 3)]),
    });
    const lineId = recorded.lines[0].id;
    decisions.set(lineId + ':resource:0', {
      workspaceId: WS,
      importJobId: recorded.importJobId,
      importLineId: lineId,
      occurrenceKey: 'resource:0',
      unitDefinitionId: TONNE,
      rawUnit: 'ton',
      decidedByUserId: 'user-1',
    });
    const result = await service.continueImportJob({
      workspaceId: WS,
      importJobId: recorded.importJobId,
      userId: 'user-1',
    });
    const resources = result.knowledge.workItems[0].resources;
    expect(resources[0].rawUnit).toBe('ton');
    expect(resources[0].resolvedBaseUnit).toBe('tonne');
    expect(resources[1].rawUnit).toBe('ton');
    expect(resources[1].resolvedBaseUnit).toBeNull();
    expect(resources[1].reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(result.written).toEqual([]);
    expect(aliasCreate).not.toHaveBeenCalled();
    expect(definitionCreate).not.toHaveBeenCalled();
  });

  it('does not let one job decision resolve the same spelling on another job', async () => {
    const first = await journal.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge: document('digest-a', [material('Pasir', 'ton', 2)]),
    });
    const second = await journal.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge: document('digest-b', [material('Pasir', 'ton', 8)]),
    });
    decisions.set(first.lines[0].id + ':resource:0', {
      workspaceId: WS,
      importJobId: first.importJobId,
      importLineId: first.lines[0].id,
      occurrenceKey: 'resource:0',
      unitDefinitionId: TONNE,
      rawUnit: 'ton',
      decidedByUserId: 'user-1',
    });
    const other = await service.continueImportJob({
      workspaceId: WS,
      importJobId: second.importJobId,
      userId: 'user-1',
    });
    expect(other.knowledge.workItems[0].resources[0].resolvedBaseUnit).toBeNull();
    expect(other.knowledge.workItems[0].resources[0].reasonCodes).toContain(
      AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED,
    );
    const chosen = await service.continueImportJob({
      workspaceId: WS,
      importJobId: first.importJobId,
      userId: 'user-1',
    });
    expect(chosen.knowledge.workItems[0].resources[0].resolvedBaseUnit).toBe('tonne');
    expect(chosen.knowledge.workItems[0].resources[0].rawUnit).toBe('ton');
    expect(versionService.createVersion).toHaveBeenCalledWith(
      'ahsp-1',
      expect.objectContaining({
        resources: [expect.objectContaining({ baseUnit: 'tonne' })],
      }),
      expect.anything(),
      expect.objectContaining({
        sourceFacts: [expect.objectContaining({ rawUnit: 'ton' })],
      }),
    );
  });

  it('falls back to the kernel when the slot has no decision', async () => {
    const recorded = await journal.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge: document('digest-c', [material('Semen', 'kg', 2)]),
    });
    units.resolve.mockImplementation(async (raw: string) => {
      if (raw === 'kg' || raw === 'm3') {
        return {
          status: UNIT_RESOLUTION_STATUS.RESOLVED,
          sourceUnitDefinition: { id: raw + '-id' },
          reasonCodes: [],
        };
      }
      return {
        status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
        sourceUnitDefinition: null,
        reasonCodes: [UNIT_REASON.UNKNOWN_UNIT_ALIAS],
      };
    });
    const result = await service.continueImportJob({
      workspaceId: WS,
      importJobId: recorded.importJobId,
      userId: 'user-1',
    });
    expect(result.knowledge.workItems[0].resources[0].resolvedBaseUnit).toBe('kg');
    expect(result.written).toHaveLength(1);
    expect(decisions.size).toBe(0);
  });

  it('opens one durable intake twice without an AHSP and without a second journal', async () => {
    const knowledge = document('digest-intake', [material('Pasir', 'ton', 2)]);
    const first = await service.openImportReview({
      workspaceId: WS,
      userId: 'user-1',
      knowledge,
    });
    const second = await service.openImportReview({
      workspaceId: WS,
      userId: 'user-1',
      knowledge,
    });
    expect(second.importJobId).toBe(first.importJobId);
    expect(second.lines).toEqual(first.lines);
    expect(first.lines).toHaveLength(1);
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(versionService.createVersion).not.toHaveBeenCalled();
    const kept = journal.lines.get(first.lines[0].id);
    expect(kept?.knowledge.resources[0].rawUnit).toBe('ton');
    expect(kept?.status).toBe(ImportStatus.PENDING);
  });

  it('rechecks one decided slot without writing an AHSP and leaves the sibling unresolved', async () => {
    const commitKnowledge = jest.spyOn(
      service as unknown as { commitKnowledge: () => Promise<unknown> },
      'commitKnowledge',
    );
    const writeItem = jest.spyOn(
      service as unknown as { writeItem: () => Promise<unknown> },
      'writeItem',
    );
    const recorded = await journal.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge: document('digest-recheck', [
        material('Pasir', 'ton', 2),
        material('Kerikil', 'ton', 3),
      ]),
    });
    const lineId = recorded.lines[0].id;
    decisions.set(lineId + ':resource:0', {
      workspaceId: WS,
      importJobId: recorded.importJobId,
      importLineId: lineId,
      occurrenceKey: 'resource:0',
      unitDefinitionId: TONNE,
      rawUnit: 'ton',
      decidedByUserId: 'reader-now',
    });
    const reviewed = await service.recheckImportJob({
      workspaceId: WS,
      importJobId: recorded.importJobId,
    });
    const resources = reviewed.knowledge.workItems[0].resources;
    expect(resources[0].rawUnit).toBe('ton');
    expect(resources[0].resolvedBaseUnit).toBe('tonne');
    expect(resources[0].reasonCodes).not.toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(resources[1].rawUnit).toBe('ton');
    expect(resources[1].resolvedBaseUnit).toBeNull();
    expect(resources[1].reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(reviewed.status).toBe(ImportStatus.PENDING);
    expect(reviewed.lines[0].status).toBe(ImportStatus.PENDING);
    expect(reviewed.lines[0].reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    const kept = journal.lines.get(lineId);
    expect(kept?.status).toBe(ImportStatus.PENDING);
    expect(kept?.knowledge.resources[0].rawUnit).toBe('ton');
    expect(kept?.reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(commitKnowledge).not.toHaveBeenCalled();
    expect(writeItem).not.toHaveBeenCalled();
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(versionService.createVersion).not.toHaveBeenCalled();
    expect(aliasCreate).not.toHaveBeenCalled();
    expect(definitionCreate).not.toHaveBeenCalled();
    commitKnowledge.mockRestore();
    writeItem.mockRestore();
  });

  it('keeps a reviewed line ready and unsaved, then the explicit continue writes it once', async () => {
    const commitKnowledge = jest.spyOn(
      service as unknown as { commitKnowledge: () => Promise<unknown> },
      'commitKnowledge',
    );
    const recorded = await journal.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge: document('digest-save', [material('Pasir', 'ton', 2)]),
    });
    const lineId = recorded.lines[0].id;
    decisions.set(lineId + ':resource:0', {
      workspaceId: WS,
      importJobId: recorded.importJobId,
      importLineId: lineId,
      occurrenceKey: 'resource:0',
      unitDefinitionId: TONNE,
      rawUnit: 'ton',
      decidedByUserId: 'reader-now',
    });
    const reviewed = await service.recheckImportJob({
      workspaceId: WS,
      importJobId: recorded.importJobId,
    });
    expect(reviewed.lines[0].status).toBe(ImportStatus.PENDING);
    expect(reviewed.lines[0].reasonCodes).not.toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(journal.lines.get(lineId)?.status).toBe(ImportStatus.PENDING);
    expect(commitKnowledge).not.toHaveBeenCalled();
    expect(ahspService.create).not.toHaveBeenCalled();
    expect(versionService.createVersion).not.toHaveBeenCalled();
    const saved = await service.continueImportJob({
      workspaceId: WS,
      importJobId: recorded.importJobId,
      userId: 'reader-now',
    });
    expect(saved.written).toHaveLength(1);
    expect(ahspService.create).toHaveBeenCalledTimes(1);
    expect(versionService.createVersion).toHaveBeenCalledTimes(1);
    expect(journal.lines.get(lineId)?.knowledge.resources[0].rawUnit).toBe('ton');
    const again = await service.continueImportJob({
      workspaceId: WS,
      importJobId: recorded.importJobId,
      userId: 'reader-now',
    });
    expect(again.written).toHaveLength(0);
    expect(ahspService.create).toHaveBeenCalledTimes(1);
    expect(versionService.createVersion).toHaveBeenCalledTimes(1);
    commitKnowledge.mockRestore();
  });

  it('does not let one job recheck resolve the same spelling on another job', async () => {
    const first = await journal.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge: document('digest-job-a', [material('Pasir', 'ton', 2)]),
    });
    const second = await journal.recordDocument({
      workspaceId: WS,
      userId: 'user-1',
      knowledge: document('digest-job-b', [material('Pasir', 'ton', 8)]),
    });
    decisions.set(first.lines[0].id + ':resource:0', {
      workspaceId: WS,
      importJobId: first.importJobId,
      importLineId: first.lines[0].id,
      occurrenceKey: 'resource:0',
      unitDefinitionId: TONNE,
      rawUnit: 'ton',
      decidedByUserId: 'reader-now',
    });
    const other = await service.recheckImportJob({
      workspaceId: WS,
      importJobId: second.importJobId,
    });
    expect(other.knowledge.workItems[0].resources[0].resolvedBaseUnit).toBeNull();
    expect(other.lines[0].reasonCodes).toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    const chosen = await service.recheckImportJob({
      workspaceId: WS,
      importJobId: first.importJobId,
    });
    expect(chosen.knowledge.workItems[0].resources[0].resolvedBaseUnit).toBe('tonne');
    expect(chosen.lines[0].reasonCodes).not.toContain(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    expect(ahspService.create).not.toHaveBeenCalled();
  });
});

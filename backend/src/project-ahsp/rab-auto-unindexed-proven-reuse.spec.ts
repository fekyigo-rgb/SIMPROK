import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAhspService } from './project-ahsp.service';
import { RabAutoProvenReuseService } from './rab-auto-04-reuse.service';
import {
  buildProvenContextRefreshKey,
  hasGovernedUnindexedSource,
  samePreviouslyDecidedUnindexedWorkFact,
} from './rab-auto-source-proof';

describe('RAB-AUTO-04 governed unindexed legacy reuse', () => {
  const input = {
    projectId: '10000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000001',
    accountId: '30000000-0000-4000-8000-000000000001',
    businessPricingAsOfDate: '2026-11-03',
  };
  const sourceId = '40000000-0000-4000-8000-000000000001';
  const targetId = '50000000-0000-4000-8000-000000000001';
  const version = '60000000-0000-4000-8000-000000000001';
  const region = '70000000-0000-4000-8000-000000000001';
  const priorId = '80000000-0000-4000-8000-000000000001';
  const text = 'Pengecatan Dinding Beton Sandaran';
  const target = {
    id: targetId, boqStructureId: '90000000-0000-4000-8000-000000000001',
    parentId: null, wbsNodeId: null, wbsCode: '1.',
    name: 'Pek. Pengecatan Dinding Beton Sandaran', unit: 'm2',
    ahspVersionId: null, workingOccurrenceId: null,
    calculationOccurrenceId: null, priceOrigin: null,
  };
  const priorPayloadHash = createHash('sha256').update(JSON.stringify({
    boqItemId: sourceId, ahspVersionId: version,
    businessPricingAsOfDate: input.businessPricingAsOfDate,
    referenceRegionId: region, resolutionPolicyVersion: 'E1A_TEST',
  })).digest('hex');
  const prior = {
    ahspVersionId: version, createdByAccountId: input.accountId,
    idempotencyKey: 'e1a-original-approved-choice',
    requestPayloadHash: priorPayloadHash,
    resolutionPolicyVersion: 'E1A_TEST',
    businessPricingAsOfDate: new Date('2026-11-03T00:00:00.000Z'),
    referenceRegionId: region,
  };
  const occurrence = () => {
    const date = input.businessPricingAsOfDate;
    const boqUpdatedAt = '2026-11-02T12:00:00.000Z';
    const key = buildProvenContextRefreshKey({
      projectId: input.projectId, boqItemId: sourceId,
      previousOccurrenceId: priorId, ahspVersionId: version,
      referenceRegionId: region, businessPricingAsOfDate: date,
      boqUpdatedAt,
    });
    const payload = {
      boqItemId: sourceId, ahspVersionId: version,
      businessPricingAsOfDate: date, referenceRegionId: region,
      resolutionPolicyVersion: 'E1A_TEST',
      refreshSourceOccurrenceId: priorId,
      refreshExpectedBoqUpdatedAt: boqUpdatedAt,
    };
    return {
      projectId: input.projectId, workspaceId: input.workspaceId,
      ahspVersionId: version, createdByAccountId: input.accountId,
      businessPricingAsOfDate: new Date(date + 'T00:00:00.000Z'),
      referenceRegionId: region,
      idempotencyKey: key, resolutionPolicyVersion: 'E1A_TEST',
      requestPayloadHash: createHash('sha256')
        .update(JSON.stringify(payload)).digest('hex'),
      previousOccurrenceId: priorId,
      previousOccurrence: prior,
    };
  };
  const source = (patch: Record<string, unknown> = {}) => ({
    id: sourceId, parentId: null, wbsNodeId: null, wbsCode: '1.',
    name: text, unit: 'm2', ahspVersionId: version,
    workingOccurrenceId: '90000000-0000-4000-8000-000000000001',
    calculationOccurrenceId: null, priceOrigin: null,
    workingOccurrence: occurrence(),
    calculationOccurrence: null,
    ...patch,
  });
  const make = (rows: Array<ReturnType<typeof source>>) => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(rows.map((row) => ({ id: row.id }))),
      boqItem: {
        findMany: jest.fn()
          .mockResolvedValueOnce([target])
          .mockResolvedValueOnce(rows),
      },
      projectRegionSelection: { findMany: jest.fn().mockResolvedValue([{ regionId: region }]) },
    };
    const ahsp = { selectForBoqItem: jest.fn().mockResolvedValue({ id: 'new-occurrence' }) };
    return {
      service: new RabAutoProvenReuseService(
        prisma as unknown as PrismaService,
        ahsp as unknown as ProjectAhspService,
      ),
      ahsp, prisma,
    };
  };

  it('recognizes only the complete unchanged specification and exact unit without WBS nodes', () => {
    expect(samePreviouslyDecidedUnindexedWorkFact(target, source())).toBe(true);
    expect(samePreviouslyDecidedUnindexedWorkFact(
      { ...target, name: 'PEKERJAAN PENGECATAN DINDING BETON SANDARAN' },
      source(),
    )).toBe(true);
    for (const t of [
      { name: 'Pek. Pengecatan Dinding Baja Sandaran' },
      { name: 'Pek. Pengecatan Dinding Beton Sandaran 30 cm' },
      { unit: 'm3' }, { wbsCode: '2.' },
      { parentId: 'folder-different' }, { parentId: undefined },
      { wbsNodeId: 'existing-canonical-node' },
    ]) {
      expect(samePreviouslyDecidedUnindexedWorkFact({ ...target, ...t }, source())).toBe(false);
    }
    expect(samePreviouslyDecidedUnindexedWorkFact(
      { ...target, name: 'Pek. Pengecatan Beton' }, source(),
    )).toBe(false);
    // The same nested parent proves the same current ancestor-to-root path.
    expect(samePreviouslyDecidedUnindexedWorkFact(
      { ...target, parentId: 'folder-one' },
      { ...source(), parentId: 'folder-one' },
    )).toBe(true);
    expect(samePreviouslyDecidedUnindexedWorkFact(
      { ...target, parentId: 'folder-one' },
      { ...source(), parentId: 'folder-two' },
    )).toBe(false);
  });

  it('verifies cryptographic context refresh lineage to an earlier human decision', () => {
    expect(hasGovernedUnindexedSource(sourceId, occurrence(), input.projectId)).toBe(true);
    // Another generation of the same AHSP is not a different BOQ decision.
    expect(hasGovernedUnindexedSource(sourceId, {
      ...prior, previousOccurrenceId: priorId, previousOccurrence: null,
    }, input.projectId)).toBe(true);
    expect(hasGovernedUnindexedSource(sourceId, {
      ...prior, previousOccurrenceId: priorId,
      requestPayloadHash: 'not-the-writer-hash', previousOccurrence: null,
    }, input.projectId)).toBe(false);
    const o = occurrence();
    expect(hasGovernedUnindexedSource(sourceId, {
      ...o, requestPayloadHash: 'forged-hash',
    }, input.projectId)).toBe(false);
    expect(hasGovernedUnindexedSource(sourceId, {
      ...o, previousOccurrence: null,
    }, input.projectId)).toBe(false);
    expect(hasGovernedUnindexedSource(sourceId, {
      ...o, previousOccurrence: { ...prior, idempotencyKey: 'rab-auto-04-inherited' },
    }, input.projectId)).toBe(false);
  });

  it('reuses the one governed J.75 decision using the existing official writer only', async () => {
    const { service, ahsp, prisma } = make([source()]);
    const result = await service.execute(input);
    expect(result.summary).toEqual({ PROVEN_ASSOCIATION_REUSED: 1 });
    expect(result.automaticBindingPerformed).toBe(true);
    expect(ahsp.selectForBoqItem).toHaveBeenCalledWith(
      expect.objectContaining({
        ...input, boqItemId: targetId, ahspVersionId: version,
        referenceRegionId: region, reuseSourceBoqItemId: sourceId,
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // SQL discovery must use the same null-safe parent identity as the
    // official transaction writer. Two nulls mean root, not missing truth.
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.strings.join('')).toMatch(/"parentId" IS NOT DISTINCT FROM/);
    expect(sql.values).toContain(null);
    const query = prisma.boqItem.findMany.mock.calls[1][0];
    expect(query.where).toMatchObject({
      id: { in: [sourceId] },
      boqStructure: { projectId: input.projectId },
    });
  });

  it('does not borrow from competing, non-identical, or unverifiable decisions', async () => {
    const cases = [
      { rows: [] as Array<ReturnType<typeof source>>, kind: 'NO_PROVEN_ASSOCIATION' },
      { rows: [source(), source({ id: 'competing-source', name: 'Pengecatan   Dinding Beton Sandaran' })], kind: 'MULTIPLE_SOURCE_DECISIONS' },
      { rows: [source({ name: 'Pengecatan Dinding Baja Sandaran' })], kind: 'SOURCE_CONTEXT_NOT_AUTHORIZED' },
      // A stubbed candidate query returning a cross-parent row must still
      // be rejected by the second fact gate before the official writer.
      { rows: [source({ parentId: 'other-subjudul' })], kind: 'SOURCE_CONTEXT_NOT_AUTHORIZED' },
      { rows: [source({ parentId: undefined })], kind: 'SOURCE_CONTEXT_NOT_AUTHORIZED' },
      { rows: [source({ workingOccurrence: { ...occurrence(), requestPayloadHash: null } })], kind: 'SOURCE_CONTEXT_NOT_AUTHORIZED' },
      { rows: [source({ workingOccurrence: { ...occurrence(), referenceRegionId: 'other-region' } })], kind: 'SOURCE_CONTEXT_NOT_AUTHORIZED' },
      { rows: [source({ priceOrigin: 'MANUAL_CLIENT' })], kind: 'SOURCE_CONTEXT_NOT_AUTHORIZED' },
    ];
    for (const c of cases) {
      const { service, ahsp } = make(c.rows);
      const result = await service.execute(input);
      expect(result.summary).toEqual({ [c.kind]: 1 });
      expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
    }
  });

  it('does not announce success if official writer refuses the choice', async () => {
    const { service, ahsp } = make([source()]);
    ahsp.selectForBoqItem.mockRejectedValue(new Error('CONCURRENT_CHANGE'));
    expect((await service.execute(input)).summary).toEqual({
      REUSE_REVALIDATION_REQUIRED: 1,
    });
  });
});

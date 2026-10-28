import { ImportStatus } from '@prisma/client';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';

describe('AHSP one-truth Import reconciliation — protection of canonical parent and journal', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const ahspId = '22222222-2222-4222-8222-222222222222';
  const base = {
    workType: { raw: 'A.1' },
    methodName: { raw: 'Galian tanah' },
    admission: 'PROVEN',
    identityVerdict: 'POSSIBLY_IDENTICAL',
    reasonCodes: [],
    resources: [],
  };
  const context = {
    workspaceId,
    userId: 'owner-1',
    lineId: 'line-1',
    decision: 'USE_EXISTING',
    assistedClassification: {
      jenisPengadaanRootId: 'root-1',
      paths: [{ leafNodeId: 'leaf-b', provenanceHint: 'FROM_USER' }],
      pendingPaths: [],
      dasarAcuan: null,
      penerbit: null,
    },
  };
  function harness(
    match: Record<string, unknown>,
    overrides?: { parent?: { id: string } | null; version?: { id: string } | null },
  ) {
    const service = Object.create(AhspDocumentCanonicalizationService.prototype) as any;
    const journal = { settleOrThrow: jest.fn().mockResolvedValue(undefined) };
    const audit = { logAction: jest.fn().mockResolvedValue(undefined) };
    const assignments = {
      applyToAhsp: jest.fn().mockResolvedValue({ applied: 1 }),
    };
    const writer = jest.fn().mockResolvedValue({
      ahspId, versionId: 'version-2', admission: 'PROVEN',
      identityPendingResources: 0, linkedResources: [],
    });
    const adopted = jest.fn().mockResolvedValue(ahspId);
    const tx = {
      aHSP: { findFirst: jest.fn().mockResolvedValue(overrides?.parent === undefined ? { id: ahspId } : overrides.parent) },
      aHSPVersion: { findFirst: jest.fn().mockResolvedValue(overrides?.version === undefined ? { id: 'version-1' } : overrides.version) },
    };
    Object.assign(service, { journal, audit, assistedClassification: assignments });
    service.writeItem = writer;
    service.recordUseExisting = adopted;
    const item = {
      ...base,
      identityMatches: [{ ahspId, deleted: false, signal: 'EXACT_PARENT',
        formulaSame: false, classificationCovered: true, currentVersionId: 'version-1', ...match }],
    };
    const run = (decision?: string) =>
      service.settleHeldItem(item, { source: { contentDigestSha256: 'abc' } },
        { ...context, decision }, tx as any);
    return { run, tx, service, item, writer, adopted, assignments, journal, audit };
  }

  it('different proven formula: explicit adoption appends version, never creates parent, maintains the base', async () => {
    const x = harness({});
    const answer = await x.run('USE_EXISTING');
    expect(answer).toMatchObject({ kind: 'WRITTEN', ahspId, versionId: 'version-2', reusedParent: true });
    expect(x.writer).toHaveBeenCalledTimes(1);
    expect(x.writer.mock.calls[0][2]).toMatchObject({
      existingParentId: ahspId, basedOnVersionId: 'version-1', workspaceId,
    });
    expect(x.assignments.applyToAhsp).toHaveBeenCalledWith(
      expect.objectContaining({ ahspId, actingWorkspaceId: workspaceId, client: x.tx }),
    );
    expect(x.tx.aHSP.findFirst).toHaveBeenCalledWith({
      where: { id: ahspId, workspaceId, deletedAt: null }, select: { id: true },
    });
  });

  it('same proven formula, new path: ONLY assignment, no version or duplicate parent', async () => {
    const x = harness({ formulaSame: true, classificationCovered: false });
    const answer = await x.run('USE_EXISTING');
    expect(answer).toMatchObject({
      kind: 'ALREADY_PRESENT', ahspId, assignmentAppliedInTransaction: true,
    });
    expect(x.writer).not.toHaveBeenCalled();
    expect(x.assignments.applyToAhsp).toHaveBeenCalledTimes(1);
    expect(x.journal.settleOrThrow).toHaveBeenCalledWith(x.tx, {
      workspaceId, lineId: 'line-1', status: ImportStatus.COMPLETED,
      reasonCodes: ['IDENTITY_POSSIBLE_MATCH'],
      ahspId, ahspVersionId: 'version-1',
    });
  });

  it('no explicit USE_EXISTING: hold with no adoption, writer or assignment', async () => {
    const x = harness({});
    const answer = await x.run();
    expect(answer.kind).toBe('HELD');
    expect(x.adopted).not.toHaveBeenCalled();
    expect(x.writer).not.toHaveBeenCalled();
    expect(x.assignments.applyToAhsp).not.toHaveBeenCalled();
  });

  it('incomplete identity evidence does not give a version or assignment', async () => {
    const x = harness({ formulaSame: undefined });
    const answer = await x.run('USE_EXISTING');
    expect(answer.kind).toBe('HELD');
    expect(x.writer).not.toHaveBeenCalled();
    expect(x.adopted).not.toHaveBeenCalled();
  });

  it('soft-deleted, inaccessible or cross-workspace parent is never mutated', async () => {
    const x = harness({}, { parent: null });
    const answer = await x.run('USE_EXISTING');
    expect(answer.kind).toBe('HELD');
    expect(x.tx.aHSP.findFirst).toHaveBeenCalledWith({
      where: { id: ahspId, workspaceId, deletedAt: null }, select: { id: true },
    });
    expect(x.adopted).not.toHaveBeenCalled();
    expect(x.writer).not.toHaveBeenCalled();
  });

  it('stale current version denies any old-context revision', async () => {
    const x = harness({}, { version: { id: 'version-newer' } });
    const answer = await x.run('USE_EXISTING');
    expect(answer.kind).toBe('HELD');
    expect(x.adopted).not.toHaveBeenCalled();
    expect(x.writer).not.toHaveBeenCalled();
    expect(x.assignments.applyToAhsp).not.toHaveBeenCalled();
  });

  it('ambiguous candidate set cannot pick whichever parent sorted first', async () => {
    const x = harness({});
    x.item.identityMatches.push({ ...x.item.identityMatches[0], ahspId: 'another-parent' });
    // The existing audit writer records a refused adoption and returns null.
    // It must never pick the first candidate in the ambiguity.
    x.adopted.mockResolvedValue(null);
    const answer = await x.run('USE_EXISTING');
    expect(answer.kind).toBe('HELD');
    expect(x.writer).not.toHaveBeenCalled();
    expect(x.adopted).toHaveBeenCalledTimes(1);
    expect(x.assignments.applyToAhsp).not.toHaveBeenCalled();
  });
});

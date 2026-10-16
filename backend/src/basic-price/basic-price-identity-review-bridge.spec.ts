import { ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPriceIdentityReviewBridgeService } from './basic-price-identity-review-bridge.service';
import { ResourceObservationController } from '../resource-catalog/resource-observation.controller';

describe('BP-205 — existing shared identity curator bridge (no duplicated kernel)', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const actor = '22222222-2222-4222-8222-222222222222';
  const batchId = '33333333-3333-4333-8333-333333333333';
  const rowId = '44444444-4444-4444-8444-444444444444';
  const sourceSha256 = 'f'.repeat(64);
  const batch = () => ({
    id: batchId, workspaceId, uploadedByAccountId: actor, status: 'NEEDS_REVIEW',
    sourceSha256, sourceFileName: 'Harga Campuran.xlsx',
    selectedSheetName: 'DATA', parserContractVersion: 'SOURCE-PARSER-V1',
  });
  const row = () => ({
    id: rowId, batchId, version: 7, status: 'NEEDS_REVIEW',
    sourceSection: 'MATERIAL', sourceSectionProvenance: 'UPLOADER_DECLARED',
    reasonCodes: ['ROW_CATEGORY_CONFIRMED_BY_REVIEWER'],
    rawResourceNameText: 'Timbunan Biasa', rawResourceCodeText: 'M08',
    rawUnitText: 'M3', sourceRowNumber: 8,
    sourceCodeCellAddress: 'A8', sourceNameCellAddress: 'B8',
    sourceUnitCellAddress: 'C8',
  });
  function setup(opts: {
    batch?: ReturnType<typeof batch> | null;
    row?: ReturnType<typeof row> | null;
    present?: boolean;
    blocker?: boolean;
  } = {}) {
    const b = Object.prototype.hasOwnProperty.call(opts, 'batch') ? opts.batch : batch();
    const current = Object.prototype.hasOwnProperty.call(opts, 'row') ? opts.row : row();
    const prisma = {
      basicPriceImportBatch: { findUnique: jest.fn().mockResolvedValue(b) },
      basicPriceImportRow: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(current
            ? { version: current.version, status: current.status, sourceSection: current.sourceSection }
            : null),
        findMany: jest.fn().mockResolvedValue([current]),
      },
      observedResource: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(opts.present ? { status: 'OBSERVED' } : null)
          .mockResolvedValueOnce({ status: 'OBSERVED' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      resourceCatalog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const proposals = {
      proposeForRows: jest.fn().mockResolvedValue(new Map([[rowId, {
        resource: {
          admissionReview: {
            reasonCode: opts.blocker === false ? null : 'IDENTITY_CANDIDATE_BLOCKED',
            blockedCandidateIds: opts.blocker === false ? [] : ['55555555-5555-4555-8555-555555555555'],
          },
        },
      }]])),
    };
    const observations = { observeMany: jest.fn().mockResolvedValue({ persisted: 1 }) };
    const service = new BasicPriceIdentityReviewBridgeService(
      prisma as never, proposals as never, observations as never,
    );
    return { prisma, proposals, observations, service };
  }

  it('queues exactly one source-identified observation via the shared service, without catalog writes', async () => {
    const h = setup();
    await expect(h.service.request(workspaceId, batchId, rowId, actor, 7))
      .resolves.toEqual({ rowId, status: 'OBSERVED', unchanged: false });
    expect(h.observations.observeMany).toHaveBeenCalledTimes(1);
    expect(h.observations.observeMany).toHaveBeenCalledWith([expect.objectContaining({
      workspaceId, origin: 'BASIC_PRICE', rawName: 'Timbunan Biasa',
      resourceType: 'MATERIAL',
      candidates: ['55555555-5555-4555-8555-555555555555'],
      provenance: expect.objectContaining({
        sourceSha256, sourceFileName: 'Harga Campuran.xlsx',
        sheetName: 'DATA', sourceRowNumber: 8,
        sourceNameCellAddress: 'B8',
      }),
    })]);
    expect(h.prisma.basicPriceImportRow.findFirst).toHaveBeenCalledTimes(2);
  });

  it('idempotent repeat skips proposal and writes when source observation exists', async () => {
    const h = setup({ present: true });
    await expect(h.service.request(workspaceId, batchId, rowId, actor, 7))
      .resolves.toMatchObject({ status: 'OBSERVED', unchanged: true });
    expect(h.observations.observeMany).not.toHaveBeenCalled();
    expect(h.proposals.proposeForRows).not.toHaveBeenCalled();
  });

  it('denies other account or workspace without revealing batch existence', async () => {
    const foreign = setup();
    await expect(foreign.service.request(workspaceId, batchId, rowId, 'other-actor', 7))
      .rejects.toThrow(NotFoundException);
    const other = setup();
    await expect(other.service.request('foreign-workspace', batchId, rowId, actor, 7))
      .rejects.toThrow(NotFoundException);
    expect(foreign.observations.observeMany).not.toHaveBeenCalled();
    expect(other.observations.observeMany).not.toHaveBeenCalled();
  });

  it('rejects an old version before examining candidate or writing', async () => {
    const h = setup();
    await expect(h.service.request(workspaceId, batchId, rowId, actor, 6))
      .rejects.toThrow(ConflictException);
    expect(h.proposals.proposeForRows).not.toHaveBeenCalled();
    expect(h.observations.observeMany).not.toHaveBeenCalled();
  });

  it('cannot queue a categoryless or weak batch-wide guess as an established type', async () => {
    for (const change of [
      { sourceSection: null },
      { sourceSectionProvenance: 'UPLOADER_DECLARED', reasonCodes: [] },
    ]) {
      const h = setup({ row: { ...row(), ...change } as ReturnType<typeof row> });
      await expect(h.service.request(workspaceId, batchId, rowId, actor, 7))
        .rejects.toThrow('CATEGORY_CONFIRMATION_REQUIRED');
      expect(h.observations.observeMany).not.toHaveBeenCalled();
    }
  });

  it('refuses requests without current strong blocked identity evidence', async () => {
    const h = setup({ blocker: false });
    await expect(h.service.request(workspaceId, batchId, rowId, actor, 7))
      .rejects.toThrow('IDENTITY_REVIEW_NOT_REQUIRED');
    expect(h.observations.observeMany).not.toHaveBeenCalled();
  });

  it('only allows the original row while its state remains reviewable', async () => {
    const h = setup({ row: { ...row(), status: 'RESOLVED' } });
    await expect(h.service.request(workspaceId, batchId, rowId, actor, 7))
      .rejects.toThrow(ConflictException);
    expect(h.observations.observeMany).not.toHaveBeenCalled();
  });

  it('readback maps only an exact source locator and type, not a similar name', async () => {
    const h = setup();
    h.prisma.observedResource.findMany.mockResolvedValue([
      { sourceRowNumber: 8, rawName: 'Timbunan Biasa', resourceType: 'MATERIAL', status: 'OBSERVED' },
      { sourceRowNumber: 8, rawName: 'Timbunan Biasa', resourceType: 'LABOR', status: 'RESOLVED_EXISTING' },
      { sourceRowNumber: 9, rawName: 'Timbunan Biasa', resourceType: 'MATERIAL', status: 'ADMITTED_NEW' },
    ]);
    await expect(h.service.statuses(workspaceId, batchId, actor)).resolves.toEqual({
      rows: { [rowId]: { status: 'OBSERVED', resource: null } },
    });
    h.prisma.observedResource.findMany.mockResolvedValue([
      { sourceRowNumber: 8, rawName: 'Timbunan Biasa', resourceType: 'MATERIAL', status: 'RESOLVED_EXISTING' },
    ]);
    await expect(h.service.statuses(workspaceId, batchId, actor)).resolves.toEqual({
      rows: { [rowId]: { status: 'RESOLVED_EXISTING', resource: null } },
    });
  });

  it('exposes curator choice only for active workspace-visible same-type catalog resource', async () => {
    const h = setup();
    const catalogId = '66666666-6666-4666-8666-666666666666';
    h.prisma.observedResource.findMany.mockResolvedValue([{
      sourceRowNumber: 8, rawName: 'Timbunan Biasa',
      resourceType: 'MATERIAL', status: 'RESOLVED_EXISTING',
      resolvedResourceCatalogId: catalogId,
    }]);
    const chosen = {
      id: catalogId, code: 'M08', name: 'Timbunan Biasa',
      type: 'MATERIAL', baseUnit: 'M3', status: 'ACTIVE',
    };
    h.prisma.resourceCatalog.findMany.mockResolvedValue([chosen]);
    await expect(h.service.statuses(workspaceId, batchId, actor)).resolves.toEqual({
      rows: { [rowId]: { status: 'RESOLVED_EXISTING', resource: chosen } },
    });
    expect(h.prisma.resourceCatalog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'ACTIVE', OR: [{ workspaceId }, { workspaceId: null }],
      }),
    }));
    h.prisma.resourceCatalog.findMany.mockResolvedValue([]);
    await expect(h.service.statuses(workspaceId, batchId, actor)).resolves.toEqual({
      rows: { [rowId]: { status: 'RESOLVED_EXISTING', resource: null } },
    });
    h.prisma.resourceCatalog.findMany.mockResolvedValue([{ ...chosen, type: 'EQUIPMENT' }]);
    await expect(h.service.statuses(workspaceId, batchId, actor)).resolves.toEqual({
      rows: { [rowId]: { status: 'RESOLVED_EXISTING', resource: null } },
    });
  });

  it('refuses a stale revalidation after the canonical identity authority is consulted', async () => {
    const h = setup();
    h.prisma.basicPriceImportRow.findFirst.mockReset()
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce({ version: 8, status: 'NEEDS_REVIEW', sourceSection: 'MATERIAL' });
    await expect(h.service.request(workspaceId, batchId, rowId, actor, 7))
      .rejects.toThrow('ROW_VERSION_STALE');
    expect(h.proposals.proposeForRows).toHaveBeenCalledTimes(1);
    expect(h.observations.observeMany).not.toHaveBeenCalled();
  });

  it('the existing curator list receives a Basic Price observation without inventing AHSP context', async () => {
    const observation = {
      id: 'observation-1', workspaceId, origin: 'BASIC_PRICE',
      rawName: 'Timbunan Biasa', resourceType: 'MATERIAL',
      sourceSha256, sheetName: 'DATA', sourceRowNumber: 8,
    };
    const observations = { listOpenForCuration: jest.fn().mockResolvedValue([observation]) };
    const journal = { workContextForSourceRows: jest.fn().mockResolvedValue(new Map()) };
    const controller = new ResourceObservationController(
      observations as never, {} as never, journal as never,
    );
    const request = { workspaceContext: { workspaceId }, user: { id: actor } };
    const result = await controller.list(request);
    expect(observations.listOpenForCuration).toHaveBeenCalledWith(workspaceId, actor, undefined);
    expect(result).toEqual([{ ...observation, workContext: { kind: 'ABSENT' } }]);
  });

  it('readback returns no other user work and does not invent a pending review', async () => {
    const h = setup();
    await expect(h.service.statuses(workspaceId, batchId, actor)).resolves.toEqual({
      rows: { [rowId]: { status: 'NOT_REQUESTED', resource: null } },
    });
    expect(h.prisma.observedResource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspaceId, origin: 'BASIC_PRICE', sourceSha256, sheetName: 'DATA',
      }),
    }));
    const denied = setup();
    await expect(denied.service.statuses(workspaceId, batchId, 'another-account'))
      .rejects.toThrow(NotFoundException);
    expect(denied.prisma.observedResource.findMany).not.toHaveBeenCalled();
  });
});

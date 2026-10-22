import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';

describe('BP-ROW11-GRADEA - append-only mapping reason clarification', () => {
  const WORKSPACE = '11111111-1111-4111-8111-111111111111';
  const OWNER = '10000000-0000-4000-8000-000000000007';
  const BATCH = '22222222-2222-4222-8222-222222222222';
  const ROW = '33333333-3333-4333-8333-333333333333';
  const MAPPING = '44444444-4444-4444-8444-444444444444';
  const CATALOG = '55555555-5555-4555-8555-555555555555';
  const UNIT = '66666666-6666-4666-8666-666666666666';
  const reason =
    'Owner menyatakan M5 adalah salah ketik dari sumber Excel; satuan benar M3 meter kubik.';
  let service: BasicPriceRowResolutionService;
  let row: Record<string, unknown>;
  let tx: {
    $queryRaw: jest.Mock;
    basicPriceImportRow: { findUniqueOrThrow: jest.Mock; update?: unknown };
    unitDefinition: { findUniqueOrThrow: jest.Mock };
    basicPriceImportRowMappingReasonClarification: { create: jest.Mock };
    resourceCatalog?: unknown;
    basicPrice?: unknown;
  };
  beforeEach(() => {
    const mapping = {
      id: MAPPING,
      reviewerAccountId: OWNER,
      resourceCatalogId: CATALOG,
      unitDefinitionId: UNIT,
      reason:
        'KOREKSI_NOMENKLATUR: Batu Pecah 2-3 cm | KOREKSI_SATUAN_SUMBER: M5 -> M3; Belum ada di catalog',
      reasonClarification: null,
    };
    row = {
      batch: { workspaceId: WORKSPACE, uploadedByAccountId: OWNER },
      version: 3,
      status: 'READY_FOR_SUBMISSION',
      resolutionStatus: 'RESOLVED',
      priceSubmissionId: null,
      privateBasicPrice: null,
      resourceCatalogId: CATALOG,
      unitDefinitionId: UNIT,
      rawUnitText: 'M5',
      resourceMappings: [mapping],
    };
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ROW }]),
      basicPriceImportRow: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(() => Promise.resolve(row)),
      },
      unitDefinition: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ code: 'M3' }),
      },
      basicPriceImportRowMappingReasonClarification: {
        create: jest.fn().mockResolvedValue({
          id: 'clarification-01',
          originalReason: mapping.reason,
          clarifiedReason: reason,
          recordedAt: new Date('2026-10-21T10:00:00Z'),
        }),
      },
    };
    const db = {
      $transaction: jest.fn(async (fn: (arg: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    service = new BasicPriceRowResolutionService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });
  const decide = (
    text = reason,
    version = 3,
    caller = OWNER,
    workspace = WORKSPACE,
  ) =>
    service.clarifyUnitCorrectionReason(workspace, BATCH, ROW, caller, {
      version,
      reason: text,
    });

  it('preserves the original reason, catalog, unit, source, and prices; creates one addendum', async () => {
    await expect(decide()).resolves.toMatchObject({ clarifiedReason: reason });
    expect(
      tx.basicPriceImportRowMappingReasonClarification.create,
    ).toHaveBeenCalledWith({
      data: {
        mappingId: MAPPING,
        workspaceId: WORKSPACE,
        actorAccountId: OWNER,
        originalReason:
          'KOREKSI_NOMENKLATUR: Batu Pecah 2-3 cm | KOREKSI_SATUAN_SUMBER: M5 -> M3; Belum ada di catalog',
        clarifiedReason: reason,
      },
      select: {
        id: true,
        originalReason: true,
        clarifiedReason: true,
        recordedAt: true,
      },
    });
    expect(row).toMatchObject({
      rawUnitText: 'M5',
      resourceCatalogId: CATALOG,
      unitDefinitionId: UNIT,
    });
    expect(tx.basicPriceImportRow.update).toBeUndefined();
    expect(tx.resourceCatalog).toBeUndefined();
    expect(tx.basicPrice).toBeUndefined();
  });
  it('rejects vague reason, stale row, wrong workspace, or another account', async () => {
    await expect(decide('M5 ke M3')).rejects.toThrow(
      'UNIT_CLARIFICATION_REASON_REQUIRED',
    );
    await expect(decide(reason, 2)).rejects.toThrow('ROW_VERSION_STALE');
    await expect(
      decide(reason, 3, OWNER, '77777777-7777-4777-8777-777777777777'),
    ).rejects.toThrow('Batch not found');
    await expect(
      decide(reason, 3, '88888888-8888-4888-8888-888888888888'),
    ).rejects.toThrow('Batch not found');
    expect(
      tx.basicPriceImportRowMappingReasonClarification.create,
    ).not.toHaveBeenCalled();
  });
  it('refuses duplicate, ambiguous original decision, price already created and invalid units', async () => {
    const old = (row.resourceMappings as Array<Record<string, unknown>>)[0];
    old.reasonClarification = { id: 'previous-audit' };
    await expect(decide()).rejects.toThrow(
      'UNIT_CLARIFICATION_MAPPING_INELIGIBLE',
    );
    old.reasonClarification = null;
    (row.resourceMappings as unknown[]).push({ ...old });
    await expect(decide()).rejects.toThrow(
      'UNIT_CLARIFICATION_DECISION_AMBIGUOUS',
    );
    (row.resourceMappings as unknown[]).pop();
    row.privateBasicPrice = { id: 'existing-price' };
    await expect(decide()).rejects.toThrow('UNIT_CLARIFICATION_ROW_INELIGIBLE');
    row.privateBasicPrice = null;
    await expect(
      decide('Owner confirms a typing issue only, but states no unit values.'),
    ).rejects.toThrow('UNIT_CLARIFICATION_SOURCE_AND_TARGET_REQUIRED');
    expect(
      tx.basicPriceImportRowMappingReasonClarification.create,
    ).not.toHaveBeenCalled();
  });
});

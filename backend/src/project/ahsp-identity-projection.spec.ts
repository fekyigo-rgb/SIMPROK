import { ProjectService } from './project.service';

/**
 * RAB-TRACE-01 — one AHSP identity authority for every lawful RAB read.
 *
 * Adding the projection to the draft path alone would have looked correct on
 * this project only because it has no baseline yet. The moment one existed,
 * the official RAB would have lost the identity the draft showed. These tests
 * exercise the private helper through both public read paths.
 */
describe('AHSP identity projection', () => {
  const LIVE_VERSION = 'a0000000-0000-4000-8000-000000000001';
  const SNAPSHOT = 'b0000000-0000-4000-8000-000000000002';

  const buildPrisma = (items: any[]) => ({
    projectBaseline: { findFirst: jest.fn().mockResolvedValue({ rabDocumentId: 'rab-1', versionNumber: 1 }) },
    rabDocument: { findUnique: jest.fn().mockResolvedValue({ id: 'rab-1', boqStructureId: 'struct-1' }), findFirst: jest.fn().mockResolvedValue(null) },
    boqStructure: { findFirst: jest.fn().mockResolvedValue({ id: 'struct-1' }) },
    boqItem: { findMany: jest.fn().mockResolvedValue(items) },
    aHSPVersion: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: LIVE_VERSION,
          versionNumber: 4,
          outputUnit: 'm3',
          ahsp: { workType: 'Timbunan dan Pemadatan Sirtu', methodName: 'Pemadatan secara Manual' },
        },
      ]),
    },
    aHSPSnapshot: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: SNAPSHOT,
          workType: 'Timbunan Historis',
          methodName: 'Pemadatan Alat Berat',
          versionNumber: 2,
          outputUnit: 'm3',
        },
      ]),
    },
  });

  const workItem = (over: Record<string, unknown>) => ({
    id: 'item-1',
    itemType: 'WORK_ITEM',
    wbsCode: 'R75',
    ahspVersionId: null,
    ahspSnapshotId: null,
    unitPrice: '197005.00',
    lineTotal: '129826295.00',
    priceOrigin: 'SERVER_COST_KERNEL',
    ...over,
  });

  const serviceWith = (prisma: any) =>
    new ProjectService(
      prisma as any,
      { evaluate: jest.fn().mockResolvedValue({ canEditDraft: false }) } as any,
      ...(Array(8).fill({}) as any[]),
    ) as any;

  it('the baseline read path projects AHSP identity, not only the draft', async () => {
    const prisma = buildPrisma([workItem({ ahspVersionId: LIVE_VERSION })]);
    const items = await serviceWith(prisma).getBoq('project-1');

    expect(items[0].ahsp).toEqual({
      workType: 'Timbunan dan Pemadatan Sirtu',
      methodName: 'Pemadatan secara Manual',
      versionNumber: 4,
      outputUnit: 'm3',
      source: 'LIVE',
    });
    // The row's own code is untouched and is not the AHSP identity.
    expect(items[0].wbsCode).toBe('R75');
  });

  it('a snapshot-backed row resolves its frozen identity, never "belum terhubung"', async () => {
    const prisma = buildPrisma([
      workItem({ ahspVersionId: LIVE_VERSION, ahspSnapshotId: SNAPSHOT }),
    ]);
    const items = await serviceWith(prisma).getBoq('project-1');

    // The snapshot is the row's binding truth, so it answers — not the live
    // version it was taken from.
    expect(items[0].ahsp).toMatchObject({
      workType: 'Timbunan Historis',
      methodName: 'Pemadatan Alat Berat',
      versionNumber: 2,
      source: 'SNAPSHOT',
    });
    expect(prisma.aHSPVersion.findMany).not.toHaveBeenCalled();
  });

  it('a row with no AHSP is null — nothing is invented from the wbsCode', async () => {
    const prisma = buildPrisma([workItem({})]);
    const items = await serviceWith(prisma).getBoq('project-1');

    expect(items[0].ahsp).toBeNull();
    expect(items[0].wbsCode).toBe('R75');
  });

  it('resolving identity performs no write', async () => {
    const prisma = buildPrisma([workItem({ ahspVersionId: LIVE_VERSION })]);
    await serviceWith(prisma).getBoq('project-1');

    for (const model of ['boqItem', 'rabDocument', 'aHSPVersion', 'aHSPSnapshot'] as const) {
      for (const writer of ['create', 'update', 'delete', 'upsert', 'updateMany', 'deleteMany']) {
        expect((prisma as any)[model][writer]).toBeUndefined();
      }
    }
  });
});

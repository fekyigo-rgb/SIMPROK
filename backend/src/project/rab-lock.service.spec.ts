import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PERSISTED_CALCULATION_STATUS } from './persisted-calculation.contracts';
import { PersistedCalculationService } from './persisted-calculation.service';
import { RAB_STATUS } from './rab-lifecycle-policy.service';
import { PRELOCK_FINDING, RAB_LOCK_REASON } from './rab-lock.contracts';
import { AhspResourceResolutionOrchestrator } from '../project-ahsp/ahsp-resource-resolution.orchestrator';
import { RabLockService } from './rab-lock.service';

/**
 * RM-03D1 RAB LOCK v1 — DRAFT → LOCKED on the SAME RabDocument.
 *
 * The numbers below are ordinary fixture values. Nothing in the production
 * path knows any project id, any BOQ row id, or any amount; the lock decides
 * purely on lifecycle state and on what the existing authorities answer.
 */
describe('RabLockService', () => {
  const projectId = 'project-1';
  const workspaceId = 'workspace-1';
  const actorAccountId = 'account-1';
  const structureId = 'structure-1';
  const rabId = 'rab-1';
  const boqItemId = 'item-1';
  const ahspVersionId = 'ahsp-v4';
  const asOfDate = new Date('2026-08-08T00:00:00.000Z');

  let service: RabLockService;
  let tx: any;
  let persisted: { getPersistedCalculation: jest.Mock };
  let resolution: { resolveVersionResources: jest.Mock };

  const draftRab = (overrides: Record<string, unknown> = {}) => ({
    id: rabId,
    name: 'Working Draft RAB',
    status: RAB_STATUS.DRAFT,
    totalBaseCost: new Prisma.Decimal('129826295.00'),
    totalFinalCost: new Prisma.Decimal('158517906.20'),
    lockedAt: null,
    lockedByAccountId: null,
    lockedFromStatus: null,
    updatedAt: new Date('2026-08-09T00:00:00.000Z'),
    ...overrides,
  });

  const pricedWorkItem = (overrides: Record<string, unknown> = {}) => ({
    id: boqItemId,
    wbsCode: 'R75',
    name: '1 m3 Timbunan dan Pemadatan Sirtu secara manual',
    priceOrigin: 'SERVER_COST_KERNEL',
    unitPrice: new Prisma.Decimal('197005.00'),
    lineTotal: new Prisma.Decimal('129826295.00'),
    ahspVersionId,
    calculationAsOfDate: asOfDate,
    ...overrides,
  });

  const verifiedProof = () => ({
    status: PERSISTED_CALCULATION_STATUS.VERIFIED,
    boqItemId,
    stored: { volume: '659', unit: 'm3', unitPrice: '197005.00', lineTotal: '129826295.00' },
    recomputed: { unitPrice: '197005.00', lineTotal: '129826295.00' },
    integrity: {
      unitPriceMatches: true,
      lineTotalMatches: true,
      allResourceCostsReproduced: true,
    },
  });

  /** Arrange the transaction client. Defaults describe a clean, lockable RAB. */
  const arrange = (opts: {
    rab?: any;
    workItems?: any[];
    eligibleAhsp?: boolean;
    updateCount?: number;
    settledRab?: any;
    structures?: any[];
    project?: any;
    occurrence?: any;
  } = {}) => {
    const rab = opts.rab ?? draftRab();
    tx = {
      $queryRaw: jest.fn().mockResolvedValue(
        opts.project === undefined ? [{ id: projectId, workspaceId }] : opts.project,
      ),
      boqStructure: {
        findMany: jest.fn().mockResolvedValue(opts.structures ?? [{ id: structureId }]),
      },
      rabDocument: {
        findMany: jest.fn().mockResolvedValue([rab]),
        updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(opts.settledRab ?? rab),
      },
      boqItem: {
        findMany: jest.fn().mockResolvedValue(opts.workItems ?? [pricedWorkItem()]),
      },
      projectAhspOccurrence: {
        findFirst: jest.fn().mockResolvedValue(
          opts.occurrence === undefined
            ? {
                referenceRegionId: 'region-1',
                ahspVersion: { id: ahspVersionId, resources: [{ id: 'res-1' }] },
                resourceResolutions: [
                  {
                    ahspResourceId: 'res-1',
                    rawAhspResourceRef: 'Pekerja',
                    selectedBasicPriceId: 'bp-A',
                    adaptedPriceValue: '132000.00',
                  },
                ],
              }
            : opts.occurrence,
        ),
      },
      aHSPVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.eligibleAhsp === false ? null : { id: ahspVersionId }),
      },
    };
    return { tx, rab };
  };

  beforeEach(async () => {
    persisted = { getPersistedCalculation: jest.fn().mockResolvedValue(verifiedProof()) };
    // Default: the authority would decide exactly what is frozen — no drift.
    resolution = {
      resolveVersionResources: jest.fn().mockResolvedValue([
        { ahspResourceId: 'res-1', status: 'RESOLVED', selectedBasicPriceId: 'bp-A', adaptedPriceValue: '132000.00' },
      ]),
    };

    const prisma = {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabLockService,
        { provide: PrismaService, useValue: prisma },
        { provide: PersistedCalculationService, useValue: persisted },
        { provide: AhspResourceResolutionOrchestrator, useValue: resolution },
      ],
    }).compile();

    service = module.get(RabLockService);
  });

  const lock = () => service.lockWorkingDraft({ projectId, workspaceId, actorAccountId });

  // ── T1 ─────────────────────────────────────────────────────────────────────
  it('T1: a DRAFT RAB whose revalidation is clean becomes LOCKED', async () => {
    arrange();
    const result: any = await lock();

    expect(result.status).toBe(RAB_STATUS.LOCKED);
    expect(result.changed).toBe(true);
    expect(result.lockedByAccountId).toBe(actorAccountId);
    expect(result.lockedFromStatus).toBe(RAB_STATUS.DRAFT);
    expect(result.frozen.totalBaseCost).toBe('129826295.00');

    // exactly one transition, scoped so only a DRAFT row can be transitioned
    expect(tx.rabDocument.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.rabDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: rabId, status: RAB_STATUS.DRAFT } }),
    );
  });

  it('T1b: the freeze happens inside the transaction that holds the project row lock', async () => {
    arrange();
    await lock();
    const sql = tx.$queryRaw.mock.calls[0][0];
    expect(JSON.stringify(sql)).toContain('FOR UPDATE');
    // revalidation ran on the SAME client, not on a second connection
    expect(persisted.getPersistedCalculation).toHaveBeenCalledWith(
      boqItemId,
      projectId,
      workspaceId,
      tx,
    );
  });

  // ── T2 ─────────────────────────────────────────────────────────────────────
  it('T2: locking an already-LOCKED RAB is an idempotent no-op — no second write, no second lock fact', async () => {
    const alreadyLocked = draftRab({
      status: RAB_STATUS.LOCKED,
      lockedAt: new Date('2026-08-09T10:00:00.000Z'),
      lockedByAccountId: 'the-original-locker',
      lockedFromStatus: RAB_STATUS.DRAFT,
    });
    arrange({ rab: alreadyLocked });

    const result: any = await lock();

    expect(result.status).toBe(RAB_STATUS.LOCKED);
    expect(result.changed).toBe(false);
    // the original actor and timestamp survive — a re-run never rewrites history
    expect(result.lockedByAccountId).toBe('the-original-locker');
    expect(result.lockedAt).toBe('2026-08-09T10:00:00.000Z');
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
  });

  // ── T8 ─────────────────────────────────────────────────────────────────────
  // UNIT PROOF, not a Basic Price drift proof. This mocks the re-proof
  // authority to return MISMATCH; it says nothing about whether a NEWLY
  // eligible Basic Price would be detected. That question is answered only by
  // a real-database test against the real Basic Price authority.
  it('T8 (unit): a stored/recomputed money MISMATCH refuses the lock and leaves the RAB DRAFT', async () => {
    arrange();
    persisted.getPersistedCalculation.mockResolvedValue({
      ...verifiedProof(),
      status: PERSISTED_CALCULATION_STATUS.MISMATCH,
      recomputed: { unitPrice: '201000.00', lineTotal: '132459000.00' },
      integrity: { unitPriceMatches: false, lineTotalMatches: false, allResourceCostsReproduced: true },
    });

    const result: any = await lock();

    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(RAB_LOCK_REASON.PRELOCK_REVALIDATION_REQUIRED);
    expect(result.findings[0]).toMatchObject({
      finding: PRELOCK_FINDING.CALCULATION_MISMATCH,
      storedUnitPrice: '197005.00',
      currentUnitPrice: '201000.00',
    });
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
  });

  // ── T9 ─────────────────────────────────────────────────────────────────────
  it('T9: an AHSP version that is no longer eligible for the line’s own as-of date refuses the lock', async () => {
    arrange({ eligibleAhsp: false });

    const result: any = await lock();

    expect(result.reason).toBe(RAB_LOCK_REASON.PRELOCK_REVALIDATION_REQUIRED);
    expect(result.findings[0].finding).toBe(PRELOCK_FINDING.AHSP_VERSION_NO_LONGER_ELIGIBLE);
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
  });

  it('T9b: eligibility is asked at the line’s own calculation as-of date, never at "today"', async () => {
    arrange();
    await lock();
    const where = tx.aHSPVersion.findFirst.mock.calls[0][0].where;
    expect(where.effectiveDate).toEqual({ lte: asOfDate });
  });

  // ── T10 ────────────────────────────────────────────────────────────────────
  it('T10: a line that cannot be re-proved at all refuses the lock', async () => {
    arrange();
    persisted.getPersistedCalculation.mockResolvedValue({
      status: PERSISTED_CALCULATION_STATUS.FAIL_CLOSED,
      boqItemId,
      reason: 'CALCULATION_OCCURRENCE_MISSING',
    });

    const result: any = await lock();

    expect(result.reason).toBe(RAB_LOCK_REASON.PRELOCK_REVALIDATION_REQUIRED);
    expect(result.findings[0]).toMatchObject({
      finding: PRELOCK_FINDING.CALCULATION_NOT_REPROVABLE,
      detail: 'CALCULATION_OCCURRENCE_MISSING',
    });
  });

  it('T10b: a resource cost that cannot be reproduced refuses the lock even when the totals match', async () => {
    arrange();
    persisted.getPersistedCalculation.mockResolvedValue({
      ...verifiedProof(),
      integrity: { unitPriceMatches: true, lineTotalMatches: true, allResourceCostsReproduced: false },
    });

    const result: any = await lock();
    expect(result.findings[0].finding).toBe(PRELOCK_FINDING.RESOURCE_COST_NOT_REPRODUCED);
  });

  it('T10c: an unpriced WORK_ITEM refuses the lock — an unpriced row is never frozen as if it were free', async () => {
    arrange({ workItems: [pricedWorkItem({ priceOrigin: null, unitPrice: null, lineTotal: null })] });

    const result: any = await lock();
    expect(result.findings[0].finding).toBe(PRELOCK_FINDING.UNPRICED_WORK_ITEM);
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
  });

  it('T10d: an incomplete recap (null totals) refuses the lock', async () => {
    arrange({ rab: draftRab({ totalBaseCost: null, totalFinalCost: null }) });

    const result: any = await lock();
    expect(result.reason).toBe(RAB_LOCK_REASON.PRELOCK_REVALIDATION_REQUIRED);
    expect(result.findings.some((f: any) => f.finding === PRELOCK_FINDING.RAB_PRICING_INCOMPLETE)).toBe(true);
  });

  it('a RAB with no work item at all is not lockable', async () => {
    arrange({ workItems: [] });
    const result: any = await lock();
    expect(result.reason).toBe(RAB_LOCK_REASON.RAB_HAS_NO_WORK_ITEM);
  });

  // ── HARDENING C ────────────────────────────────────────────────────────────
  it('C: a MANUAL_CLIENT line cannot be frozen by LOCK v1 — a hand-entered price needs a confirmation law that does not exist yet', async () => {
    arrange({ workItems: [pricedWorkItem({ priceOrigin: 'MANUAL_CLIENT' })] });

    const result: any = await lock();

    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(RAB_LOCK_REASON.PRELOCK_REVALIDATION_REQUIRED);
    expect(result.findings[0].finding).toBe(PRELOCK_FINDING.MANUAL_PRICE_REQUIRES_CONFIRMATION);
    // the RAB is left exactly as it was
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
    // and manual pricing is still not something the kernel is asked to re-prove
    expect(persisted.getPersistedCalculation).not.toHaveBeenCalled();
  });

  // ── HARDENING D ────────────────────────────────────────────────────────────
  it('D: a LOCKED row with an incomplete lock fact fails closed — the actor and timestamp are never invented', async () => {
    for (const corrupt of [
      { lockedAt: null, lockedByAccountId: 'a', lockedFromStatus: 'DRAFT' },
      { lockedAt: new Date(), lockedByAccountId: null, lockedFromStatus: 'DRAFT' },
      { lockedAt: new Date(), lockedByAccountId: 'a', lockedFromStatus: null },
      // a freeze claiming an origin v1 never performs
      { lockedAt: new Date(), lockedByAccountId: 'a', lockedFromStatus: 'APPROVED' },
    ]) {
      arrange({ rab: draftRab({ status: RAB_STATUS.LOCKED, ...corrupt }) });
      const result: any = await lock();
      expect(result.status).toBe('REFUSED');
      expect(result.reason).toBe(RAB_LOCK_REASON.RAB_LOCK_PROVENANCE_CORRUPT);
    }
  });

  it('D: the settled-race path also proves the winner before describing it', async () => {
    arrange({
      updateCount: 0,
      settledRab: draftRab({
        status: RAB_STATUS.LOCKED,
        lockedAt: null, // winner's row is not a whole lock fact
        lockedByAccountId: null,
        lockedFromStatus: null,
      }),
    });

    const result: any = await lock();

    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(RAB_LOCK_REASON.RAB_LOCK_PROVENANCE_CORRUPT);
  });

  it('D: a settled row that is not LOCKED at all is never reported as a successful freeze', async () => {
    arrange({ updateCount: 0, settledRab: draftRab({ status: RAB_STATUS.DRAFT }) });
    const result: any = await lock();
    expect(result.status).toBe('REFUSED');
  });

  // ── T11 / T12 ──────────────────────────────────────────────────────────────
  // UNIT PROOF of the compare-and-set branch, NOT evidence of real concurrency.
  // updateCount is mocked to 0; no two transactions ever contend here. Real
  // concurrency has to be proven against a real PostgreSQL row lock.
  it('T11 (unit): when compare-and-set matches zero rows, the loser reports the settled truth instead of freezing twice', async () => {
    // updateMany matches zero rows because the winner already moved it out of DRAFT
    arrange({
      updateCount: 0,
      settledRab: draftRab({
        status: RAB_STATUS.LOCKED,
        lockedAt: new Date('2026-08-09T11:00:00.000Z'),
        lockedByAccountId: 'the-winner',
        lockedFromStatus: RAB_STATUS.DRAFT,
      }),
    });

    const result: any = await lock();

    expect(result.status).toBe(RAB_STATUS.LOCKED);
    expect(result.changed).toBe(false);
    expect(result.lockedByAccountId).toBe('the-winner');
  });

  it('T12: the transition is scoped to status DRAFT, so a racing write can never be frozen over', async () => {
    arrange();
    await lock();
    const call = tx.rabDocument.updateMany.mock.calls[0][0];
    // Not `where: { id }` — the status predicate is what makes the transition
    // compare-and-set rather than last-writer-wins.
    expect(call.where.status).toBe(RAB_STATUS.DRAFT);
  });

  // ── T13 / T14 ──────────────────────────────────────────────────────────────
  it('T13/T14: locking never approves and never creates a baseline', async () => {
    const { tx: client } = arrange();
    await lock();

    const written = client.rabDocument.updateMany.mock.calls[0][0].data;
    expect(written.status).toBe(RAB_STATUS.LOCKED);
    expect(written).not.toHaveProperty('approvedAt');
    expect(written).not.toHaveProperty('approvedByPositionId');
    expect(Object.keys(written)).toEqual(
      expect.arrayContaining(['status', 'lockedAt', 'lockedByAccountId', 'lockedFromStatus']),
    );
    // there is no baseline writer on the transaction client at all
    expect((client as any).projectBaseline).toBeUndefined();
  });

  it('an APPROVED RAB is never walked back into LOCKED', async () => {
    arrange({ rab: draftRab({ status: RAB_STATUS.APPROVED }) });
    const result: any = await lock();
    expect(result.reason).toBe(RAB_LOCK_REASON.RAB_ALREADY_APPROVED);
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
  });

  // ── scope / tenancy ────────────────────────────────────────────────────────
  it('a project in another workspace is "not found", never "forbidden"', async () => {
    arrange({ project: [{ id: projectId, workspaceId: 'someone-else' }] });
    const result: any = await lock();
    expect(result.reason).toBe(RAB_LOCK_REASON.PROJECT_NOT_FOUND);
  });

  // ── BLOCKER A (unit): CURRENT BASIC PRICE RELEVANCE ────────────────────────
  // The snapshot proof stays VERIFIED throughout these, which is the point:
  // drift must be caught while the frozen line reproduces itself perfectly.

  it('A: a different currently-eligible Basic Price refuses the lock even though the snapshot is VERIFIED', async () => {
    arrange();
    resolution.resolveVersionResources.mockResolvedValue([
      { ahspResourceId: 'res-1', status: 'RESOLVED', selectedBasicPriceId: 'bp-B', adaptedPriceValue: '140000.00' },
    ]);

    const result: any = await lock();

    expect(persisted.getPersistedCalculation).toHaveBeenCalled(); // snapshot still asked
    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(RAB_LOCK_REASON.PRELOCK_REVALIDATION_REQUIRED);
    expect(result.findings[0]).toMatchObject({
      finding: PRELOCK_FINDING.BASIC_PRICE_SELECTION_CHANGED,
      detail: 'Pekerja',
      storedUnitPrice: '132000.00',
      currentUnitPrice: '140000.00',
    });
    expect(tx.rabDocument.updateMany).not.toHaveBeenCalled();
  });

  it('A: the same price row whose adapted basis has moved is also refused', async () => {
    arrange();
    resolution.resolveVersionResources.mockResolvedValue([
      { ahspResourceId: 'res-1', status: 'RESOLVED', selectedBasicPriceId: 'bp-A', adaptedPriceValue: '150000.00' },
    ]);
    const result: any = await lock();
    expect(result.findings[0].finding).toBe(PRELOCK_FINDING.BASIC_PRICE_NO_LONGER_ELIGIBLE);
  });

  it('A: ambiguity is never resolved on the Owner behalf inside a freeze', async () => {
    arrange();
    resolution.resolveVersionResources.mockResolvedValue([
      { ahspResourceId: 'res-1', status: 'NEEDS_REVIEW', selectedBasicPriceId: null, adaptedPriceValue: null },
    ]);
    const result: any = await lock();
    expect(result.findings[0].finding).toBe(PRELOCK_FINDING.BASIC_PRICE_AMBIGUOUS);
  });

  it('A: a missing current price refuses the lock', async () => {
    arrange();
    resolution.resolveVersionResources.mockResolvedValue([
      { ahspResourceId: 'res-1', status: 'UNRESOLVED', selectedBasicPriceId: null, adaptedPriceValue: null },
    ]);
    const result: any = await lock();
    expect(result.findings[0].finding).toBe(PRELOCK_FINDING.BASIC_PRICE_MISSING);
  });

  it('A: an unchanged decision passes, and the authority is asked at the line OWN date, never today', async () => {
    arrange();
    const result: any = await lock();
    expect(result.status).toBe(RAB_STATUS.LOCKED);
    expect(resolution.resolveVersionResources).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ asOf: asOfDate }),
    );
    // and on the SAME transaction client that holds the project row lock
    expect(resolution.resolveVersionResources.mock.calls[0][0]).toBe(tx);
  });

  it('more than one Working Draft is ambiguous, so nothing is frozen', async () => {
    arrange({ structures: [{ id: 's1' }, { id: 's2' }] });
    const result: any = await lock();
    expect(result.reason).toBe(RAB_LOCK_REASON.AMBIGUOUS_WORKING_DRAFT);
  });
});


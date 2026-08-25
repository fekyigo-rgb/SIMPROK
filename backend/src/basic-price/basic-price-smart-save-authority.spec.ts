import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { BasicPriceSmartSaveService } from './basic-price-smart-save.service';
import type { TrustedBasicPriceActor } from './trusted-basic-price-actor.service';

/**
 * SMART-SAVE AUTHORITY — NOTHING IS READ BEFORE THE CALLER IS PROVEN.
 *
 * WHY THIS FILE RUNS WITHOUT A DATABASE OR THE OWNER'S WORKBOOK. The real
 * 86-row acceptance suite is the right place to prove SIMPROK's intelligence,
 * and it skips itself when that gitignored workbook is absent — which is
 * correct, and which is exactly why a security law must not live only there. A
 * boundary that is only checked on the machine that happens to hold a
 * spreadsheet is not checked. Everything below is a plain unit test over a
 * doubled Prisma, so it runs on every `npm test`, everywhere, always.
 *
 * WHAT THE ROUTE'S GUARDS ALREADY PROVE, AND WHAT THEY CANNOT. `PermissionsAll(
 * BASIC_PRICE_RESOLVE, BASIC_PRICE_SUBMIT)` proves that this account is a
 * member of the workspace it named and holds both capabilities IN it. No guard
 * has ever seen the batch id in the URL, so none of them can say whether the
 * caller may touch THAT batch. That gap is the command's own to close, and it
 * must close it before it reads anything at all.
 *
 * THE DEFECT THESE TESTS EXIST FOR. `smart-save` measured a batch's bindings
 * and prices by naked `batchId` and only afterwards called the step whose first
 * act is the ownership check. A member of workspace A naming a batch of
 * workspace B therefore caused two counts to run against B's rows before a
 * single line of ownership code executed. Nothing was mutated, and today's
 * classification arithmetic happened not to put those numbers in the response —
 * but a read of another tenant's rows is already the breach, and "the
 * arithmetic saved us" is not a boundary.
 */

const WORKSPACE_A = 'workspace-a';
const WORKSPACE_B = 'workspace-b';
const CALLER_ACCOUNT = 'account-caller';
const OTHER_ACCOUNT = 'account-other';
const BATCH_ID = 'batch-0001';

/**
 * The state a foreign batch really holds. Nothing here may ever reach the
 * caller — not as a count, not as a delta, not as a persistence verdict richer
 * than the refusal itself.
 */
const FOREIGN_BOUND_ROWS = 13;
const FOREIGN_KEPT_PRICES = 13;

/** The exact argument shapes this command passes to its doubled Prisma. */
interface RowCountArgs {
  where: { batchId: string; status: string; batch: { workspaceId: string } };
}
interface PriceCountArgs {
  where: { workspaceId: string; sourceImportRow: { batchId: string } };
}
interface BatchFindUniqueArgs {
  where: { id: string };
  select: Record<string, boolean>;
}

/**
 * The first argument of every recorded call, named rather than poked at. A
 * jest mock's `calls` is `any[][]`, so reading `[0].where` straight off it is an
 * unchecked guess about the very shape these tests exist to pin.
 */
const firstArgs = <T>(mock: jest.Mock): T[] =>
  (mock.mock.calls as unknown[][]).map((call) => call[0] as T);

interface CountingPrisma {
  basicPriceImportBatch: { findUnique: jest.Mock };
  basicPriceImportRow: { count: jest.Mock };
  basicPrice: { count: jest.Mock };
}

describe('SMART-SAVE — authority before measurement', () => {
  let service: BasicPriceSmartSaveService;
  let prisma: CountingPrisma;
  let resolution: { acceptMachineProvenRows: jest.Mock };
  let privateAssets: { keepBatchPrivate: jest.Mock };

  /** Every read this command can possibly issue, counted. */
  const measurementCalls = () =>
    prisma.basicPriceImportRow.count.mock.calls.length +
    prisma.basicPrice.count.mock.calls.length;

  /** The real shape, not a cast: server-derived account, user and workspace. */
  const actor: TrustedBasicPriceActor = {
    accountId: CALLER_ACCOUNT,
    userId: 'user-caller',
    workspaceId: WORKSPACE_A,
  };

  const press = () =>
    service.acceptProvenAndKeepPrivate({
      workspaceId: WORKSPACE_A,
      batchId: BATCH_ID,
      actor,
      reviewerAccountId: CALLER_ACCOUNT,
    });

  beforeEach(async () => {
    prisma = {
      basicPriceImportBatch: { findUnique: jest.fn() },
      // Both are wired to answer with the FOREIGN batch's real numbers. If the
      // command ever reads them without authority, the test sees the exact
      // figures that would have leaked rather than a harmless zero.
      basicPriceImportRow: {
        count: jest.fn().mockResolvedValue(FOREIGN_BOUND_ROWS),
      },
      basicPrice: { count: jest.fn().mockResolvedValue(FOREIGN_KEPT_PRICES) },
    };
    resolution = { acceptMachineProvenRows: jest.fn() };
    privateAssets = { keepBatchPrivate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPriceSmartSaveService,
        { provide: PrismaService, useValue: prisma },
        { provide: BasicPriceRowResolutionService, useValue: resolution },
        { provide: BasicPricePrivateAssetService, useValue: privateAssets },
      ],
    }).compile();

    service = module.get(BasicPriceSmartSaveService);
  });

  /* ── A. CROSS-WORKSPACE ────────────────────────────────────────────────── */

  describe('a batch belonging to another workspace', () => {
    beforeEach(() => {
      // The batch exists and is perfectly well-formed — it simply belongs to
      // someone else's tenant. This is the case a guard cannot catch.
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue({
        id: BATCH_ID,
        workspaceId: WORKSPACE_B,
        uploadedByAccountId: OTHER_ACCOUNT,
        status: 'NEEDS_REVIEW',
      });
    });

    it('is refused, and indistinguishably from a batch that does not exist', async () => {
      await expect(press()).rejects.toBeInstanceOf(NotFoundException);

      prisma.basicPriceImportBatch.findUnique.mockResolvedValue(null);
      await expect(press()).rejects.toBeInstanceOf(NotFoundException);
    });

    /** THE ORDERING INVARIANT, COUNTED RATHER THAN ASSERTED IN PROSE. */
    it('MEASUREMENT_CALLS_FOR_UNAUTHORIZED_BATCH = 0', async () => {
      await expect(press()).rejects.toThrow();
      expect(measurementCalls()).toBe(0);
      expect(prisma.basicPriceImportRow.count).not.toHaveBeenCalled();
      expect(prisma.basicPrice.count).not.toHaveBeenCalled();
    });

    it('derives no eligible set and materializes nothing — no mutation at all', async () => {
      await expect(press()).rejects.toThrow();
      expect(resolution.acceptMachineProvenRows).not.toHaveBeenCalled();
      expect(privateAssets.keepBatchPrivate).not.toHaveBeenCalled();
    });

    /**
     * THE REFUSAL CARRIES NO FOREIGN STATE. A smart-save failure normally
     * carries a `smartSave` envelope describing what survived; a refusal that
     * happened BEFORE any measurement has nothing to describe, and must not
     * invent a verdict about a batch the caller may not see.
     */
    it('the refusal body carries no progress envelope and no foreign numbers', async () => {
      const error = await press().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundException);
      const body = (error as NotFoundException).getResponse();
      const serialized = JSON.stringify(body);

      expect(serialized).not.toContain('smartSave');
      expect(serialized).not.toContain('boundRowsDelta');
      expect(serialized).not.toContain('keptPricesDelta');
      expect(serialized).not.toContain('PARTIAL');
      expect(serialized).not.toContain(String(FOREIGN_BOUND_ROWS));
      expect(serialized).not.toContain(WORKSPACE_B);
      expect(serialized).not.toContain(OTHER_ACCOUNT);
    });
  });

  /* ── B. SAME WORKSPACE, ANOTHER PERSON'S BATCH ─────────────────────────── */

  /**
   * The import lifecycle is USER-OWNED, not merely workspace-scoped: a
   * teammate holding the very same two permissions still may not touch someone
   * else's batch, because that authority belongs to the separate curation
   * queue. So this is a real, distinct case rather than a theoretical one — and
   * it must fail exactly as silently.
   */
  describe("a teammate's batch in the caller's own workspace", () => {
    beforeEach(() => {
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue({
        id: BATCH_ID,
        workspaceId: WORKSPACE_A,
        uploadedByAccountId: OTHER_ACCOUNT,
        status: 'NEEDS_REVIEW',
      });
    });

    it('is refused with the same non-disclosing answer', async () => {
      await expect(press()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('measures nothing and mutates nothing', async () => {
      await expect(press()).rejects.toThrow();
      expect(measurementCalls()).toBe(0);
      expect(resolution.acceptMachineProvenRows).not.toHaveBeenCalled();
      expect(privateAssets.keepBatchPrivate).not.toHaveBeenCalled();
    });
  });

  /* ── C. THE CALLER'S OWN BATCH — THE LAW MUST NOT BLOCK THE LAWFUL ─────── */

  describe("the caller's own batch", () => {
    beforeEach(() => {
      prisma.basicPriceImportBatch.findUnique.mockResolvedValue({
        id: BATCH_ID,
        workspaceId: WORKSPACE_A,
        uploadedByAccountId: CALLER_ACCOUNT,
        status: 'NEEDS_REVIEW',
      });
      resolution.acceptMachineProvenRows.mockResolvedValue({
        acceptedRowIds: [],
        acceptedCount: 13,
        eligibleCount: 13,
        skippedCount: 0,
        excludedCount: 0,
        remainingEligible: 0,
        evidenceLoads: 1,
        chunks: 3,
      });
      privateAssets.keepBatchPrivate.mockResolvedValue({
        batchId: BATCH_ID,
        createdCount: 13,
        alreadyPrivateCount: 0,
        prices: [],
      });
    });

    it('proceeds, and only THEN measures', async () => {
      const result = await press();
      expect(result.accepted.acceptedCount).toBe(13);
      expect(result.kept.createdCount).toBe(13);

      // Ownership was established first, and the measurement happened after it.
      expect(prisma.basicPriceImportBatch.findUnique).toHaveBeenCalledTimes(1);
      expect(measurementCalls()).toBeGreaterThan(0);
      const ownershipOrder =
        prisma.basicPriceImportBatch.findUnique.mock.invocationCallOrder[0];
      const firstMeasurement = Math.min(
        ...prisma.basicPriceImportRow.count.mock.invocationCallOrder,
        ...prisma.basicPrice.count.mock.invocationCallOrder,
      );
      expect(ownershipOrder).toBeLessThan(firstMeasurement);
    });

    /**
     * DEFENCE IN DEPTH. The ordering guarantee is the check above; this is the
     * second lock on the same door. Every measurement query names the
     * SERVER-DERIVED workspace, so a future edit that moved the check would
     * still not read another tenant's rows through this method.
     */
    it('scopes every measurement query by the server-derived workspace', async () => {
      await press();
      for (const args of firstArgs<RowCountArgs>(
        prisma.basicPriceImportRow.count,
      )) {
        expect(args.where.batch.workspaceId).toBe(WORKSPACE_A);
        expect(args.where.batchId).toBe(BATCH_ID);
      }
      for (const args of firstArgs<PriceCountArgs>(prisma.basicPrice.count)) {
        expect(args.where.workspaceId).toBe(WORKSPACE_A);
        expect(args.where.sourceImportRow.batchId).toBe(BATCH_ID);
      }
    });

    /**
     * THE OWNERSHIP READ ASKS FOR THE MINIMUM. A command that selected the
     * whole batch row would carry the caller's metadata, provenance and source
     * facts around a code path that needs none of them.
     */
    it('reads only the columns the ownership verdict needs', async () => {
      await press();
      const [args] = firstArgs<BatchFindUniqueArgs>(
        prisma.basicPriceImportBatch.findUnique,
      );
      expect(args.where).toEqual({ id: BATCH_ID });
      expect(args.select).toEqual({
        id: true,
        workspaceId: true,
        uploadedByAccountId: true,
        status: true,
      });
    });
  });
});

/**
 * SMART-SAVE FAILURE WIRING — proven end to end, still without a database.
 *
 * `basic-price-smart-save-failure.law.spec.ts` proves the classification
 * arithmetic; this proves the COMMAND actually feeds it the right two
 * measurements in the right order, which is the part a pure law cannot check.
 * Both run on every `npm test`, so the partial-failure contract does not depend
 * on the machine that happens to hold the Owner's workbook.
 */
describe('SMART-SAVE — what a failure is allowed to claim about persistence', () => {
  let service: BasicPriceSmartSaveService;
  let prisma: CountingPrisma;
  let resolution: { acceptMachineProvenRows: jest.Mock };
  let privateAssets: { keepBatchPrivate: jest.Mock };

  const actor: TrustedBasicPriceActor = {
    accountId: CALLER_ACCOUNT,
    userId: 'user-caller',
    workspaceId: WORKSPACE_A,
  };

  const press = () =>
    service.acceptProvenAndKeepPrivate({
      workspaceId: WORKSPACE_A,
      batchId: BATCH_ID,
      actor,
      reviewerAccountId: CALLER_ACCOUNT,
    });

  /** Ready rows before the press, then after the failure. Prices stay at 0. */
  const measuringBoundRows = (before: number, after: number) => {
    let call = 0;
    prisma.basicPriceImportRow.count.mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? before : after);
    });
    prisma.basicPrice.count.mockResolvedValue(0);
  };

  beforeEach(async () => {
    prisma = {
      basicPriceImportBatch: {
        findUnique: jest.fn().mockResolvedValue({
          id: BATCH_ID,
          workspaceId: WORKSPACE_A,
          uploadedByAccountId: CALLER_ACCOUNT,
          status: 'NEEDS_REVIEW',
        }),
      },
      basicPriceImportRow: { count: jest.fn().mockResolvedValue(0) },
      basicPrice: { count: jest.fn().mockResolvedValue(0) },
    };
    resolution = { acceptMachineProvenRows: jest.fn() };
    privateAssets = { keepBatchPrivate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPriceSmartSaveService,
        { provide: PrismaService, useValue: prisma },
        { provide: BasicPriceRowResolutionService, useValue: resolution },
        { provide: BasicPricePrivateAssetService, useValue: privateAssets },
      ],
    }).compile();

    service = module.get(BasicPriceSmartSaveService);
  });

  /**
   * THE CASE THE WHOLE CONTRACT EXISTS FOR. Step 1 commits in bounded chunks,
   * so a failure in step 2 leaves those bindings permanently in the database.
   * Saying "nothing was saved" there is a fluent falsehood at the worst
   * possible moment.
   */
  it('bindings that survived a step-2 fault are reported, never denied', async () => {
    measuringBoundRows(0, 13);
    resolution.acceptMachineProvenRows.mockResolvedValue({
      acceptedRowIds: [],
      acceptedCount: 13,
      eligibleCount: 13,
      skippedCount: 0,
      excludedCount: 0,
      remainingEligible: 0,
      evidenceLoads: 1,
      chunks: 3,
    });
    privateAssets.keepBatchPrivate.mockRejectedValue(
      new Error('connection terminated'),
    );

    const error = (await press().catch((caught: unknown) => caught)) as {
      getResponse(): { message: string; smartSave: unknown };
    };
    expect(error.getResponse()).toEqual({
      message: 'SMART_SAVE_INTERRUPTED',
      smartSave: {
        persistence: 'PARTIAL',
        boundRowsDelta: 13,
        keptPricesDelta: 0,
      },
    });
  });

  /**
   * AND CERTAINTY IS STILL AVAILABLE WHEN IT IS EARNED. Two equal readings are
   * a measurement, not a default, so a failure that genuinely persisted nothing
   * may still say so.
   */
  it('a failure that changed nothing is allowed to say nothing changed', async () => {
    measuringBoundRows(4, 4);
    resolution.acceptMachineProvenRows.mockRejectedValue(
      new ConflictException('BATCH_NOT_MUTABLE'),
    );

    const error = (await press().catch((caught: unknown) => caught)) as {
      getStatus(): number;
      getResponse(): { message: string; smartSave: { persistence: string } };
    };
    // The named reason survives with its own status — a reviewer who can act on
    // it must still be told what to act on.
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse().message).toBe('BATCH_NOT_MUTABLE');
    expect(error.getResponse().smartSave.persistence).toBe('NONE');
  });

  /**
   * A BATCH IS NOT A BLANK SLATE. Rows a person finished by hand before
   * pressing are already bound, so only the DIFFERENCE may ever be credited to
   * this press.
   */
  it('pre-existing bindings are never credited to this press', async () => {
    measuringBoundRows(9, 12);
    resolution.acceptMachineProvenRows.mockResolvedValue({
      acceptedRowIds: [],
      acceptedCount: 3,
      eligibleCount: 3,
      skippedCount: 0,
      excludedCount: 0,
      remainingEligible: 0,
      evidenceLoads: 1,
      chunks: 1,
    });
    privateAssets.keepBatchPrivate.mockRejectedValue(new Error('boom'));

    const error = (await press().catch((caught: unknown) => caught)) as {
      getResponse(): { smartSave: { boundRowsDelta: number } };
    };
    expect(error.getResponse().smartSave.boundRowsDelta).toBe(3);
  });

  /**
   * AND IT REFUSES TO GUESS. If the database cannot be read while the failure
   * is being explained, the honest answer is that persistence is unknown — not
   * a zero invented so the sentence reads tidily.
   */
  it('an unreadable measurement degrades to UNKNOWN, never to a tidy zero', async () => {
    prisma.basicPriceImportRow.count.mockRejectedValue(new Error('db down'));
    prisma.basicPrice.count.mockRejectedValue(new Error('db down'));
    resolution.acceptMachineProvenRows.mockRejectedValue(new Error('db down'));

    const error = (await press().catch((caught: unknown) => caught)) as {
      getResponse(): { smartSave: { persistence: string } };
    };
    expect(error.getResponse().smartSave.persistence).toBe('UNKNOWN');
  });

  /**
   * THE MEASUREMENT IS TENANT-SCOPED EVEN ON THE FAILURE PATH. A command
   * explaining what went wrong must not widen what it can see while doing it.
   */
  it('every failure-path measurement still names the server-derived workspace', async () => {
    measuringBoundRows(0, 5);
    resolution.acceptMachineProvenRows.mockResolvedValue({
      acceptedRowIds: [],
      acceptedCount: 5,
      eligibleCount: 5,
      skippedCount: 0,
      excludedCount: 0,
      remainingEligible: 0,
      evidenceLoads: 1,
      chunks: 1,
    });
    privateAssets.keepBatchPrivate.mockRejectedValue(new Error('boom'));

    await press().catch(() => undefined);
    for (const args of firstArgs<RowCountArgs>(
      prisma.basicPriceImportRow.count,
    )) {
      expect(args.where.batch.workspaceId).toBe(WORKSPACE_A);
    }
    for (const args of firstArgs<PriceCountArgs>(prisma.basicPrice.count)) {
      expect(args.where.workspaceId).toBe(WORKSPACE_A);
    }
  });
});

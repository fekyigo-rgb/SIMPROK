import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AhspVersionService } from './ahsp-version.service';
import { AhspAuditService } from './ahsp-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitKernelService } from '../../unit-kernel/unit-kernel.service';
import {
  buildEligibleAhspVersionWhere,
  PRIVATE_UNUSABLE_VERSION_STATUSES,
} from '../../project-ahsp/ahsp-eligibility.policy';

/**
 * RM-03D1 — AHSP VERSION RETIREMENT.
 *
 * A version's composition and effectiveDate are immutable in practice, which is
 * correct: an occurrence priced against a version must not have it change
 * underneath. The consequence was that an ERRONEOUS version stayed selectable
 * forever — `updateStatus` shipped with zero callers, and the only reachable
 * alternative archived the whole AHSP parent.
 *
 * These prove the narrow act that was missing, and prove just as hard what it
 * must never become: a delete, a promotion, a cross-tenant reach, a catalog
 * withdrawal, a race, or a second eligibility rule.
 */
describe('AhspVersionService — retirement (RM-03D1)', () => {
  let service: AhspVersionService;
  let tx: any;
  let prisma: { $transaction: jest.Mock };
  let audit: { logAction: jest.Mock };

  const WORKSPACE = 'ws-01';
  const OTHER_WORKSPACE = 'ws-02';
  const VERSION_ID = 'ver-01';
  const AHSP_ID = 'ahsp-01';
  const USER = 'user-01';

  let lockedRow: any;
  let parentRow: any;

  const locked = (over: Record<string, unknown> = {}) => ({
    id: VERSION_ID,
    ahspId: AHSP_ID,
    workspaceId: WORKSPACE,
    status: 'DRAFT',
    ...over,
  });

  const parent = (over: Record<string, unknown> = {}) => ({
    workspaceId: WORKSPACE,
    ownershipType: 'USER_ASSET',
    deletedAt: null,
    archivedAt: null,
    ...over,
  });

  beforeEach(async () => {
    lockedRow = locked();
    parentRow = parent();

    tx = {
      $queryRaw: jest.fn(async () => (lockedRow ? [lockedRow] : [])),
      aHSP: { findUnique: jest.fn(async () => parentRow) },
      aHSPVersion: {
        findUniqueOrThrow: jest.fn(async () => ({ ...lockedRow })),
        update: jest.fn(async ({ data }: any) => ({ ...lockedRow, ...data })),
      },
    };
    audit = { logAction: jest.fn() };
    prisma = { $transaction: jest.fn((cb: any) => cb(tx)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AhspVersionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AhspAuditService, useValue: audit },
        { provide: UnitKernelService, useValue: { resolve: jest.fn() } },
      ],
    }).compile();

    service = module.get(AhspVersionService);
  });

  const retire = (over: Record<string, unknown> = {}) =>
    service.retireVersion({
      versionId: VERSION_ID,
      workspaceId: WORKSPACE,
      status: 'ARCHIVED',
      userId: USER,
      reason: 'construction attempt missing required temporal completeness',
      ...(over as any),
    });

  // ---------------- the act ----------------

  it('1. retires an erroneous version and records the reason with a before-image', async () => {
    const result = await retire();

    expect(result.changed).toBe(true);
    expect(result.version.status).toBe('ARCHIVED');
    expect(audit.logAction).toHaveBeenCalledTimes(1);
    expect(audit.logAction.mock.calls[0][0]).toMatchObject({
      ahspVersionId: VERSION_ID,
      who: USER,
      reason: 'construction attempt missing required temporal completeness',
    });
    expect(audit.logAction.mock.calls[0][0].before).toBeDefined();
  });

  it('2. SUPERSEDED is available for a version replaced by a corrected successor', async () => {
    const result = await retire({ status: 'SUPERSEDED', reason: 'effective-date provenance corrected' });

    expect(result.version.status).toBe('SUPERSEDED');
  });

  // ---------------- GAP-3: atomicity ----------------

  it('3. ATOMIC — the audit is written inside the SAME transaction as the update', async () => {
    await retire();

    // Second argument is the transaction client. If the audit were written
    // through the root client, a failed audit would leave a version withdrawn
    // with no recorded reason.
    expect(audit.logAction.mock.calls[0][1]).toBe(tx);
  });

  it('4. ROLLBACK — a failing audit aborts the whole retirement, so the status never commits alone', async () => {
    audit.logAction.mockRejectedValue(new Error('AUDIT_WRITE_FAILED'));

    await expect(retire()).rejects.toThrow('AUDIT_WRITE_FAILED');
    // The update was attempted inside the transaction, and the throw propagates
    // out of the $transaction callback — so Prisma rolls it back rather than
    // leaving a withdrawn version with no reason attached.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  // ---------------- GAP-4A: concurrency ----------------

  it('5. SERIALIZED — the row is locked FOR UPDATE before any decision is taken', async () => {
    await retire();

    const sql = tx.$queryRaw.mock.calls[0][0].strings.join('');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('ahsp_versions');
  });

  it('6. the status is re-read AFTER the lock, not before it', async () => {
    // The decision is made from the locked row, so a status that changed while
    // this request waited is the one that governs.
    lockedRow = locked({ status: 'ARCHIVED' });

    const result = await retire();

    expect(result.changed).toBe(false);
    expect(tx.aHSPVersion.update).not.toHaveBeenCalled();
  });

  it('7. IDEMPOTENT — retiring to the status it already holds writes no second audit row', async () => {
    lockedRow = locked({ status: 'ARCHIVED' });

    const result = await retire();

    expect(result.changed).toBe(false);
    expect(tx.aHSPVersion.update).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('8. FIRST TERMINAL DECISION WINS — retiring an ARCHIVED version as SUPERSEDED is refused, never overwritten', async () => {
    lockedRow = locked({ status: 'ARCHIVED' });

    const error = await retire({ status: 'SUPERSEDED' }).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      message: 'AHSP_VERSION_ALREADY_RETIRED_DIFFERENTLY',
      currentStatus: 'ARCHIVED',
      requestedStatus: 'SUPERSEDED',
    });
    expect(tx.aHSPVersion.update).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('9. and the mirror case: a SUPERSEDED version is not re-labelled ARCHIVED', async () => {
    lockedRow = locked({ status: 'SUPERSEDED' });

    await expect(retire({ status: 'ARCHIVED' })).rejects.toThrow(
      'AHSP_VERSION_ALREADY_RETIRED_DIFFERENTLY',
    );
    expect(tx.aHSPVersion.update).not.toHaveBeenCalled();
  });

  // ---------------- GAP-4B: authority scope ----------------

  it('10. a PUBLISHED version is NOT retirable through this private route', async () => {
    lockedRow = locked({ status: 'PUBLISHED' });

    await expect(retire()).rejects.toThrow('PUBLISHED_AHSP_VERSION_NOT_RETIRABLE_HERE');
    expect(tx.aHSPVersion.update).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('11. a non-USER_ASSET parent is refused — this route is not catalog retirement', async () => {
    parentRow = parent({ ownershipType: 'SIMPROK_ASSET' });

    await expect(retire()).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.aHSPVersion.update).not.toHaveBeenCalled();
  });

  it('12. a null-workspace (Official Repository) version is refused', async () => {
    lockedRow = locked({ workspaceId: null });

    await expect(retire()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('13. a foreign-workspace version reads as not-found rather than forbidden', async () => {
    await expect(retire({ workspaceId: OTHER_WORKSPACE })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.aHSPVersion.update).not.toHaveBeenCalled();
  });

  it('14. a version whose PARENT belongs to another workspace is refused even though the row matched', async () => {
    parentRow = parent({ workspaceId: OTHER_WORKSPACE });

    await expect(retire()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('15. a deleted or archived parent is refused', async () => {
    parentRow = parent({ deletedAt: new Date() });
    await expect(retire()).rejects.toBeInstanceOf(NotFoundException);

    parentRow = parent({ archivedAt: new Date() });
    await expect(retire()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('16. a missing version reads as not-found', async () => {
    lockedRow = null;

    await expect(retire()).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---------------- no second eligibility rule ----------------

  it('17. retirement adds NO second eligibility rule — both outcomes are already excluded by the existing authority', () => {
    expect(PRIVATE_UNUSABLE_VERSION_STATUSES).toEqual(
      expect.arrayContaining(['SUPERSEDED', 'ARCHIVED']),
    );

    const where: any = buildEligibleAhspVersionWhere(WORKSPACE, new Date('2026-08-08'));
    const privateBranch = where.AND[1].OR[1];
    expect(privateBranch.status).toEqual({ notIn: PRIVATE_UNUSABLE_VERSION_STATUSES });
    // And a retired version can never satisfy the catalog branch either.
    expect(where.AND[1].OR[0].status).toBe('PUBLISHED');
  });
});

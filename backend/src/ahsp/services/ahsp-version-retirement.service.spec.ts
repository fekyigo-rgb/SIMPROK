import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
 * must never become: a delete, a promotion, a cross-tenant reach, or a second
 * eligibility rule.
 */
describe('AhspVersionService — retirement (RM-03D1)', () => {
  let service: AhspVersionService;
  let prisma: {
    aHSPVersion: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let audit: { logAction: jest.Mock };

  const WORKSPACE = 'ws-01';
  const OTHER_WORKSPACE = 'ws-02';
  const VERSION_ID = 'ver-01';
  const USER = 'user-01';

  const versionRow = (over: Record<string, unknown> = {}) => ({
    id: VERSION_ID,
    ahspId: 'ahsp-01',
    workspaceId: WORKSPACE,
    versionNumber: 3,
    status: 'DRAFT',
    ahsp: { workspaceId: WORKSPACE, deletedAt: null },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      aHSPVersion: {
        findFirst: jest.fn(),
        findUnique: jest.fn(async () => versionRow()),
        update: jest.fn(async ({ data }: any) => ({ ...versionRow(), ...data })),
      },
    };
    audit = { logAction: jest.fn() };

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

  it('1. retires an erroneous version and records the reason on the existing audit log', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(versionRow());

    const result = await retire();

    expect(result.changed).toBe(true);
    expect(result.version.status).toBe('ARCHIVED');
    expect(audit.logAction).toHaveBeenCalledTimes(1);
    expect(audit.logAction.mock.calls[0][0]).toMatchObject({
      ahspVersionId: VERSION_ID,
      who: USER,
      reason: 'construction attempt missing required temporal completeness',
    });
    // History, not deletion: the before-image is carried into the audit row.
    expect(audit.logAction.mock.calls[0][0].before).toBeDefined();
  });

  it('2. SUPERSEDED is available for a version replaced by a corrected successor', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(versionRow());

    const result = await retire({ status: 'SUPERSEDED', reason: 'effective-date provenance corrected' });

    expect(result.version.status).toBe('SUPERSEDED');
  });

  it('3. IDEMPOTENT — retiring to the status it already holds changes nothing and writes no second audit row', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(versionRow({ status: 'ARCHIVED' }));

    const result = await retire();

    expect(result.changed).toBe(false);
    expect(prisma.aHSPVersion.update).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('4. a foreign-workspace version is not retirable, and reads as not-found rather than forbidden', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(null);

    await expect(retire({ workspaceId: OTHER_WORKSPACE })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aHSPVersion.update).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('5. a version whose PARENT belongs to another workspace is refused even if the row matched', async () => {
    // Defence in depth: the parent is re-checked rather than trusted.
    prisma.aHSPVersion.findFirst.mockResolvedValue(
      versionRow({ ahsp: { workspaceId: OTHER_WORKSPACE, deletedAt: null } }),
    );

    await expect(retire()).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aHSPVersion.update).not.toHaveBeenCalled();
  });

  it('6. a version under a deleted AHSP is not retirable', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(
      versionRow({ ahsp: { workspaceId: WORKSPACE, deletedAt: new Date() } }),
    );

    await expect(retire()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('7. the tenant predicate is strict equality — never an OR with null', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(versionRow());

    await retire();

    expect(prisma.aHSPVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VERSION_ID, workspaceId: WORKSPACE } }),
    );
  });

  it('8. retirement introduces NO second eligibility rule — both outcomes are already excluded by the existing authority', () => {
    // The whole point: this slice adds a way to SET a status, never a new way to
    // interpret one. If these two statuses ever left the shared exclusion list,
    // a retired version would silently become selectable again.
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

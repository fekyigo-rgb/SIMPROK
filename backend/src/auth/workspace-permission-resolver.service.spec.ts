import { WorkspacePermissionResolverService } from './workspace-permission-resolver.service';
import {
  PERMISSIONS,
  ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES,
} from '../common/constants/permissions';

const BASELINE = [...ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES].sort();

describe('WorkspacePermissionResolverService', () => {
  let findFirst: jest.Mock;
  let resolver: WorkspacePermissionResolverService;

  const prismaStub = () => ({ workspaceMembership: { findFirst } });

  beforeEach(() => {
    findFirst = jest.fn();
    resolver = new WorkspacePermissionResolverService(prismaStub() as any);
  });

  const membership = (roles: Array<{ codes: string[] }>) => ({
    id: 'membership-1',
    membershipRoles: roles.map((role) => ({
      role: {
        rolePermissions: role.codes.map((code) => ({ permission: { code } })),
      },
    })),
  });

  // LEGACY_TEST_CHANGE_REGISTER (Amendment A2):
  // FILE: workspace-permission-resolver.service.spec.ts
  // TEST_NAME: every case below that asserts an ACTIVE membership's resolved
  //   permissions.
  // OLD_EXPECTATION: an ACTIVE membership resolved to exactly its
  //   RolePermission-granted codes; a membership with zero role grants
  //   resolved to an empty (but non-null) permissions array.
  // NEW_EXPECTATION: an ACTIVE membership always resolves to at least
  //   ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES (BASIC_PRICE_VIEW/_IMPORT/
  //   _RESOLVE/_SUBMIT), unioned with whatever RolePermission grants.
  // REASON: Owner Decision ONE SIMPROK BASIC PRICE PRODUCT MODEL — SIMPROK
  //   has no role-based product variant; every ACTIVE membership gets the
  //   same Basic Price baseline regardless of role.
  // OWNER_LAW_REFERENCE: docs/control/DECISIONS.md — ONE SIMPROK BASIC PRICE
  //   PRODUCT MODEL; Amendment A1 (security boundary consequence).
  // SECURITY_BOUNDARY_PRESERVED: YES — missing/inactive membership still
  //   resolves null (test 2 below, unchanged); internal curation codes
  //   (REVIEW_VIEW/VERIFY/PUBLISH) are still never part of the baseline
  //   (test 8 below); cross-workspace scoping unchanged (test 4).
  // TEST_WEAKENING: NO.

  it('1. ACTIVE membership without any role grant still resolves the active-membership baseline (VIEW/IMPORT/RESOLVE/SUBMIT)', async () => {
    findFirst.mockResolvedValue(membership([]));

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(result).toEqual({
      membershipId: 'membership-1',
      permissions: BASELINE,
    });
  });

  it('2. missing/inactive/invited/suspended membership resolves null (denied, not empty-granted)', async () => {
    findFirst.mockResolvedValue(null);

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(result).toBeNull();
    // status: 'ACTIVE' is part of the query itself — an INACTIVE/INVITED/SUSPENDED
    // membership never matches findFirst's where clause, so it naturally resolves null.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('3. only isActive+unexpired MembershipRole rows are selected by the query (isActive filter present)', async () => {
    findFirst.mockResolvedValue(membership([]));

    await resolver.resolve('account-1', 'workspace-a');

    const call = findFirst.mock.calls[0][0];
    expect(call.select.membershipRoles.where).toEqual(
      expect.objectContaining({
        isActive: true,
        OR: [{ endDate: null }, { endDate: { gte: expect.any(Date) } }],
      }),
    );
  });

  it('4. workspace scoping: the query is filtered to the exact account+workspace pair, never cross-workspace', async () => {
    findFirst.mockResolvedValue(membership([{ codes: ['PROJECT_VIEW'] }]));

    await resolver.resolve('account-1', 'workspace-a');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: 'account-1',
          workspaceId: 'workspace-a',
        }),
      }),
    );
  });

  it('5. ACTIVE membership with a role: baseline UNION role permissions, unique, sorted', async () => {
    findFirst.mockResolvedValue(
      membership([{ codes: ['PROJECT_VIEW', 'RAB_VIEW'] }]),
    );

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(result).toEqual({
      membershipId: 'membership-1',
      permissions: Array.from(
        new Set([...BASELINE, 'PROJECT_VIEW', 'RAB_VIEW']),
      ).sort(),
    });
  });

  it('6. duplicate RolePermission grant across multiple roles, and duplicate overlap with the baseline itself, collapses to one code each', async () => {
    findFirst.mockResolvedValue(
      membership([
        { codes: ['PROJECT_VIEW', 'RAB_VIEW', PERMISSIONS.BASIC_PRICE_VIEW] },
        { codes: ['RAB_VIEW'] },
      ]),
    );

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(
      result?.permissions.filter((code) => code === 'RAB_VIEW'),
    ).toHaveLength(1);
    expect(
      result?.permissions.filter(
        (code) => code === PERMISSIONS.BASIC_PRICE_VIEW,
      ),
    ).toHaveLength(1);
  });

  it('7. result is deterministically sorted', async () => {
    findFirst.mockResolvedValue(
      membership([{ codes: ['RAB_VIEW', 'PROJECT_CREATE', 'PROJECT_VIEW'] }]),
    );

    const result = await resolver.resolve('account-1', 'workspace-a');

    const expected = Array.from(
      new Set([...BASELINE, 'RAB_VIEW', 'PROJECT_CREATE', 'PROJECT_VIEW']),
    ).sort();
    expect(result?.permissions).toEqual(expected);
  });

  it('8. ACTIVE membership never automatically receives internal curation codes (REVIEW_VIEW/VERIFY/PUBLISH) absent an explicit role grant', async () => {
    findFirst.mockResolvedValue(membership([]));

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(result?.permissions).not.toContain(
      PERMISSIONS.BASIC_PRICE_REVIEW_VIEW,
    );
    expect(result?.permissions).not.toContain(PERMISSIONS.BASIC_PRICE_VERIFY);
    expect(result?.permissions).not.toContain(PERMISSIONS.BASIC_PRICE_PUBLISH);
  });

  it('9. an explicit role grant of an internal curation code is still honored (role-derived, not baseline-derived)', async () => {
    findFirst.mockResolvedValue(
      membership([
        {
          codes: [
            PERMISSIONS.BASIC_PRICE_REVIEW_VIEW,
            PERMISSIONS.BASIC_PRICE_VERIFY,
          ],
        },
      ]),
    );

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(result?.permissions).toEqual(
      Array.from(
        new Set([
          ...BASELINE,
          PERMISSIONS.BASIC_PRICE_REVIEW_VIEW,
          PERMISSIONS.BASIC_PRICE_VERIFY,
        ]),
      ).sort(),
    );
  });
});

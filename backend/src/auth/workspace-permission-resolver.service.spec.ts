import { WorkspacePermissionResolverService } from './workspace-permission-resolver.service';

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

  it('1. ACTIVE membership + active unexpired role resolves the granted permission codes', async () => {
    findFirst.mockResolvedValue(
      membership([{ codes: ['PROJECT_VIEW', 'RAB_VIEW'] }]),
    );

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(result).toEqual({
      membershipId: 'membership-1',
      permissions: ['PROJECT_VIEW', 'RAB_VIEW'],
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

  it('5. duplicate RolePermission/grant across multiple roles collapses to one code', async () => {
    findFirst.mockResolvedValue(
      membership([
        { codes: ['PROJECT_VIEW', 'RAB_VIEW'] },
        { codes: ['RAB_VIEW'] },
      ]),
    );

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(
      result?.permissions.filter((code) => code === 'RAB_VIEW'),
    ).toHaveLength(1);
  });

  it('6. result is deterministically sorted', async () => {
    findFirst.mockResolvedValue(
      membership([{ codes: ['RAB_VIEW', 'PROJECT_CREATE', 'PROJECT_VIEW'] }]),
    );

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(result?.permissions).toEqual([
      'PROJECT_CREATE',
      'PROJECT_VIEW',
      'RAB_VIEW',
    ]);
  });

  it('7. a membership with zero granted permissions resolves an empty, non-null array (membership itself is real)', async () => {
    findFirst.mockResolvedValue(membership([]));

    const result = await resolver.resolve('account-1', 'workspace-a');

    expect(result).toEqual({ membershipId: 'membership-1', permissions: [] });
  });
});

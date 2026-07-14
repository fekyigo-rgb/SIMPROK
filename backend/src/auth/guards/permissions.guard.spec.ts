import { ExecutionContext, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { workspaceMembership: { findFirst: jest.Mock } };
  let guard: PermissionsGuard;
  let request: any;

  const createContext = (): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  const membershipWithPermissions = (permissionCodes: string[]) => ({
    id: 'membership-1',
    membershipRoles: [
      {
        role: {
          rolePermissions: permissionCodes.map((code) => ({ permission: { code } })),
        },
      },
    ],
  });

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['PROJECT_VIEW']),
    };
    prisma = { workspaceMembership: { findFirst: jest.fn() } };
    guard = new PermissionsGuard(reflector as unknown as Reflector, prisma as any);
    request = {
      user: { id: 'account-1' },
      headers: {},
      query: {},
      params: {},
    };
  });

  it('1. project route without an explicit workspace header uses request.projectAccess.workspaceId', async () => {
    request.projectAccess = { workspaceId: 'workspace-a' };
    prisma.workspaceMembership.findFirst.mockResolvedValue(
      membershipWithPermissions(['PROJECT_VIEW']),
    );

    await expect(guard.canActivate(createContext())).resolves.toBe(true);

    expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: 'account-1',
          workspaceId: 'workspace-a',
        }),
      }),
    );
  });

  it('2. matching explicit workspace header proceeds normally', async () => {
    request.projectAccess = { workspaceId: 'workspace-a' };
    request.headers['x-workspace-id'] = 'workspace-a';
    prisma.workspaceMembership.findFirst.mockResolvedValue(
      membershipWithPermissions(['PROJECT_VIEW']),
    );

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
  });

  it('3. mismatched explicit workspace header is rejected with 403 before any DB lookup', async () => {
    request.projectAccess = { workspaceId: 'workspace-a' };
    request.headers['x-workspace-id'] = 'workspace-b';

    await expect(guard.canActivate(createContext())).rejects.toThrow(ForbiddenException);
    expect(prisma.workspaceMembership.findFirst).not.toHaveBeenCalled();
  });

  it('4. a permission held only in Workspace B cannot authorize a Workspace A project operation', async () => {
    request.projectAccess = { workspaceId: 'workspace-a' };
    // The account's only ACTIVE membership+permission grant lives in Workspace B, so the
    // Workspace A lookup performed by the guard finds nothing.
    prisma.workspaceMembership.findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(createContext())).rejects.toThrow(ForbiddenException);
  });

  it('5. membership/role lookup is performed against Workspace A (from projectAccess), never a differing supplied value', async () => {
    request.projectAccess = { workspaceId: 'workspace-a' };
    request.query = { workspaceId: 'workspace-a' };
    prisma.workspaceMembership.findFirst.mockResolvedValue(
      membershipWithPermissions(['PROJECT_VIEW']),
    );

    await guard.canActivate(createContext());

    expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-a' }),
      }),
    );
  });

  it('6. membership exists in Workspace A but lacks the required permission -> 403', async () => {
    request.projectAccess = { workspaceId: 'workspace-a' };
    prisma.workspaceMembership.findFirst.mockResolvedValue(
      membershipWithPermissions(['PROJECT_CREATE']),
    );

    await expect(guard.canActivate(createContext())).rejects.toThrow(ForbiddenException);
  });

  it('7. non-project route without any workspace context returns 400', async () => {
    await expect(guard.canActivate(createContext())).rejects.toThrow(BadRequestException);
    expect(prisma.workspaceMembership.findFirst).not.toHaveBeenCalled();
  });

  it('8. non-project route with a matching explicit workspace still passes (existing behavior unchanged)', async () => {
    request.headers['x-workspace-id'] = 'workspace-a';
    prisma.workspaceMembership.findFirst.mockResolvedValue(
      membershipWithPermissions(['PROJECT_VIEW']),
    );

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-a' }),
      }),
    );
  });

  it('9. request.workspaceContext is populated with the project workspace on success', async () => {
    request.projectAccess = { workspaceId: 'workspace-a' };
    prisma.workspaceMembership.findFirst.mockResolvedValue(
      membershipWithPermissions(['PROJECT_VIEW']),
    );

    await guard.canActivate(createContext());

    expect(request.workspaceContext).toEqual({
      workspaceId: 'workspace-a',
      membershipId: 'membership-1',
    });
  });
});

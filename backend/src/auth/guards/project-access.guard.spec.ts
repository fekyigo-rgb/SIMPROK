import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectAccessGuard } from './project-access.guard';

describe('ProjectAccessGuard', () => {
  const project = {
    id: 'p1',
    workspaceId: 'w1',
    status: 'ACTIVE',
  };
  const user = {
    id: 'u1',
    workspaceMembershipId: 'm1',
    workspaceId: 'w1',
    fullName: 'Project User',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const membership = {
    id: 'm1',
    accountId: 'account-1',
    workspaceId: 'w1',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    userProfile: user,
    membershipRoles: [
      {
        id: 'mr1',
        workspaceMembershipId: 'm1',
        roleId: 'r1',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: null,
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        role: {
          id: 'r1',
          workspaceId: 'w1',
          code: 'PROJECT_MANAGER',
          name: 'Project Manager',
          description: null,
          isSystem: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      },
    ],
  };
  const assignment = {
    id: 'a1',
    workspaceMembershipId: 'm1',
    projectId: 'p1',
    roleInProject: 'PM',
    assignedAt: new Date('2026-01-01T00:00:00.000Z'),
    revokedAt: null,
    isPrimaryAssignment: true,
    status: 'ASSIGNED',
  };

  let prisma: {
    project: { findUnique: jest.Mock };
    workspaceMembership: { findUnique: jest.Mock };
    projectAssignment: { findUnique: jest.Mock };
  };
  let guard: ProjectAccessGuard;
  let request: any;

  const createContext = (): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as ExecutionContext;

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue(project) },
      workspaceMembership: { findUnique: jest.fn().mockResolvedValue(membership) },
      projectAssignment: { findUnique: jest.fn().mockResolvedValue(assignment) },
    };
    guard = new ProjectAccessGuard(prisma as any);
    request = {
      user: { id: 'account-1', email: 'account@example.com', memberships: [] },
      params: { projectId: 'p1' },
    };
  });

  it('throws 404 when project is not found', async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      NotFoundException,
    );
  });

  it("throws 404 when account is not a member of project's workspace", async () => {
    prisma.workspaceMembership.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws 404 when membership exists but status is not ACTIVE', async () => {
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      ...membership,
      status: 'SUSPENDED',
    });

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws 403 when workspace member has no active ProjectAssignment', async () => {
    prisma.projectAssignment.findUnique.mockResolvedValue({
      ...assignment,
      status: 'REMOVED',
    });

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns true and populates projectAccess when active assignment exists', async () => {
    await expect(guard.canActivate(createContext())).resolves.toBe(true);

    expect(request.projectAccess).toEqual({
      projectId: 'p1',
      workspaceId: 'w1',
      projectStatus: 'ACTIVE',
      membershipId: 'm1',
      assignmentId: 'a1',
      roleInProject: 'PM',
      isPrimaryAssignment: true,
      roles: ['PROJECT_MANAGER'],
    });
    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { id: true, workspaceId: true, status: true },
    });
    expect(prisma.workspaceMembership.findUnique).toHaveBeenCalledWith({
      where: {
        accountId_workspaceId: {
          accountId: 'account-1',
          workspaceId: 'w1',
        },
      },
      include: {
        userProfile: true,
        membershipRoles: {
          include: {
            role: true,
          },
        },
      },
    });
    expect(prisma.projectAssignment.findUnique).toHaveBeenCalledWith({
      where: {
        workspaceMembershipId_projectId: {
          workspaceMembershipId: 'm1',
          projectId: 'p1',
        },
      },
    });
  });

  it('throws UnauthorizedException when req.user is missing', async () => {
    request.user = undefined;

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws Error when params.projectId is missing', async () => {
    request.params = {};

    await expect(guard.canActivate(createContext())).rejects.toThrow(Error);
  });
});

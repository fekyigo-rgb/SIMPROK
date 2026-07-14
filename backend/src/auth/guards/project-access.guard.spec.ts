import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProjectAccessGuard } from './project-access.guard';

const grantedContext = {
  projectId: 'p1',
  workspaceId: 'w1',
  projectStatus: 'ACTIVE',
  membershipId: 'm1',
  assignmentId: 'a1',
  roleInProject: 'PM',
  isPrimaryAssignment: true,
  roles: ['PROJECT_MANAGER'],
};

describe('ProjectAccessGuard', () => {
  let accessPolicy: { resolveProjectAccess: jest.Mock };
  let guard: ProjectAccessGuard;
  let request: any;

  const createContext = (): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as ExecutionContext;

  beforeEach(() => {
    accessPolicy = {
      resolveProjectAccess: jest.fn().mockResolvedValue({
        kind: 'GRANTED',
        context: grantedContext,
      }),
    };
    guard = new ProjectAccessGuard(accessPolicy as any);
    request = {
      user: { id: 'account-1' },
      params: { projectId: 'p1' },
    };
  });

  it('delegates access resolution to the shared policy', async () => {
    await expect(guard.canActivate(createContext())).resolves.toBe(true);

    expect(accessPolicy.resolveProjectAccess).toHaveBeenCalledWith(
      'account-1',
      'p1',
    );
    expect(request.projectAccess).toEqual(grantedContext);
  });

  it.each(['PROJECT_NOT_FOUND', 'MEMBERSHIP_NOT_FOUND'] as const)(
    'returns 404 for %s',
    async (kind) => {
      accessPolicy.resolveProjectAccess.mockResolvedValue({ kind });

      await expect(guard.canActivate(createContext())).rejects.toThrow(
        NotFoundException,
      );
    },
  );

  it('returns 403 when assignment is required', async () => {
    accessPolicy.resolveProjectAccess.mockResolvedValue({
      kind: 'ASSIGNMENT_REQUIRED',
    });

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      ForbiddenException,
    );
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

import { ProjectAccessPolicyService } from './project-access-policy.service';

const project = {
  id: 'p1',
  workspaceId: 'w1',
  organizationId: 'org1',
  code: 'P-1',
  name: 'Project 1',
  description: null,
  mainMaterialSpec: null,
  location: null,
  clientName: null,
  type: 'GENERAL',
  address: null,
  budgetBaseline: null,
  startDate: null,
  endDate: null,
  createdById: null,
  deletedAt: null,
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
  userProfile: { id: 'user-1' },
  membershipRoles: [
    {
      role: {
        code: 'PROJECT_MANAGER',
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
  project,
};

describe('ProjectAccessPolicyService', () => {
  let prisma: {
    project: { findUnique: jest.Mock };
    workspaceMembership: { findUnique: jest.Mock };
    projectAssignment: { findMany: jest.Mock };
  };
  let service: ProjectAccessPolicyService;

  beforeEach(() => {
    prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: project.id,
          workspaceId: project.workspaceId,
          status: project.status,
        }),
      },
      workspaceMembership: {
        findUnique: jest.fn().mockResolvedValue(membership),
      },
      projectAssignment: {
        findMany: jest.fn(),
      },
    };
    service = new ProjectAccessPolicyService(prisma as any);
  });

  it.each([
    ['assigned', [assignment], true],
    ['nonassigned', [], false],
  ])(
    'keeps list and project-scoped resolution equivalent for %s membership',
    async (_label, assignments, expectedGranted) => {
      prisma.projectAssignment.findMany.mockResolvedValue(assignments);

      const resolution = await service.resolveProjectAccess('account-1', 'p1');
      const projects = await service.listAccessibleProjects('account-1', 'w1');

      const guardGranted = resolution.kind === 'GRANTED';
      const listed = projects.some((candidate) => candidate.id === 'p1');

      expect(guardGranted).toBe(expectedGranted);
      expect(listed).toBe(expectedGranted);
      expect(listed).toBe(guardGranted);

      expect(prisma.projectAssignment.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            workspaceMembershipId: 'm1',
            status: 'ASSIGNED',
            projectId: 'p1',
            project: { workspaceId: 'w1' },
          },
        }),
      );
      expect(prisma.projectAssignment.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            workspaceMembershipId: 'm1',
            status: 'ASSIGNED',
            project: { workspaceId: 'w1' },
          },
        }),
      );
    },
  );

  it('returns no access and no list when workspace membership is not eligible', async () => {
    prisma.workspaceMembership.findUnique.mockResolvedValue(null);

    await expect(
      service.resolveProjectAccess('account-1', 'p1'),
    ).resolves.toEqual({ kind: 'MEMBERSHIP_NOT_FOUND' });
    await expect(
      service.listAccessibleProjects('account-1', 'w1'),
    ).resolves.toEqual([]);
    expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
  });
});

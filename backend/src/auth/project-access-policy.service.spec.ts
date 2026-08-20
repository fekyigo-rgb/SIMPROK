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
    project: {
      findUnique: jest.Mock;
    };
    workspaceMembership: {
      findUnique: jest.Mock;
    };
    projectAssignment: {
      findMany: jest.Mock;
    };
    organization: {
      findMany: jest.Mock;
    };
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
      organization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'org1',
            name: 'Org-A',
          },
        ]),
      },
    };

    service =
      new ProjectAccessPolicyService(prisma as any);
  });

  it.each([
    ['assigned', [assignment], true],
    ['nonassigned', [], false],
  ])(
    'keeps list and project-scoped resolution equivalent for %s membership',
    async (_label, assignments, expectedGranted) => {
      prisma.projectAssignment.findMany.mockResolvedValue(assignments);

      const resolution =
        await service.resolveProjectAccess(
          'account-1',
          'p1',
        );

      expect(
        prisma.organization.findMany,
      ).not.toHaveBeenCalled();

      const projects =
        await service.listAccessibleProjects(
          'account-1',
          'w1',
        );

      const guardGranted =
        resolution.kind === 'GRANTED';

      const listed =
        projects.some(
          (candidate) => candidate.id === 'p1',
        );

      expect(guardGranted).toBe(expectedGranted);
      expect(listed).toBe(expectedGranted);
      expect(listed).toBe(guardGranted);

      if (expectedGranted) {
        expect(projects).toHaveLength(1);

        expect(
          projects[0]?.organizationName,
        ).toBe('Org-A');

        expect(
          prisma.organization.findMany,
        ).toHaveBeenCalledTimes(1);

        expect(
          prisma.organization.findMany,
        ).toHaveBeenCalledWith({
          where: {
            id: {
              in: ['org1'],
            },
          },
          select: {
            id: true,
            name: true,
          },
        });
      } else {
        expect(projects).toEqual([]);

        expect(
          prisma.organization.findMany,
        ).not.toHaveBeenCalled();
      }

      expect(
        prisma.projectAssignment.findMany,
      ).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            workspaceMembershipId: 'm1',
            status: 'ASSIGNED',
            revokedAt: null,
            projectId: 'p1',
            project: {
              is: {
                workspaceId: 'w1',
              },
            },
          },
          include: {
            project: true,
          },
        }),
      );

      expect(
        prisma.projectAssignment.findMany,
      ).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            workspaceMembershipId: 'm1',
            status: 'ASSIGNED',
            revokedAt: null,
            project: {
              is: {
                workspaceId: 'w1',
              },
            },
          },
          include: {
            project: true,
          },
        }),
      );

      expect(
        prisma.projectAssignment.findMany,
      ).toHaveBeenCalledTimes(2);
    },
  );

  it(
    'returns no access and no list when workspace membership is not eligible',
    async () => {
      prisma.workspaceMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveProjectAccess(
          'account-1',
          'p1',
        ),
      ).resolves.toEqual({
        kind: 'MEMBERSHIP_NOT_FOUND',
      });

      await expect(
        service.listAccessibleProjects(
          'account-1',
          'w1',
        ),
      ).resolves.toEqual([]);

      expect(
        prisma.projectAssignment.findMany,
      ).not.toHaveBeenCalled();

      expect(
        prisma.organization.findMany,
      ).not.toHaveBeenCalled();
    },
  );
});
import { Test, TestingModule } from '@nestjs/testing';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: PrismaService;

  const mockPrisma = {
    account: {
      findUnique: jest.fn(),
    },
  };

  beforeAll(() => {
    // getRequiredJwtSecret expects JWT_SECRET to be configured
    process.env.JWT_SECRET = 'dummy-secret-for-strategy-tests';
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('ACTIVE account validates successfully', async () => {
      const mockAccount = {
        id: 'acc-123',
        email: 'active@test.local',
        status: 'ACTIVE',
        memberships: [
          {
            workspaceId: 'ws-1',
            workspace: { name: 'WS 1' },
            id: 'mem-1',
            membershipRoles: [
              { role: { name: 'ROLE_ADMIN' } }
            ]
          }
        ]
      };

      mockPrisma.account.findUnique.mockResolvedValue(mockAccount);

      const result = await strategy.validate({ sub: 'acc-123' });

      expect(result).toEqual({
        id: 'acc-123',
        email: 'active@test.local',
        memberships: [
          {
            workspaceId: 'ws-1',
            workspaceName: 'WS 1',
            userId: 'mem-1',
            roles: ['ROLE_ADMIN'],
          }
        ]
      });
    });

    it('non-ACTIVE account is rejected', async () => {
      const mockAccount = {
        id: 'acc-123',
        email: 'suspended@test.local',
        status: 'SUSPENDED',
        memberships: []
      };

      mockPrisma.account.findUnique.mockResolvedValue(mockAccount);

      await expect(
        strategy.validate({ sub: 'acc-123' })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('missing account is rejected', async () => {
      mockPrisma.account.findUnique.mockResolvedValue(null);

      await expect(
        strategy.validate({ sub: 'acc-not-found' })
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

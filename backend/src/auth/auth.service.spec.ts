import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwt: JwtService;

  const mockPrisma = {
    account: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockJwt = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwt = module.get<JwtService>(JwtService);

    jest.clearAllMocks();
  });

  describe('login', () => {
    it('ACTIVE account with correct password logs in successfully', async () => {
      const passwordHash = await bcrypt.hash('Test1234!', 10);
      const mockAccount = {
        id: 'acc-123',
        email: 'active@test.local',
        passwordHash,
        displayName: 'Active User',
        status: 'ACTIVE',
      };

      mockPrisma.account.findUnique.mockResolvedValue(mockAccount);
      mockJwt.signAsync.mockResolvedValue('valid-token');

      const result = await service.login({
        email: 'active@test.local',
        password: 'Test1234!',
      });

      expect(result.access_token).toBe('valid-token');
      expect(result.account.id).toBe(mockAccount.id);
      expect(result.account.email).toBe(mockAccount.email);
    });

    it('non-ACTIVE account with correct password is rejected', async () => {
      const passwordHash = await bcrypt.hash('Test1234!', 10);
      const mockAccount = {
        id: 'acc-123',
        email: 'suspended@test.local',
        passwordHash,
        displayName: 'Suspended User',
        status: 'SUSPENDED',
      };

      mockPrisma.account.findUnique.mockResolvedValue(mockAccount);

      await expect(
        service.login({
          email: 'suspended@test.local',
          password: 'Test1234!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('non-ACTIVE account rejection uses generic UnauthorizedException', async () => {
      const passwordHash = await bcrypt.hash('Test1234!', 10);
      const mockAccount = {
        id: 'acc-123',
        email: 'deactivated@test.local',
        passwordHash,
        displayName: 'Deactivated User',
        status: 'DEACTIVATED',
      };

      mockPrisma.account.findUnique.mockResolvedValue(mockAccount);

      await expect(
        service.login({
          email: 'deactivated@test.local',
          password: 'Test1234!',
        }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('wrong password still rejected as before', async () => {
      const passwordHash = await bcrypt.hash('Test1234!', 10);
      const mockAccount = {
        id: 'acc-123',
        email: 'active@test.local',
        passwordHash,
        displayName: 'Active User',
        status: 'ACTIVE',
      };

      mockPrisma.account.findUnique.mockResolvedValue(mockAccount);

      await expect(
        service.login({
          email: 'active@test.local',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';

describe('AhspAuditService', () => {
  let service: AhspAuditService;
  let prisma: {
    aHSPAuditLog: {
      create: jest.Mock;
    };
  };

  const auditLog = {
    id: 'audit-1',
    ahspId: 'ahsp-1',
    ahspVersionId: null,
    action: 'AHSPCreated',
    who: 'user-1',
    before: null,
    after: { id: 'ahsp-1' },
    reason: undefined,
  };

  beforeEach(async () => {
    prisma = {
      aHSPAuditLog: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AhspAuditService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<AhspAuditService>(AhspAuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('logAction creates an AHSP audit log and returns the Prisma result', async () => {
    prisma.aHSPAuditLog.create.mockResolvedValue(auditLog);

    await expect(
      service.logAction({
        ahspId: auditLog.ahspId,
        action: auditLog.action,
        who: auditLog.who,
        after: auditLog.after,
      }),
    ).resolves.toEqual(auditLog);

    expect(prisma.aHSPAuditLog.create).toHaveBeenCalledWith({
      data: {
        ahspId: auditLog.ahspId,
        ahspVersionId: undefined,
        action: auditLog.action,
        who: auditLog.who,
        before: null,
        after: auditLog.after,
        reason: undefined,
      },
    });
  });
});

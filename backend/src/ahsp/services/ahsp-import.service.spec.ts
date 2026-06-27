import { Test, TestingModule } from '@nestjs/testing';
import { ImportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspImportService } from './ahsp-import.service';

describe('AhspImportService', () => {
  let service: AhspImportService;
  let prisma: {
    aHSPImportJob: {
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let audit: {
    logAction: jest.Mock;
  };

  const importJob = {
    id: 'import-job-1',
    idempotencyKey: 'import-key-1',
    ahspId: 'ahsp-1',
    status: ImportStatus.PENDING,
  };

  beforeEach(async () => {
    prisma = {
      aHSPImportJob: {
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = {
      logAction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AhspImportService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AhspAuditService,
          useValue: audit,
        },
      ],
    }).compile();

    service = module.get<AhspImportService>(AhspImportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('createImportJob creates a pending import job and writes audit when ahspId and userId exist', async () => {
    prisma.aHSPImportJob.create.mockResolvedValue(importJob);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.createImportJob(
        importJob.idempotencyKey,
        importJob.ahspId,
        'user-1',
      ),
    ).resolves.toEqual(importJob);

    expect(prisma.aHSPImportJob.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: importJob.idempotencyKey,
        ahspId: importJob.ahspId,
        status: ImportStatus.PENDING,
      },
    });
    expect(audit.logAction).toHaveBeenCalledWith({
      ahspId: importJob.ahspId,
      action: 'AHSPImportJobCreated',
      who: 'user-1',
      after: importJob,
    });
  });

  it('updateJobStatus updates an import job status and returns the Prisma result', async () => {
    const updatedJob = {
      ...importJob,
      status: ImportStatus.COMPLETED,
    };
    prisma.aHSPImportJob.update.mockResolvedValue(updatedJob);

    await expect(
      service.updateJobStatus(importJob.id, ImportStatus.COMPLETED),
    ).resolves.toEqual(updatedJob);

    expect(prisma.aHSPImportJob.update).toHaveBeenCalledWith({
      where: { id: importJob.id },
      data: { status: ImportStatus.COMPLETED },
    });
  });
});

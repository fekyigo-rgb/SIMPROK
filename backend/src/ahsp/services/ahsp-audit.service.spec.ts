import { Test, TestingModule } from '@nestjs/testing';
import { AhspAuditService } from './ahsp-audit.service';

describe('AhspAuditService', () => {
  let service: AhspAuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AhspAuditService],
    }).compile();

    service = module.get<AhspAuditService>(AhspAuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

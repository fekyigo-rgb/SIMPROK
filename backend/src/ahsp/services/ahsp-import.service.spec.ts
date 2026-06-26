import { Test, TestingModule } from '@nestjs/testing';
import { AhspImportService } from './ahsp-import.service';

describe('AhspImportService', () => {
  let service: AhspImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AhspImportService],
    }).compile();

    service = module.get<AhspImportService>(AhspImportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { AhspService } from './ahsp.service';

describe('AhspService', () => {
  let service: AhspService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AhspService],
    }).compile();

    service = module.get<AhspService>(AhspService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

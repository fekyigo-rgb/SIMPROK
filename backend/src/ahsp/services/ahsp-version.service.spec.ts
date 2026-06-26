import { Test, TestingModule } from '@nestjs/testing';
import { AhspVersionService } from './ahsp-version.service';

describe('AhspVersionService', () => {
  let service: AhspVersionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AhspVersionService],
    }).compile();

    service = module.get<AhspVersionService>(AhspVersionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

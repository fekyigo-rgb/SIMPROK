import { Test, TestingModule } from '@nestjs/testing';
import { AhspSnapshotService } from './ahsp-snapshot.service';

describe('AhspSnapshotService', () => {
  let service: AhspSnapshotService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AhspSnapshotService],
    }).compile();

    service = module.get<AhspSnapshotService>(AhspSnapshotService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

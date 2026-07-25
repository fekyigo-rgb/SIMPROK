import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPricePublicationService } from './basic-price-publication.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BasicPricePublicationService', () => {
  let service: BasicPricePublicationService;
  let tx: {
    $queryRaw: jest.Mock;
    basicPrice: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    basicPricePublicationAudit: { create: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

  const ACTOR = 'account-human-01';
  const BASIC_PRICE_ID = 'bp-01';

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn(),
      basicPrice: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      basicPricePublicationAudit: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BasicPricePublicationService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BasicPricePublicationService>(BasicPricePublicationService);
  });

  it('rejects with no actor — never defaults to a system/AI publisher', async () => {
    await expect(service.publish(BASIC_PRICE_ID, '')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws NotFound when the BasicPrice row does not exist', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.publish(BASIC_PRICE_ID, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
  });

  it('rejects publishing a price that is not yet VERIFIED', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: BASIC_PRICE_ID, status: 'UNPUBLISHED', verificationStatus: 'UNVERIFIED' }]);
    await expect(service.publish(BASIC_PRICE_ID, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('publishes a VERIFIED price, writes exactly one audit row with the human actor', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: BASIC_PRICE_ID, status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' }]);
    tx.basicPrice.update.mockResolvedValue({ id: BASIC_PRICE_ID, status: 'PUBLISHED' });

    const result = await service.publish(BASIC_PRICE_ID, ACTOR);

    expect(tx.basicPrice.update).toHaveBeenCalledWith({ where: { id: BASIC_PRICE_ID }, data: { status: 'PUBLISHED' } });
    expect(tx.basicPricePublicationAudit.create).toHaveBeenCalledTimes(1);
    expect(tx.basicPricePublicationAudit.create).toHaveBeenCalledWith({
      data: { basicPriceId: BASIC_PRICE_ID, action: 'PUBLISH', actorAccountId: ACTOR },
    });
    expect(result).toEqual({ id: BASIC_PRICE_ID, status: 'PUBLISHED' });
  });

  it('is idempotent: an already-PUBLISHED price returns existing state without a duplicate audit', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: BASIC_PRICE_ID, status: 'PUBLISHED', verificationStatus: 'VERIFIED' }]);
    tx.basicPrice.findUniqueOrThrow.mockResolvedValue({ id: BASIC_PRICE_ID, status: 'PUBLISHED' });

    const result = await service.publish(BASIC_PRICE_ID, ACTOR);

    expect(tx.basicPrice.update).not.toHaveBeenCalled();
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: BASIC_PRICE_ID, status: 'PUBLISHED' });
  });
});

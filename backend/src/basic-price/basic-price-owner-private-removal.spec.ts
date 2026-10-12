import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';

describe('BP-MULTI-ACTION-02 — owner private removal, one canonical currentness', () => {
  const priceId = '11111111-1111-4111-8111-111111111111';
  const wsId = '22222222-2222-4222-8222-222222222222';
  const acctId = '33333333-3333-4333-8333-333333333333';

  const createHarness = () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: priceId }]),
      basicPrice: {
        findFirst: jest
          .fn()
          .mockImplementation((args: { where: { id?: string } }) =>
            args.where.id
              ? {
                  status: 'UNPUBLISHED',
                  verificationStatus: 'UNVERIFIED',
                  sourceSubmissionId: null,
                  sourceImportRow: { priceSubmissionId: null },
                }
              : null,
          ),
      },
      priceSubmissionAudit: { findFirst: jest.fn().mockResolvedValue(null) },
      basicPricePublicationAudit: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'withdrawal' }),
      },
      projectAhspResourceResolution: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      basicPriceProvenanceCorrection: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (arg: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new BasicPriceService(
      prisma as never,
      new BasicPriceEligibilityPolicy(),
    );
    return { tx, service };
  };

  it('appends existing WITHDRAWN governance only, preserving price, money and history', async () => {
    const { tx, service } = createHarness();
    await expect(
      service.removeOwnPrivatePrice(wsId, acctId, priceId),
    ).resolves.toEqual({
      basicPriceId: priceId,
      removed: true,
      alreadyRemoved: false,
    });
    expect(tx.basicPricePublicationAudit.create).toHaveBeenCalledWith({
      data: {
        basicPriceId: priceId,
        actorAccountId: acctId,
        action: 'WITHDRAWN',
        reason: 'PRIVATE_OWNER_REMOVE_FROM_ACTIVE',
        effectiveAt: expect.any(Date) as Date,
      },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.basicPrice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: priceId,
          workspaceId: wsId,
          assetScope: 'WORKSPACE_PRIVATE',
          reportedByAccountId: acctId,
        }) as object,
      }),
    );
    expect(tx.projectAhspResourceResolution.findFirst).toHaveBeenCalledWith({
      where: { selectedBasicPriceId: priceId },
      select: { id: true },
    });
  });

  it('denies foreign account and catalog/non-private rows with no audit write', async () => {
    const { tx, service } = createHarness();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.removeOwnPrivatePrice(wsId, acctId, priceId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('denies published price even if a corrupted private row is returned by the lock', async () => {
    const { tx, service } = createHarness();
    tx.basicPrice.findFirst.mockResolvedValueOnce({
      status: 'PUBLISHED',
      verificationStatus: 'PUBLISHED',
      sourceSubmissionId: null,
      sourceImportRow: null,
    });
    await expect(
      service.removeOwnPrivatePrice(wsId, acctId, priceId),
    ).rejects.toThrow('PUBLIC_BASIC_PRICE_PROTECTED');
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('protects submitted or referenced price and its retained provenance', async () => {
    const { tx, service } = createHarness();
    tx.basicPrice.findFirst.mockResolvedValueOnce({
      status: 'UNPUBLISHED',
      verificationStatus: 'UNVERIFIED',
      sourceSubmissionId: null,
      sourceImportRow: { priceSubmissionId: 'submitted' },
    });
    await expect(
      service.removeOwnPrivatePrice(wsId, acctId, priceId),
    ).rejects.toThrow('PRICE_PROPOSAL_HISTORY_PROTECTED');
    tx.projectAhspResourceResolution.findFirst.mockResolvedValueOnce({
      id: 'rab-resolution',
    });
    await expect(
      service.removeOwnPrivatePrice(wsId, acctId, priceId),
    ).rejects.toThrow('BASIC_PRICE_REFERENCED_PROTECTED');
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('is idempotent for previously withdrawn private rows', async () => {
    const { tx, service } = createHarness();
    tx.basicPricePublicationAudit.findFirst.mockResolvedValueOnce({
      id: 'existing',
    });
    await expect(
      service.removeOwnPrivatePrice(wsId, acctId, priceId),
    ).resolves.toEqual({
      basicPriceId: priceId,
      removed: true,
      alreadyRemoved: true,
    });
    expect(tx.basicPricePublicationAudit.create).not.toHaveBeenCalled();
  });

  it('fails closed without trustworthy context', async () => {
    const { service } = createHarness();
    await expect(
      service.removeOwnPrivatePrice(wsId, '', priceId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

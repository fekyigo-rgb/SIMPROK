import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  ObservedResourceNameReviewService,
  assertSpellingOnlyNameReview,
  observedResourceSourceFactsFingerprint,
  reviewedNameForCuration,
} from './observed-resource-name-review.service';

describe('ObservedResourceNameReviewService', () => {
  const observation = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    status: 'OBSERVED',
    rawName: 'FALT BED TRUCK 4 TON',
    rawCode: 'E-04',
    rawUnit: 'Jam',
    resourceType: 'EQUIPMENT',
    sourceSha256: 'a'.repeat(64),
    sheetName: 'Alat',
    sourceRowNumber: 14,
    parserContractVersion: 'AHSP_XLSX_V3',
  } as const;
  const fingerprint = observedResourceSourceFactsFingerprint(observation);
  let prisma: any;
  let service: ObservedResourceNameReviewService;

  beforeEach(() => {
    prisma = {
      observedResource: {
        findFirst: jest.fn().mockResolvedValue(observation),
        update: jest.fn(),
      },
      observedResourceNameReview: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'review-1',
          createdAt: new Date('2026-10-26T00:00:00.000Z'),
          ...data,
        })),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: (run: (tx: any) => unknown) => run(prisma),
    };
    service = new ObservedResourceNameReviewService(prisma);
  });

  const append = (over: Record<string, unknown> = {}) =>
    service.append({
      workspaceId: observation.workspaceId,
      observationId: observation.id,
      actorAccountId: '33333333-3333-4333-8333-333333333333',
      expectedVersion: 0,
      expectedSourceFactsFingerprint: fingerprint,
      reviewedName: 'FLAT BED TRUCK 4 TON',
      reason: 'Transposisi huruf pada kata FLAT.',
      evidence: 'Nama alat pada judul spesifikasi sumber.',
      ...over,
    });

  it('appends version 1 without mutating source facts or deciding identity', async () => {
    const saved = await append();

    expect(saved).toMatchObject({
      version: 1,
      reviewedName: 'FLAT BED TRUCK 4 TON',
      sourceFactsFingerprint: fingerprint,
    });
    expect(prisma.observedResourceNameReview.create).toHaveBeenCalledTimes(1);
    expect(prisma.observedResource.update).not.toHaveBeenCalled();
  });

  it('returns the independently reloadable history and latest version', async () => {
    const event = {
      id: 'review-1',
      version: 1,
      reviewedName: 'FLAT BED TRUCK 4 TON',
      actorAccountId: 'acct-1',
      reason: 'Transposisi huruf.',
      evidence: 'Bukti sumber.',
      sourceFactsFingerprint: fingerprint,
      createdAt: new Date('2026-10-26T00:00:00.000Z'),
    };
    prisma.observedResourceNameReview.findMany.mockResolvedValue([event]);

    await expect(
      service.read(observation.workspaceId, observation.id),
    ).resolves.toMatchObject({
      rawName: observation.rawName,
      sourceFactsFingerprint: fingerprint,
      currentVersion: 1,
      latest: event,
      history: [event],
    });
  });

  it('fails closed with 409 on an optimistic-version conflict', async () => {
    prisma.observedResourceNameReview.findFirst.mockResolvedValue({
      version: 1,
      sourceFactsFingerprint: fingerprint,
    });

    await expect(append()).rejects.toThrow(
      new ConflictException('NAME_REVIEW_VERSION_CONFLICT'),
    );
    expect(prisma.observedResourceNameReview.create).not.toHaveBeenCalled();
  });

  it('fails closed with 409 when the caller or previous event is bound to stale source facts', async () => {
    await expect(
      append({ expectedSourceFactsFingerprint: 'b'.repeat(64) }),
    ).rejects.toThrow(
      new ConflictException('OBSERVATION_SOURCE_FACTS_STALE'),
    );

    prisma.observedResourceNameReview.findFirst.mockResolvedValue({
      version: 1,
      sourceFactsFingerprint: 'b'.repeat(64),
    });
    await expect(append({ expectedVersion: 1 })).rejects.toThrow(
      new ConflictException('OBSERVATION_SOURCE_FACTS_STALE'),
    );
    expect(prisma.observedResourceNameReview.create).not.toHaveBeenCalled();
  });

  it('refuses correction after identity has already been decided', async () => {
    prisma.observedResource.findFirst.mockResolvedValue({
      ...observation,
      status: 'RESOLVED_EXISTING',
    });
    await expect(append()).rejects.toThrow(
      new ConflictException('OBSERVATION_ALREADY_DECIDED'),
    );
  });

  it('scopes observation lookup to the guarded workspace and returns 404 across it', async () => {
    prisma.observedResource.findFirst.mockResolvedValue(null);
    await expect(append()).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.observedResource.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: observation.id, workspaceId: observation.workspaceId },
      }),
    );
  });

  it('accepts the bounded spelling correction but rejects capacity, model, unit and type-word changes', () => {
    expect(() =>
      assertSpellingOnlyNameReview(
        'FALT BED TRUCK 4 TON',
        'FLAT BED TRUCK 4 TON',
      ),
    ).not.toThrow();

    for (const reviewedName of [
      'FLAT BED TRUCK 10 TON',
      'FLAT BED TRUCK X4 TON',
      'FLAT BED TRUCK 4 KG',
      'DUMP TRUCK 4 TON',
    ]) {
      expect(() =>
        assertSpellingOnlyNameReview(
          'FALT BED TRUCK 4 TON',
          reviewedName,
        ),
      ).toThrow(BadRequestException);
    }
  });

  it('projects only a current, revalidated latest name for curation', () => {
    expect(
      reviewedNameForCuration({
        ...observation,
        nameReviews: [
          {
            reviewedName: 'FLAT BED TRUCK 4 TON',
            sourceFactsFingerprint: fingerprint,
          },
        ],
      }),
    ).toBe('FLAT BED TRUCK 4 TON');

    expect(() =>
      reviewedNameForCuration({
        ...observation,
        nameReviews: [
          {
            reviewedName: 'FLAT BED TRUCK 4 TON',
            sourceFactsFingerprint: 'b'.repeat(64),
          },
        ],
      }),
    ).toThrow(ConflictException);
  });
});

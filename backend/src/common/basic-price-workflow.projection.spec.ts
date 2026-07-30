import {
  mapPublicationQueueItem,
  mapRegionIdentity,
  mapResourceIdentity,
  mapReviewDetail,
  mapReviewerIdentity,
  mapReviewQueueItem,
  type ReviewRowSource,
} from './basic-price-workflow.projection';

describe('basic-price workflow projections (RM-02D2A2)', () => {
  describe('mapResourceIdentity', () => {
    it('projects a human-readable resource identity, preserving a null code', () => {
      expect(
        mapResourceIdentity({ id: 'r1', code: null, name: 'Kerikil', type: 'MATERIAL' }),
      ).toEqual({ id: 'r1', code: null, name: 'Kerikil', type: 'MATERIAL' });
    });

    it('keeps a present code', () => {
      expect(
        mapResourceIdentity({ id: 'r1', code: 'M.01', name: 'Semen', type: 'MATERIAL' }).code,
      ).toBe('M.01');
    });
  });

  describe('mapRegionIdentity', () => {
    it('projects code+name and nothing else', () => {
      expect(mapRegionIdentity({ id: 'reg1', code: 'ID-JK', name: 'DKI Jakarta' })).toEqual({
        id: 'reg1',
        code: 'ID-JK',
        name: 'DKI Jakarta',
      });
    });

    it('is null for a general (no) region', () => {
      expect(mapRegionIdentity(null)).toBeNull();
    });
  });

  describe('mapReviewerIdentity', () => {
    it('projects userId/fullName/email, never a raw UUID label', () => {
      expect(mapReviewerIdentity({ id: 'u1', fullName: 'Budi', email: 'budi@x.co' })).toEqual({
        userId: 'u1',
        fullName: 'Budi',
        email: 'budi@x.co',
      });
    });

    it('is null when unassigned', () => {
      expect(mapReviewerIdentity(null)).toBeNull();
    });
  });

  const reviewRow = (): ReviewRowSource => ({
    id: 'review-1',
    priceSubmissionId: 'sub-1',
    slaState: 'OPEN',
    openedAt: new Date('2026-07-20T00:00:00.000Z'),
    escalatedAt: null,
    expiredAt: null,
    resolvedAt: null,
    submission: {
      status: 'UNDER_REVIEW',
      sourceType: 'MARKET_SURVEY',
      sourceOrigin: 'SUPPLIER',
      currentRevisionId: 'rev-2',
      resource: { id: 'r1', code: 'M.01', name: 'Semen', type: 'MATERIAL' },
      region: { id: 'reg1', code: 'ID-JK', name: 'DKI Jakarta' },
      revisions: [
        { id: 'rev-1', value: '100000.00', effectiveDate: null },
        { id: 'rev-2', value: '125000.00', effectiveDate: new Date('2026-07-19T00:00:00.000Z') },
      ],
    },
    assignedTo: { id: 'u1', fullName: 'Budi', membership: { account: { email: 'budi@x.co' } } },
  });

  describe('mapReviewQueueItem', () => {
    it('carries identity and the CURRENT-revision price as a two-digit string', () => {
      const item = mapReviewQueueItem(reviewRow());
      expect(item.resource).toEqual({ id: 'r1', code: 'M.01', name: 'Semen', type: 'MATERIAL' });
      expect(item.region).toEqual({ id: 'reg1', code: 'ID-JK', name: 'DKI Jakarta' });
      expect(item.assignedReviewer).toEqual({ userId: 'u1', fullName: 'Budi', email: 'budi@x.co' });
      expect(item.currentPrice).toBe('125000.00');
      expect(typeof item.currentPrice).toBe('string');
      expect(item.effectiveDate).toBe('2026-07-19T00:00:00.000Z');
      expect(item.openedAt).toBe('2026-07-20T00:00:00.000Z');
    });

    it('is null-safe: no current revision, no region, unassigned', () => {
      const row = reviewRow();
      row.submission.currentRevisionId = null;
      row.submission.region = null;
      row.assignedTo = null;
      const item = mapReviewQueueItem(row);
      expect(item.currentPrice).toBeNull();
      expect(item.effectiveDate).toBeNull();
      expect(item.region).toBeNull();
      expect(item.assignedReviewer).toBeNull();
    });
  });

  describe('mapReviewDetail', () => {
    it('extends the queue item with source axes and a projected decision history', () => {
      const row: ReviewRowSource = {
        ...reviewRow(),
        decisions: [
          {
            id: 'd1',
            action: 'REASSIGN',
            note: 'dialihkan ke Budi',
            decidedAt: new Date('2026-07-21T00:00:00.000Z'),
            decidedBy: {
              id: 'u2',
              fullName: 'Sari',
              membership: { account: { email: 'sari@x.co' } },
            },
          },
        ],
      };
      const detail = mapReviewDetail(row);
      expect(detail.sourceType).toBe('MARKET_SURVEY');
      expect(detail.sourceOrigin).toBe('SUPPLIER');
      expect(detail.currentPrice).toBe('125000.00');
      expect(detail.decisions).toEqual([
        {
          id: 'd1',
          action: 'REASSIGN',
          note: 'dialihkan ke Budi',
          decidedAt: '2026-07-21T00:00:00.000Z',
          decidedBy: { userId: 'u2', fullName: 'Sari', email: 'sari@x.co' },
        },
      ]);
    });

    it('defaults to an empty decision history when none are included', () => {
      expect(mapReviewDetail(reviewRow()).decisions).toEqual([]);
    });
  });

  describe('mapPublicationQueueItem', () => {
    it('projects a human-readable publication row with a two-digit price string', () => {
      const item = mapPublicationQueueItem({
        id: 'bp-1',
        value: '125000.00',
        effectiveDate: new Date('2026-07-19T00:00:00.000Z'),
        status: 'UNPUBLISHED',
        verificationStatus: 'VERIFIED',
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        resource: { id: 'r1', code: 'M.01', name: 'Semen', type: 'MATERIAL' },
        region: { id: 'reg1', code: 'ID-JK', name: 'DKI Jakarta' },
      });
      expect(item).toEqual({
        basicPriceId: 'bp-1',
        resource: { id: 'r1', code: 'M.01', name: 'Semen', type: 'MATERIAL' },
        region: { id: 'reg1', code: 'ID-JK', name: 'DKI Jakarta' },
        price: '125000.00',
        effectiveDate: '2026-07-19T00:00:00.000Z',
        status: 'UNPUBLISHED',
        verificationStatus: 'VERIFIED',
        createdAt: '2026-07-20T00:00:00.000Z',
      });
      expect(typeof item.price).toBe('string');
    });

    it('is null-safe for a general (no) region', () => {
      const item = mapPublicationQueueItem({
        id: 'bp-2',
        value: '5000.00',
        effectiveDate: new Date('2026-07-19T00:00:00.000Z'),
        status: 'UNPUBLISHED',
        verificationStatus: 'VERIFIED',
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        resource: { id: 'r2', code: null, name: 'Pasir', type: 'MATERIAL' },
        region: null,
      });
      expect(item.region).toBeNull();
    });
  });
});

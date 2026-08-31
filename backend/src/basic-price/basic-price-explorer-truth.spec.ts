import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PriceVerificationStatus } from '@prisma/client';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BP-UX-FINAL-01C — THE EXPLORER TELLS THE TRUTH ABOUT TIME, AND DETAIL TELLS
 * THE TRUTH ABOUT THE PAST.
 *
 * Kept in its own file rather than grown onto `basic-price.service.spec.ts`,
 * which is already a long and careful record of the eligibility/date-range law.
 * These are new questions with their own fixtures; mixing them in would make
 * both harder to read and would put the older law's assertions at risk for no
 * benefit.
 */
describe('BasicPriceService — BP-UX-FINAL-01C truth closure', () => {
  let service: BasicPriceService;
  let prisma: {
    basicPrice: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  const workspaceId = 'ws-truth-closure-01';

  /**
   * THE SHAPES THESE ASSERTIONS READ, DECLARED RATHER THAN CAST TO `any`.
   *
   * These tests exist to catch a rename, a field swap or a clause that quietly
   * moved — and an `any` bag would let all three through silently while still
   * reading as a passing test. Declaring the shape is the difference between
   * asserting on a contract and asserting on whatever happened to be there.
   */
  interface EligibilityBranch {
    status?: string;
    verificationStatus?: string;
    assetScope?: string;
    workspaceId?: string | null;
    OR?: Array<{ workspaceId: string | null }>;
  }

  /**
   * BP-UX-FINAL-01D — one `none` now covers BOTH governance verbs, each
   * compared against the instant it actually owns.
   */
  interface GovernedAuditFilter {
    action: string;
    effectiveAt?: { lte: Date };
    createdAt?: { lte: Date };
  }

  interface ExplorerWhere {
    OR?: EligibilityBranch[];
    NOT?: unknown;
    AND?: Array<Record<string, unknown>>;
    supersededBy?: unknown;
    promotedFrom?: unknown;
    publicationAudits?: { none: { OR: GovernedAuditFilter[] } };
    effectiveDate?: { gte?: Date; lte?: Date; lt?: Date };
    resourceId?: string;
    regionId?: string | null;
  }

  interface FindManyArgs {
    where: ExplorerWhere;
    take?: number;
    select?: Record<string, unknown>;
    orderBy?: unknown;
  }

  interface FindFirstArgs {
    where: ExplorerWhere & { id?: string };
    select?: Record<string, unknown>;
  }

  /** ONE cast, at the mock boundary, so everything downstream is typed. */
  const listArgs = (): FindManyArgs =>
    (prisma.basicPrice.findMany.mock.calls[0] as [FindManyArgs])[0];

  const firstArgs = (): FindFirstArgs =>
    (prisma.basicPrice.findFirst.mock.calls[0] as [FindFirstArgs])[0];

  /**
   * The two-branch eligibility predicate, asserted branch by branch rather than
   * by object equality — the same convention `basic-price.service.spec.ts`
   * settled on, so a rename or a field swap fails rather than passing silently.
   */
  const expectTwoBranchEligibility = (where: ExplorerWhere) => {
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR).toHaveLength(2);
    const [catalog, priv] = where.OR as [EligibilityBranch, EligibilityBranch];
    expect(catalog.status).toBe('PUBLISHED');
    expect(catalog.verificationStatus).toBe(PriceVerificationStatus.PUBLISHED);
    expect(catalog.OR).toEqual([{ workspaceId }, { workspaceId: null }]);
    expect(priv.assetScope).toBe('WORKSPACE_PRIVATE');
    expect(priv.workspaceId).toBe(workspaceId);
    expect(priv).not.toHaveProperty('OR');
  };

  const mockPrice = {
    id: 'bp-01',
    resourceId: 'rc-01',
    workspaceId,
    assetScope: 'SIMPROK_CATALOG',
    value: '150000.00',
    effectiveDate: new Date('2026-01-01'),
    validUntil: null,
    reviewDate: null,
    status: 'PUBLISHED',
    sourceOrigin: 'GOVERNMENT',
    sourceType: 'MARKET_SURVEY',
    verificationStatus: 'PUBLISHED',
    freshnessStatus: 'CURRENT',
    region: null,
    resource: {
      id: 'rc-01',
      code: 'MAT-SEMEN-01',
      name: 'Semen Portland 50kg',
      type: 'MATERIAL',
      baseUnit: 'Zak',
    },
  };

  beforeEach(async () => {
    prisma = {
      basicPrice: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPriceService,
        BasicPriceEligibilityPolicy,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<BasicPriceService>(BasicPriceService);
  });

  // =========================================================================
  // GAP-B / GAP-C — TEMPORAL APPLICABILITY AND THE AS-OF LENS
  // =========================================================================

  describe('findAllForWorkspace — temporal applicability', () => {
    const whereOfListCall = (): ExplorerWhere => listArgs().where;

    interface StartedClause {
      effectiveDate: { lte: Date };
    }
    interface NotEndedClause {
      OR: [{ validUntil: null }, { validUntil: { gte: Date } }];
    }

    const applicabilityOf = (where: ExplorerWhere) => {
      const members = where.AND ?? [];
      const started = members.find((member) => 'effectiveDate' in member) as
        | StartedClause
        | undefined;
      const notEnded = members.find(
        (member) =>
          Array.isArray((member as { OR?: unknown[] }).OR) &&
          JSON.stringify(member).includes('validUntil'),
      ) as NotEndedClause | undefined;
      expect(started).toBeDefined();
      expect(notEnded).toBeDefined();
      return { started: started!, notEnded: notEnded! };
    };

    /**
     * BP-UX-FINAL-01D — the instant one governance verb is compared against.
     *
     * Both verbs now live under a single `publicationAudits.none.OR`, each
     * against the field IT owns: WITHDRAWN against `effectiveAt` (a claim the
     * source dates), SUPERSEDED against `createdAt` (a transition SIMPROK
     * records, whose `effectiveAt` schema law refuses to invent).
     */
    const governedInstantOf = (
      where: ExplorerWhere,
      action: 'WITHDRAWN' | 'SUPERSEDED',
    ): Date | undefined => {
      const member = (where.publicationAudits?.none.OR ?? []).find(
        (candidate) => candidate.action === action,
      );
      expect(member).toBeDefined();
      return action === 'WITHDRAWN'
        ? member?.effectiveAt?.lte
        : member?.createdAt?.lte;
    };

    beforeEach(() => {
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      prisma.basicPrice.count.mockResolvedValue(1);
    });

    it('B1/B2 — the list asks that a price has already STARTED', async () => {
      await service.findAllForWorkspace(workspaceId, {});

      const { started } = applicabilityOf(whereOfListCall());
      expect(started.effectiveDate.lte).toBeInstanceOf(Date);
    });

    it('B3/B4/B5 — and that its own source has not ENDED it; null is not an ending', async () => {
      await service.findAllForWorkspace(workspaceId, {});

      const { notEnded } = applicabilityOf(whereOfListCall());
      expect(notEnded.OR[0]).toEqual({ validUntil: null });
      // The instant itself is asserted exactly in C1/C7 below; here the shape
      // is what matters, so the bound is read rather than matched loosely.
      expect(notEnded.OR[1].validUntil.gte).toBeInstanceOf(Date);
    });

    it('the Explorer now enforces the SAME predicate the spending engines do', async () => {
      // `basic-price-eligibility.policy.ts` states the property in as many
      // words: "if the list could offer a price the resolver would not accept
      // ... the gap between them would be the privilege escalation." This is
      // that gap, closed — one asOf, both clauses.
      await service.findAllForWorkspace(workspaceId, {});

      const { started, notEnded } = applicabilityOf(whereOfListCall());
      expect(notEnded.OR[1]).toEqual({
        validUntil: { gte: started.effectiveDate.lte },
      });
    });

    it('ONE instant answers the whole request — currentness reads it too', async () => {
      // Currentness used to reach for its own `new Date()` while applicability
      // did not exist at all. Two clocks in one query can disagree across a
      // midnight boundary, and then the room answers two questions at once.
      await service.findAllForWorkspace(workspaceId, {});

      const where = whereOfListCall();
      const { started } = applicabilityOf(where);
      expect(governedInstantOf(where, 'WITHDRAWN')).toEqual(
        started.effectiveDate.lte,
      );
      // BP-UX-FINAL-01D — and the correction verb reads the SAME instant.
      expect(governedInstantOf(where, 'SUPERSEDED')).toEqual(
        started.effectiveDate.lte,
      );
    });

    it('B6/B7/B8 — currentness still composes, evaluated AT the as-of instant', async () => {
      await service.findAllForWorkspace(workspaceId, { asOf: '2026-05-01' });

      const where = whereOfListCall();
      // Replaced — BP-UX-FINAL-01D: the integrity guard, plus a temporal clause
      // in `publicationAudits`. A correction recorded AFTER the as-of instant
      // must not delete the price from a historical answer.
      expect(where.supersededBy).toEqual({
        isNot: {
          OR: [
            {
              AND: [
                { verificationStatus: { not: 'UNVERIFIED' } },
                {
                  supersedes: {
                    is: {
                      publicationAudits: { none: { action: 'SUPERSEDED' } },
                    },
                  },
                },
              ],
            },
            {
              AND: [
                { verificationStatus: 'UNVERIFIED' },
                { createdAt: { lte: new Date('2026-05-01T00:00:00.000Z') } },
              ],
            },
          ],
        },
      });
      expect(where.AND).toEqual(
        expect.arrayContaining([
          {
            OR: [
              { supersedesBasicPriceId: null },
              { verificationStatus: { not: 'UNVERIFIED' } },
              { createdAt: { lte: new Date('2026-05-01T00:00:00.000Z') } },
            ],
          },
        ]),
      );
      const governed = where.publicationAudits?.none.OR ?? [];
      expect(governed).toContainEqual({
        action: 'SUPERSEDED',
        createdAt: { lte: new Date('2026-05-01T00:00:00.000Z') },
      });
      // Withdrawn — and a withdrawal effective AFTER the as-of instant must not
      // remove the price early, which is why the instant is passed rather than
      // the mere existence of an audit row being checked.
      expect(governed).toContainEqual({
        action: 'WITHDRAWN',
        effectiveAt: { lte: new Date('2026-05-01T00:00:00.000Z') },
      });
      // Restating something that is no longer current.
      expect(where.promotedFrom).toBeDefined();
    });

    it('C1/C7 — an explicit asOf is the one instant every temporal clause reads', async () => {
      await service.findAllForWorkspace(workspaceId, { asOf: '2026-05-01' });

      const where = whereOfListCall();
      const { started, notEnded } = applicabilityOf(where);
      const expected = new Date('2026-05-01T00:00:00.000Z');

      expect(started.effectiveDate.lte).toEqual(expected);
      expect(notEnded.OR[1]).toEqual({ validUntil: { gte: expected } });
      expect(governedInstantOf(where, 'WITHDRAWN')).toEqual(expected);
      expect(governedInstantOf(where, 'SUPERSEDED')).toEqual(expected);
    });

    it('C2 — a malformed asOf is refused (400) and no query is issued', async () => {
      await expect(
        service.findAllForWorkspace(workspaceId, { asOf: '01-05-2026' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('C3 — an impossible calendar date is refused, never rolled forward', async () => {
      // `new Date('2026-02-30')` silently becomes 2 March, which would answer a
      // different question than the one asked without saying so.
      await expect(
        service.findAllForWorkspace(workspaceId, { asOf: '2026-02-30' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('C3 — an ISO8601 basic-format asOf is refused too', async () => {
      await expect(
        service.findAllForWorkspace(workspaceId, { asOf: '20260501' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('C8 — asOf does not disturb the separate effectiveDate RANGE filters', async () => {
      // Different axes: a range narrows which prices STARTED in a window; asOf
      // decides which APPLIED on a day. Composed with AND, neither overwrites
      // the other — which a spread `effectiveDate` key would have done.
      await service.findAllForWorkspace(workspaceId, {
        asOf: '2026-05-01',
        dateFrom: '2026-01-01',
      });

      const where = whereOfListCall();
      expect(where.effectiveDate).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
      });
      const { started } = applicabilityOf(where);
      expect(started.effectiveDate.lte).toEqual(
        new Date('2026-05-01T00:00:00.000Z'),
      );
    });

    it('applicability NEVER widens: eligibility and precedence survive untouched', async () => {
      await service.findAllForWorkspace(workspaceId, { asOf: '2026-05-01' });

      const where = whereOfListCall();
      expectTwoBranchEligibility(where);
      expect(where.NOT).toEqual({ promotedFrom: { is: { workspaceId } } });
    });

    it('soft reverification is NEVER used as a hard gate', async () => {
      await service.findAllForWorkspace(workspaceId, {});

      // `reviewDate` is advice. A price past it stays fully usable and stays in
      // every candidate set; only `validUntil` is a claim the SOURCE made.
      expect(JSON.stringify(whereOfListCall())).not.toContain('reviewDate');
    });

    it('freshnessStatus is evidence, not a temporal gate', async () => {
      await service.findAllForWorkspace(workspaceId, {});

      const where = whereOfListCall();
      // It may still be filtered EXPLICITLY by a caller, but applicability must
      // never smuggle it in as a validity rule.
      expect(JSON.stringify(where.AND)).not.toContain('freshnessStatus');
    });

    /* ── 01D GAP-D — ONE CLOCK PER REQUEST ──────────────────────────────── */

    /**
     * THE DEFECT THESE PIN.
     *
     * Applicability answers "which price APPLIED on D". Reverification used to
     * be projected from a `new Date()` written inline in `mapExplorerItem`. So
     * a person asking about 2025 was shown a 2025 price wearing a 2026 verdict,
     * and nothing on the screen said the two sentences were about different
     * days. Selection and description must share ONE resolved instant.
     */
    const priceDueForReviewFrom = (reviewDate: string) => ({
      ...mockPrice,
      reviewDate: new Date(reviewDate),
    });

    it('T2 — an explicit asOf governs the FRESHNESS verdict, not only the filter', async () => {
      // Recommended re-check on 1 Jun 2025, asked about 1 Feb 2025. On that day
      // the recommendation had not yet arrived, so the honest answer is CURRENT
      // — even though, read at wall-clock today, it is long past.
      prisma.basicPrice.findMany.mockResolvedValue([
        priceDueForReviewFrom('2025-06-01'),
      ]);

      const result = await service.findAllForWorkspace(workspaceId, {
        asOf: '2025-02-01',
      });

      expect(result.data[0].reverification).toBe('CURRENT');
      // ...and the SAME instant selected the row, which is the whole point.
      const { started } = applicabilityOf(whereOfListCall());
      expect(started.effectiveDate.lte).toEqual(
        new Date('2025-02-01T00:00:00.000Z'),
      );
    });

    it('T2 — the same price, asked about a later day, is DUE at that day', async () => {
      prisma.basicPrice.findMany.mockResolvedValue([
        priceDueForReviewFrom('2025-06-01'),
      ]);

      const result = await service.findAllForWorkspace(workspaceId, {
        asOf: '2025-09-01',
      });

      expect(result.data[0].reverification).toBe('DUE');
    });

    it('T1 — with no asOf, applicability and freshness share the PRESENT', async () => {
      // A review date safely in the past: DUE now, and the applicability clause
      // must be reading the same "now" rather than a second one.
      prisma.basicPrice.findMany.mockResolvedValue([
        priceDueForReviewFrom('2020-01-01'),
      ]);

      const before = Date.now();
      const result = await service.findAllForWorkspace(workspaceId, {});
      const after = Date.now();

      expect(result.data[0].reverification).toBe('DUE');
      const { started } = applicabilityOf(whereOfListCall());
      const applicabilityInstant = started.effectiveDate.lte.getTime();
      expect(applicabilityInstant).toBeGreaterThanOrEqual(before);
      expect(applicabilityInstant).toBeLessThanOrEqual(after);
    });

    it('T1 — the request resolves its instant ONCE, not per clause', async () => {
      // Currentness and applicability are composed from the same `asOf`, so a
      // withdrawal's effective bound and the effective-date bound agree exactly.
      // Two separate `new Date()` calls would differ by a tick and, worse, would
      // mean the room could not state which clock it was on.
      await service.findAllForWorkspace(workspaceId, {});

      const where = whereOfListCall();
      const { started } = applicabilityOf(where);
      expect(governedInstantOf(where, 'WITHDRAWN')).toEqual(
        started.effectiveDate.lte,
      );
      // BP-UX-FINAL-01D — and the correction verb reads the SAME instant.
      expect(governedInstantOf(where, 'SUPERSEDED')).toEqual(
        started.effectiveDate.lte,
      );
    });

    it('a price with no recommended date is NOT_RECOMMENDED in either mode', async () => {
      // Silence is not a warning and not a clean bill of health. It must read
      // the same whichever day is being asked about.
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      const historical = await service.findAllForWorkspace(workspaceId, {
        asOf: '2025-02-01',
      });
      expect(historical.data[0].reverification).toBe('NOT_RECOMMENDED');

      prisma.basicPrice.findMany.mockClear();
      prisma.basicPrice.findMany.mockResolvedValue([mockPrice]);
      const present = await service.findAllForWorkspace(workspaceId, {});
      expect(present.data[0].reverification).toBe('NOT_RECOMMENDED');
    });

    // =======================================================================
    // 01D GAP-A — A CORRECTION MADE TODAY MUST NOT REWRITE YESTERDAY
    // =======================================================================

    describe('correction currentness is answered AT the asked-about instant', () => {
      /**
       * THE LAW THIS PINS, AND THE READING IT REPLACES.
       *
       * An earlier reading of this repository concluded that supersession is
       * RETROACTIVE — that a corrected price was never valid, so no `asOf`
       * could show it. That is wrong, and the same repository says why:
       *
       *   1. `basic-price-publication.service.ts` — "PUBLICATION IS ALSO THE
       *      MOMENT A CORRECTION BECOMES CURRENT", and the atomic write makes
       *      "this row is published" and "this row replaced that one" true IN
       *      THE SAME INSTANT. A moment therefore exists before which the
       *      predecessor WAS the current truth.
       *   2. `schema.prisma`, `BasicPricePublicationAudit.effectiveAt` — a
       *      PUBLISH and a SUPERSEDED "are INSTANTANEOUS GOVERNANCE
       *      TRANSITIONS that become true exactly when they are recorded".
       *      Recorded, not backdated — which is a temporal claim, not an
       *      absence of one.
       *   3. Migration 20260826120000, S2 — "a proposed correction is invisible
       *      to selection until the same two-human ladder has finished with
       *      it": the predecessor stays current until the ladder finishes.
       *
       * So the anchor is the PREDECESSOR's own SUPERSEDED audit `createdAt` —
       * the only instant that action has, because the migration explicitly
       * refuses to invent an `effectiveAt` for it. Correction still means "that
       * fact was wrong"; what it may NOT do is edit what SIMPROK answered
       * before anyone knew.
       */
      it('C-ASOF — the correction clause carries the asked-about instant', async () => {
        await service.findAllForWorkspace(workspaceId, { asOf: '2020-01-01' });

        const where = whereOfListCall();
        expect(where.publicationAudits?.none.OR).toContainEqual({
          action: 'SUPERSEDED',
          createdAt: { lte: new Date('2020-01-01T00:00:00.000Z') },
        });
      });

      it('C-ASOF — the instant MOVES with the caller, so it is a real comparison', async () => {
        await service.findAllForWorkspace(workspaceId, { asOf: '2020-01-01' });
        const early = whereOfListCall();

        prisma.basicPrice.findMany.mockClear();
        await service.findAllForWorkspace(workspaceId, { asOf: '2026-01-01' });
        const late = whereOfListCall();

        const supersededOf = (where: ExplorerWhere) =>
          where.publicationAudits?.none.OR.find(
            (member) => member.action === 'SUPERSEDED',
          )?.createdAt?.lte;

        expect(supersededOf(early)).toEqual(
          new Date('2020-01-01T00:00:00.000Z'),
        );
        expect(supersededOf(late)).toEqual(
          new Date('2026-01-01T00:00:00.000Z'),
        );
      });

      it('C-ASOF-11 — a missing-audit catalog successor fails CLOSED at every instant; private is timed', async () => {
        for (const asOf of ['1999-01-01', '2099-01-01']) {
          prisma.basicPrice.findMany.mockClear();
          await service.findAllForWorkspace(workspaceId, { asOf });
          expect(whereOfListCall().supersededBy).toEqual({
            isNot: {
              OR: [
                {
                  AND: [
                    { verificationStatus: { not: 'UNVERIFIED' } },
                    {
                      supersedes: {
                        is: {
                          publicationAudits: { none: { action: 'SUPERSEDED' } },
                        },
                      },
                    },
                  ],
                },
                {
                  AND: [
                    { verificationStatus: 'UNVERIFIED' },
                    { createdAt: { lte: new Date(`${asOf}T00:00:00.000Z`) } },
                  ],
                },
              ],
            },
          });
        }
      });

      it('C-ASOF-10 — withdrawal keeps its OWN effective clock, unmerged', async () => {
        await service.findAllForWorkspace(workspaceId, { asOf: '2020-01-01' });

        const governed = whereOfListCall().publicationAudits?.none.OR ?? [];
        // The one action that carries its own effective instant, compared
        // against `effectiveAt` and never against the bookkeeping `createdAt`.
        const withdrawn = governed.find(
          (member) => member.action === 'WITHDRAWN',
        );
        expect(withdrawn?.effectiveAt?.lte).toEqual(
          new Date('2020-01-01T00:00:00.000Z'),
        );
        expect(withdrawn?.createdAt).toBeUndefined();
        // ...and the correction verb does NOT borrow it.
        const superseded = governed.find(
          (member) => member.action === 'SUPERSEDED',
        );
        expect(superseded?.effectiveAt).toBeUndefined();
      });

      it('C-ASOF-08/09 — a promoted descendant inherits the same correction clock', async () => {
        await service.findAllForWorkspace(workspaceId, { asOf: '2020-01-01' });

        const promotedFrom = whereOfListCall().promotedFrom as {
          isNot: { OR: unknown[] };
        };
        const serialised = JSON.stringify(promotedFrom);
        expect(serialised).toContain('"SUPERSEDED"');
        expect(serialised).toContain('"createdAt"');

        // The old absolute form — a bare `{ supersededBy: { isNot: null } }` as
        // the first branch — would suppress a descendant whose origin is
        // corrected TOMORROW, in every answer about yesterday. It survives only
        // nested inside the fail-closed AND, never as the branch itself.
        expect(promotedFrom.isNot.OR[0]).not.toEqual({
          supersededBy: { isNot: null },
        });
      });
    });
  });

  // =========================================================================
  // GAP-D / GAP-E — PROJECTED DETAIL WITH REAL HISTORY
  // =========================================================================

  describe('findDetailForWorkspace', () => {
    const detailRow = {
      ...mockPrice,
      regionId: null,
      supersedesBasicPriceId: 'bp-old',
      sourcePeriodLabel: 'TA 2026',
      effectiveDateProvenance: 'SOURCE_STATED',
      effectiveDateDerivationRule: null,
      sourceSubmission: {
        importRow: {
          batch: {
            sourceVendorName: 'Toko Jaya',
            sourceOrganizationName: null,
          },
        },
      },
      sourceImportRow: null,
    };

    const lineage = (
      id: string,
      value: string,
      date: string,
      supersedes: string | null,
    ) => ({
      id,
      value,
      effectiveDate: new Date(date),
      supersedesBasicPriceId: supersedes,
    });

    it('D2 — returns the REAL persisted timeline, newest first', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', 'bp-old'),
        lineage('bp-old', '140000.00', '2025-06-01', null),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      // ID7 — three fields and no fourth. No `basicPriceId` on any entry:
      // rendering a dated amount needs no identifier, and a PREDECESSOR's raw
      // UUID was never the browser's to hold. `toEqual` on the whole array is
      // what makes that a proof rather than a hope — a re-added id fails here.
      expect(detail.corrections.entries).toEqual([
        {
          price: '150000.00',
          effectiveDate: new Date('2026-01-01').toISOString(),
          state: 'CURRENT',
        },
        {
          price: '140000.00',
          effectiveDate: new Date('2025-06-01').toISOString(),
          state: 'SUPERSEDED',
        },
      ]);
      // The whole chain was read, so nothing may suggest otherwise.
      expect(detail.corrections.truncated).toBe(false);
    });

    it('D3 — a multi-generation chain comes back whole and ordered', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', 'g2'),
        lineage('g2', '140000.00', '2025-06-01', 'g1'),
        lineage('g1', '130000.00', '2025-01-01', null),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      // Ordered by the MONEY, because the money is what the browser receives —
      // the ids that produced this order stay on the server.
      expect(detail.corrections.entries.map((entry) => entry.price)).toEqual([
        '150000.00',
        '140000.00',
        '130000.00',
      ]);
      expect(detail.corrections.entries.map((entry) => entry.state)).toEqual([
        'CURRENT',
        'SUPERSEDED',
        'SUPERSEDED',
      ]);
    });

    it('D1 — an uncorrected price has a ONE-entry history, not an empty one', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        supersedesBasicPriceId: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', null),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.corrections.entries).toHaveLength(1);
      expect(detail.corrections.entries[0].state).toBe('CURRENT');
      expect(detail.corrections.entries[0].price).toBe('150000.00');
    });

    it('D4 — an unrelated row in the same context never enters the timeline', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        supersedesBasicPriceId: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', null),
        // Same resource, same region, similar value, earlier date — and NOT
        // named by any pointer. A different observation, not this price's past.
        lineage('other', '149000.00', '2025-12-01', null),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.corrections.entries).toHaveLength(1);
      expect(detail.corrections.entries[0].price).toBe('150000.00');
    });

    it('the anchor is always present, seeded from its OWN real columns', async () => {
      // If the bounded lineage read truncates the anchor out, its entry must
      // still carry the anchor's real price and date. A placeholder here would
      // be exactly the invented history this read exists to refuse.
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        supersedesBasicPriceId: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.corrections.entries).toEqual([
        {
          price: '150000.00',
          effectiveDate: new Date('2026-01-01').toISOString(),
          state: 'CURRENT',
        },
      ]);
    });

    it('D9 — the history costs ONE extra query, never one per generation', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', 'g2'),
        lineage('g2', '140000.00', '2025-06-01', 'g1'),
        lineage('g1', '130000.00', '2025-01-01', null),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.corrections.entries).toHaveLength(3);
      expect(prisma.basicPrice.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.basicPrice.findMany).toHaveBeenCalledTimes(1);
    });

    it('the lineage read is tenant-filtered, bounded, and scoped to ONE context', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      await service.findDetailForWorkspace('bp-01', workspaceId);

      const call = listArgs();
      expectTwoBranchEligibility(call.where);
      expect(call.where.resourceId).toBe('rc-01');
      // Exact equality including NULL — a region-less price and a regional one
      // are different logical contexts, and the publication writer says so.
      expect(call.where.regionId).toBeNull();
      expect(typeof call.take).toBe('number');
      expect(call.take).toBeGreaterThan(0);
    });

    it('D6 — the lineage read never follows PROMOTION into a foreign tenant', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      await service.findDetailForWorkspace('bp-01', workspaceId);

      const call = JSON.stringify(listArgs());
      // Promotion lineage and correction lineage are DIFFERENT questions.
      // Following the first walks into another workspace's private origin.
      expect(call).not.toContain('promotedFrom');
      expect(call).not.toContain('reportedByAccountId');
      expect(call).not.toContain('sourceSubmissionId');
    });

    it('the by-id detail read stays RAW-LAWFUL, so a superseded price is readable', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      await service.findDetailForWorkspace('bp-01', workspaceId);

      const where = JSON.stringify(firstArgs().where);
      // HIST-01 — asking for a row by id is a lawfulness question, not a
      // selection one. Currentness and precedence must NOT apply here, or a
      // corrected price would become unreadable the moment it was corrected.
      expect(where).not.toContain('supersededBy');
      expect(where).not.toContain('publicationAudits');
      expect(where).not.toContain('NOT');
    });

    it('D7 — an unknown or foreign id is plain non-existence (404), never a leak', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(null);

      await expect(
        service.findDetailForWorkspace('bp-someone-elses', workspaceId),
      ).rejects.toBeInstanceOf(NotFoundException);
      // And no lineage read is issued for a row that does not exist for us.
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('projects no raw internal column — never a Prisma entity dump', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);
      const serialised = JSON.stringify(detail);

      for (const internal of [
        'verificationStatus',
        'supersedesBasicPriceId',
        'sourceSubmissionId',
        'sourceImportRowId',
        'organizationId',
        'reportedByAccountId',
        'sourcePeriodGranularity',
      ]) {
        expect(serialised).not.toContain(internal);
      }
    });

    it('GAP-E — evidence is a PROVEN fact, not a sentence about a file', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.evidence.importBatchLinked).toBe(true);
      expect(detail.evidence.observationBasis).toBe('SOURCE_DOCUMENT');
      expect(detail.evidence.sourcePeriodLabel).toBe('TA 2026');
      expect(detail.evidence.effectiveDateProvenance).toBe('SOURCE_STATED');
    });

    it('GAP-E — a row with NO provenance chain says so rather than claiming linkage', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        sourceSubmission: null,
        sourceImportRow: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.evidence.importBatchLinked).toBe(false);
      expect(detail.evidence.observationBasis).toBe('FIELD_REPORTED');
      expect(detail.price.sourceName).toBeNull();
    });

    it('GAP-E — the private provenance chain proves evidence just as well', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        sourceSubmission: null,
        sourceImportRow: {
          batch: {
            sourceVendorName: null,
            sourceOrganizationName: 'Tim Simprok',
          },
        },
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.evidence.importBatchLinked).toBe(true);
      expect(detail.price.sourceName).toBe('Tim Simprok');
    });

    /* ── 01D GAP-B — LINKAGE IS NOT A FILE ──────────────────────────────── */

    it('E3 — importBatchLinked ALONE never proves the original upload is stored', async () => {
      // The defect this pins: a relation to a batch was being read as "the
      // uploaded file is retained". `sourceStorageRef` is null for every batch
      // imported before bytes were kept, so linkage could never have implied it.
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.evidence.importBatchLinked).toBe(true);
      expect(detail.evidence.originalFileRetained).toBe(false);
    });

    it('E1 — retained bytes are reported only when the batch actually names them', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        sourceSubmission: {
          importRow: {
            batch: {
              sourceVendorName: 'Toko Jaya',
              sourceOrganizationName: null,
              sourceStorageRef: 'basic-price-intake/ab/cdef0123',
            },
          },
        },
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.evidence.importBatchLinked).toBe(true);
      expect(detail.evidence.originalFileRetained).toBe(true);
    });

    it('E4 — the storage LOCATION never reaches the browser, only the yes/no', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        sourceImportRow: {
          batch: {
            sourceVendorName: null,
            sourceOrganizationName: 'Tim Simprok',
            sourceStorageRef: 'basic-price-intake/ab/cdef0123',
          },
        },
        sourceSubmission: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.evidence.originalFileRetained).toBe(true);
      // An internal content-addressed path is not a browser's business, and a
      // sha-like string in a payload is an invitation to build a fetch on it.
      const serialised = JSON.stringify(detail);
      expect(serialised).not.toContain('basic-price-intake');
      expect(serialised).not.toContain('sourceStorageRef');
    });

    it('PRICE-EVID-01 — a new observation may keep the shop name without claiming the old file', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        supersedesBasicPriceId: null,
        sourceSubmission: null,
        sourceImportRow: null,
        provenanceCorrections: [
          {
            after: {
              sourceIdentityName: 'Toko ABC',
              evidenceClass: 'FIELD_REPORTED',
            },
          },
        ],
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.price.sourceName).toBe('Toko ABC');
      expect(detail.evidence.importBatchLinked).toBe(false);
      expect(detail.evidence.originalFileRetained).toBe(false);
      expect(detail.evidence.observationBasis).toBe('FIELD_REPORTED');
      const serialised = JSON.stringify(detail);
      expect(serialised).not.toContain('sourceImportRowId');
      expect(serialised).not.toContain('sourceStorageRef');
      expect(serialised).not.toContain('evidenceClass');
    });

    it('PRICE-EVID-07 — a correction without its own import row may reuse predecessor documentary facts', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        sourceSubmission: null,
        sourceImportRow: null,
        supersedes: {
          sourceImportRow: {
            batch: {
              sourceVendorName: 'Toko Jaya',
              sourceOrganizationName: null,
              sourceStorageRef: 'basic-price-intake/ab/invoice-may',
            },
          },
        },
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.evidence.importBatchLinked).toBe(true);
      expect(detail.evidence.originalFileRetained).toBe(true);
      expect(detail.evidence.observationBasis).toBe('SOURCE_DOCUMENT');
      expect(JSON.stringify(detail)).not.toContain('basic-price-intake');
    });

    it('E2 — no chain at all reports BOTH facts false, and invents neither', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        sourceSubmission: null,
        sourceImportRow: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.evidence.importBatchLinked).toBe(false);
      expect(detail.evidence.originalFileRetained).toBe(false);
      expect(detail.evidence.observationBasis).toBe('FIELD_REPORTED');
    });

    it('EVID-CLASS-03/06 — no chain and no field marker stays unknown, without raw ids', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        sourceType: 'SYSTEM_ESTIMATE',
        sourceOrigin: 'GOVERNMENT',
        sourceSubmission: null,
        sourceImportRow: null,
        supersedes: null,
        provenanceCorrections: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);
      const serialised = JSON.stringify(detail);

      expect(detail.evidence.importBatchLinked).toBe(false);
      expect(detail.evidence.observationBasis).toBeNull();
      expect(detail.evidence.observationBasis).not.toBe('FIELD_REPORTED');
      expect(detail.evidence.observationBasis).not.toBe('SOURCE_DOCUMENT');
      expect(serialised).not.toContain('sourceImportRowId');
      expect(serialised).not.toContain('sourceStorageRef');
      expect(serialised).not.toContain('verificationStatus');
    });

    /* ── 01D GAP-A — A BOUNDED LINEAGE SAYS SO ──────────────────────────── */

    it('H6 — an unresolved predecessor pointer reports truncated', async () => {
      // The anchor names a predecessor the bounded, tenant-filtered read did
      // not return. The chain therefore continues past this answer, and the
      // label above it must become "Riwayat Koreksi Terbaru".
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', 'bp-old'),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.corrections.entries).toHaveLength(1);
      expect(detail.corrections.truncated).toBe(true);
      // And the id it could not resolve is still not handed out.
      expect(JSON.stringify(detail)).not.toContain('bp-old');
    });

    /* ── 01D §6 — THE BOUNDED CANDIDATE READ ADMITS ITS OWN CEILING ─────── */

    /**
     * WHY THIS SECTION EXISTS.
     *
     * Chain MEMBERSHIP is exact-pointer-only and always was. The remaining risk
     * was in the FETCH: it is scoped by (resource, region), which is a SUPERSET
     * of the chain. Two hundred perfectly ordinary, unrelated observations of
     * the same resource in the same region would fill the ceiling, and a real
     * older correction could then fall outside the rows read — invisibly, with
     * the answer still looking complete.
     *
     * The repair is not a bigger read. It is reading ONE row past the ceiling
     * so the cap becomes DETECTABLE, and then saying so.
     */
    const HISTORY_BOUND = 200;

    it('HBOUND-01 — a read that did not reach its ceiling claims no truncation', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        supersedesBasicPriceId: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', null),
        ...Array.from({ length: 40 }, (_unused, index) =>
          lineage(`noise-${index}`, '149000.00', '2025-12-01', null),
        ),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.corrections.entries).toHaveLength(1);
      expect(detail.corrections.truncated).toBe(false);
    });

    it('HBOUND-02 — a CAPPED candidate read reports truncated even when the chain LOOKS whole', async () => {
      // The chain visible here terminates cleanly: `bp-01` -> `g2`, and `g2`
      // names no predecessor. Under the old rule that would have reported
      // `truncated: false` — a completeness claim resting on rows that were
      // never read. Absence outside a capped read is not provable.
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', 'g2'),
        lineage('g2', '140000.00', '2025-06-01', null),
        ...Array.from({ length: HISTORY_BOUND - 1 }, (_unused, index) =>
          lineage(`unrelated-${index}`, '139000.00', '2025-01-01', null),
        ),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      // HBOUND-03/04 — membership is still pointers alone: two hundred
      // unrelated rows in the same context enter nothing.
      expect(detail.corrections.entries).toHaveLength(2);
      expect(detail.corrections.entries.map((entry) => entry.price)).toEqual([
        '150000.00',
        '140000.00',
      ]);
      // HBOUND-07 — and no completeness is claimed over a capped read.
      expect(detail.corrections.truncated).toBe(true);
    });

    it('HBOUND-02 — the read asks for exactly ONE row past the ceiling, and only one query', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      await service.findDetailForWorkspace('bp-01', workspaceId);

      const call = listArgs();
      // Bounded — never an unbounded backwards walk, never a whole-catalog read.
      expect(call.take).toBe(HISTORY_BOUND + 1);
      // HBOUND-05 — and still exactly one query, whatever the depth.
      expect(prisma.basicPrice.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.basicPrice.findFirst).toHaveBeenCalledTimes(1);
    });

    it('HBOUND-06 — a corrupted self-referential chain stays bounded and truthful', async () => {
      // Unreachable in the database (S1 refuses A -> A, and publish order makes
      // A -> B -> A unwritable). An impossible state must still produce a short,
      // honest answer rather than a stalled request.
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', 'g2'),
        lineage('g2', '140000.00', '2025-06-01', 'bp-01'),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.corrections.entries.length).toBeLessThanOrEqual(2);
      const prices = detail.corrections.entries.map((entry) => entry.price);
      expect(new Set(prices).size).toBe(prices.length);
    });

    it('H1 — an uncorrected price is NOT truncated', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        supersedesBasicPriceId: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', null),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.corrections.truncated).toBe(false);
    });

    /* ── 01D GAP-C — WHAT THE PAYLOAD MAY CARRY ─────────────────────────── */

    it('ID1-ID7 — no tenant, actor or predecessor identifier reaches the browser', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '150000.00', '2026-01-01', 'bp-old'),
        lineage('bp-old', '140000.00', '2025-06-01', null),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);
      const serialised = JSON.stringify(detail);

      // ID1 — the workspace is expressed as a SCOPE LABEL, never as its uuid.
      expect(serialised).not.toContain(workspaceId);
      expect(detail.price.workspaceScope).toBe('WORKSPACE');
      // ID2-ID6 — no actor, no provenance FK, no lineage FK by name.
      for (const internal of [
        'workspaceId',
        'accountId',
        'actorAccountId',
        'reportedByAccountId',
        'sourceSubmissionId',
        'sourceImportRowId',
        'supersedesBasicPriceId',
        'promotedFromBasicPriceId',
      ]) {
        expect(serialised).not.toContain(internal);
      }
      // ID7 — and no PREDECESSOR row id, which is the one this read could
      // plausibly have needed and does not: a dated amount renders without it.
      expect(serialised).not.toContain('bp-old');
      expect(detail.corrections.entries).toHaveLength(2);
    });

    /* ── KDN ADDENDUM (Owner Lock) — a RESOURCE FACT, never an aggregate ── */

    it('KDN-01 — a stated %KDN is projected as an exact decimal string', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        kdnPercent: '72.50',
        kdnEstablishment: 'SOURCE_IMPORT_ROW',
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      // Exact string, never a float — a percentage deserves the same arithmetic
      // discipline as the money beside it.
      expect(detail.domesticContent.kdnPercent).toBe('72.50');
    });

    it('KDN-02 — an UNSTATED %KDN stays null, and is never coerced to zero', async () => {
      // The fixture carries no `kdnPercent` at all, which is the
      // ordinary case: the column exists but no writer has set it.
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.domesticContent.kdnPercent).toBeNull();
      // A zero here would be a compliance claim SIMPROK was never given.
      expect(detail.domesticContent.kdnPercent).not.toBe('0.00');
      expect(detail.domesticContent.kdnPercent).not.toBe(0);
    });

    it('KDN-02b — an explicit NULL is absence; an explicit ZERO is a FACT', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        resource: { ...detailRow.resource },
        kdnPercent: null,
        kdnEstablishment: null,
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);
      expect(
        (await service.findDetailForWorkspace('bp-01', workspaceId))
          .domesticContent.kdnPercent,
      ).toBeNull();

      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        kdnPercent: '0.00',
        kdnEstablishment: 'SOURCE_IMPORT_ROW',
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);
      // "This resource has no domestic content" is a substantive statement and
      // must survive as one, distinguishable from silence.
      expect(
        (await service.findDetailForWorkspace('bp-01', workspaceId))
          .domesticContent.kdnPercent,
      ).toBe('0.00');
    });

    it('KDN-03/04 — no component breakdown is projected, because none is persisted', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        kdnPercent: '72.50',
        kdnEstablishment: 'SOURCE_IMPORT_ROW',
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      // ONE key and no fourth. A material/equipment/labour split would have to
      // be derived backwards from the total, which is inventing the evidence.
      expect(Object.keys(detail.domesticContent)).toEqual(['kdnPercent']);
      expect(JSON.stringify(detail)).not.toContain('component');
    });

    it('KDN-05/06 — the payload never says TKDN and carries no aggregate', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        kdnPercent: '72.50',
        kdnEstablishment: 'SOURCE_IMPORT_ROW',
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const serialised = JSON.stringify(
        await service.findDetailForWorkspace('bp-01', workspaceId),
      );
      // The legacy COLUMN is named tkdnValue; the browser-facing FACT is not.
      // %KDN is item/resource observation level; TKDN is the RAB/Project aggregate.
      expect(serialised).not.toContain('tkdnValue');
      expect(serialised).not.toContain('TKDN');
      expect(serialised).not.toContain('tkdn');
    });

    it('KDN-07 — %KDN changes no money, no currentness and no eligibility', async () => {
      const withKdn = {
        ...detailRow,
        kdnPercent: '72.50',
        kdnEstablishment: 'SOURCE_IMPORT_ROW',
      };
      prisma.basicPrice.findFirst.mockResolvedValue(withKdn);
      prisma.basicPrice.findMany.mockResolvedValue([]);
      const a = await service.findDetailForWorkspace('bp-01', workspaceId);

      prisma.basicPrice.findFirst.mockClear();
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);
      const b = await service.findDetailForWorkspace('bp-01', workspaceId);

      // Identical money and identical lineage whether or not a %KDN exists.
      expect(a.price.price).toBe(b.price.price);
      expect(a.price.reverification).toBe(b.price.reverification);
      expect(a.corrections).toEqual(b.corrections);
      // And the read stayed a LAWFULNESS question — no currentness clause crept
      // in beside the new column.
      const where = JSON.stringify(firstArgs().where);
      expect(where).not.toContain('tkdnValue');
      expect(where).not.toContain('supersededBy');
    });

    it('KDN-08 — a foreign workspace cannot obtain the resource %KDN fact', async () => {
      /**
       * THE TENANT LAW IS NOT RE-STATED FOR KDN; KDN RIDES INSIDE IT.
       *
       * `kdnPercent` is selected on the SAME row the eligibility gate admits
       * or refuses. A row this workspace may not read is therefore never
       * fetched at all, so there is no projection step in which its %KDN
       * could leak — the fact cannot outlive the row it hangs on.
       */
      prisma.basicPrice.findFirst.mockResolvedValue(null);

      await expect(
        service.findDetailForWorkspace('bp-another-tenants', workspaceId),
      ).rejects.toBeInstanceOf(NotFoundException);

      // The gate that refused it is the two-branch tenant predicate itself.
      expectTwoBranchEligibility(firstArgs().where);
      // And nothing downstream ran: no lineage read, so no resource/KDN
      // projection of any kind was reached.
      expect(prisma.basicPrice.findMany).not.toHaveBeenCalled();
    });

    it('KDN-08 — the %KDN read is scoped by the SAME eligibility predicate as the price', async () => {
      // The positive control for the test above: when a row IS lawful, the
      // `kdnPercent` is selected through the very read that eligibility
      // filtered — never through a second, unscoped lookup.
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        kdnPercent: '72.50',
        kdnEstablishment: 'SOURCE_IMPORT_ROW',
      });
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);
      expect(detail.domesticContent.kdnPercent).toBe('72.50');

      // ONE read produced both the money and the %KDN, and it was tenant-gated.
      expect(prisma.basicPrice.findFirst).toHaveBeenCalledTimes(1);
      const call = firstArgs();
      expectTwoBranchEligibility(call.where);
      expect((call.select as { kdnPercent?: boolean }).kdnPercent).toBe(true);
      expect(
        (call.select as { resource?: { select?: Record<string, unknown> } })
          .resource?.select?.tkdnValue,
      ).toBeUndefined();
      // No separate resourceCatalog lookup exists to be unscoped.
      expect(Object.keys(prisma.basicPrice).sort()).toEqual([
        'count',
        'findFirst',
        'findMany',
      ]);
    });

    it('the price half is the SAME projection the Explorer row used', async () => {
      // Detail and the list must never disagree about what a price is called,
      // what it costs or where it comes from. One function, two screens.
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      expect(detail.price.basicPriceId).toBe('bp-01');
      expect(detail.price.price).toBe('150000.00');
      expect(detail.price.sourceName).toBe('Toko Jaya');
      expect(detail.price.resource.name).toBe('Semen Portland 50kg');
      expect(detail.price.workspaceScope).toBe('WORKSPACE');
    });

    it('money stays an exact decimal string at every depth', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue({
        ...detailRow,
        value: '9007199254740993.99',
      });
      prisma.basicPrice.findMany.mockResolvedValue([
        lineage('bp-01', '9007199254740993.99', '2026-01-01', null),
      ]);

      const detail = await service.findDetailForWorkspace('bp-01', workspaceId);

      // Beyond IEEE-754 safe-integer range: a single Number() anywhere in the
      // chain would silently change the money.
      expect(detail.price.price).toBe('9007199254740993.99');
      expect(detail.corrections.entries[0].price).toBe('9007199254740993.99');
    });

    it('M — a detail read exposes no write path at all', async () => {
      prisma.basicPrice.findFirst.mockResolvedValue(detailRow);
      prisma.basicPrice.findMany.mockResolvedValue([]);

      await service.findDetailForWorkspace('bp-01', workspaceId);

      // The mock provides ONLY read methods, so any create/update/delete would
      // have thrown. Asserted explicitly so a future write is a test failure
      // rather than a silent capability on a GET.
      expect(Object.keys(prisma.basicPrice).sort()).toEqual([
        'count',
        'findFirst',
        'findMany',
      ]);
    });
  });
});

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BasicPricePublicationService } from './basic-price-publication.service';
import { BasicPricePromotionService } from './basic-price-promotion.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BASIC_PRICE_CURRENTNESS_VERSION,
  basicPriceCurrentnessWhere,
  mergeCurrentnessAnd,
} from './basic-price-currentness';

/**
 * BP-CORR-01 — PUBLISHED BASIC PRICE CORRECTION + SUPERSESSION.
 *
 * A published price is a historical fact. A correction adds a new governed
 * truth and moves which one is CURRENT; it never edits what was published.
 * These cases pin that as behaviour, not as prose.
 */

const WORKSPACE_ID = 'ws-01';
const ORG_ID = 'org-01';
const PUBLISHER_ACCOUNT_ID = 'account-publisher-01';
const VERIFIER_ACCOUNT_ID = 'account-verifier-01';
const SUCCESSOR_ID = 'bp-successor-01';
const PREDECESSOR_ID = 'bp-predecessor-01';
const SUBMISSION_ID = 'submission-01';
const VERIFIER_USER_ID = 'user-verifier-01';
const RESOURCE_ID = 'resource-semen-01';
const REGION_ID = 'region-ntt-01';

/**
 * The EXECUTABLE half of the currentness module, with comments stripped and the
 * exported version constant left behind. Several assertions below are about
 * what the PREDICATE may contain, and prose — or a constant whose NAME happens
 * to read "PUBLISHED" while deciding nothing — must never be able to fail them.
 */
const predicateBody = () => {
  const source = readFileSync(
    join(__dirname, 'basic-price-currentness.ts'),
    'utf8',
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  // From the WITHDRAWN action constant onwards — everything that actually
  // decides anything, including the `withdrawnAudit` helper. Only the version
  // string sits above it, and a label is not a condition.
  const start = code.indexOf('export const WITHDRAWN_PUBLICATION_AUDIT_ACTION');
  expect(start).toBeGreaterThan(-1);
  return code.slice(start);
};

const expectedSupersededBy = (asOf: Date) => ({
  isNot: {
    OR: [
      {
        AND: [
          { verificationStatus: { not: 'UNVERIFIED' } },
          {
            supersedes: {
              is: { publicationAudits: { none: { action: 'SUPERSEDED' } } },
            },
          },
        ],
      },
      {
        AND: [
          { verificationStatus: 'UNVERIFIED' },
          { createdAt: { lte: asOf } },
        ],
      },
    ],
  },
});

describe('BP-CORR-01 supersession', () => {
  /**
   * A scripted transaction over the REAL service. The two `$queryRaw` locks
   * (successor, then predecessor) are answered in call order, so a test can
   * script a predecessor that is unpublished, foreign, mis-scoped or absent and
   * observe exactly what the service refuses.
   */
  const build = (options: {
    successor?: Record<string, unknown> | null;
    predecessor?: Record<string, unknown> | null;
    /** What the pre-lock read saw. Drives the idempotent-terminal branch. */
    stateBeforeLock?: Record<string, unknown> | null;
    /** An already-existing successor of the predecessor (chain fork attempt). */
    existingSuccessor?: Record<string, unknown> | null;
  }) => {
    const successor = {
      id: SUCCESSOR_ID,
      status: 'UNPUBLISHED',
      verificationStatus: 'VERIFIED',
      sourceSubmissionId: SUBMISSION_ID,
      organizationId: ORG_ID,
      resourceId: RESOURCE_ID,
      regionId: REGION_ID,
      supersedesBasicPriceId: null,
      ...(options.successor ?? {}),
    };
    const predecessor =
      options.predecessor === null
        ? null
        : {
            id: PREDECESSOR_ID,
            status: 'PUBLISHED',
            verificationStatus: 'PUBLISHED',
            assetScope: 'SIMPROK_CATALOG',
            resourceId: RESOURCE_ID,
            regionId: REGION_ID,
            promotedFromBasicPriceId: null,
            ...(options.predecessor ?? {}),
          };

    const updates: Array<Record<string, unknown>> = [];
    const audits: Array<Record<string, unknown>> = [];
    let rawCall = 0;

    const tx = {
      $queryRaw: jest.fn(() => {
        rawCall += 1;
        if (rawCall === 1) {
          return Promise.resolve(options.successor === null ? [] : [successor]);
        }
        return Promise.resolve(predecessor === null ? [] : [predecessor]);
      }),
      basicPrice: {
        findFirst: jest
          .fn()
          .mockResolvedValue(options.existingSuccessor ?? null),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: SUCCESSOR_ID, ...successor }),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({ id: SUCCESSOR_ID, ...args.data });
        }),
      },
      basicPricePublicationAudit: {
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          audits.push(args.data);
          return Promise.resolve(args.data);
        }),
      },
      priceSubmission: {
        findFirst: jest.fn().mockResolvedValue({
          review: { decisions: [{ decidedByUserId: VERIFIER_USER_ID }] },
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          workspaceMembershipId: 'membership-verifier-01',
          membership: {
            id: 'membership-verifier-01',
            accountId: VERIFIER_ACCOUNT_ID,
            workspaceId: WORKSPACE_ID,
            status: 'ACTIVE',
            account: { id: VERIFIER_ACCOUNT_ID, status: 'ACTIVE' },
          },
        }),
      },
    };

    const prisma = {
      $transaction: jest.fn((callback: (t: unknown) => unknown) =>
        callback(tx),
      ),
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-publisher-01',
          accountId: PUBLISHER_ACCOUNT_ID,
          workspaceId: WORKSPACE_ID,
          status: 'ACTIVE',
          account: { id: PUBLISHER_ACCOUNT_ID, status: 'ACTIVE' },
          userProfile: {
            workspaceMembershipId: 'membership-publisher-01',
            workspaceId: WORKSPACE_ID,
            status: 'ACTIVE',
          },
        }),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: ORG_ID }),
      },
      basicPrice: {
        findFirst: jest.fn().mockResolvedValue(
          options.stateBeforeLock === undefined
            ? {
                status: 'UNPUBLISHED',
                verificationStatus: 'VERIFIED',
                supersedesBasicPriceId: null,
              }
            : options.stateBeforeLock,
        ),
      },
    };

    return { tx, prisma, updates, audits };
  };

  const makeService = async (prisma: unknown) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPricePublicationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return module.get(BasicPricePublicationService);
  };

  const publish = async (
    harness: ReturnType<typeof build>,
    supersedesBasicPriceId: string | null = PREDECESSOR_ID,
  ) => {
    const service = await makeService(harness.prisma);
    return service.publish({
      workspaceId: WORKSPACE_ID,
      basicPriceId: SUCCESSOR_ID,
      publisherAccountId: PUBLISHER_ACCOUNT_ID,
      supersedesBasicPriceId,
    });
  };

  // =========================================================================
  // HISTORY — §23
  // =========================================================================
  describe('HISTORY', () => {
    it('HIST-02 — publishing a correction writes NOTHING to the predecessor row', async () => {
      const harness = build({});
      await publish(harness);

      // Every BasicPrice update in the whole act targets the SUCCESSOR. The
      // predecessor's own columns are byte-identical before and after: there is
      // no second update, no flag, no date, no status move.
      expect(harness.tx.basicPrice.update).toHaveBeenCalledTimes(1);
      expect(harness.tx.basicPrice.update.mock.calls[0][0].where).toEqual({
        id: SUCCESSOR_ID,
      });
    });

    it('HIST-03 — the successor names its exact predecessor, in the same atomic write as publication', async () => {
      const harness = build({});
      await publish(harness);

      expect(harness.updates).toEqual([
        {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: PREDECESSOR_ID,
        },
      ]);
    });

    it('HIST-02 — a correction still moves no money, no identity and no scope', async () => {
      const harness = build({});
      await publish(harness);

      const written = Object.keys(harness.updates[0]);
      for (const forbidden of [
        'value',
        'resourceId',
        'regionId',
        'effectiveDate',
        'validUntil',
        'assetScope',
        'workspaceId',
        'organizationId',
        'sourceOrigin',
      ]) {
        expect(written).not.toContain(forbidden);
      }
    });

    it("HIST-04 — the predecessor's history is APPENDED to, never overwritten, and never with a forged PUBLISH", async () => {
      const harness = build({});
      await publish(harness);

      expect(harness.audits).toEqual([
        {
          basicPriceId: SUCCESSOR_ID,
          action: 'PUBLISH',
          actorAccountId: PUBLISHER_ACCOUNT_ID,
          reason: `status:UNPUBLISHED->PUBLISHED; verificationStatus:VERIFIED->PUBLISHED; supersedes:${PREDECESSOR_ID}`,
        },
        {
          basicPriceId: PREDECESSOR_ID,
          action: 'SUPERSEDED',
          actorAccountId: PUBLISHER_ACCOUNT_ID,
          reason: `superseded by:${SUCCESSOR_ID}`,
        },
      ]);

      // THE LOAD-BEARING HALF: the audit written ON the predecessor is
      // SUPERSEDED, never PUBLISH. The Cost Kernel proves a publisher by
      // looking for action = 'PUBLISH' on that exact price, so a PUBLISH row
      // here would let a correction answer the two-human ladder on the
      // predecessor's behalf.
      const onPredecessor = harness.audits.filter(
        (audit) => audit.basicPriceId === PREDECESSOR_ID,
      );
      expect(onPredecessor.every((audit) => audit.action !== 'PUBLISH')).toBe(
        true,
      );
    });

    it('HIST-06 — an ordinary publish supersedes nothing and leaves every prior price standing', async () => {
      const harness = build({});
      await publish(harness, null);

      expect(harness.updates).toEqual([
        {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: null,
        },
      ]);
      // Exactly one audit row, on the successor, with the pre-BP-CORR-01 reason
      // string. A non-correcting publish is byte-for-byte what it always was.
      expect(harness.audits).toEqual([
        {
          basicPriceId: SUCCESSOR_ID,
          action: 'PUBLISH',
          actorAccountId: PUBLISHER_ACCOUNT_ID,
          reason:
            'status:UNPUBLISHED->PUBLISHED; verificationStatus:VERIFIED->PUBLISHED',
        },
      ]);
      // The predecessor lock never even runs — one $queryRaw, not two.
      expect(harness.tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('HIST-08 — a row cannot supersede itself, and it is refused before a single row is read', async () => {
      const harness = build({});
      const service = await makeService(harness.prisma);
      await expect(
        service.publish({
          workspaceId: WORKSPACE_ID,
          basicPriceId: SUCCESSOR_ID,
          publisherAccountId: PUBLISHER_ACCOUNT_ID,
          supersedesBasicPriceId: SUCCESSOR_ID,
        }),
      ).rejects.toThrow('SUPERSESSION_SELF_REFERENCE');
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PREDECESSOR VALIDATION — §13
  // =========================================================================
  describe('PREDECESSOR VALIDATION — server validates, never trusts', () => {
    const refuses = async (
      options: Parameters<typeof build>[0],
      message: string,
      exception: unknown = ConflictException,
    ) => {
      const harness = build(options);
      await expect(publish(harness)).rejects.toBeInstanceOf(exception as any);
      await expect(publish(build(options))).rejects.toThrow(message);
      // NOTHING IS WRITTEN ON ANY REFUSAL. A rejected correction must not leave
      // a half-published successor behind.
      expect(harness.tx.basicPrice.update).not.toHaveBeenCalled();
      expect(
        harness.tx.basicPricePublicationAudit.create,
      ).not.toHaveBeenCalled();
    };

    it('a predecessor outside the caller workspace/organization is plain non-existence, never "forbidden"', async () => {
      await refuses(
        { predecessor: null },
        'SUPERSEDED_BASIC_PRICE_NOT_FOUND',
        NotFoundException,
      );
    });

    it('CUR-02 — an unpublished price was never current, so nothing can replace it', async () => {
      await refuses(
        {
          predecessor: {
            status: 'UNPUBLISHED',
            verificationStatus: 'VERIFIED',
          },
        },
        'SUPERSEDED_BASIC_PRICE_NOT_PUBLISHED',
      );
    });

    it('a merely-VERIFIED predecessor is refused — VERIFIED is not PUBLISHED', async () => {
      await refuses(
        { predecessor: { verificationStatus: 'VERIFIED' } },
        'SUPERSEDED_BASIC_PRICE_NOT_PUBLISHED',
      );
    });

    it('a WORKSPACE_PRIVATE price has its own correction channel and is never superseded here', async () => {
      await refuses(
        { predecessor: { assetScope: 'WORKSPACE_PRIVATE' } },
        'SUPERSEDED_BASIC_PRICE_NOT_CATALOG',
      );
    });

    it('a shared descendant is not this workspace’s to correct', async () => {
      await refuses(
        { predecessor: { promotedFromBasicPriceId: 'origin-elsewhere' } },
        'SUPERSEDED_BASIC_PRICE_IS_SHARED',
      );
    });

    it('CUR-05 — a different resource is not a correction, it is an unrelated price', async () => {
      await refuses(
        { predecessor: { resourceId: 'resource-pasir-99' } },
        'SUPERSESSION_RESOURCE_MISMATCH',
      );
    });

    it('CUR-06 — a different region is not a correction either', async () => {
      await refuses(
        { predecessor: { regionId: 'region-papua-99' } },
        'SUPERSESSION_REGION_MISMATCH',
      );
    });

    it('CUR-06 — a NULL region on one side never matches a real region on the other', async () => {
      await refuses(
        { predecessor: { regionId: null } },
        'SUPERSESSION_REGION_MISMATCH',
      );
    });
  });

  // =========================================================================
  // ONE CURRENT TRUTH / CHAIN LAW — §8, §11
  // =========================================================================
  describe('ONE CURRENT TRUTH', () => {
    it('CUR-04 / HIST-07 — a predecessor may be replaced ONCE; a second successor would fork the chain', async () => {
      const harness = build({
        existingSuccessor: { id: 'bp-other-successor' },
      });
      await expect(publish(harness)).rejects.toThrow(
        'PREDECESSOR_ALREADY_SUPERSEDED',
      );
      expect(harness.tx.basicPrice.update).not.toHaveBeenCalled();
    });

    it('the fork refusal reads from the SUCCESSOR side, so it never depends on a mutable column on the predecessor', async () => {
      const harness = build({
        existingSuccessor: { id: 'bp-other-successor' },
      });
      await expect(publish(harness)).rejects.toThrow(
        'PREDECESSOR_ALREADY_SUPERSEDED',
      );
      expect(harness.tx.basicPrice.findFirst).toHaveBeenCalledWith({
        where: { supersedesBasicPriceId: PREDECESSOR_ID },
        select: { id: true },
      });
    });

    it('CUR-03 — currentness is asked ABOUT OTHER ROWS, never as a flag on this one', () => {
      // Every clause is a question about something ELSE — a successor, an audit
      // row, an origin. Nothing here reads a mutable column on the row being
      // judged, which is exactly why a correction or a withdrawal never has to
      // write to published history.
      const asOf = new Date('2026-08-03T00:00:00.000Z');

      /**
       * BP-UX-FINAL-01D — the row-being-judged still contributes NO mutable
       * column of its own, and reason 1 is now temporal.
       *
       * `supersededBy` carries only the INTEGRITY guard (a successor whose
       * governance record is missing must fail closed); the temporal question
       * moved to `publicationAudits`, which is where the canonical instant
       * actually lives — on the predecessor's own SUPERSEDED audit.
       */
      const untimeableCorrection = expectedSupersededBy(asOf).isNot;
      const originNoLongerCurrent = {
        OR: [
          {
            OR: [
              {
                publicationAudits: {
                  some: { action: 'SUPERSEDED', createdAt: { lte: asOf } },
                },
              },
              {
                AND: [
                  { supersededBy: { isNot: null } },
                  { publicationAudits: { none: { action: 'SUPERSEDED' } } },
                ],
              },
            ],
          },
          {
            publicationAudits: {
              some: { action: 'WITHDRAWN', effectiveAt: { lte: asOf } },
            },
          },
        ],
      };

      expect(basicPriceCurrentnessWhere({ asOf })).toEqual({
        supersededBy: { isNot: untimeableCorrection },
        publicationAudits: {
          none: {
            OR: [
              { action: 'WITHDRAWN', effectiveAt: { lte: asOf } },
              { action: 'SUPERSEDED', createdAt: { lte: asOf } },
            ],
          },
        },
        promotedFrom: { isNot: originNoLongerCurrent },
        AND: [
          {
            OR: [
              { supersedesBasicPriceId: null },
              { verificationStatus: { not: 'UNVERIFIED' } },
              { createdAt: { lte: asOf } },
            ],
          },
        ],
      });
    });

    /**
     * BP-UX-FINAL-01D — REASON 1 IS ANSWERED AT `asOf`, NOT ABSOLUTELY.
     *
     * The defect this kills: `supersededBy: { is: null }` had no date beside
     * it, so a correction published TODAY silently rewrote what SIMPROK would
     * have answered LAST YEAR. Reasons 2 and 3 already took an `asOf`; reason 1
     * did not, and the asymmetry was invisible because the two instants
     * coincide for every present-tense read.
     *
     * The canonical anchor is the PREDECESSOR's own SUPERSEDED audit
     * `createdAt` — the only instant that action has, because schema law states
     * a SUPERSEDED transition "becomes true exactly when it is recorded" and
     * refuses to invent an `effectiveAt` for it.
     */
    it('§4 — the supersession clause compares `asOf` against the RECORDED governance instant', () => {
      const asOf = new Date('2026-03-01T00:00:00.000Z');
      const fragment = basicPriceCurrentnessWhere({ asOf });

      const none = (fragment.publicationAudits as { none: { OR: unknown[] } })
        .none;
      expect(none.OR).toContainEqual({
        action: 'SUPERSEDED',
        createdAt: { lte: asOf },
      });
      // Never a bare `{ action: 'SUPERSEDED' }` in the temporal clause: that
      // would read "corrected at some point, therefore not current then",
      // which is exactly the retroactive rewrite this gate removed.
      expect(none.OR).not.toContainEqual({ action: 'SUPERSEDED' });
    });

    it('§4 — an untimeable correction fails CLOSED at every instant', () => {
      // Pointer present, governance record absent. "No record dated at or
      // before D" would otherwise answer NO forever and offer corrected-away
      // money for the rest of time, so the guard is unconditional — it carries
      // no `asOf` at all, in either direction.
      for (const asOf of [
        new Date('1999-01-01T00:00:00.000Z'),
        new Date('2099-01-01T00:00:00.000Z'),
      ]) {
        const fragment = basicPriceCurrentnessWhere({ asOf });
        expect(fragment.supersededBy).toEqual(expectedSupersededBy(asOf));
        const serialised = JSON.stringify(fragment.supersededBy);
        expect(serialised).toContain('"not":"UNVERIFIED"');
        expect(serialised).toContain('"createdAt"');
      }
    });

    /**
     * C-ASOF-07 — A CORRECTION MADE TODAY MUST NOT REWRITE A COST ALREADY
     * CALCULATED FOR AN EARLIER BUSINESS DATE.
     *
     * The AHSP candidate offer composes this exact fragment with its BUSINESS
     * `asOf` (pinned by CK-03 below). Before 01D the supersession clause ignored
     * that date entirely, so a correction published this morning changed which
     * candidates a resolution dated last March would have been offered — the
     * Cost Kernel's own historical reconstruction, silently rewritten.
     *
     * Now the clause carries whatever instant the caller states, so the offer
     * for March is answered by what governance knew in March.
     */
    it('C-ASOF-07 — a business as-of reaches the correction clause, not just the withdrawal one', () => {
      const businessDate = new Date('2026-03-15T00:00:00.000Z');
      const fragment = basicPriceCurrentnessWhere({ asOf: businessDate });
      const none = (fragment.publicationAudits as { none: { OR: unknown[] } })
        .none;

      // Both verbs answered for the SAME business instant — a resolver that
      // states a date must have every lifecycle rule answered on that date.
      expect(none.OR).toContainEqual({
        action: 'SUPERSEDED',
        createdAt: { lte: businessDate },
      });
      expect(none.OR).toContainEqual({
        action: 'WITHDRAWN',
        effectiveAt: { lte: businessDate },
      });
    });

    it('§4 — a promoted descendant inherits the SAME correction clock as its origin', () => {
      // One law, asked about two rows. If the descendant used a different
      // clause it would follow its origin out of candidacy on a different
      // clock than the origin itself — two shadow engines for one rule.
      const asOf = new Date('2026-03-01T00:00:00.000Z');
      const fragment = basicPriceCurrentnessWhere({ asOf });
      const serialised = JSON.stringify(fragment.promotedFrom);

      expect(serialised).toContain('"SUPERSEDED"');
      expect(serialised).toContain('"createdAt"');
      // And the old absolute form is gone: a bare `supersededBy isNot null`
      // alone would suppress a descendant whose origin is corrected tomorrow.
      expect(fragment.promotedFrom).not.toEqual({
        isNot: {
          OR: [
            { supersededBy: { isNot: null } },
            {
              publicationAudits: {
                some: { action: 'WITHDRAWN', effectiveAt: { lte: asOf } },
              },
            },
          ],
        },
      });
    });

    /**
     * BP-CORR-01B TEMPORAL CORRECTIVE — THE DEFECT THIS TEST EXISTS TO KILL.
     *
     * The first implementation compared the caller's `asOf` against the audit
     * row's `createdAt`. That silently asserted a claim SIMPROK is not entitled
     * to make: that a withdrawal became true at the moment SIMPROK was told
     * about it.
     *
     * Those are two different facts:
     *
     *   createdAt    WHEN WE LEARNED IT      — a system bookkeeping instant.
     *   effectiveAt  WHEN IT BECAME TRUE     — a business/source fact.
     *
     * They often coincide, and the old code was therefore right by accident in
     * the common case. It was wrong in both directions in the cases that matter:
     * a source that states "our July list is withdrawn as of 1 August" and is
     * processed on 5 August would have kept selling the withdrawn price for four
     * days; and a withdrawal announced today but effective next Monday would
     * have removed the price immediately.
     */
    it('§10 — the withdrawal clause compares the caller as-of against EFFECTIVE time, never against recording time', () => {
      const asOf = new Date('2026-03-01T00:00:00.000Z');
      const fragment = basicPriceCurrentnessWhere({ asOf });
      const none = (
        fragment.publicationAudits as {
          none: { OR: Record<string, unknown>[] };
        }
      ).none;

      expect(none.OR).toContainEqual({
        action: 'WITHDRAWN',
        effectiveAt: { lte: asOf },
      });

      /**
       * BP-UX-FINAL-01D NARROWED THIS ASSERTION, AND THE NARROWING IS THE LAW.
       *
       * It used to read `expect(JSON.stringify(fragment)).not.toContain(
       * 'createdAt')` — "bookkeeping is never business truth", stated over the
       * WHOLE fragment. That was right about WITHDRAWN and wrong as a blanket
       * rule, because the two verbs are different kinds of fact:
       *
       *   WITHDRAWN   the SOURCE's claim about the world. It HAS a separate
       *               business instant, the CHECK constraint refuses the row
       *               without one, and reading `createdAt` here would ignore an
       *               instant that exists.
       *   SUPERSEDED  SIMPROK's OWN governance transition. Schema law: it
       *               "becomes true exactly when it is recorded", its
       *               `effectiveAt` is NULL by design, and the migration
       *               refuses to back-fill one because that "would manufacture
       *               a claim nobody made". `createdAt` is the ONLY instant it
       *               has.
       *
       * So the ban stays exactly where it was earned: on the withdrawal clause.
       */
      const withdrawalClause = none.OR.find(
        (member) => member.action === 'WITHDRAWN',
      );
      expect(withdrawalClause).toBeDefined();
      expect(JSON.stringify(withdrawalClause)).not.toContain('createdAt');

      // The lineage clause must carry the SAME as-of against the SAME field. If
      // it did not, a shared restatement would follow its origin out of
      // candidacy on a different clock than the origin itself.
      const lineage = JSON.stringify(fragment.promotedFrom);
      expect(lineage).toContain('"WITHDRAWN"');
      expect(lineage).toContain('"effectiveAt"');
      expect(JSON.parse(lineage)).toEqual({
        isNot: {
          OR: [
            {
              OR: [
                {
                  publicationAudits: {
                    some: {
                      action: 'SUPERSEDED',
                      createdAt: { lte: asOf.toISOString() },
                    },
                  },
                },
                {
                  AND: [
                    { supersededBy: { isNot: null } },
                    { publicationAudits: { none: { action: 'SUPERSEDED' } } },
                  ],
                },
              ],
            },
            {
              publicationAudits: {
                some: {
                  action: 'WITHDRAWN',
                  effectiveAt: { lte: asOf.toISOString() },
                },
              },
            },
          ],
        },
      });
    });

    /**
     * T-05 — A FUTURE-DATED WITHDRAWAL MUST NOT SUPPRESS TOO EARLY.
     *
     * The old code had no way to express this at all: with no as-of it
     * suppressed on the mere EXISTENCE of a WITHDRAWN row, so a withdrawal
     * announced today and effective next Monday removed the price today.
     *
     * Every caller now supplies an instant — a business date where it has one,
     * the present where it does not — so "is this withdrawal in force yet" is
     * always a real comparison rather than an assumption.
     */
    it('T-05 — currentness always compares against a supplied instant; existence of a WITHDRAWN row is never enough on its own', () => {
      const fragment = basicPriceCurrentnessWhere({
        asOf: new Date('2026-08-05T00:00:00.000Z'),
      });
      // Never a bare `{ action: 'WITHDRAWN' }`: that would read "withdrawn at
      // some point, therefore not current now", which is false for a withdrawal
      // that has not taken effect yet.
      const none = (
        fragment.publicationAudits as {
          none: { OR: Record<string, unknown>[] };
        }
      ).none;
      expect(none.OR).not.toContainEqual({ action: 'WITHDRAWN' });
      expect(
        none.OR.find((member) => member.action === 'WITHDRAWN')?.effectiveAt,
      ).toBeDefined();
      // BP-UX-FINAL-01D — and the same discipline now applies to the correction
      // verb: existence of a SUPERSEDED record is never enough on its own
      // either, because it may have been recorded AFTER the instant asked about.
      expect(none.OR).not.toContainEqual({ action: 'SUPERSEDED' });
      expect(
        none.OR.find((member) => member.action === 'SUPERSEDED')?.createdAt,
      ).toBeDefined();
    });

    it('the currentness fragment can only ever REMOVE a row — four keys, no top-level OR/NOT, no scope of its own', () => {
      // Four non-colliding keys. `OR` still belongs to eligibility; `NOT` still
      // belongs to promotion precedence. `AND` is the fourth currentness key
      // (private successor recorded-by-asOf) and callers that also need `AND`
      // must merge rather than overwrite.
      for (const fragment of [
        basicPriceCurrentnessWhere({ asOf: new Date('2026-01-01T00:00:00Z') }),
        basicPriceCurrentnessWhere({ asOf: new Date() }),
      ]) {
        expect(Object.keys(fragment).sort()).toEqual([
          'AND',
          'promotedFrom',
          'publicationAudits',
          'supersededBy',
        ]);
        expect(fragment.OR).toBeUndefined();
        expect(fragment.NOT).toBeUndefined();
      }
      // It must never re-state eligibility. Composing a publication predicate
      // in here would make a selection rule into a permission rule — exactly
      // the mistake BP-CAT-01E corrected for promotion precedence.
      // Scoped to the PREDICATE BODY, never the whole file — see predicateBody.
      expect(predicateBody()).not.toContain('PUBLISHED');
      expect(predicateBody()).not.toContain('assetScope');
      expect(predicateBody()).not.toContain('workspaceId');
      // BP-UX-FINAL-01D — V3: reason 1 became temporal. The version string is
      // part of the contract, so a silent law change fails here first.
      expect(BASIC_PRICE_CURRENTNESS_VERSION).toBe(
        'BPUXFINAL01D_BASIC_PRICE_CURRENTNESS_V3',
      );
    });

    it('BP-DETAIL-MAINT-02 — a private successor is timed by createdAt on the same asOf clock', () => {
      const before = new Date('2026-01-01T00:00:00.000Z');
      const after = new Date('2026-08-27T00:00:00.000Z');
      const earlier = basicPriceCurrentnessWhere({ asOf: before });
      const later = basicPriceCurrentnessWhere({ asOf: after });

      expect(JSON.stringify(earlier.supersededBy)).toContain('"createdAt"');
      expect(JSON.stringify(later.supersededBy)).toContain('"createdAt"');
      expect(JSON.stringify(earlier.supersededBy)).toContain(
        before.toISOString(),
      );
      expect(JSON.stringify(later.supersededBy)).toContain(after.toISOString());
      expect(JSON.stringify(earlier.supersededBy)).not.toContain(
        after.toISOString(),
      );
      expect(predicateBody()).not.toContain('assetScope');
      expect(predicateBody()).not.toContain('PUBLISHED');
    });

    it('PRIVATE-ASOF-01 — an August private successor is not current at a March asOf', () => {
      const march = new Date('2026-03-01T00:00:00.000Z');
      const august = new Date('2026-08-27T00:00:00.000Z');
      const historical = basicPriceCurrentnessWhere({ asOf: march });
      const present = basicPriceCurrentnessWhere({ asOf: august });

      expect(historical.AND).toEqual([
        {
          OR: [
            { supersedesBasicPriceId: null },
            { verificationStatus: { not: 'UNVERIFIED' } },
            { createdAt: { lte: march } },
          ],
        },
      ]);
      expect(present.AND).toEqual([
        {
          OR: [
            { supersedesBasicPriceId: null },
            { verificationStatus: { not: 'UNVERIFIED' } },
            { createdAt: { lte: august } },
          ],
        },
      ]);
      expect(JSON.stringify(historical.AND)).not.toContain(
        august.toISOString(),
      );
      // Origins and catalog successors stay off this bookkeeping clock:
      // they pass via null pointer / not-UNVERIFIED, not via createdAt alone.
      expect(JSON.stringify(historical.AND)).toContain(
        'supersedesBasicPriceId',
      );
      expect(JSON.stringify(historical.AND)).toContain('UNVERIFIED');
    });

    it('PRIVATE-LIFECYCLE-01 — CHECK S2 keeps the private successor discriminator unpromotable', () => {
      const sql = readFileSync(
        join(
          __dirname,
          '..',
          '..',
          'prisma',
          'migrations',
          '20260827180000_bp_detail_maint_02_private_supersession',
          'migration.sql',
        ),
        'utf8',
      );
      expect(sql).toContain('"assetScope" = \'WORKSPACE_PRIVATE\'');
      expect(sql).toContain('"status" = \'UNPUBLISHED\'');
      expect(sql).toContain('"verificationStatus" = \'UNVERIFIED\'');
      expect(sql).toContain(
        '"status" = \'PUBLISHED\' AND "verificationStatus" = \'PUBLISHED\'',
      );
      const publication = readFileSync(
        join(__dirname, 'basic-price-publication.service.ts'),
        'utf8',
      );
      expect(publication).toContain('SUPERSEDED_BASIC_PRICE_NOT_CATALOG');
      const method = readFileSync(
        join(__dirname, 'basic-price-private-asset.service.ts'),
        'utf8',
      ).split('async correctPrivatePrice(')[1];
      expect(method).toBeDefined();
      expect(method).not.toMatch(/^\s*verificationStatus\s*:/m);
      expect(method).not.toMatch(/^\s*status\s*:/m);
    });

    it('PRIVATE-ASOF-01 — mergeCurrentnessAnd keeps the successor clause beside applicability', () => {
      const asOf = new Date('2026-03-01T00:00:00.000Z');
      const merged = mergeCurrentnessAnd(basicPriceCurrentnessWhere({ asOf }), [
        { effectiveDate: { lte: asOf } },
      ]);
      expect(merged.AND).toHaveLength(2);
      expect(merged.AND?.[0]).toEqual({
        OR: [
          { supersedesBasicPriceId: null },
          { verificationStatus: { not: 'UNVERIFIED' } },
          { createdAt: { lte: asOf } },
        ],
      });
      expect(merged.AND?.[1]).toEqual({ effectiveDate: { lte: asOf } });
      expect(merged.OR).toBeUndefined();
      expect(merged.NOT).toBeUndefined();
    });
  });

  // =========================================================================
  // IDEMPOTENCY / CONCURRENCY — §20, §27
  // =========================================================================
  describe('IDEMPOTENCY / CONCURRENCY', () => {
    it('IDEM-01/02 — an exact repeat returns the same successor and writes nothing twice', async () => {
      const harness = build({
        successor: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: PREDECESSOR_ID,
        },
        stateBeforeLock: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: PREDECESSOR_ID,
        },
      });
      await expect(publish(harness)).resolves.toBeDefined();
      expect(harness.tx.basicPrice.update).not.toHaveBeenCalled();
      expect(
        harness.tx.basicPricePublicationAudit.create,
      ).not.toHaveBeenCalled();
    });

    it('IDEM-04 — a repeat naming a DIFFERENT predecessor is refused, never silently accepted', async () => {
      const harness = build({
        successor: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: PREDECESSOR_ID,
        },
        stateBeforeLock: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: PREDECESSOR_ID,
        },
      });
      await expect(publish(harness, 'bp-some-other-price')).rejects.toThrow(
        'SUPERSESSION_ALREADY_SETTLED',
      );
      expect(harness.tx.basicPrice.update).not.toHaveBeenCalled();
    });

    it('IDEM-04 — a settled correction cannot be retracted to "corrects nothing" by republishing', async () => {
      const harness = build({
        successor: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: PREDECESSOR_ID,
        },
        stateBeforeLock: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: PREDECESSOR_ID,
        },
      });
      await expect(publish(harness, null)).rejects.toThrow(
        'SUPERSESSION_ALREADY_SETTLED',
      );
    });

    it('IDEM-01 — an ordinary republish of a non-correcting price stays idempotent (absent == explicitly none)', async () => {
      const harness = build({
        successor: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: null,
        },
        stateBeforeLock: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: null,
        },
      });
      await expect(publish(harness, null)).resolves.toBeDefined();
      expect(harness.tx.basicPrice.update).not.toHaveBeenCalled();
    });

    it('IDEM-03/05 — a concurrent identical correction loses explicitly, with a bounded named conflict and no retry', async () => {
      // The other transaction won the FOR UPDATE and published first, so this
      // one finds the row already terminal while its own pre-lock read had seen
      // it UNPUBLISHED.
      const harness = build({
        successor: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId: PREDECESSOR_ID,
        },
        stateBeforeLock: {
          status: 'UNPUBLISHED',
          verificationStatus: 'VERIFIED',
          supersedesBasicPriceId: null,
        },
      });
      await expect(publish(harness)).rejects.toThrow(
        'PUBLICATION_CONCURRENTLY_COMPLETED',
      );
      expect(harness.tx.basicPrice.update).not.toHaveBeenCalled();
    });

    it('IDEM-06 — there is no retry, backoff or reschedule anywhere on the correction path', () => {
      const source = readFileSync(
        join(__dirname, 'basic-price-publication.service.ts'),
        'utf8',
      );
      expect(source).not.toMatch(/setTimeout|setInterval|retry|backoff/i);
    });
  });

  // =========================================================================
  // PROMOTION INTERACTION — §16, §25
  // =========================================================================
  describe('PROMOTION INTERACTION', () => {
    const promotion = readFileSync(
      join(__dirname, 'basic-price-promotion.service.ts'),
      'utf8',
    );

    it('PROMO-02 — correction never rewrites promotion lineage: the write block cannot touch promotedFromBasicPriceId', () => {
      const publication = readFileSync(
        join(__dirname, 'basic-price-publication.service.ts'),
        'utf8',
      );
      // Scoped to the WRITE, not the whole file: the service legitimately READS
      // this column (to refuse correcting a shared row), and a whole-file match
      // would fail on that read — which is the opposite of the risk.
      const start = publication.indexOf('await tx.basicPrice.update({');
      const end = publication.indexOf(
        'await tx.basicPricePublicationAudit.create({',
        start,
      );
      expect(start).toBeGreaterThan(-1);
      expect(publication.slice(start, end)).not.toContain(
        'promotedFromBasicPriceId',
      );
      expect(publication).toContain('SUPERSEDED_BASIC_PRICE_IS_SHARED');
    });

    it('PROMO-03/04 — a corrected successor is never auto-shared: the correction path creates no BasicPrice at all', () => {
      const publication = readFileSync(
        join(__dirname, 'basic-price-publication.service.ts'),
        'utf8',
      );
      expect(publication).not.toMatch(/\.basicPrice\.create\s*\(/);
    });

    /**
     * PROVED BY BEHAVIOUR, NOT BY A STRING MATCH.
     *
     * An earlier version of this case asserted only that the source contained
     * 'BASIC_PRICE_SUPERSEDED'. A mutation that neutered the guard's CONDITION
     * while leaving the throw in place did not kill it — the test failed open,
     * which is the one thing a lock may never do. It now runs the real service
     * against a scripted transaction, so the guard has to actually refuse.
     */
    const buildPromotion = (options: { supersededBy?: unknown }) => {
      const ORIGIN = 'bp-origin-01';
      const created: Array<Record<string, unknown>> = [];
      let txFindFirst = 0;
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: ORIGIN,
            assetScope: 'SIMPROK_CATALOG',
            status: 'PUBLISHED',
            verificationStatus: 'PUBLISHED',
          },
        ]),
        basicPrice: {
          // Call 1 = the promotion-lineage re-read (not yet promoted).
          // Call 2 = BP-CORR-01's "has this origin been corrected away" read.
          findFirst: jest.fn(() => {
            txFindFirst += 1;
            return Promise.resolve(
              txFindFirst === 1 ? null : (options.supersededBy ?? null),
            );
          }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            resourceId: 'res-1',
            value: '78000.00',
            sourceType: 'REGULATION',
          }),
          create: jest.fn((args: { data: Record<string, unknown> }) => {
            created.push(args.data);
            return Promise.resolve({ id: 'shared-1', ...args.data });
          }),
        },
        basicPricePublicationAudit: { create: jest.fn() },
      };
      const prisma = {
        workspaceMembership: {
          findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
        },
        workspace: {
          findUnique: jest.fn().mockResolvedValue({ organizationId: ORG_ID }),
        },
        basicPrice: { findFirst: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      };
      return { tx, prisma, created, ORIGIN };
    };

    const promote = async (harness: ReturnType<typeof buildPromotion>) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BasicPricePromotionService,
          { provide: PrismaService, useValue: harness.prisma },
        ],
      }).compile();
      return module.get(BasicPricePromotionService).promoteToSharedCatalog({
        workspaceId: WORKSPACE_ID,
        basicPriceId: harness.ORIGIN,
        actorAccountId: PUBLISHER_ACCOUNT_ID,
      });
    };

    it('PROMO-06 — a superseded origin is REFUSED admission into shared knowledge, and nothing is created', async () => {
      const harness = buildPromotion({
        supersededBy: { id: 'bp-successor-01' },
      });
      await expect(promote(harness)).rejects.toThrow('BASIC_PRICE_SUPERSEDED');
      // The old money must not reach the national catalog after the correction
      // that replaced it.
      expect(harness.created).toEqual([]);
      expect(harness.tx.basicPrice.create).not.toHaveBeenCalled();
      expect(
        harness.tx.basicPricePublicationAudit.create,
      ).not.toHaveBeenCalled();
    });

    it('PROMO-06 — a CURRENT origin is still promoted exactly as before, so the guard narrows nothing else', async () => {
      const harness = buildPromotion({});
      const result = await promote(harness);
      expect(result).toMatchObject({ created: true });
      expect(harness.created).toHaveLength(1);
      // And the descendant still carries the origin's money verbatim.
      expect(harness.created[0]).toMatchObject({
        promotedFromBasicPriceId: harness.ORIGIN,
        workspaceId: null,
      });
    });

    it('PROMO-06 — the refusal reads from the successor side, never from a flag on the origin', () => {
      expect(promotion).toContain(
        'where: { supersedesBasicPriceId: basicPriceId }',
      );
    });

    it('PROMO-01/05 — a shared descendant never inherits the correction pointer, so the two lineages stay disjoint', () => {
      const inherited =
        promotion
          .split('INHERITED_SOURCE_FACTS = {')[1]
          ?.split('} as const')[0] ?? '';
      expect(inherited).not.toContain('supersedesBasicPriceId');
      expect(inherited).toContain('value: true');
    });
  });

  // =========================================================================
  // COST KERNEL / HISTORICAL TRUTH — §18, §19, §26
  // =========================================================================
  describe('COST KERNEL — historical money survives supersession', () => {
    const read = (relative: string) =>
      readFileSync(join(__dirname, '..', relative), 'utf8');

    it('CK-01/CK-02 — the Cost Kernel re-read stays raw-lawful and never composes currentness', () => {
      const persistence = read('project/rab-kernel-persistence.service.ts');
      // A resolution persisted against a price that has since been superseded
      // must still re-read THAT EXACT ROW and still prove its provenance.
      // Composing the currentness fragment here would invalidate every
      // historical calculation the moment a correction was published.
      expect(persistence).toContain('usableWhere(params.workspaceId)');
      expect(persistence).not.toContain('basicPriceCurrentnessWhere');
    });

    it('CK-04 — nothing rewrites a persisted selectedBasicPriceId', () => {
      const walk = (dir: string): string[] =>
        readdirSync(dir)
          .sort()
          .flatMap((name) => {
            const path = join(dir, name);
            return statSync(path).isDirectory()
              ? walk(path)
              : name.endsWith('.ts') && !name.endsWith('.spec.ts')
                ? [path]
                : [];
          });
      const writers = walk(join(__dirname, '..')).filter((file) => {
        const code = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/[^\n]*/g, '');
        return (
          /projectAhspResourceResolution\.(update|updateMany|upsert)\s*\(/.test(
            code,
          ) && /selectedBasicPriceId/.test(code)
        );
      });
      expect(writers).toEqual([]);
    });

    it('CK-03 — a NEW resolution asks the current question: the candidate offer composes currentness, its re-read does not', () => {
      const orchestrator = read(
        'project-ahsp/ahsp-resource-resolution.orchestrator.ts',
      );
      const offer = orchestrator.split('const resolutions:')[0];
      const reread = orchestrator.split('const selectedCandidate =')[1] ?? '';
      // §10 — the AHSP offer HAS a business as-of date, so it must pass it. A
      // bare call here would answer a historical question with wall-clock
      // "today", which is precisely what the Cost Kernel must never do.
      expect(offer).toContain('basicPriceCurrentnessWhere({ asOf })');
      expect(offer).toContain('mergeCurrentnessAnd');
      expect(reread).not.toContain('basicPriceCurrentnessWhere');
    });

    it('the by-id read stays raw-lawful, so a superseded price remains fully readable as history', () => {
      const service = read('basic-price/basic-price.service.ts');
      const findOne = service.split('async findOneForWorkspace')[1] ?? '';
      const byId = findOne.split('}')[0] + findOne.split('async ')[0];
      expect(findOne).toContain('usableWhere(workspaceId)');
      expect(byId).not.toContain('basicPriceCurrentnessWhere');
      const list = service.split('async findAllForWorkspace')[1] ?? '';
      expect(list).toContain('mergeCurrentnessAnd');
    });
  });

  // =========================================================================
  // CORRECTION vs NEW OBSERVATION — §21
  // =========================================================================
  describe('CORRECTION IS NOT TEMPORAL EVOLUTION', () => {
    it('CUR-08 — supersession is never inferred from a later date, an equal resource or a moved value', () => {
      // The whole condition is exact-id lineage. If any of these ever appear in
      // the executable fragment, SIMPROK has started guessing that a March
      // observation proves the January one was wrong.
      for (const heuristic of [
        'effectiveDate',
        'value',
        'resourceId',
        'sourceOrigin',
        'orderBy',
      ]) {
        expect(predicateBody()).not.toContain(heuristic);
      }

      /**
       * BP-UX-FINAL-01D — THE TWO DATES, EACH WHERE IT BELONGS.
       *
       * This used to assert `createdAt` was absent from the predicate ENTIRELY.
       * That was the right ban stated too widely. `createdAt` standing in for a
       * WITHDRAWAL's effective point was the BP-CORR-01B defect — a bookkeeping
       * timestamp answering a claim the source had dated itself. But a
       * SUPERSEDED transition has no separate business instant to ignore:
       * schema law says it "becomes true exactly when it is recorded" and the
       * migration refuses to back-fill an `effectiveAt` for it, because doing so
       * "would manufacture a claim nobody made".
       *
       * So each verb is now pinned to the one instant it actually owns, and the
       * cross-wiring — the real defect in either direction — is what fails.
       */
      const body = predicateBody();
      expect(body).toContain('effectiveAt: { lte: asOf }');
      expect(body).toContain('createdAt: { lte: asOf }');

      const clauseOf = (helper: string) =>
        (body.split(`const ${helper}`)[1] ?? '').split('});')[0];

      const withdrawnClause = clauseOf('withdrawnAudit');
      expect(withdrawnClause).toContain('effectiveAt: { lte: asOf }');
      expect(withdrawnClause).not.toContain('createdAt');

      const supersededClause = clauseOf('supersededAudit');
      expect(supersededClause).toContain('createdAt: { lte: asOf }');
      expect(supersededClause).not.toContain('effectiveAt');
    });

    it('CUR-08 — a genuine later observation publishes with no predecessor and both prices stay lawful', async () => {
      const harness = build({});
      await publish(harness, null);
      expect(harness.updates[0].supersedesBasicPriceId).toBeNull();
      // No SUPERSEDED audit anywhere: nothing was declared wrong.
      expect(
        harness.audits.some((audit) => audit.action === 'SUPERSEDED'),
      ).toBe(false);
    });
  });

  // =========================================================================
  // BP-CORR-01B GAP B — WITHDRAWAL WITHOUT REPLACEMENT — §14
  // =========================================================================
  describe('WITHDRAWAL WITHOUT REPLACEMENT', () => {
    const WITHDRAWN_ID = 'bp-withdrawn-01';

    const buildWithdrawal = (
      options: {
        price?: Record<string, unknown> | null;
        existingAudit?: unknown;
        membership?: unknown;
      } = {},
    ) => {
      const price =
        options.price === null
          ? null
          : {
              id: WITHDRAWN_ID,
              status: 'PUBLISHED',
              verificationStatus: 'PUBLISHED',
              assetScope: 'SIMPROK_CATALOG',
              ...(options.price ?? {}),
            };
      const audits: Array<Record<string, unknown>> = [];
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue(price === null ? [] : [price]),
        basicPrice: {
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          deleteMany: jest.fn(),
        },
        basicPricePublicationAudit: {
          findFirst: jest.fn().mockResolvedValue(options.existingAudit ?? null),
          create: jest.fn((args: { data: Record<string, unknown> }) => {
            audits.push(args.data);
            return Promise.resolve({ id: 'audit-1', ...args.data });
          }),
        },
      };
      const prisma = {
        workspaceMembership: {
          findFirst: jest
            .fn()
            .mockResolvedValue(
              options.membership === undefined
                ? { id: 'm1' }
                : options.membership,
            ),
        },
        workspace: {
          findUnique: jest.fn().mockResolvedValue({ organizationId: ORG_ID }),
        },
        $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      };
      return { tx, prisma, audits };
    };

    const withdraw = async (
      harness: ReturnType<typeof buildWithdrawal>,
      overrides: Record<string, unknown> = {},
    ) => {
      const service = await makeService(harness.prisma);
      return service.withdraw({
        workspaceId: WORKSPACE_ID,
        basicPriceId: WITHDRAWN_ID,
        actorAccountId: PUBLISHER_ACCOUNT_ID,
        reason: 'Supplier retracted the published list',
        ...overrides,
      });
    };

    it('W-02/W-11/W-12 — withdrawal appends ONE governance record and touches no BasicPrice at all', async () => {
      const harness = buildWithdrawal();
      const result = await withdraw(harness);

      expect(result).toMatchObject({ created: true });
      expect(harness.audits).toHaveLength(1);
      expect(harness.audits[0]).toMatchObject({
        basicPriceId: WITHDRAWN_ID,
        action: 'WITHDRAWN',
        actorAccountId: PUBLISHER_ACCOUNT_ID,
        reason: 'Supplier retracted the published list',
      });
      // T-06 — the fallback. No effective time was supplied, so the governed
      // decision instant is recorded. It is NEVER left null: a null would fail
      // OPEN in the currentness projection and the withdrawal would govern
      // nothing.
      expect(harness.audits[0].effectiveAt).toBeInstanceOf(Date);

      // W-11 — NO FAKE SUCCESSOR. Inventing a price to represent absence would
      // put a number in the catalog nobody ever observed.
      expect(harness.tx.basicPrice.create).not.toHaveBeenCalled();
      // W-04 — and no mutation of the published fact.
      expect(harness.tx.basicPrice.update).not.toHaveBeenCalled();
      // W-12 — and nothing is deleted.
      expect(harness.tx.basicPrice.delete).not.toHaveBeenCalled();
      expect(harness.tx.basicPrice.deleteMany).not.toHaveBeenCalled();
    });

    it('T-06 — an explicitly stated effective time is persisted EXACTLY, never replaced by the recording instant', async () => {
      const harness = buildWithdrawal();
      const stated = new Date('2026-08-01T00:00:00.000Z');
      await withdraw(harness, { effectiveAt: stated });
      expect(harness.audits[0].effectiveAt).toEqual(stated);
    });

    it('T-05 — a FUTURE effective time is believed exactly as given; the writer never clamps it to now', async () => {
      const harness = buildWithdrawal();
      const nextMonday = new Date('2099-01-04T00:00:00.000Z');
      await withdraw(harness, { effectiveAt: nextMonday });
      expect(harness.audits[0].effectiveAt).toEqual(nextMonday);
    });

    it('T-11 — a replay naming a DIFFERENT effective time is a conflict, never silently idempotent', async () => {
      const harness = buildWithdrawal({
        existingAudit: {
          id: 'audit-existing',
          action: 'WITHDRAWN',
          effectiveAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      });
      await expect(
        withdraw(harness, {
          effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow('WITHDRAWAL_ALREADY_SETTLED');
      expect(
        harness.tx.basicPricePublicationAudit.create,
      ).not.toHaveBeenCalled();
    });

    it('T-11 — a replay naming the SAME effective time stays idempotent', async () => {
      const stated = new Date('2026-08-01T00:00:00.000Z');
      const harness = buildWithdrawal({
        existingAudit: {
          id: 'audit-existing',
          action: 'WITHDRAWN',
          effectiveAt: stated,
        },
      });
      const result = await withdraw(harness, { effectiveAt: stated });
      expect(result).toMatchObject({ created: false });
      expect(
        harness.tx.basicPricePublicationAudit.create,
      ).not.toHaveBeenCalled();
    });

    it('W-08 — replay is idempotent: the second call writes no second record', async () => {
      const harness = buildWithdrawal({
        existingAudit: { id: 'audit-existing', action: 'WITHDRAWN' },
      });
      const result = await withdraw(harness);
      expect(result).toMatchObject({ created: false });
      expect(
        harness.tx.basicPricePublicationAudit.create,
      ).not.toHaveBeenCalled();
    });

    it('W-09 — a price in another tenant is plain non-existence', async () => {
      const harness = buildWithdrawal({ price: null });
      await expect(withdraw(harness)).rejects.toBeInstanceOf(NotFoundException);
      expect(
        harness.tx.basicPricePublicationAudit.create,
      ).not.toHaveBeenCalled();
    });

    it('W-10 — the actor must be a live human in this workspace; identity is never taken from the caller', async () => {
      const harness = buildWithdrawal({ membership: null });
      await expect(withdraw(harness)).rejects.toThrow(
        'WITHDRAWER_NOT_ACTIVE_IN_WORKSPACE',
      );
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('only PUBLISHED truth can be withdrawn — an unpublished row was never offered', async () => {
      const harness = buildWithdrawal({
        price: { status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' },
      });
      await expect(withdraw(harness)).rejects.toThrow(
        'BASIC_PRICE_NOT_PUBLISHED',
      );
      expect(
        harness.tx.basicPricePublicationAudit.create,
      ).not.toHaveBeenCalled();
    });

    it('a WORKSPACE_PRIVATE price is not withdrawable through the catalog lifecycle', async () => {
      const harness = buildWithdrawal({
        price: { assetScope: 'WORKSPACE_PRIVATE' },
      });
      await expect(withdraw(harness)).rejects.toThrow(
        'PRIVATE_BASIC_PRICE_NOT_WITHDRAWABLE',
      );
    });

    it('a withdrawal must carry a stated human reason', async () => {
      const harness = buildWithdrawal();
      await expect(withdraw(harness, { reason: '   ' })).rejects.toThrow(
        'WITHDRAW_REASON_REQUIRED',
      );
      await expect(withdraw(harness, { reason: '' })).rejects.toThrow(
        'WITHDRAW_REASON_REQUIRED',
      );
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('W-10 — there is no actor default: an empty actor is refused before anything is read', async () => {
      const harness = buildWithdrawal();
      await expect(withdraw(harness, { actorAccountId: '' })).rejects.toThrow(
        'WITHDRAW_ACTOR_REQUIRED',
      );
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('§15 — no production HTTP route exposes withdrawal, and no new controller was created', () => {
      const controller = readFileSync(
        join(__dirname, 'basic-price-publication.controller.ts'),
        'utf8',
      );
      expect(controller).not.toContain('withdraw');
      expect(
        readdirSync(__dirname).filter((name) => /withdraw/i.test(name)),
      ).toEqual([]);
    });

    it('the withdrawal writer never fabricates a PUBLISH, SUPERSEDED or PROMOTE_SHARED audit', async () => {
      const harness = buildWithdrawal();
      await withdraw(harness);
      const actions = harness.audits.map((audit) => audit.action);
      expect(actions).toEqual(['WITHDRAWN']);
      for (const forged of ['PUBLISH', 'SUPERSEDED', 'PROMOTE_SHARED']) {
        expect(actions).not.toContain(forged);
      }
    });
  });

  // =========================================================================
  // MIGRATION — §29
  // =========================================================================
  describe('MIGRATION is additive and history-preserving', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'prisma',
        'migrations',
        '20260826120000_bpcorr01_published_price_supersession',
        'migration.sql',
      ),
      'utf8',
    );

    it('HIST-01/06 — no backfill, no rewrite, no destructive DDL; legacy rows keep NULL', () => {
      for (const destructive of [
        'DROP TABLE',
        'DROP COLUMN',
        'DELETE FROM',
        'TRUNCATE',
        'UPDATE "basic_prices"',
        'NOT NULL',
      ]) {
        expect(sql).not.toContain(destructive);
      }
      expect(sql).toContain('ADD COLUMN "supersedesBasicPriceId" UUID');
    });

    it('CUR-04 — ONE current truth is a database fact, not an application convention', () => {
      expect(sql).toContain(
        'CREATE UNIQUE INDEX "basic_prices_supersedesBasicPriceId_key"',
      );
    });

    it('HIST-05 — a superseded predecessor cannot be deleted out from under its successor', () => {
      expect(sql).toContain('ON DELETE RESTRICT');
      expect(sql).not.toContain('ON DELETE CASCADE');
    });

    it('HIST-08 — self-supersession is unrepresentable', () => {
      expect(sql).toContain('basic_prices_supersession_not_self_check');
    });

    it('CUR-02 — an unpublished proposal cannot carry the pointer, so it cannot drop a predecessor out of candidacy', () => {
      expect(sql).toContain(
        'basic_prices_supersession_successor_is_published_check',
      );
    });

    it('PROMO-02 — the promotion and correction lineages are kept disjoint by the database', () => {
      expect(sql).toContain('basic_prices_supersession_not_promoted_row_check');
    });
  });
});

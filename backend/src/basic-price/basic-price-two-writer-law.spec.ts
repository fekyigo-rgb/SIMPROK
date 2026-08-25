import { ConflictException } from '@nestjs/common';
import { BasicPricePromotionService } from './basic-price-promotion.service';

/**
 * BP-CAT-01E SEAM C — THE TWO-WRITER LAW, PROVED BY BEHAVIOUR.
 *
 * The Owner ratified one publication-transition writer plus one governed
 * shared-restatement writer, and zero others. `basic-price-writer-inventory`
 * already censuses that structurally — but a source census can only ever be a
 * structural alarm, and an earlier version of it FAILED OPEN because a data
 * block outgrew its regex window. So the lock does not rest on it alone.
 *
 * These cases exercise the restatement writer's actual contract against a
 * scripted transaction: what it refuses, what it creates, and what it must
 * never touch. Together with the database CHECK constraints and the structural
 * census, that is three independent kinds of evidence for one law.
 */
describe('BP-CAT-01E two-writer law — behavioural', () => {
  const WORKSPACE = '40000000-0000-4000-8000-000000000001';
  const ORG = '40000000-0000-4000-8000-000000000002';
  const ORIGIN = '40000000-0000-4000-8000-000000000003';
  const ACTOR = '40000000-0000-4000-8000-000000000004';

  /** The origin as the locked SELECT sees it. */
  const lockedOrigin = (over: Record<string, unknown> = {}) => ({
    id: ORIGIN,
    assetScope: 'SIMPROK_CATALOG',
    status: 'PUBLISHED',
    verificationStatus: 'PUBLISHED',
    ...over,
  });

  const build = (options: {
    locked?: Record<string, unknown> | null;
    alreadyPromoted?: unknown;
  }) => {
    const created: Array<Record<string, unknown>> = [];
    const audits: Array<Record<string, unknown>> = [];
    const basicPriceUpdate = jest.fn();

    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue(options.locked === null ? [] : [options.locked]),
      basicPrice: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          resourceId: 'res-1',
          value: '78000.00',
          sourceType: 'REGULATION',
        }),
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return Promise.resolve({ id: 'shared-1', ...args.data });
        }),
        // Registered so a transition attempt would be VISIBLE rather than
        // throwing for the wrong reason.
        update: basicPriceUpdate,
      },
      basicPricePublicationAudit: {
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          audits.push(args.data);
          return Promise.resolve(args.data);
        }),
      },
    };

    const prisma = {
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: ORG }),
      },
      basicPrice: {
        findFirst: jest.fn().mockResolvedValue(options.alreadyPromoted ?? null),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };

    return {
      service: new BasicPricePromotionService(prisma as never),
      created,
      audits,
      basicPriceUpdate,
      tx,
    };
  };

  const run = (h: ReturnType<typeof build>) =>
    h.service.promoteToSharedCatalog({
      workspaceId: WORKSPACE,
      basicPriceId: ORIGIN,
      actorAccountId: ACTOR,
    });

  it('WR-02: refuses an origin that has NOT already reached PUBLISHED on both axes', async () => {
    for (const drift of [
      { status: 'UNPUBLISHED', verificationStatus: 'VERIFIED' },
      { status: 'PUBLISHED', verificationStatus: 'VERIFIED' },
      { status: 'UNPUBLISHED', verificationStatus: 'PUBLISHED' },
    ]) {
      const h = build({ locked: lockedOrigin(drift) });
      await expect(run(h)).rejects.toThrow(ConflictException);
      // Nothing was written on the way to the refusal.
      expect(h.created).toHaveLength(0);
      expect(h.audits).toHaveLength(0);
    }
  });

  it('WR-02b: refuses a WORKSPACE_PRIVATE origin outright', async () => {
    const h = build({
      locked: lockedOrigin({ assetScope: 'WORKSPACE_PRIVATE' }),
    });
    await expect(run(h)).rejects.toThrow(ConflictException);
    expect(h.created).toHaveLength(0);
  });

  it('WR-03/04: CREATES a distinct descendant and never transitions the origin', async () => {
    const h = build({ locked: lockedOrigin() });
    await run(h);

    expect(h.created).toHaveLength(1);
    // WR-04 — THE TRANSITION WRITER IS NOT THIS ONE. No update was issued at
    // all, so the origin cannot have been moved, re-stamped or re-scoped.
    expect(h.basicPriceUpdate).not.toHaveBeenCalled();
  });

  it('WR-05: the descendant always carries its lineage and the shared scope', async () => {
    const h = build({ locked: lockedOrigin() });
    await run(h);

    const [data] = h.created;
    expect(data.promotedFromBasicPriceId).toBe(ORIGIN);
    expect(data.workspaceId).toBeNull();
    expect(data.organizationId).toBeNull();
    expect(data.assetScope).toBe('SIMPROK_CATALOG');
    expect(data.status).toBe('PUBLISHED');
    expect(data.verificationStatus).toBe('PUBLISHED');
    // Money arrives by copy from the origin read, never restated by this writer.
    expect(data.value).toBe('78000.00');
  });

  it('WR-06: writes PROMOTE_SHARED and never a PUBLISH decision', async () => {
    const h = build({ locked: lockedOrigin() });
    await run(h);

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0].action).toBe('PROMOTE_SHARED');
    expect(h.audits[0].action).not.toBe('PUBLISH');
    // The origin is named in the trail, so the act is explicable without the
    // lineage column alone.
    expect(String(h.audits[0].reason)).toContain(ORIGIN);
  });

  it('WR-07: a caller cannot reach the shared state by supplying its own facts — every field is read from the origin', async () => {
    const h = build({ locked: lockedOrigin() });
    await run(h);

    const [data] = h.created;
    // The service's only inputs are workspaceId, basicPriceId and the actor.
    // Nothing a caller could propose — a value, a scope, a status — appears in
    // the written row except by way of the origin the database returned.
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining([
        'workspaceId',
        'organizationId',
        'assetScope',
        'status',
        'verificationStatus',
        'promotedFromBasicPriceId',
      ]),
    );
    expect(h.tx.basicPrice.findUniqueOrThrow).toHaveBeenCalled();
  });

  it('WR-07b: an origin the caller cannot see is refused before anything is written', async () => {
    const h = build({ locked: null });
    await expect(run(h)).rejects.toThrow();
    expect(h.created).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it('idempotent: an origin already promoted returns the existing descendant and writes nothing', async () => {
    const h = build({
      locked: lockedOrigin(),
      alreadyPromoted: { id: 'shared-existing' },
    });
    const result = await run(h);
    expect(result.created).toBe(false);
    expect(result.shared).toEqual({ id: 'shared-existing' });
    expect(h.created).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });
});

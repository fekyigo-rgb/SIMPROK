import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';

describe('BP-ONE-TRUTH-01 — exact source-document replay offers', () => {
  const ws = '10000000-0000-4000-8000-000000000004';
  const date = (s: string) => new Date(s + 'T00:00:00.000Z');
  const row = (
    id: string,
    day: string,
    amount = '150000',
    docKey = 'sha:A489B144:sheet:BASIC_PRICE_READY:row:80',
    kdnPercent: string | null = null,
  ) => ({ id, effectiveDate: date(day), amount, docKey, kdnPercent });

  const run = async (
    docs: ReturnType<typeof row>[],
    options: {
      eligibleIds?: string[];
      manualPairs?: {
        predecessorId: string;
        descendantId: string;
        depth: number;
      }[];
      manualEligibleAt?: string;
    } = {},
  ) => {
    const calls: unknown[] = [];
    const db = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce(options.manualPairs ?? [])
        .mockResolvedValueOnce(docs),
      basicPrice: {
        findMany: jest.fn((args: { where: { id: { in: string[] } } }) => {
          calls.push(args);
          if (options.manualPairs && calls.length === 1) {
            return options.manualEligibleAt
              ? [
                  {
                    id: options.manualPairs[0].descendantId,
                    effectiveDate: date(options.manualEligibleAt),
                  },
                ]
              : [];
          }
          const eligible = options.eligibleIds ?? docs.map((r) => r.id);
          return args.where.id.in
            .filter((id) => eligible.includes(id))
            .map((id) => ({ id }));
        }),
      },
    };
    const omitted = await BasicPriceService.olderSameSourceObservationOfferIds(
      db as never,
      new BasicPriceEligibilityPolicy(),
      ws,
      date('2026-10-10'),
      {},
    );
    return { omitted, db };
  };

  it('three different import dates of the exact same document row yield one offer', async () => {
    const docs = [
      row('original', '2026-08-26'),
      row('reimport-01', '2026-09-01'),
      row('reimport-02', '2026-09-02'),
    ];
    const { omitted, db } = await run(docs);
    expect(new Set(omitted)).toEqual(new Set(['original', 'reimport-01']));
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('never merges different prices or an independently proven document key', async () => {
    const differingPrices = [
      row('p150', '2026-09-02', '150000'),
      row('p167', '2026-09-02', '167000'),
    ];
    expect((await run(differingPrices)).omitted).toEqual([]);
    const distinctFiles = [
      row('doc-a', '2026-09-01', '150000', 'sha:A:row:80'),
      row('doc-b', '2026-09-02', '150000', 'sha:B:row:80'),
    ];
    expect((await run(distinctFiles)).omitted).toEqual([]);
  });

  it('does not mistake conflicting KDN percentages for the same offer', async () => {
    const docs = [
      row('kdn10', '2026-08-26', '150000', 'same-doc', '10'),
      row('kdn40', '2026-09-02', '150000', 'same-doc', '40'),
    ];
    expect((await run(docs)).omitted).toEqual([]);
  });

  it('keeps older evidence if the most recent replay is no longer eligible', async () => {
    const docs = [row('original', '2026-08-26'), row('later', '2026-09-02')];
    expect((await run(docs, { eligibleIds: ['original'] })).omitted).toEqual(
      [],
    );
  });

  it('a later eligible same-source observation closes every replay, never rewriting any', async () => {
    const docs = [
      row('original', '2026-08-26'),
      row('reimport-01', '2026-09-01'),
      row('reimport-02', '2026-09-02'),
    ];
    const manualPairs = [
      { predecessorId: 'original', descendantId: 'latest', depth: 2 },
    ];
    const { omitted } = await run(docs, {
      manualPairs,
      manualEligibleAt: '2026-09-30',
    });
    expect(new Set(omitted)).toEqual(
      new Set(['original', 'reimport-01', 'reimport-02']),
    );
  });
});

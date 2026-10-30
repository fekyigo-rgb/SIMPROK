import {
  buildProvenPriceHistory,
  type ProvenHistoryRow,
} from './basic-price-proven-history';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const audit = (prior: number) => [
  {
    before: {
      semantic: 'NEW_OBSERVATION',
      observedAfterBasicPriceId: id(prior),
    },
    after: { semantic: 'NEW_OBSERVATION', sameSourceIdentity: true },
  },
];
const row = (
  n: number,
  options: Partial<ProvenHistoryRow> = {},
): ProvenHistoryRow => ({
  id: id(n),
  workspaceId: 'workspace-a',
  assetScope: 'WORKSPACE_PRIVATE',
  recordsNewObservation: n > 0,
  sourceOrigin: 'FIELD_REPORT',
  sourceType: 'FIELD_REPORT',
  resourceId: 'resource-m59',
  regionId: 'region-ambon',
  regionCoverageSetId: null,
  supersedesBasicPriceId: null,
  createdAt: new Date(Date.UTC(2026, 9, n + 1)),
  effectiveDate: new Date(Date.UTC(2026, 9, n + 1)),
  price: String(1550000 + n * 20000) + '.00',
  sourceName: 'Tim Simprok',
  provenanceCorrections: [],
  ...options,
});

describe('BP-HISTORY-ONE-TRUTH — Backend owns the UI event meaning', () => {
  it('M59: new observation is Diperbarui, previous price remains Harga Awal', () => {
    const old = row(0, { price: '1550000.00' });
    const latest = row(1, {
      price: '1750000.00',
      sourceName: null,
      provenanceCorrections: audit(0),
    });
    const history = buildProvenPriceHistory(latest.id, [old, latest]);
    expect(history.truncated).toBe(false);
    expect(
      history.entries.map((e) => [e.price, e.changeLabel, e.actionLabel]),
    ).toEqual([
      ['1750000.00', 'Terkini', 'Diperbarui'],
      ['1550000.00', 'Harga Awal', 'Harga Awal'],
    ]);
    expect(history.entries[0].sourceName).toBe('Tim Simprok');
    expect(history.entries[0].recordedAt).toBe(latest.createdAt.toISOString());
  });

  it('twelve proven observations: always newest first, only one Harga Awal', () => {
    const rows: ProvenHistoryRow[] = [row(0)];
    for (let n = 1; n <= 12; n += 1) {
      rows.push(
        row(n, { sourceName: null, provenanceCorrections: audit(n - 1) }),
      );
    }
    const history = buildProvenPriceHistory(id(12), rows.reverse());
    expect(history.entries).toHaveLength(13);
    expect(history.entries[0].price).toBe(row(12).price);
    expect(history.entries[0].changeLabel).toBe('Terkini');
    expect(
      history.entries.slice(1, -1).every((e) => e.changeLabel === 'Diperbarui'),
    ).toBe(true);
    expect(history.entries.at(-1)?.changeLabel).toBe('Harga Awal');
    expect(
      history.entries.filter((e) => e.actionLabel === 'Harga Awal'),
    ).toHaveLength(1);
    expect(history.entries.every((e) => e.sourceName === 'Tim Simprok')).toBe(
      true,
    );
  });

  it('explicit correction keeps its separate meaning, not an update', () => {
    const origin = row(0);
    const later = row(1, { provenanceCorrections: audit(0) });
    const corrected = row(2, {
      supersedesBasicPriceId: later.id,
      effectiveDate: later.effectiveDate, // correction retains the prior business date
      sourceName: null,
    });
    const result = buildProvenPriceHistory(corrected.id, [
      origin,
      corrected,
      later,
    ]);
    expect(result.entries.map((e) => e.actionLabel)).toEqual([
      'Dikoreksi',
      'Diperbarui',
      'Harga Awal',
    ]);
  });

  it('unrelated same-resource, same-source price is NOT smuggled into history', () => {
    const old = row(0);
    const independent = row(1, { price: old.price });
    expect(
      buildProvenPriceHistory(independent.id, [old, independent]).entries,
    ).toHaveLength(1);
  });

  it('observation of a DIFFERENT source must not reuse its predecessor chain', () => {
    const old = row(0);
    const different = row(1, {
      sourceName: 'Supplier Baru',
      provenanceCorrections: [
        {
          before: {
            semantic: 'NEW_OBSERVATION',
            observedAfterBasicPriceId: old.id,
          },
          after: { semantic: 'NEW_OBSERVATION', sameSourceIdentity: false },
        },
      ],
    });
    const result = buildProvenPriceHistory(different.id, [old, different]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].actionLabel).toBe('Harga Awal');
    expect(result.entries[0].sourceName).toBe('Supplier Baru');
  });

  it('cross-workspace or cross-region provenance is NOT traversed', () => {
    const origin = row(0);
    const intruder = row(1, {
      workspaceId: 'workspace-b',
      provenanceCorrections: audit(0),
    });
    const result = buildProvenPriceHistory(intruder.id, [origin, intruder]);
    expect(result.entries).toHaveLength(1);
    expect(result.truncated).toBe(true);
    const wrongRegion = row(1, {
      regionId: 'region-other',
      provenanceCorrections: audit(0),
    });
    expect(
      buildProvenPriceHistory(wrongRegion.id, [origin, wrongRegion]).entries,
    ).toHaveLength(1);
    const wrongOrigin = row(1, {
      sourceOrigin: 'COMMUNITY_REPORT',
      provenanceCorrections: audit(0),
    });
    const originResult = buildProvenPriceHistory(wrongOrigin.id, [
      origin,
      wrongOrigin,
    ]);
    // The canonical same-source writer permits a change in observation
    // method/origin while preserving the identity through exact audit links.
    expect(originResult.entries).toHaveLength(2);
    expect(originResult.truncated).toBe(false);
  });

  it('a predecessor outside the read boundary is not fabricated as Harga Awal', () => {
    const newer = row(1, { provenanceCorrections: audit(0) });
    const result = buildProvenPriceHistory(newer.id, [newer]);
    expect(result.truncated).toBe(true);
    expect(result.entries[0].actionLabel).toBe('Diperbarui');
    expect(result.entries.map((e) => e.actionLabel)).not.toContain(
      'Harga Awal',
    );
  });

  it('a capped result missing its anchor admits an incomplete read, never claims empty history', () => {
    const origin = row(0);
    const result = buildProvenPriceHistory(origin.id, [row(7)], true);
    expect(result.entries).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });

  it('a broken cycle is bounded, never a hanging request', () => {
    const a = row(0, { supersedesBasicPriceId: id(1) });
    const b = row(1, {
      supersedesBasicPriceId: id(0),
      effectiveDate: a.effectiveDate,
    });
    const result = buildProvenPriceHistory(a.id, [a, b]);
    expect(result.entries).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});

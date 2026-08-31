import {
  BASIC_PRICE_HISTORY_MAX_GENERATIONS,
  buildSupersessionTimeline,
  type SupersessionLineageRow,
} from './basic-price-history';

/**
 * BP-UX-FINAL-01D — CORRECTION LINEAGE, FROM EXACT PERSISTED POINTERS.
 *
 * The freshness layer and the Detail tab both show a timeline. The danger with
 * a timeline is not that it will be empty — it is that it will be PLAUSIBLE:
 * same resource, similar dates, descending values, and completely invented.
 * These tests exist mostly to prove the negatives.
 *
 * AND ONE MORE NEGATIVE, ADDED BY 01D: that a BOUNDED read never claims to be a
 * complete one. `truncated` is the flag that keeps the label honest, so it is
 * tested in both directions — false when the chain really does end, true when
 * the answer stops with a predecessor still named.
 */
type Row = SupersessionLineageRow & { value: string };

const row = (id: string, supersedes: string | null, value = '0'): Row => ({
  id,
  supersedesBasicPriceId: supersedes,
  value,
});

describe('buildSupersessionTimeline', () => {
  it('D1 — a price that has never been corrected is its own whole history', () => {
    const only = row('a', null, '62500.00');
    const { entries: timeline } = buildSupersessionTimeline('a', [only]);

    expect(timeline).toEqual([{ row: only, state: 'CURRENT' }]);
  });

  it('D2 — one exact predecessor yields current + one superseded, newest first', () => {
    const older = row('a', null, '61000.00');
    const newer = row('b', 'a', '62500.00');

    const { entries: timeline } = buildSupersessionTimeline('b', [
      older,
      newer,
    ]);

    expect(timeline.map((entry) => [entry.row.id, entry.state])).toEqual([
      ['b', 'CURRENT'],
      ['a', 'SUPERSEDED'],
    ]);
  });

  it('D3 — a multi-generation chain is deterministic, newest to oldest', () => {
    const g1 = row('g1', null);
    const g2 = row('g2', 'g1');
    const g3 = row('g3', 'g2');
    const g4 = row('g4', 'g3');

    // Row order from the database must not change the answer.
    const { entries: timeline } = buildSupersessionTimeline('g4', [
      g3,
      g1,
      g4,
      g2,
    ]);

    expect(timeline.map((entry) => entry.row.id)).toEqual([
      'g4',
      'g3',
      'g2',
      'g1',
    ]);
    expect(timeline.map((entry) => entry.state)).toEqual([
      'CURRENT',
      'SUPERSEDED',
      'SUPERSEDED',
      'SUPERSEDED',
    ]);
  });

  it('opening a PREDECESSOR shows the whole story, not a truncated one', () => {
    // `GET /basic-prices/:id` is a lawfulness question, so a superseded price
    // stays readable. A person who opens one must see what replaced it —
    // otherwise the oldest price in a chain reads as the last word.
    const g1 = row('g1', null);
    const g2 = row('g2', 'g1');
    const g3 = row('g3', 'g2');

    const { entries: timeline } = buildSupersessionTimeline('g1', [g1, g2, g3]);

    expect(timeline.map((entry) => entry.row.id)).toEqual(['g3', 'g2', 'g1']);
    expect(timeline[0].state).toBe('CURRENT');
    expect(timeline[2].state).toBe('SUPERSEDED');
  });

  /* ── The negatives: what must NEVER become history ─────────────────────── */

  it('D4 — same value is NOT lineage', () => {
    const a = row('a', null, '62500.00');
    const b = row('b', null, '62500.00');

    // Two independent observations that happen to cost the same are two
    // different truths. Neither names the other, so neither is the other's past.
    expect(buildSupersessionTimeline('a', [a, b]).entries).toEqual([
      { row: a, state: 'CURRENT' },
    ]);
  });

  it('D4 — merely sharing the fetch scope is NOT lineage', () => {
    // The caller fetches by (resourceId, regionId) because the database proves
    // that is a SUPERSET of the chain. Membership is decided ONLY by pointers,
    // so unrelated rows in the same context are silently ignored.
    const anchor = row('anchor', null);
    const noise = [row('n1', null), row('n2', null), row('n3', null)];

    const { entries: timeline } = buildSupersessionTimeline('anchor', [
      anchor,
      ...noise,
    ]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].row.id).toBe('anchor');
  });

  it('D4 — a chain in a DIFFERENT logical context is never joined', () => {
    // Two separate chains can coexist in one fetch. Following pointers keeps
    // them apart; a date-ordered "history" would have interleaved them.
    const x1 = row('x1', null);
    const x2 = row('x2', 'x1');
    const y1 = row('y1', null);
    const y2 = row('y2', 'y1');

    expect(
      buildSupersessionTimeline('x2', [x1, x2, y1, y2]).entries.map(
        (e) => e.row.id,
      ),
    ).toEqual(['x2', 'x1']);
    expect(
      buildSupersessionTimeline('y2', [x1, x2, y1, y2]).entries.map(
        (e) => e.row.id,
      ),
    ).toEqual(['y2', 'y1']);
  });

  it('SUPERSEDED is never inferred from age or order', () => {
    // The newest row by any ordering is still CURRENT only because nothing
    // points at it. A predecessor carries no mark of its own — the successor
    // holds the entire relationship — so state must come from the pointer map.
    const lonelyOld = row('old', null);
    expect(buildSupersessionTimeline('old', [lonelyOld]).entries[0].state).toBe(
      'CURRENT',
    );
  });

  /* ── Safety: bounded, and never a hang ─────────────────────────────────── */

  it('D7 — an anchor the caller may not read yields NO history, not a partial one', () => {
    expect(
      buildSupersessionTimeline('missing', [row('a', null)]).entries,
    ).toEqual([]);
  });

  it('a pointer to an unreadable row stops the walk instead of skipping it', () => {
    // An honest short history beats a timeline with an invisible hole in it.
    const b = row('b', 'a-not-readable');
    const { entries: timeline } = buildSupersessionTimeline('b', [b]);

    expect(timeline.map((entry) => entry.row.id)).toEqual(['b']);
  });

  it('a cycle — unreachable in the database — still terminates', () => {
    // `basic_prices_supersession_not_self_check` plus publish-order monotonicity
    // make this state unrepresentable. The guard exists so an impossible state
    // degrades into a bounded answer rather than a stalled request.
    const a = row('a', 'b');
    const b = row('b', 'a');

    const { entries: timeline } = buildSupersessionTimeline('a', [a, b]);

    expect(timeline.length).toBeLessThanOrEqual(2);
    expect(new Set(timeline.map((entry) => entry.row.id)).size).toBe(
      timeline.length,
    );
  });

  it('a chain longer than the ceiling is truncated, never unbounded', () => {
    const rows: Row[] = [];
    const length = BASIC_PRICE_HISTORY_MAX_GENERATIONS + 25;
    for (let index = 0; index < length; index += 1) {
      rows.push(row(`g${index}`, index === 0 ? null : `g${index - 1}`));
    }

    const { entries: timeline } = buildSupersessionTimeline(
      `g${length - 1}`,
      rows,
    );

    expect(timeline.length).toBeLessThanOrEqual(
      BASIC_PRICE_HISTORY_MAX_GENERATIONS,
    );
    expect(timeline[0].row.id).toBe(`g${length - 1}`);
  });

  /* ── 01D: the bounded read must admit that it is bounded ──────────────── */

  it('H1 — no predecessor: one entry, and NOT truncated', () => {
    const timeline = buildSupersessionTimeline('a', [row('a', null)]);

    expect(timeline.entries).toHaveLength(1);
    // The lineage genuinely ends here. Reporting truncation would push the UI
    // onto "Riwayat Koreksi Terbaru" and imply a hidden older correction that
    // does not exist — an invented absence is as false as an invented fact.
    expect(timeline.truncated).toBe(false);
  });

  it('H2 — one predecessor, fully read: NOT truncated', () => {
    const a = row('a', null);
    const b = row('b', 'a');

    expect(buildSupersessionTimeline('b', [a, b]).truncated).toBe(false);
  });

  it('H3 — several predecessors, fully read: NOT truncated', () => {
    const rows = [
      row('g1', null),
      row('g2', 'g1'),
      row('g3', 'g2'),
      row('g4', 'g3'),
    ];

    expect(buildSupersessionTimeline('g4', rows).truncated).toBe(false);
  });

  it('H4/H5 — a chain deeper than the generation bound reports truncated', () => {
    const rows: Row[] = [];
    const length = BASIC_PRICE_HISTORY_MAX_GENERATIONS + 25;
    for (let index = 0; index < length; index += 1) {
      rows.push(row(`g${index}`, index === 0 ? null : `g${index - 1}`));
    }

    const timeline = buildSupersessionTimeline(`g${length - 1}`, rows);

    expect(timeline.entries.length).toBeLessThanOrEqual(
      BASIC_PRICE_HISTORY_MAX_GENERATIONS,
    );
    // The walk stopped with the oldest emitted row still naming a predecessor,
    // which is exactly the fact `truncated` reports. Nothing is estimated: no
    // count of what was missed is claimed, because none can be known.
    expect(timeline.truncated).toBe(true);
  });

  it('H6 — a predecessor the caller may not read also reports truncated', () => {
    // Same consequence for the person reading the screen: there is more chain
    // than is shown. The unreadable id is never returned, only the fact.
    const timeline = buildSupersessionTimeline('b', [
      row('b', 'a-not-readable'),
    ]);

    expect(timeline.entries.map((entry) => entry.row.id)).toEqual(['b']);
    expect(timeline.truncated).toBe(true);
  });

  it('H6 — an unreadable ANCHOR is not truncation, it is absence', () => {
    // Nothing was cut short because nothing was read. Reporting truncation
    // here would describe a lineage the caller was never entitled to see.
    expect(buildSupersessionTimeline('missing', [row('a', null)])).toEqual({
      entries: [],
      truncated: false,
    });
  });

  it('H9 — a fetch full of unrelated rows never inflates the lineage', () => {
    // The bound is a way to read fewer rows, never a membership rule. Two
    // hundred unrelated observations of the same resource+region leave a
    // never-corrected price with exactly one entry and no truncation claim.
    const anchor = row('anchor', null);
    const noise = Array.from({ length: 250 }, (_unused, index) =>
      row(`n${index}`, null),
    );

    const timeline = buildSupersessionTimeline('anchor', [anchor, ...noise]);

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.truncated).toBe(false);
  });

  it('D8 — building a timeline mutates nothing it was given', () => {
    const a = row('a', null);
    const b = row('b', 'a');
    const input = [a, b];
    const snapshot = JSON.stringify(input);

    buildSupersessionTimeline('b', input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

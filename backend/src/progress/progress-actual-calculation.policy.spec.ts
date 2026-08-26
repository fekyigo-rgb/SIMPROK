import { ProgressActualStatus } from '@prisma/client';
import {
  isProgressActualCalculationEligible,
  selectCurrentCalculationLineageLeaves,
} from './progress-actual-calculation.policy';

interface ActualCandidate {
  id: string;
  supersedesEntryId: string | null;
  status: ProgressActualStatus;
}

const actual = (
  id: string,
  status: ProgressActualStatus,
  supersedesEntryId: string | null = null,
): ActualCandidate => ({ id, supersedesEntryId, status });

const currentEligibleFacts = (
  entries: readonly ActualCandidate[],
): readonly ActualCandidate[] => {
  const selection = selectCurrentCalculationLineageLeaves(entries);
  return selection.state === 'VALID'
    ? selection.leaves.filter((entry) =>
        isProgressActualCalculationEligible(entry.status),
      )
    : [];
};

describe('official Actual calculation status eligibility', () => {
  it.each([
    [ProgressActualStatus.LEGACY_UNSPECIFIED, false],
    [ProgressActualStatus.RECORDED, false],
    [ProgressActualStatus.SUBMITTED, false],
    [ProgressActualStatus.VERIFIED, true],
    [ProgressActualStatus.ACCEPTED, true],
    [ProgressActualStatus.RETURNED_FOR_CORRECTION, false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isProgressActualCalculationEligible(status)).toBe(expected);
  });

  it('fails closed for an unknown runtime status', () => {
    const hostileStatus =
      'UNKNOWN_RUNTIME_STATUS' as unknown as ProgressActualStatus;

    expect(isProgressActualCalculationEligible(hostileStatus)).toBe(false);
  });
});

describe('current official calculation lineage selection', () => {
  it('treats an empty candidate set as valid with no leaves', () => {
    expect(selectCurrentCalculationLineageLeaves([])).toEqual({
      state: 'VALID',
      leaves: [],
    });
  });

  it('selects one eligible ACCEPTED root when it has no successor', () => {
    const r1 = actual('r1', ProgressActualStatus.ACCEPTED);

    expect(selectCurrentCalculationLineageLeaves([r1])).toEqual({
      state: 'VALID',
      leaves: [r1],
    });
    expect(currentEligibleFacts([r1])).toEqual([r1]);
  });

  it('never falls back from an ACCEPTED predecessor to a SUBMITTED successor', () => {
    const r1 = actual('r1', ProgressActualStatus.ACCEPTED);
    const r2 = actual('r2', ProgressActualStatus.SUBMITTED, 'r1');

    expect(selectCurrentCalculationLineageLeaves([r1, r2])).toEqual({
      state: 'VALID',
      leaves: [r2],
    });
    expect(currentEligibleFacts([r1, r2])).toEqual([]);
  });

  it('never falls back from a VERIFIED predecessor to a SUBMITTED successor', () => {
    const r1 = actual('r1', ProgressActualStatus.VERIFIED);
    const r2 = actual('r2', ProgressActualStatus.SUBMITTED, 'r1');

    expect(selectCurrentCalculationLineageLeaves([r1, r2])).toEqual({
      state: 'VALID',
      leaves: [r2],
    });
    expect(currentEligibleFacts([r1, r2])).toEqual([]);
  });

  it('selects a VERIFIED successor instead of its ACCEPTED predecessor', () => {
    const r1 = actual('r1', ProgressActualStatus.ACCEPTED);
    const r2 = actual('r2', ProgressActualStatus.VERIFIED, 'r1');

    expect(selectCurrentCalculationLineageLeaves([r1, r2])).toEqual({
      state: 'VALID',
      leaves: [r2],
    });
    expect(currentEligibleFacts([r1, r2])).toEqual([r2]);
  });

  it('selects only an ACCEPTED successor over its ACCEPTED predecessor', () => {
    const r1 = actual('r1', ProgressActualStatus.ACCEPTED);
    const r2 = actual('r2', ProgressActualStatus.ACCEPTED, 'r1');

    expect(selectCurrentCalculationLineageLeaves([r1, r2])).toEqual({
      state: 'VALID',
      leaves: [r2],
    });
    expect(currentEligibleFacts([r1, r2])).toEqual([r2]);
  });

  it('returns no eligible fact for a long chain ending SUBMITTED', () => {
    const entries = [
      actual('r1', ProgressActualStatus.ACCEPTED),
      actual('r2', ProgressActualStatus.VERIFIED, 'r1'),
      actual('r3', ProgressActualStatus.ACCEPTED, 'r2'),
      actual('r4', ProgressActualStatus.SUBMITTED, 'r3'),
    ];

    expect(selectCurrentCalculationLineageLeaves(entries)).toEqual({
      state: 'VALID',
      leaves: [entries[3]],
    });
    expect(currentEligibleFacts(entries)).toEqual([]);
  });

  it('selects the final VERIFIED fact in a long correction chain', () => {
    const entries = [
      actual('r1', ProgressActualStatus.ACCEPTED),
      actual('r2', ProgressActualStatus.SUBMITTED, 'r1'),
      actual('r3', ProgressActualStatus.VERIFIED, 'r2'),
    ];

    expect(selectCurrentCalculationLineageLeaves(entries)).toEqual({
      state: 'VALID',
      leaves: [entries[2]],
    });
    expect(currentEligibleFacts(entries)).toEqual([entries[2]]);
  });

  it('preserves historical input while excluding every superseded predecessor', () => {
    const r1 = actual('r1', ProgressActualStatus.ACCEPTED);
    const r2 = actual('r2', ProgressActualStatus.SUBMITTED, 'r1');
    const history = [r1, r2];

    const selection = selectCurrentCalculationLineageLeaves(history);

    expect(history).toEqual([r1, r2]);
    expect(selection).toEqual({ state: 'VALID', leaves: [r2] });
    expect(currentEligibleFacts(history)).toEqual([]);
  });

  it('keeps one leaf per independent lineage and preserves leaf input order', () => {
    const a1 = actual('a1', ProgressActualStatus.ACCEPTED);
    const a2 = actual('a2', ProgressActualStatus.VERIFIED, 'a1');
    const b1 = actual('b1', ProgressActualStatus.VERIFIED);
    const b2 = actual('b2', ProgressActualStatus.SUBMITTED, 'b1');
    const entries = [b1, a2, a1, b2];

    expect(selectCurrentCalculationLineageLeaves(entries)).toEqual({
      state: 'VALID',
      leaves: [a2, b2],
    });
    expect(currentEligibleFacts(entries)).toEqual([a2]);
  });

  it('fails closed on a self-reference', () => {
    expect(
      selectCurrentCalculationLineageLeaves([
        actual('a', ProgressActualStatus.ACCEPTED, 'a'),
      ]),
    ).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'SELF_REFERENCE',
      leaves: [],
    });
  });

  it('fails closed on a cycle', () => {
    expect(
      selectCurrentCalculationLineageLeaves([
        actual('a', ProgressActualStatus.ACCEPTED, 'c'),
        actual('b', ProgressActualStatus.VERIFIED, 'a'),
        actual('c', ProgressActualStatus.SUBMITTED, 'b'),
      ]),
    ).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'CYCLE',
      leaves: [],
    });
  });

  it('treats a falsy non-null string as an opaque ID when detecting a cycle', () => {
    expect(
      selectCurrentCalculationLineageLeaves([
        actual('', ProgressActualStatus.ACCEPTED, 'b'),
        actual('b', ProgressActualStatus.VERIFIED, ''),
      ]),
    ).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'CYCLE',
      leaves: [],
    });
  });

  it('fails closed when a referenced predecessor is missing', () => {
    expect(
      selectCurrentCalculationLineageLeaves([
        actual('b', ProgressActualStatus.VERIFIED, 'missing-a'),
      ]),
    ).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'MISSING_PREDECESSOR',
      leaves: [],
    });
  });

  it('fails closed on duplicate entry IDs', () => {
    expect(
      selectCurrentCalculationLineageLeaves([
        actual('a', ProgressActualStatus.ACCEPTED),
        actual('a', ProgressActualStatus.VERIFIED),
      ]),
    ).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'DUPLICATE_ID',
      leaves: [],
    });
  });

  it('fails closed when a predecessor has multiple direct children', () => {
    expect(
      selectCurrentCalculationLineageLeaves([
        actual('a', ProgressActualStatus.ACCEPTED),
        actual('b', ProgressActualStatus.VERIFIED, 'a'),
        actual('c', ProgressActualStatus.SUBMITTED, 'a'),
      ]),
    ).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'MULTIPLE_DIRECT_CHILDREN',
      leaves: [],
    });
  });

  it('uses current-lineage truth rather than effectiveEntry legitimacy ranking', () => {
    const acceptedPredecessor = actual(
      'accepted-predecessor',
      ProgressActualStatus.ACCEPTED,
    );
    const verifiedLeaf = actual(
      'verified-leaf',
      ProgressActualStatus.VERIFIED,
      acceptedPredecessor.id,
    );

    expect(
      selectCurrentCalculationLineageLeaves([
        acceptedPredecessor,
        verifiedLeaf,
      ]),
    ).toEqual({ state: 'VALID', leaves: [verifiedLeaf] });
    expect(currentEligibleFacts([acceptedPredecessor, verifiedLeaf])).toEqual([
      verifiedLeaf,
    ]);
  });

  it('does not mutate the input array or entry objects', () => {
    const r1 = Object.freeze(actual('r1', ProgressActualStatus.ACCEPTED));
    const r2 = Object.freeze(actual('r2', ProgressActualStatus.VERIFIED, 'r1'));
    const entries = Object.freeze([r1, r2]);

    expect(selectCurrentCalculationLineageLeaves(entries)).toEqual({
      state: 'VALID',
      leaves: [r2],
    });
    expect(entries).toEqual([r1, r2]);
  });
});

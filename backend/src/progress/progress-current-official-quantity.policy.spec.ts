import {
  Prisma,
  ProgressActualStatus,
  ProgressAuditOutcome,
} from '@prisma/client';
import {
  calculateCurrentOfficialQuantity,
  type Law1CalculationEntry,
} from './progress-current-official-quantity.policy';
import {
  MON04_SEMANTIC_AUDIT_ACTION,
  MON04_SEMANTIC_POLICY_VERSION,
  MON04_SEMANTIC_ATTESTATION_TYPE,
  MON04_SEMANTIC_CONTEXT_VERSION,
  type ProgressSemanticContextScope,
} from './progress-semantic-authority.policy';
import { PROGRESS_AUTHORITIES } from './progress-authority.service';
import { createHash } from 'node:crypto';

describe('MON-04 LAW 1: Current Official Quantity Policy', () => {
  const scope: ProgressSemanticContextScope = {
    projectId: 'p-1',
    activeBaselineId: 'b-1',
    boqItemId: 'item-1',
  };

  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, value]) => value !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, canonicalize(value)]),
      );
    }
    return input;
  };

  const stableDigest = (value: unknown): string =>
    createHash('sha256')
      .update(JSON.stringify(canonicalize(value)))
      .digest('hex');

  const createProvenEvent = (
    entries: Law1CalculationEntry[],
    leafIds: string[],
  ) => {
    const contextDigest = stableDigest({
      policyVersion: MON04_SEMANTIC_POLICY_VERSION,
      attestationType: MON04_SEMANTIC_ATTESTATION_TYPE,
      contextVersion: MON04_SEMANTIC_CONTEXT_VERSION,
      scope,
      relevantEntries: entries
        .map((entry) => ({
          id: entry.id,
          supersedesEntryId: entry.supersedesEntryId,
          installedQuantity: entry.installedQuantity.toString(),
          workDate: entry.workDate?.toISOString() ?? null,
          captureMethod: entry.captureMethod,
          evidenceReferences: entry.evidenceReferences,
          notes: entry.notes,
          correctionReasonCode: entry.correctionReasonCode,
          correctionReason: entry.correctionReason,
          recordedByAccountId: entry.recordedByAccountId,
          revision: entry.revision,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      currentLeafIds: [...leafIds].sort(),
    });

    return {
      action: MON04_SEMANTIC_AUDIT_ACTION,
      outcome: ProgressAuditOutcome.SUCCESS,
      occurredAt: new Date(),
      actorAccountId: 'actor-1',
      authorityCode: PROGRESS_AUTHORITIES.VERIFY,
      metadata: {
        policyVersion: MON04_SEMANTIC_POLICY_VERSION,
        attestationType: MON04_SEMANTIC_ATTESTATION_TYPE,
        contextVersion: MON04_SEMANTIC_CONTEXT_VERSION,
        activeBaselineId: scope.activeBaselineId,
        boqItemId: scope.boqItemId,
        contextDigest,
        currentLeafIds: [...leafIds].sort(),
        explicitConfirmation: true,
      },
    };
  };

  const createEntry = (
    overrides: Partial<Law1CalculationEntry>,
  ): Law1CalculationEntry => ({
    id: 'e-1',
    supersedesEntryId: null,
    installedQuantity: '4',
    workDate: new Date('2026-08-01T00:00:00Z'),
    status: ProgressActualStatus.VERIFIED,
    captureMethod: 'MANUAL',
    evidenceReferences: [],
    notes: null,
    correctionReasonCode: null,
    correctionReason: null,
    recordedByAccountId: 'actor-1',
    revision: 1,
    auditEvents: [],
    ...overrides,
  });

  const setupProvenEntry = (
    entry: Law1CalculationEntry,
  ): Law1CalculationEntry => {
    return {
      ...entry,
      auditEvents: [createProvenEvent([entry], [entry.id])],
    };
  };

  it('T1: no Actual -> NOT_YET_RECORDED', () => {
    expect(calculateCurrentOfficialQuantity(scope, [])).toEqual({
      state: 'NOT_YET_RECORDED',
    });
  });

  it('T2: VERIFIED PROVEN 4 -> COMPLETE(4)', () => {
    let entry = createEntry({
      status: ProgressActualStatus.VERIFIED,
      installedQuantity: '4',
    });
    entry = setupProvenEntry(entry);

    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal('4'),
    });
  });

  it('T3: ACCEPTED PROVEN 4 -> COMPLETE(4)', () => {
    let entry = createEntry({
      status: ProgressActualStatus.ACCEPTED,
      installedQuantity: '4',
    });
    entry = setupProvenEntry(entry);

    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal('4'),
    });
  });

  it('T4: ACCEPTED -> SUBMITTED correction -> NO_ELIGIBLE_CURRENT_FACT', () => {
    const predecessor = createEntry({
      id: 'e-1',
      status: ProgressActualStatus.ACCEPTED,
    });
    const successor = createEntry({
      id: 'e-2',
      supersedesEntryId: 'e-1',
      status: ProgressActualStatus.SUBMITTED,
    });

    // Lineage context will select successor as leaf.
    expect(
      calculateCurrentOfficialQuantity(scope, [predecessor, successor]),
    ).toEqual({
      state: 'NO_ELIGIBLE_CURRENT_FACT',
    });
  });

  it('T5: VERIFIED -> SUBMITTED correction -> NO_ELIGIBLE_CURRENT_FACT', () => {
    const predecessor = createEntry({
      id: 'e-1',
      status: ProgressActualStatus.VERIFIED,
    });
    const successor = createEntry({
      id: 'e-2',
      supersedesEntryId: 'e-1',
      status: ProgressActualStatus.SUBMITTED,
    });

    expect(
      calculateCurrentOfficialQuantity(scope, [predecessor, successor]),
    ).toEqual({
      state: 'NO_ELIGIBLE_CURRENT_FACT',
    });
  });

  it('T6: PROVEN zero -> COMPLETE(0)', () => {
    let entry = createEntry({
      status: ProgressActualStatus.VERIFIED,
      installedQuantity: '0',
    });
    entry = setupProvenEntry(entry);

    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal('0'),
    });
  });

  it('T7: independent proven 3 + 4 -> COMPLETE(7)', () => {
    const e1 = createEntry({ id: 'e-1', installedQuantity: '3' });
    const e2 = createEntry({ id: 'e-2', installedQuantity: '4' });
    const provenEvent = createProvenEvent([e1, e2], ['e-1', 'e-2']);

    const e1Proven = { ...e1, auditEvents: [provenEvent] };
    const e2Proven = { ...e2, auditEvents: [provenEvent] };

    expect(
      calculateCurrentOfficialQuantity(scope, [e1Proven, e2Proven]),
    ).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal('7'),
    });
  });

  it('T8: long correction chain', () => {
    const e1 = createEntry({
      id: 'e-1',
      status: ProgressActualStatus.SUBMITTED,
    });
    const e2 = createEntry({
      id: 'e-2',
      supersedesEntryId: 'e-1',
      status: ProgressActualStatus.RETURNED_FOR_CORRECTION,
    });
    const e3 = createEntry({
      id: 'e-3',
      supersedesEntryId: 'e-2',
      status: ProgressActualStatus.VERIFIED,
      installedQuantity: '10',
    });

    const e3Proven = setupProvenEntry(e3);
    const provenEvent = createProvenEvent([e1, e2, e3], ['e-3']);
    e3Proven.auditEvents = [provenEvent];

    expect(calculateCurrentOfficialQuantity(scope, [e1, e2, e3Proven])).toEqual(
      {
        state: 'COMPLETE',
        currentOfficialQuantity: new Prisma.Decimal('10'),
      },
    );
  });

  it('T9: multiple independent lineages', () => {
    const e1 = createEntry({ id: 'e-1', installedQuantity: '2' });
    const e2 = createEntry({
      id: 'e-2',
      supersedesEntryId: 'e-1',
      installedQuantity: '3',
    }); // Lineage 1 leaf: e-2 (3)

    const e3 = createEntry({ id: 'e-3', installedQuantity: '5' }); // Lineage 2 leaf: e-3 (5)

    const provenEvent = createProvenEvent([e1, e2, e3], ['e-2', 'e-3']);
    const e2Proven = { ...e2, auditEvents: [provenEvent] };
    const e3Proven = { ...e3, auditEvents: [provenEvent] };

    expect(
      calculateCurrentOfficialQuantity(scope, [e1, e2Proven, e3Proven]),
    ).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal('8'),
    });
  });

  it('T10: VERIFIED PROVEN 3 + distinct SUBMITTED current root 4 -> INCOMPLETE subtotal 3', () => {
    const e1 = createEntry({
      id: 'e-1',
      installedQuantity: '3',
      status: ProgressActualStatus.VERIFIED,
    });
    const e2 = createEntry({
      id: 'e-2',
      installedQuantity: '4',
      status: ProgressActualStatus.SUBMITTED,
    });

    // Proven event only covers e-1 as eligible, but context includes both as leaves.
    // Wait, the semantic context hashes ALL relevant entries and current leaves.
    // So the semantic proof must match the EXACT context (both leaves).
    const provenEvent = createProvenEvent([e1, e2], ['e-1', 'e-2']);
    const e1Proven = { ...e1, auditEvents: [provenEvent] };

    expect(calculateCurrentOfficialQuantity(scope, [e1Proven, e2])).toEqual({
      state: 'INCOMPLETE',
      knownEligibleQuantitySubtotal: new Prisma.Decimal('3'),
    });
  });

  it('T11: semantic NOT_PROVEN -> SEMANTICS_UNPROVEN', () => {
    const entry = createEntry({
      status: ProgressActualStatus.VERIFIED,
      installedQuantity: '4',
      auditEvents: [],
    });
    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'SEMANTICS_UNPROVEN',
    });
  });

  it('T12: semantic STALE -> SEMANTICS_UNPROVEN', () => {
    const entry = createEntry({
      id: 'e-1',
      status: ProgressActualStatus.VERIFIED,
    });
    // Make proof for just e-1
    const staleProvenEvent = createProvenEvent([entry], ['e-1']);

    // Now add another entry, making the old proof stale for the new context
    const e2 = createEntry({ id: 'e-2', installedQuantity: '2' });
    const entryWithStaleProof = { ...entry, auditEvents: [staleProvenEvent] };

    expect(
      calculateCurrentOfficialQuantity(scope, [entryWithStaleProof, e2]),
    ).toEqual({
      state: 'SEMANTICS_UNPROVEN', // For e-1 because its proof is stale
    });
  });

  it('T13: semantic INVALID_PROVENANCE -> SEMANTICS_UNPROVEN', () => {
    const entry = createEntry({
      id: 'e-1',
      status: ProgressActualStatus.VERIFIED,
    });
    const badEvent = {
      action: MON04_SEMANTIC_AUDIT_ACTION,
      outcome: ProgressAuditOutcome.SUCCESS,
      occurredAt: new Date(),
      actorAccountId: 'actor-1',
      authorityCode: PROGRESS_AUTHORITIES.VERIFY,
      metadata: { bogus: true }, // Invalid metadata shape
    };
    const entryWithBadProof = { ...entry, auditEvents: [badEvent] };

    expect(
      calculateCurrentOfficialQuantity(scope, [entryWithBadProof]),
    ).toEqual({
      state: 'SEMANTICS_UNPROVEN',
    });
  });

  it('T14: self-reference -> INVALID_LINEAGE', () => {
    const entry = createEntry({ id: 'e-1', supersedesEntryId: 'e-1' });
    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'SELF_REFERENCE',
    });
  });

  it('T15: cycle -> INVALID_LINEAGE', () => {
    const e1 = createEntry({ id: 'e-1', supersedesEntryId: 'e-2' });
    const e2 = createEntry({ id: 'e-2', supersedesEntryId: 'e-1' });
    expect(calculateCurrentOfficialQuantity(scope, [e1, e2])).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'CYCLE',
    });
  });

  it('T16: missing predecessor -> INVALID_LINEAGE', () => {
    const entry = createEntry({ id: 'e-1', supersedesEntryId: 'missing' });
    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'MISSING_PREDECESSOR',
    });
  });

  it('T17: multiple direct children -> INVALID_LINEAGE', () => {
    const root = createEntry({ id: 'root' });
    const child1 = createEntry({ id: 'c1', supersedesEntryId: 'root' });
    const child2 = createEntry({ id: 'c2', supersedesEntryId: 'root' });
    expect(
      calculateCurrentOfficialQuantity(scope, [root, child1, child2]),
    ).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'MULTIPLE_DIRECT_CHILDREN',
    });
  });

  it('T18: duplicate ID -> INVALID_LINEAGE', () => {
    const e1 = createEntry({ id: 'e-1' });
    expect(calculateCurrentOfficialQuantity(scope, [e1, e1])).toEqual({
      state: 'INVALID_LINEAGE',
      reason: 'DUPLICATE_ID',
    });
  });

  it('T19: negative current quantity -> INVALID_NUMERIC_FACT', () => {
    const entry = createEntry({ installedQuantity: '-5' });
    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'INVALID_NUMERIC_FACT',
    });
  });

  it('T20: superseded historical eligible fact never returns', () => {
    const e1 = createEntry({
      id: 'e-1',
      installedQuantity: '10',
      status: ProgressActualStatus.VERIFIED,
    });
    const e2 = createEntry({
      id: 'e-2',
      supersedesEntryId: 'e-1',
      installedQuantity: '5',
      status: ProgressActualStatus.SUBMITTED,
    });
    // e1 is eligible, but superseded by e2 (ineligible). Result must NOT fall back to e1.
    expect(calculateCurrentOfficialQuantity(scope, [e1, e2])).toEqual({
      state: 'NO_ELIGIBLE_CURRENT_FACT',
    });
  });

  it('T21: Decimal 0.1 + 0.2 = exact 0.3', () => {
    const e1 = createEntry({ id: 'e-1', installedQuantity: '0.1' });
    const e2 = createEntry({ id: 'e-2', installedQuantity: '0.2' });
    const provenEvent = createProvenEvent([e1, e2], ['e-1', 'e-2']);

    expect(
      calculateCurrentOfficialQuantity(scope, [
        { ...e1, auditEvents: [provenEvent] },
        { ...e2, auditEvents: [provenEvent] },
      ]),
    ).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal('0.3'),
    });
  });

  it('T22: input immutability', () => {
    const e1 = createEntry({ id: 'e-1', installedQuantity: '4' });
    const provenEvent = createProvenEvent([e1], ['e-1']);
    const e1Proven = { ...e1, auditEvents: [provenEvent] };

    const input = [e1Proven];
    const originalInput = JSON.stringify(input);

    calculateCurrentOfficialQuantity(scope, input);

    expect(JSON.stringify(input)).toEqual(originalInput);
  });

  it('T23: deterministic result under safe input reordering', () => {
    const e1 = createEntry({ id: 'e-1', installedQuantity: '3' });
    const e2 = createEntry({ id: 'e-2', installedQuantity: '4' });
    const provenEvent = createProvenEvent([e1, e2], ['e-1', 'e-2']);

    const e1Proven = { ...e1, auditEvents: [provenEvent] };
    const e2Proven = { ...e2, auditEvents: [provenEvent] };

    const res1 = calculateCurrentOfficialQuantity(scope, [e1Proven, e2Proven]);
    const res2 = calculateCurrentOfficialQuantity(scope, [e2Proven, e1Proven]);

    expect(res1).toEqual(res2);
  });

  it('T24: no H2-A1 dependency', () => {
    // Pure function logic does not accept or process H2-A1 variables.
    expect(calculateCurrentOfficialQuantity.length).toEqual(2);
  });

  it('T25: quantity above planned quantity is not capped', () => {
    // Law 1 does not take planned quantity.
    let entry = createEntry({ installedQuantity: '9999999' });
    entry = setupProvenEntry(entry);

    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'COMPLETE',
      currentOfficialQuantity: new Prisma.Decimal('9999999'),
    });
  });
  it('T26: composite failure precedence is deterministic regardless of input order', () => {
    const semanticUnproven = createEntry({
      id: 'semantic-unproven',
      status: ProgressActualStatus.VERIFIED,
      installedQuantity: '4',
      auditEvents: [],
    });

    const invalidNumeric = createEntry({
      id: 'invalid-numeric',
      status: ProgressActualStatus.VERIFIED,
      installedQuantity: '-1',
      auditEvents: [],
    });

    expect(
      calculateCurrentOfficialQuantity(scope, [
        semanticUnproven,
        invalidNumeric,
      ]),
    ).toEqual({
      state: 'INVALID_NUMERIC_FACT',
    });

    expect(
      calculateCurrentOfficialQuantity(scope, [
        invalidNumeric,
        semanticUnproven,
      ]),
    ).toEqual({
      state: 'INVALID_NUMERIC_FACT',
    });
  });

  it('T27: non-finite current quantity fails closed as INVALID_NUMERIC_FACT', () => {
    const entry = createEntry({
      id: 'non-finite',
      status: ProgressActualStatus.VERIFIED,
      installedQuantity: 'Infinity',
      auditEvents: [],
    });

    expect(calculateCurrentOfficialQuantity(scope, [entry])).toEqual({
      state: 'INVALID_NUMERIC_FACT',
    });
  });
});

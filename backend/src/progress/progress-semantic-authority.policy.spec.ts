import { ProgressActualStatus, ProgressAuditOutcome } from '@prisma/client';
import { selectCurrentCalculationLineageLeaves } from './progress-actual-calculation.policy';
import {
  createProgressSemanticVerificationContext,
  isProgressSemanticAttestationEligible,
  MON04_SEMANTIC_ATTESTATION_TYPE,
  MON04_SEMANTIC_AUDIT_ACTION,
  MON04_SEMANTIC_CONTEXT_VERSION,
  MON04_SEMANTIC_POLICY_VERSION,
  progressSemanticProofMetadata,
  readProgressSemanticAuthority,
  type ProgressSemanticContextEntry,
} from './progress-semantic-authority.policy';

const scope = {
  projectId: 'project-a',
  activeBaselineId: 'baseline-a',
  boqItemId: 'item-a',
};

const actual = (
  id: string,
  status = ProgressActualStatus.VERIFIED,
  supersedesEntryId: string | null = null,
  values: Partial<ProgressSemanticContextEntry> = {},
): ProgressSemanticContextEntry => ({
  id,
  supersedesEntryId,
  installedQuantity: '4.00',
  workDate: new Date('2026-08-25T00:00:00.000Z'),
  status,
  captureMethod: 'FIELD_MEASUREMENT',
  evidenceReferences: [
    { url: `https://evidence.example/${id}`, label: `Evidence ${id}` },
  ],
  notes: null,
  correctionReasonCode: null,
  correctionReason: null,
  recordedByAccountId: 'actor-a',
  revision: supersedesEntryId ? 2 : 1,
  ...values,
});

const validContext = (entries: ProgressSemanticContextEntry[]) => {
  const context = createProgressSemanticVerificationContext(scope, entries);
  if (context.state !== 'VALID') throw new Error('Expected valid context');
  return context;
};

const proofEvent = (
  metadata: unknown,
  values: Partial<{
    action: string;
    outcome: ProgressAuditOutcome;
    authorityCode: string | null;
  }> = {},
) => ({
  action: MON04_SEMANTIC_AUDIT_ACTION,
  outcome: ProgressAuditOutcome.SUCCESS,
  metadata,
  occurredAt: new Date('2026-08-25T02:00:00.000Z'),
  actorAccountId: 'verifier-a',
  authorityCode: 'FIELD_PROGRESS_VERIFY',
  actor: { displayName: 'Verifier A' },
  ...values,
});

describe('MON-04 semantic verification context', () => {
  it('T1 derives one current root and creates deterministic context identity', () => {
    const root = actual('root-a');
    const left = validContext([root]);
    const right = validContext([{ ...root }]);

    expect(left.currentLeafIds).toEqual(['root-a']);
    expect(left.contextDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(right.contextDigest).toBe(left.contextDigest);
  });

  it('T2 includes every independent current root and binds record identity', () => {
    const rootA = actual('root-a');
    const rootB = actual('root-b');
    const context = validContext([rootB, rootA]);
    const sameValuesDifferentIdentity = validContext([
      rootA,
      { ...rootB, id: 'root-c' },
    ]);

    expect(context.currentLeafIds).toEqual(['root-a', 'root-b']);
    expect(sameValuesDifferentIdentity.contextDigest).not.toBe(
      context.contextDigest,
    );
  });

  it('T3 uses the canonical correction leaf while preserving its relationship', () => {
    const original = actual('a1', ProgressActualStatus.ACCEPTED);
    const correction = actual(
      'a2',
      ProgressActualStatus.VERIFIED,
      original.id,
      {
        installedQuantity: '5.00',
        correctionReasonCode: 'MEASUREMENT_UPDATE',
        correctionReason: 'Field remeasurement',
      },
    );
    const context = validContext([original, correction]);

    expect(context.currentLeaves).toEqual([correction]);
    expect(context.currentLeaves[0].supersedesEntryId).toBe('a1');
  });

  it('T4 fails closed with the canonical invalid-lineage reason', () => {
    const malformed = [
      actual('a', ProgressActualStatus.VERIFIED, 'b'),
      actual('b', ProgressActualStatus.ACCEPTED, 'a'),
    ];

    expect(createProgressSemanticVerificationContext(scope, malformed)).toEqual(
      expect.objectContaining({
        state: 'INVALID_LINEAGE',
        reason: 'CYCLE',
        contextDigest: null,
        currentLeaves: [],
      }),
    );
  });

  it('T5/T6 keeps lifecycle eligibility necessary but separate from proof', () => {
    expect(
      isProgressSemanticAttestationEligible(ProgressActualStatus.VERIFIED),
    ).toBe(true);
    expect(
      isProgressSemanticAttestationEligible(ProgressActualStatus.ACCEPTED),
    ).toBe(true);
    expect(
      isProgressSemanticAttestationEligible(ProgressActualStatus.SUBMITTED),
    ).toBe(false);

    const verified = actual('root-a', ProgressActualStatus.VERIFIED);
    const accepted = { ...verified, status: ProgressActualStatus.ACCEPTED };
    expect(validContext([accepted]).contextDigest).toBe(
      validContext([verified]).contextDigest,
    );
    expect(readProgressSemanticAuthority(validContext([verified]), [])).toEqual(
      { state: 'NOT_PROVEN', proof: null },
    );
  });

  it('T9 persists an exact machine-readable proof contract and reads it deterministically', () => {
    const context = validContext([actual('root-a')]);
    const metadata = progressSemanticProofMetadata(context);

    expect(metadata).toEqual({
      policyVersion: MON04_SEMANTIC_POLICY_VERSION,
      attestationType: MON04_SEMANTIC_ATTESTATION_TYPE,
      contextVersion: MON04_SEMANTIC_CONTEXT_VERSION,
      activeBaselineId: scope.activeBaselineId,
      boqItemId: scope.boqItemId,
      contextDigest: context.contextDigest,
      currentLeafIds: ['root-a'],
      explicitConfirmation: true,
    });
    expect(
      readProgressSemanticAuthority(context, [proofEvent(metadata)]),
    ).toEqual({
      state: 'PROVEN',
      proof: {
        actorAccountId: 'verifier-a',
        actorDisplayName: 'Verifier A',
        authorityCode: 'FIELD_PROGRESS_VERIFY',
        occurredAt: new Date('2026-08-25T02:00:00.000Z'),
      },
    });
  });

  it('T9 fails closed for stale and malformed proof provenance', () => {
    const context = validContext([actual('root-a')]);
    const staleMetadata = {
      ...progressSemanticProofMetadata(context),
      contextDigest: '0'.repeat(64),
    };

    expect(
      readProgressSemanticAuthority(context, [proofEvent(staleMetadata)]),
    ).toEqual({ state: 'STALE', proof: null });
    expect(
      readProgressSemanticAuthority(context, [proofEvent({ hostile: true })]),
    ).toEqual({ state: 'INVALID_PROVENANCE', proof: null });
    expect(
      readProgressSemanticAuthority(context, [
        proofEvent(progressSemanticProofMetadata(context), {
          authorityCode: null,
        }),
      ]),
    ).toEqual({ state: 'INVALID_PROVENANCE', proof: null });
  });

  it('T10 composes the one canonical lineage selector rather than ranking a second latest fact', () => {
    const a1 = actual('a1', ProgressActualStatus.ACCEPTED);
    const a2 = actual('a2', ProgressActualStatus.SUBMITTED, 'a1');
    const b1 = actual('b1', ProgressActualStatus.VERIFIED);
    const entries = [b1, a2, a1];
    const canonical = selectCurrentCalculationLineageLeaves(entries);
    const semantic = validContext(entries);

    expect(canonical).toEqual({ state: 'VALID', leaves: [b1, a2] });
    expect(semantic.currentLeafIds).toEqual(['a2', 'b1']);
    expect(semantic.currentLeaves).toEqual(
      expect.arrayContaining(
        canonical.state === 'VALID' ? canonical.leaves : [],
      ),
    );
  });
});

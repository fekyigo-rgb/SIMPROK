import {
  IdenticalQuestionEvent,
  identicalQuestionState,
  isAnswerApplicable,
  planApprove,
  planReject,
  planRevoke,
  planSupersede,
  planTeach,
} from './identical-question-governance';
import { IQL01_IDENTICAL_QUESTION_POLICY_VERSION } from './identical-question-key';

/**
 * IQL-01 — the governance state machine. TEACH is never effective; APPROVE needs
 * a different account; REJECT and REVOKE leave nothing; only the latest
 * generation is read; nothing ever revives.
 */
describe('IQL-01 governance law', () => {
  const POLICY = 'IQL01_IDENTICAL_QUESTION_V1';
  const LIVE = {
    candidateContextDigest: 'digest-A',
    resolutionPolicyVersion: POLICY,
  };
  const TEACHER = 'acct-owner';
  const APPROVER = 'acct-second';

  const event = (
    over: Partial<IdenticalQuestionEvent> &
      Pick<IdenticalQuestionEvent, 'id' | 'generation' | 'action'>,
  ): IdenticalQuestionEvent => ({
    selectedResourceCatalogId: null,
    candidateContextDigest: null,
    resolutionPolicyVersion: null,
    decidedByAccountId: TEACHER,
    ...over,
  });
  const teach = (generation = 1, over: Partial<IdenticalQuestionEvent> = {}) =>
    event({
      id: `teach-${generation}`,
      generation,
      action: 'TEACH',
      selectedResourceCatalogId: 'cat-kerikil',
      candidateContextDigest: 'digest-A',
      resolutionPolicyVersion: POLICY,
      ...over,
    });
  const approve = (generation = 2, by = APPROVER) =>
    event({
      id: `approve-${generation}`,
      generation,
      action: 'APPROVE',
      decidedByAccountId: by,
    });

  // ---------------- state ----------------
  it('no event is NONE; a TEACH is PENDING, never effective', () => {
    expect(identicalQuestionState(null, null).kind).toBe('NONE');
    expect(identicalQuestionState(teach(), null).kind).toBe('PENDING');
  });

  it('an APPROVE of an answer is APPROVED; an APPROVE of a non-answer is a broken lineage → NONE', () => {
    expect(identicalQuestionState(approve(), teach()).kind).toBe('APPROVED');
    expect(
      identicalQuestionState(
        approve(3),
        event({ id: 'r', generation: 2, action: 'REJECT' }),
      ).kind,
    ).toBe('NONE');
    expect(identicalQuestionState(approve(), null).kind).toBe('NONE');
  });

  it('a changed candidate context makes an approved answer inapplicable — and creates no event', () => {
    const answer = teach();
    expect(isAnswerApplicable(answer, LIVE)).toBe(true);
    expect(
      isAnswerApplicable(answer, {
        ...LIVE,
        candidateContextDigest: 'digest-B',
      }),
    ).toBe(false);
    expect(
      isAnswerApplicable(answer, {
        ...LIVE,
        resolutionPolicyVersion: 'OTHER_V1',
      }),
    ).toBe(false);
    // Still the same latest event: inapplicability is read, never written.
    expect(identicalQuestionState(approve(), answer).kind).toBe('APPROVED');
  });

  // ---------------- TEACH ----------------
  it('TEACH on a fresh question appends generation 1 with no predecessor', () => {
    expect(
      planTeach({
        state: identicalQuestionState(null, null),
        latest: null,
        expectedGeneration: 0,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'APPEND', generation: 1, previousDecisionId: null });
  });

  it('TEACH against a stale generation is refused', () => {
    expect(
      planTeach({
        state: identicalQuestionState(null, null),
        latest: null,
        expectedGeneration: 3,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'DECISION_GENERATION_STALE' });
  });

  it('the SAME answer while pending is a replay (a grouped decision spends one context); a different one is CANDIDATE_PENDING', () => {
    const latest = teach();
    const state = identicalQuestionState(latest, null);
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 0,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'REPLAY', event: latest });
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 1,
        selectedResourceCatalogId: 'cat-other',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'CANDIDATE_PENDING' });
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 1,
        selectedResourceCatalogId: 'cat-kerikil',
        live: { ...LIVE, candidateContextDigest: 'digest-B' },
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'CANDIDATE_PENDING' });
  });

  it('while an applicable answer is effective: the same answer replays, a different one must SUPERSEDE', () => {
    const answer = teach();
    const latest = approve();
    const state = identicalQuestionState(latest, answer);
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 0,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'REPLAY', event: latest });
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 2,
        selectedResourceCatalogId: 'cat-other',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'USE_SUPERSEDE' });
  });

  it('an approved answer that no longer applies can be taught again — as the NEXT generation', () => {
    const latest = approve();
    const state = identicalQuestionState(latest, teach());
    expect(
      planTeach({
        state,
        latest,
        expectedGeneration: 2,
        selectedResourceCatalogId: 'cat-other',
        live: { ...LIVE, candidateContextDigest: 'digest-B' },
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 3,
      previousDecisionId: 'approve-2',
    });
  });

  it('after REJECT or REVOKE, only a NEW TEACH can begin again — nothing revives', () => {
    const rejected = event({
      id: 'reject-2',
      generation: 2,
      action: 'REJECT',
      decidedByAccountId: APPROVER,
    });
    const revoked = event({
      id: 'revoke-3',
      generation: 3,
      action: 'REVOKE',
      decidedByAccountId: APPROVER,
    });
    expect(
      planTeach({
        state: identicalQuestionState(rejected, teach()),
        latest: rejected,
        expectedGeneration: 2,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 3,
      previousDecisionId: 'reject-2',
    });
    expect(
      planTeach({
        state: identicalQuestionState(revoked, approve()),
        latest: revoked,
        expectedGeneration: 3,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 4,
      previousDecisionId: 'revoke-3',
    });
  });

  // ---------------- APPROVE ----------------
  it('the teacher can NEVER approve their own candidate', () => {
    const latest = teach();
    expect(
      planApprove({
        livePolicyVersion: POLICY,
        state: identicalQuestionState(latest, null),
        latest,
        expectedGeneration: 1,
        actorAccountId: TEACHER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'TEACHER_CANNOT_APPROVE' });
  });

  it('a different authorized account approves as the next generation', () => {
    const latest = teach();
    expect(
      planApprove({
        livePolicyVersion: POLICY,
        state: identicalQuestionState(latest, null),
        latest,
        expectedGeneration: 1,
        actorAccountId: APPROVER,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 2,
      previousDecisionId: 'teach-1',
    });
  });

  it('there is nothing to approve unless a candidate is pending', () => {
    const rejected = event({ id: 'reject-2', generation: 2, action: 'REJECT' });
    expect(
      planApprove({
        livePolicyVersion: POLICY,
        state: identicalQuestionState(null, null),
        latest: null,
        expectedGeneration: 0,
        actorAccountId: APPROVER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_PENDING_CANDIDATE' });
    expect(
      planApprove({
        livePolicyVersion: POLICY,
        state: identicalQuestionState(rejected, teach()),
        latest: rejected,
        expectedGeneration: 2,
        actorAccountId: APPROVER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_PENDING_CANDIDATE' });
  });

  it('concurrent approvals: the approver replays, the loser is stale — never two current answers', () => {
    const latest = approve(2, APPROVER);
    const state = identicalQuestionState(latest, teach());
    expect(
      planApprove({
        livePolicyVersion: POLICY,
        state,
        latest,
        expectedGeneration: 1,
        actorAccountId: APPROVER,
      }),
    ).toEqual({ outcome: 'REPLAY', event: latest });
    expect(
      planApprove({
        livePolicyVersion: POLICY,
        state,
        latest,
        expectedGeneration: 1,
        actorAccountId: 'acct-third',
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'DECISION_GENERATION_STALE' });
  });

  // ---------------- REJECT / REVOKE / SUPERSEDE ----------------
  it('REJECT judges only a pending candidate', () => {
    const latest = teach();
    expect(
      planReject({
        state: identicalQuestionState(latest, null),
        latest,
        expectedGeneration: 1,
        actorAccountId: APPROVER,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 2,
      previousDecisionId: 'teach-1',
    });
    const approved = approve();
    expect(
      planReject({
        state: identicalQuestionState(approved, teach()),
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: APPROVER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_PENDING_CANDIDATE' });
  });

  it('REVOKE withdraws an approved answer — applicable or not — and nothing else', () => {
    const approved = approve();
    expect(
      planRevoke({
        state: identicalQuestionState(approved, teach()),
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: TEACHER,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 3,
      previousDecisionId: 'approve-2',
    });
    const pending = teach();
    expect(
      planRevoke({
        state: identicalQuestionState(pending, null),
        latest: pending,
        expectedGeneration: 1,
        actorAccountId: TEACHER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_EFFECTIVE_ANSWER' });
  });

  it('SUPERSEDE needs an effective, still-applicable answer and a DIFFERENT selection', () => {
    const approved = approve();
    const state = identicalQuestionState(approved, teach());
    expect(
      planSupersede({
        state,
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: TEACHER,
        selectedResourceCatalogId: 'cat-other',
        live: LIVE,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 3,
      previousDecisionId: 'approve-2',
    });
    expect(
      planSupersede({
        state,
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: TEACHER,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'SUPERSEDE_SAME_ANSWER' });
    expect(
      planSupersede({
        state,
        latest: approved,
        expectedGeneration: 2,
        actorAccountId: TEACHER,
        selectedResourceCatalogId: 'cat-other',
        live: { ...LIVE, candidateContextDigest: 'digest-B' },
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'NO_EFFECTIVE_ANSWER' });
  });

  it('a SUPERSEDE is itself only a candidate: reuse stops until someone else approves it', () => {
    const superseding = teach(3, {
      id: 'supersede-3',
      action: 'SUPERSEDE',
      selectedResourceCatalogId: 'cat-other',
    });
    const state = identicalQuestionState(superseding, approve());
    expect(state.kind).toBe('PENDING');
    expect(
      planApprove({
        livePolicyVersion: POLICY,
        state,
        latest: superseding,
        expectedGeneration: 3,
        actorAccountId: TEACHER,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'TEACHER_CANNOT_APPROVE' });
    expect(
      planApprove({
        livePolicyVersion: POLICY,
        state,
        latest: superseding,
        expectedGeneration: 3,
        actorAccountId: APPROVER,
      }),
    ).toEqual({
      outcome: 'APPEND',
      generation: 4,
      previousDecisionId: 'supersede-3',
    });
  });

  it('the generation sequence is total: TEACH 1 → APPROVE 2 → REVOKE 3 → TEACH 4 → APPROVE 5', () => {
    const g1 = planTeach({
      state: identicalQuestionState(null, null),
      latest: null,
      expectedGeneration: 0,
      selectedResourceCatalogId: 'cat-kerikil',
      live: LIVE,
    });
    const t1 = teach(1);
    const g2 = planApprove({
        livePolicyVersion: POLICY,
      state: identicalQuestionState(t1, null),
      latest: t1,
      expectedGeneration: 1,
      actorAccountId: APPROVER,
    });
    const a2 = approve(2);
    const g3 = planRevoke({
      state: identicalQuestionState(a2, t1),
      latest: a2,
      expectedGeneration: 2,
      actorAccountId: TEACHER,
    });
    const r3 = event({ id: 'revoke-3', generation: 3, action: 'REVOKE' });
    const g4 = planTeach({
      state: identicalQuestionState(r3, a2),
      latest: r3,
      expectedGeneration: 3,
      selectedResourceCatalogId: 'cat-kerikil',
      live: LIVE,
    });
    const t4 = teach(4);
    const g5 = planApprove({
        livePolicyVersion: POLICY,
      state: identicalQuestionState(t4, r3),
      latest: t4,
      expectedGeneration: 4,
      actorAccountId: APPROVER,
    });
    expect(
      [g1, g2, g3, g4, g5].map((plan) =>
        plan.outcome === 'APPEND' ? plan.generation : plan.outcome,
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });
});

/**
 * GAP B — THE V2 TRANSITION, NOT JUST THE CONSTANT.
 *
 * Bumping IQL01_IDENTICAL_QUESTION_POLICY_VERSION to V2 makes every stored V1
 * answer inapplicable. That is only half a transition: the two real historical
 * cohorts must still have LAWFUL ACTIONS, and no door may be offered that its
 * own route would refuse.
 *
 *   cohort (a) key 067f0db4… "Agregat kasar"/M03/M3 — TEACH V1 then APPROVE.
 *   cohort (b) key 890183c6… "Stamper"/E25/Jam     — TEACH V1 only, PENDING.
 *
 * Nothing here auto-approves, auto-rejects or auto-revokes. The ledger is never
 * rewritten: every action below APPENDS a generation.
 */
describe('Gap B — lawful actions for answers recorded under the superseded policy', () => {
  const V1 = 'IQL01_IDENTICAL_QUESTION_V1';
  const V2 = IQL01_IDENTICAL_QUESTION_POLICY_VERSION;
  const TEACHER = 'acct-owner';
  const SECOND = 'acct-second';
  const DIGEST = 'digest-unchanged';
  /** The context now in force. The candidate SET has not moved; only the law has. */
  const LIVE = { candidateContextDigest: DIGEST, resolutionPolicyVersion: V2 };

  const event = (
    over: Partial<{
      id: string;
      action: string;
      generation: number;
      previousDecisionId: string | null;
      selectedResourceCatalogId: string | null;
      candidateContextDigest: string | null;
      resolutionPolicyVersion: string | null;
      decidedByAccountId: string;
    }> = {},
  ) =>
    ({
      id: 'ev-1',
      action: 'TEACH',
      generation: 1,
      previousDecisionId: null,
      selectedResourceCatalogId: 'cat-kerikil',
      candidateContextDigest: DIGEST,
      resolutionPolicyVersion: V1,
      decidedByAccountId: TEACHER,
      decidedAt: new Date('2026-09-11T03:21:16.678Z'),
      reason: null,
      ...over,
    }) as never;

  /** cohort (b): a TEACH under V1, never approved. */
  const pendingV1 = event();
  /** cohort (a): an APPROVE under V1 whose answer is the V1 TEACH. */
  const approvalV1 = event({
    id: 'ev-2',
    action: 'APPROVE',
    generation: 2,
    previousDecisionId: 'ev-1',
    selectedResourceCatalogId: null,
    candidateContextDigest: null,
    resolutionPolicyVersion: null,
    decidedByAccountId: SECOND,
  });

  const pendingState = { kind: 'PENDING' as const, candidate: pendingV1 };
  const approvedState = {
    kind: 'APPROVED' as const,
    approval: approvalV1,
    answer: pendingV1,
  };

  it('the superseded policy is what makes both cohorts inapplicable — the candidate set never moved', () => {
    expect(isAnswerApplicable(pendingV1, LIVE)).toBe(false);
    // Same digest on both sides: the ONLY difference is the law.
    expect(isAnswerApplicable(event({ resolutionPolicyVersion: V2 }), LIVE)).toBe(true);
  });

  // ---- cohort (a): APPROVED under V1 ----

  it('(a) an inapplicable APPROVED answer can still be REVOKED — the lawful correction path stays open', () => {
    const plan = planRevoke({
      state: approvedState,
      latest: approvalV1,
      expectedGeneration: 2,
      actorAccountId: SECOND,
    });
    expect(plan).toMatchObject({ outcome: 'APPEND', generation: 3, previousDecisionId: 'ev-2' });
  });

  it('(a) SUPERSEDE is refused for it — you cannot amend an answer given under a law that no longer holds', () => {
    const plan = planSupersede({
      state: approvedState,
      latest: approvalV1,
      expectedGeneration: 2,
      actorAccountId: SECOND,
      selectedResourceCatalogId: 'cat-other',
      live: LIVE,
    });
    expect(plan).toEqual({ outcome: 'CONFLICT', code: 'NO_EFFECTIVE_ANSWER' });
  });

  it('(a) a NEW TEACH is lawful over it, appending a generation — the old approval is not rewritten', () => {
    const plan = planTeach({
      state: approvedState,
      latest: approvalV1,
      expectedGeneration: 2,
      selectedResourceCatalogId: 'cat-kerikil',
      live: LIVE,
    });
    expect(plan).toMatchObject({ outcome: 'APPEND', generation: 3, previousDecisionId: 'ev-2' });
  });

  it('(a) POSITIVE CONTROL — an APPROVED answer under the CURRENT policy is still effective and supersedable', () => {
    const answerV2 = event({ resolutionPolicyVersion: V2 });
    const approvalV2 = event({
      id: 'ev-2',
      action: 'APPROVE',
      generation: 2,
      previousDecisionId: 'ev-1',
      selectedResourceCatalogId: null,
      candidateContextDigest: null,
      resolutionPolicyVersion: null,
      decidedByAccountId: SECOND,
    });
    const state = { kind: 'APPROVED' as const, approval: approvalV2, answer: answerV2 };
    expect(isAnswerApplicable(answerV2, LIVE)).toBe(true);
    expect(
      planSupersede({
        state,
        latest: approvalV2,
        expectedGeneration: 2,
        actorAccountId: SECOND,
        selectedResourceCatalogId: 'cat-other',
        live: LIVE,
      }),
    ).toMatchObject({ outcome: 'APPEND' });
    // …and teaching the SAME answer again is a replay, not a second record.
    expect(
      planTeach({
        state,
        latest: approvalV2,
        expectedGeneration: 2,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toMatchObject({ outcome: 'REPLAY' });
  });

  // ---- cohort (b): PENDING under V1 ----

  it('(b) APPROVE is REFUSED with its own reason — a second holder is not asked to judge a no-op', () => {
    const plan = planApprove({
      state: pendingState,
      latest: pendingV1,
      expectedGeneration: 1,
      actorAccountId: SECOND,
      livePolicyVersion: V2,
    });
    expect(plan).toEqual({ outcome: 'CONFLICT', code: 'CANDIDATE_POLICY_SUPERSEDED' });
  });

  it('(b) REJECT is the lawful exit and is NOT blocked by the policy', () => {
    const plan = planReject({
      state: pendingState,
      latest: pendingV1,
      expectedGeneration: 1,
      actorAccountId: SECOND,
    });
    expect(plan).toMatchObject({ outcome: 'APPEND', generation: 2, previousDecisionId: 'ev-1' });
  });

  it('(b) after a REJECT the question can be TAUGHT again under the policy now in force', () => {
    const rejection = event({
      id: 'ev-2',
      action: 'REJECT',
      generation: 2,
      previousDecisionId: 'ev-1',
      selectedResourceCatalogId: null,
      candidateContextDigest: null,
      resolutionPolicyVersion: null,
      decidedByAccountId: SECOND,
    });
    const plan = planTeach({
      state: { kind: 'REJECTED', rejection } as never,
      latest: rejection,
      expectedGeneration: 2,
      selectedResourceCatalogId: 'cat-kerikil',
      live: LIVE,
    });
    expect(plan).toMatchObject({ outcome: 'APPEND', generation: 3 });
  });

  it('(b) a stale PENDING is not left as a dead wait: teaching over it is refused, so REJECT is the door', () => {
    expect(
      planTeach({
        state: pendingState,
        latest: pendingV1,
        expectedGeneration: 1,
        selectedResourceCatalogId: 'cat-kerikil',
        live: LIVE,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'CANDIDATE_PENDING' });
  });

  it('(b) POSITIVE CONTROL — a PENDING under the CURRENT policy is still approvable by a second holder', () => {
    const state = { kind: 'PENDING' as const, candidate: event({ resolutionPolicyVersion: V2 }) };
    expect(
      planApprove({
        state,
        latest: state.candidate,
        expectedGeneration: 1,
        actorAccountId: SECOND,
        livePolicyVersion: V2,
      }),
    ).toMatchObject({ outcome: 'APPEND', generation: 2 });
  });

  it('the teacher still may not approve their own teaching, and the policy check does not mask that', () => {
    const state = { kind: 'PENDING' as const, candidate: event({ resolutionPolicyVersion: V2 }) };
    expect(
      planApprove({
        state,
        latest: state.candidate,
        expectedGeneration: 1,
        actorAccountId: TEACHER,
        livePolicyVersion: V2,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'TEACHER_CANNOT_APPROVE' });
  });

  it('a stale generation is still reported as a stale generation, before any policy verdict', () => {
    expect(
      planApprove({
        state: pendingState,
        latest: pendingV1,
        expectedGeneration: 0,
        actorAccountId: SECOND,
        livePolicyVersion: V2,
      }),
    ).toEqual({ outcome: 'CONFLICT', code: 'DECISION_GENERATION_STALE' });
  });

  it('nothing auto-expires: a V1 PENDING stays PENDING until a human acts', () => {
    // The state derivation reads the ledger only; no policy, no clock.
    expect(identicalQuestionState(pendingV1, null)).toEqual({
      kind: 'PENDING',
      candidate: pendingV1,
    });
  });
});

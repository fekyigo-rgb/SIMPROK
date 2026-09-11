/**
 * IQL-01 — THE GOVERNANCE STATE MACHINE, AS PURE LAW.
 *
 * Every rule about which governance act may follow which lives here, free of
 * I/O, so it is provable in isolation and the service can only APPLY it. The
 * service supplies the latest ledger event (and the answer it judges) read
 * under its lock; this file answers "append, replay, or refuse".
 *
 *   TEACH      → CANDIDATE. Never effective.
 *   APPROVE    → EFFECTIVE, by an account DIFFERENT from the candidate's author.
 *   REJECT     → no memory.
 *   SUPERSEDE  → a new candidate for an effective question; reuse is suspended
 *                until it is approved.
 *   REVOKE     → no memory; history stays.
 *
 * Only the latest generation is ever read. A change in the candidate set
 * creates no event — it only makes an approved answer inapplicable at read
 * time. After REJECT or REVOKE, memory returns only through a new TEACH and a
 * new APPROVE: no generation ever revives.
 */

export type IdenticalQuestionAction =
  | 'TEACH'
  | 'APPROVE'
  | 'REJECT'
  | 'SUPERSEDE'
  | 'REVOKE';

/** The fields of one ledger event the law reads. */
export interface IdenticalQuestionEvent {
  readonly id: string;
  readonly generation: number;
  readonly action: IdenticalQuestionAction;
  readonly selectedResourceCatalogId: string | null;
  readonly candidateContextDigest: string | null;
  readonly resolutionPolicyVersion: string | null;
  readonly decidedByAccountId: string;
}

export type IdenticalQuestionState =
  | { readonly kind: 'NONE' }
  /** Latest is a TEACH or SUPERSEDE: a candidate awaiting judgement. */
  | { readonly kind: 'PENDING'; readonly candidate: IdenticalQuestionEvent }
  /** Latest is an APPROVE of `answer`. Applicability is judged separately. */
  | {
      readonly kind: 'APPROVED';
      readonly approval: IdenticalQuestionEvent;
      readonly answer: IdenticalQuestionEvent;
    }
  | { readonly kind: 'REJECTED'; readonly rejection: IdenticalQuestionEvent }
  | { readonly kind: 'REVOKED'; readonly revocation: IdenticalQuestionEvent };

/** The answer-carrying actions. */
export function carriesAnswer(action: IdenticalQuestionAction): boolean {
  return action === 'TEACH' || action === 'SUPERSEDE';
}

/**
 * The current state from the latest event and the event it follows. An APPROVE
 * whose predecessor is not an answer is a broken lineage and reads as NONE —
 * fail closed, never reuse.
 */
export function identicalQuestionState(
  latest: IdenticalQuestionEvent | null,
  previous: IdenticalQuestionEvent | null,
): IdenticalQuestionState {
  if (!latest) return { kind: 'NONE' };
  switch (latest.action) {
    case 'TEACH':
    case 'SUPERSEDE':
      return { kind: 'PENDING', candidate: latest };
    case 'APPROVE':
      return previous && carriesAnswer(previous.action)
        ? { kind: 'APPROVED', approval: latest, answer: previous }
        : { kind: 'NONE' };
    case 'REJECT':
      return { kind: 'REJECTED', rejection: latest };
    case 'REVOKE':
      return { kind: 'REVOKED', revocation: latest };
  }
}

/** The live context an answer is judged against. */
export interface LiveQuestionContext {
  readonly candidateContextDigest: string;
  readonly resolutionPolicyVersion: string;
}

/** An answer applies only while its candidate context and policy are unchanged. */
export function isAnswerApplicable(
  answer: IdenticalQuestionEvent,
  live: LiveQuestionContext,
): boolean {
  return (
    answer.candidateContextDigest === live.candidateContextDigest &&
    answer.resolutionPolicyVersion === live.resolutionPolicyVersion
  );
}

export type IdenticalQuestionConflict =
  | 'CANDIDATE_PENDING'
  | 'USE_SUPERSEDE'
  | 'DECISION_GENERATION_STALE'
  | 'TEACHER_CANNOT_APPROVE'
  | 'NO_PENDING_CANDIDATE'
  | 'NO_EFFECTIVE_ANSWER'
  | 'SUPERSEDE_SAME_ANSWER';

export type GovernancePlan =
  | {
      readonly outcome: 'APPEND';
      readonly generation: number;
      readonly previousDecisionId: string | null;
    }
  | { readonly outcome: 'REPLAY'; readonly event: IdenticalQuestionEvent }
  | { readonly outcome: 'CONFLICT'; readonly code: IdenticalQuestionConflict };

interface PlanBase {
  readonly state: IdenticalQuestionState;
  /** The latest event (any action), or null. */
  readonly latest: IdenticalQuestionEvent | null;
  /** The generation the actor's signed context was issued against. */
  readonly expectedGeneration: number;
}

const currentGeneration = (latest: IdenticalQuestionEvent | null) =>
  latest?.generation ?? 0;

const append = (latest: IdenticalQuestionEvent | null): GovernancePlan => ({
  outcome: 'APPEND',
  generation: currentGeneration(latest) + 1,
  previousDecisionId: latest?.id ?? null,
});

const conflict = (code: IdenticalQuestionConflict): GovernancePlan => ({
  outcome: 'CONFLICT',
  code,
});

/**
 * TEACH. Replays are checked BEFORE the generation, so every row of one grouped
 * human decision can spend the same signed context: the first appends, the rest
 * find the identical candidate already on record.
 */
export function planTeach(
  params: PlanBase & {
    readonly selectedResourceCatalogId: string;
    readonly live: LiveQuestionContext;
  },
): GovernancePlan {
  const { state, latest, live } = params;
  if (state.kind === 'PENDING') {
    const same =
      state.candidate.selectedResourceCatalogId ===
        params.selectedResourceCatalogId &&
      isAnswerApplicable(state.candidate, live);
    return same
      ? { outcome: 'REPLAY', event: state.candidate }
      : conflict('CANDIDATE_PENDING');
  }
  if (state.kind === 'APPROVED' && isAnswerApplicable(state.answer, live)) {
    return state.answer.selectedResourceCatalogId ===
      params.selectedResourceCatalogId
      ? { outcome: 'REPLAY', event: state.approval }
      : conflict('USE_SUPERSEDE');
  }
  // NONE, REJECTED, REVOKED, or an APPROVE that no longer applies.
  if (params.expectedGeneration !== currentGeneration(latest)) {
    return conflict('DECISION_GENERATION_STALE');
  }
  return append(latest);
}

/** APPROVE — by an account different from the candidate's author. */
export function planApprove(
  params: PlanBase & { readonly actorAccountId: string },
): GovernancePlan {
  const { state, latest } = params;
  if (
    state.kind === 'APPROVED' &&
    state.approval.decidedByAccountId === params.actorAccountId &&
    params.expectedGeneration === state.approval.generation - 1
  ) {
    return { outcome: 'REPLAY', event: state.approval };
  }
  if (params.expectedGeneration !== currentGeneration(latest)) {
    return conflict('DECISION_GENERATION_STALE');
  }
  if (state.kind !== 'PENDING') return conflict('NO_PENDING_CANDIDATE');
  if (state.candidate.decidedByAccountId === params.actorAccountId) {
    return conflict('TEACHER_CANNOT_APPROVE');
  }
  return append(latest);
}

/** REJECT — of a pending candidate. Any authorized account; it removes, never adds. */
export function planReject(
  params: PlanBase & { readonly actorAccountId: string },
): GovernancePlan {
  const { state, latest } = params;
  if (
    state.kind === 'REJECTED' &&
    state.rejection.decidedByAccountId === params.actorAccountId &&
    params.expectedGeneration === state.rejection.generation - 1
  ) {
    return { outcome: 'REPLAY', event: state.rejection };
  }
  if (params.expectedGeneration !== currentGeneration(latest)) {
    return conflict('DECISION_GENERATION_STALE');
  }
  if (state.kind !== 'PENDING') return conflict('NO_PENDING_CANDIDATE');
  return append(latest);
}

/** SUPERSEDE — a different answer for an effective, still-applicable question. */
export function planSupersede(
  params: PlanBase & {
    readonly actorAccountId: string;
    readonly selectedResourceCatalogId: string;
    readonly live: LiveQuestionContext;
  },
): GovernancePlan {
  const { state, latest, live } = params;
  if (
    state.kind === 'PENDING' &&
    state.candidate.action === 'SUPERSEDE' &&
    state.candidate.decidedByAccountId === params.actorAccountId &&
    state.candidate.selectedResourceCatalogId ===
      params.selectedResourceCatalogId &&
    isAnswerApplicable(state.candidate, live) &&
    params.expectedGeneration === state.candidate.generation - 1
  ) {
    return { outcome: 'REPLAY', event: state.candidate };
  }
  if (params.expectedGeneration !== currentGeneration(latest)) {
    return conflict('DECISION_GENERATION_STALE');
  }
  if (state.kind !== 'APPROVED' || !isAnswerApplicable(state.answer, live)) {
    return conflict('NO_EFFECTIVE_ANSWER');
  }
  if (
    state.answer.selectedResourceCatalogId === params.selectedResourceCatalogId
  ) {
    return conflict('SUPERSEDE_SAME_ANSWER');
  }
  return append(latest);
}

/** REVOKE — of an approved answer, applicable or not. It removes, never adds. */
export function planRevoke(
  params: PlanBase & { readonly actorAccountId: string },
): GovernancePlan {
  const { state, latest } = params;
  if (
    state.kind === 'REVOKED' &&
    state.revocation.decidedByAccountId === params.actorAccountId &&
    params.expectedGeneration === state.revocation.generation - 1
  ) {
    return { outcome: 'REPLAY', event: state.revocation };
  }
  if (params.expectedGeneration !== currentGeneration(latest)) {
    return conflict('DECISION_GENERATION_STALE');
  }
  if (state.kind !== 'APPROVED') return conflict('NO_EFFECTIVE_ANSWER');
  return append(latest);
}

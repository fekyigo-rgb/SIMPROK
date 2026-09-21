import { createHash } from 'node:crypto';

/**
 * IQL-01 — THE EXACT QUESTION FINGERPRINT.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * It answers one question: "is this resource question byte-for-byte the SAME
 * question a human already answered in this workspace?" It is a fingerprint of
 * the QUESTION. It is never evidence of identity — whether an answer may be
 * reused is decided afterwards, by the governed ledger state, the candidate
 * context digest and the Resource Identity kernel.
 *
 * EXACT, AND DELIBERATELY SO. No trim, no lowercase, no whitespace collapse, no
 * Unicode normalization, no alias, no similarity. "Agregat kasar" and
 * "Agregat Kasar" are two questions; "Sewa Dump Truck" and "Dump Truck" are two
 * questions; an absent code (null) and an empty one ("") are two questions. A
 * near-miss costs one human decision, never a wrong identity.
 *
 * ENCODING IS PART OF THE LAW. The tuple is serialized once with
 * JSON.stringify, the same framing ghx-candidate-context uses, so no value can
 * impersonate a field boundary and null stays distinguishable from "".
 */

/** Domain tag inside the hashed tuple: an IQL-01 key can never collide with another digest family. */
export const IQL01_QUESTION_KEY_TAG = 'IQL01';

/**
 * The policy an IQL-01 answer is recorded and reused under. A stored answer
 * recorded under a different policy is inapplicable, never silently reused.
 *
 * V1 → V2 (resource decision safety). Under V1 an answer could be TAUGHT for a
 * row the machine nominated on NAME SIMILARITY ALONE; the kernel now refuses
 * that at teach, at confirm and at reuse. A V1 answer is therefore an approval
 * granted under a law that no longer exists — the approver weighed a different
 * proposition than the one this workspace now applies.
 *
 * WHY THE VERSION MOVES AND THE DIGEST DOES NOT. The candidate context digest
 * covers WHICH rows were offered (id, name, class, unit, specifications) —
 * deliberately not what each nomination RESTS ON. A V1 answer is therefore
 * dormant rather than dead: it is inapplicable today only because the live
 * basis is weak, and a sighting arriving later from an ordinary Basic Price
 * import could strengthen that basis WITHOUT changing the candidate set, waking
 * the old approval with nobody asked. Putting evidence kinds into the digest
 * would instead invalidate every stored digest at once — GHX's separate ledger
 * included — and would discard an answer whenever its evidence merely improved.
 * This field already means "which law this was approved under", so this is the
 * field that moves.
 *
 * NOTHING IS REWRITTEN. The ledger, its generations and its approvals stay
 * exactly as they are; a V1 answer simply stops resolving anything by itself.
 * The lawful way forward is the governance path that already exists: REVOKE
 * remains available for a V1 answer (planRevoke does not consult applicability),
 * and the question may be taught and approved again under V2 — which now
 * requires a confirmable candidate before it will teach at all.
 */
export const IQL01_IDENTICAL_QUESTION_POLICY_VERSION =
  'IQL01_IDENTICAL_QUESTION_V2';

/** The locked exact-question tuple (lock §2). */
export interface IdenticalQuestion {
  readonly workspaceId: string;
  readonly resourceType: string;
  readonly rawName: string;
  readonly rawCode: string | null;
  readonly rawUnit: string | null;
}

/** sha256 hex (lowercase, 64 chars) of the exact question tuple. */
export function identicalQuestionKey(question: IdenticalQuestion): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        IQL01_QUESTION_KEY_TAG,
        question.workspaceId,
        question.resourceType,
        question.rawName,
        question.rawCode ?? null,
        question.rawUnit ?? null,
      ]),
      'utf8',
    )
    .digest('hex');
}

/**
 * The collision and forgery guard: the raw fields themselves, compared exactly.
 * A key match whose raw fields differ is treated as no match at all.
 */
export function isSameIdenticalQuestion(
  left: IdenticalQuestion,
  right: IdenticalQuestion,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.resourceType === right.resourceType &&
    left.rawName === right.rawName &&
    (left.rawCode ?? null) === (right.rawCode ?? null) &&
    (left.rawUnit ?? null) === (right.rawUnit ?? null)
  );
}

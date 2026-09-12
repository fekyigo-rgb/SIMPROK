import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ObservedResourceStatus, Prisma, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  UNIT_RESOLUTION_STATUS,
  trustedUnitContext,
} from '../unit-kernel/unit-kernel.contracts';
import {
  AdmitObservedResourceInput,
  ResourceAdmissionNotExhaustedError,
  ResourceAdmissionProvenanceIncompleteError,
  ResourceAdmissionService,
  ResourceProvenanceAlreadyBoundError,
  resourceAdmissionLockKey,
} from './resource-admission.service';
import {
  IdenticalQuestionLatestEvent,
  ResourceIdentityResolutionService,
} from './resource-identity-resolution.service';
import {
  RawResourceReference,
  ResourceIdentityResolution,
  isIdenticalQuestionDecidable,
} from './resource-identity-resolution.kernel';
import { candidateContextDigest } from './ghx-candidate-context';
import {
  GhxDecisionContextConfigurationError,
  GhxDecisionContextTokenService,
} from './ghx-decision-context-token.service';
import {
  IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
  IdenticalQuestion,
  identicalQuestionKey,
} from './identical-question-key';
import {
  GovernancePlan,
  IdenticalQuestionAction,
  IdenticalQuestionEvent,
  IdenticalQuestionState,
  identicalQuestionState,
  isAnswerApplicable,
  planApprove,
  planReject,
  planRevoke,
  planSupersede,
  planTeach,
} from './identical-question-governance';

/**
 * IQL-01 — the lock that serializes governance of ONE exact question. The same
 * FNV-1a helper and the same two-int advisory-lock form as resource admission,
 * under its own namespace so the two never contend.
 */
const IQL01_LOCK_NAMESPACE = resourceAdmissionLockKey(
  'IQL01_EXACT_QUESTION_GOVERNANCE',
);

/** The subject/generation unique index, by name — the concurrency backstop. */
const QUESTION_GENERATION_CONSTRAINT =
  'resource_identity_question_decisions_workspaceId_questionKe_key';

/** Bounded retry for a serialization failure or a lost generation race. Never a spin. */
const QUESTION_RETRY_LIMIT = 1;

const QUESTION_KEY_SHAPE = /^[0-9a-f]{64}$/;

/** The reader-facing state of an exact question. Account ids never leave the server. */
export type IdenticalQuestionStateLabel =
  | 'NONE'
  | 'PENDING'
  | 'EFFECTIVE'
  | 'INAPPLICABLE'
  | 'REJECTED'
  | 'REVOKED';

function isRetryableQuestionWrite(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === '40001' || error.code === 'P2034') return true;
  if (error.code !== 'P2002') return false;
  // ONLY the exact subject/generation race is retried; any other unique
  // violation is a different defect and surfaces as itself.
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const named = Array.isArray(target)
    ? target.join(',')
    : typeof target === 'string'
      ? target
      : '';
  return (
    named.includes(QUESTION_GENERATION_CONSTRAINT) ||
    (named.includes('workspaceId') &&
      named.includes('questionKey') &&
      named.includes('generation'))
  );
}

/** A ledger row (or preloaded event) as the pure governance law reads it. */
function asQuestionEvent(row: {
  id: string;
  generation: number;
  action: string;
  selectedResourceCatalogId: string | null;
  candidateContextDigest: string | null;
  resolutionPolicyVersion: string | null;
  decidedByAccountId: string;
}): IdenticalQuestionEvent {
  return {
    id: row.id,
    generation: row.generation,
    action: row.action as IdenticalQuestionAction,
    selectedResourceCatalogId: row.selectedResourceCatalogId,
    candidateContextDigest: row.candidateContextDigest,
    resolutionPolicyVersion: row.resolutionPolicyVersion,
    decidedByAccountId: row.decidedByAccountId,
  };
}

/** The digest of the machine's own candidate set — the existing GHX shape, unchanged. */
function candidateDigestOf(verdict: ResourceIdentityResolution): string {
  return candidateContextDigest(
    verdict.candidates.map((candidate) => ({
      resourceCatalogId: candidate.resourceCatalogId,
      name: candidate.name,
      type: candidate.type,
      baseUnit: candidate.baseUnit,
      specifications: candidate.specifications,
    })),
  );
}

const LIVE_POLICY = IQL01_IDENTICAL_QUESTION_POLICY_VERSION;

/** The state a question is in right after a governance act of this kind. */
const LABEL_AFTER: Record<
  IdenticalQuestionAction,
  IdenticalQuestionStateLabel
> = {
  TEACH: 'PENDING',
  APPROVE: 'EFFECTIVE',
  REJECT: 'REJECTED',
  SUPERSEDE: 'PENDING',
  REVOKE: 'REVOKED',
};

/**
 * THE shared, domain-neutral lifecycle for a resource an import SAW but could
 * not yet prove: OBSERVED → (human) → RESOLVED_EXISTING | ADMITTED_NEW.
 *
 * AHSP, Basic Price and BOQ all persist observations through `observeMany` and
 * curate through the same two commands here. Nothing is auto-promoted: a
 * candidate stays a candidate until a human decides, and a genuinely-new
 * resource is minted only through the ONE admission authority
 * (ResourceAdmissionService), which writes ResourceCatalog + ResourceSourceIdentity.
 * `origin` is a provenance tag, never a behavioural branch.
 */

export interface ObserveResourceProvenance {
  sourceSha256?: string | null;
  sourceFileName?: string | null;
  parserContractVersion?: string | null;
  sheetName?: string | null;
  sourceRowNumber?: number | null;
  sourceNameCellAddress?: string | null;
  sourceCodeCellAddress?: string | null;
  sourceUnitCellAddress?: string | null;
}

export interface ObserveResourceInput {
  workspaceId: string;
  origin: string;
  rawName: string;
  rawCode?: string | null;
  rawUnit?: string | null;
  resourceType: ResourceType;
  candidates?: readonly string[];
  provenance?: ObserveResourceProvenance;
}

@Injectable()
export class ResourceObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admission: ResourceAdmissionService,
    private readonly unitKernel: UnitKernelService,
    private readonly identity: ResourceIdentityResolutionService,
    /** IQL-01 — the existing signed decision-context machinery, second purpose. */
    private readonly tokens: GhxDecisionContextTokenService,
  ) {}

  /**
   * Persist observations, additively and idempotently. A resource with no name
   * cannot be searched for, so it is never observed. Re-importing the same
   * located source row does not duplicate (unique on workspace + provenance +
   * name + type); a hand-built row with null provenance always inserts, which is
   * the honest behaviour. Never touches a resource that already resolved.
   */
  async observeMany(
    inputs: readonly ObserveResourceInput[],
  ): Promise<{ persisted: number }> {
    const rows = inputs
      .filter((input) => input.rawName.trim().length > 0)
      .map((input) => ({
        workspaceId: input.workspaceId,
        origin: input.origin,
        rawName: input.rawName,
        rawCode: input.rawCode ?? null,
        rawUnit: input.rawUnit ?? null,
        resourceType: input.resourceType,
        sourceSha256: input.provenance?.sourceSha256 ?? null,
        sourceFileName: input.provenance?.sourceFileName ?? null,
        parserContractVersion: input.provenance?.parserContractVersion ?? null,
        sheetName: input.provenance?.sheetName ?? null,
        sourceRowNumber: input.provenance?.sourceRowNumber ?? null,
        sourceCodeCellAddress: input.provenance?.sourceCodeCellAddress ?? null,
        sourceNameCellAddress: input.provenance?.sourceNameCellAddress ?? null,
        sourceUnitCellAddress: input.provenance?.sourceUnitCellAddress ?? null,
        candidatesJson:
          input.candidates && input.candidates.length > 0
            ? [...new Set(input.candidates)]
            : Prisma.JsonNull,
      }));
    if (rows.length === 0) return { persisted: 0 };
    const result = await this.prisma.observedResource.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return { persisted: result.count };
  }

  /** The observations still awaiting a human decision, newest first. */
  async listOpen(workspaceId: string) {
    return this.prisma.observedResource.findMany({
      where: { workspaceId, status: ObservedResourceStatus.OBSERVED },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The open observations, each enriched for a human curator with what the
   * shared authorities say RIGHT NOW: the live identity candidates (name +
   * catalog id, so "this is an existing resource" can carry the id the mint
   * safety needs) and the unit the Unit Kernel can currently prove for the
   * observed spelling (so "genuinely new" can name a canonical unit).
   *
   * This is a READ. It resolves through the ONE identity kernel and the ONE
   * Unit Kernel — never a second matcher — and it changes nothing: candidates
   * are suggestions, not identity, and no catalog is written here. Evidence is
   * loaded ONCE for the workspace and every observation resolved against it.
   *
   * IQL-01: a row whose EXACT question is already answered by an APPROVED,
   * still-applicable exact-question answer is not a question any more, so it is
   * not listed — nothing is written, and a REVOKE or a changed candidate
   * context brings it straight back. Every other row carries the state of its
   * exact question, and — only for a known actor — the signed context that
   * lets the human offer this decision as a learning candidate.
   */
  async listOpenForCuration(workspaceId: string, actorAccountId?: string) {
    const observations = await this.listOpen(workspaceId);
    if (observations.length === 0) return [];
    const questionKeys = new Map(
      observations.map((observation) => [
        observation.id,
        identicalQuestionKey(this.questionOf(observation)),
      ]),
    );
    const evidence = await this.identity.loadEvidence(
      this.prisma,
      workspaceId,
      undefined,
      { identicalQuestionKeys: [...new Set(questionKeys.values())] },
    );
    const rows = await Promise.all(
      observations.map(async (observation) => {
        const resolution = await this.identity.resolve(
          evidence,
          this.referenceOf(observation),
        );
        if (resolution.authority === 'VERIFIED_IDENTICAL_QUESTION_REUSED') {
          return null;
        }
        const questionKey = questionKeys.get(observation.id) as string;
        const identicalQuestion = this.describeOpenQuestion({
          workspaceId,
          questionKey,
          resolution,
          latest: evidence.identicalQuestionDecisions?.get(questionKey) ?? null,
          actorAccountId,
        });
        // ACG-01 CLOSURE 4 — WHY, NOT JUST WHICH.
        //
        // The identity kernel already describes every candidate it nominates:
        // the class it holds, the unit it is measured in, the code SIMPROK has
        // seen for it, WHICH evidence nominated it, and which of its own claims
        // the source never stated. Two of those nine facts used to reach the
        // curator, so a row nominated only because it shares one five-letter
        // token with the source name ("Tanah Biasa" / "Klem biasa") arrived
        // looking exactly like a row a human had already bound to that code.
        //
        // Nothing is recomputed and nothing is re-ranked here: this is the
        // kernel's own description, carried instead of discarded. The decision
        // about what is strong enough to act on is made from these facts in the
        // reader's own view-model, never by inventing a score in this seam.
        const candidates = resolution.candidates.map((candidate) => ({
          resourceCatalogId: candidate.resourceCatalogId,
          name: candidate.name,
          code: candidate.code,
          type: candidate.type,
          baseUnit: candidate.baseUnit,
          evidence: candidate.evidence,
          specificationUnproved: candidate.specificationUnproved,
          unprovedSpecificationFacts: candidate.unprovedSpecificationFacts,
        }));
        let suggestedUnitDefinitionId: string | null = null;
        if (observation.rawUnit) {
          // THE CLASS IS ALREADY ON THE ROW, so ask the kernel the whole
          // question. Without it, a spelling whose every meaning is
          // context-scoped — "jam", catalogued as PERSON_HOUR under LABOR and
          // EQUIPMENT_HOUR under EQUIPMENT — has no eligible alias at all and
          // comes back ambiguous. The kernel was right to refuse: it was asked
          // "what is an hour?" when the caller already knew whose hour it was.
          //
          // This suggestion is a SUGGESTION. It never admits a resource and
          // never asserts identity; it only stops the curation screen
          // dead-ending on rows the kernel could always have answered.
          const unit = await this.unitKernel.resolve(
            observation.rawUnit,
            observation.rawUnit,
            undefined,
            trustedUnitContext(observation.resourceType),
          );
          if (
            unit.status === UNIT_RESOLUTION_STATUS.RESOLVED &&
            unit.sourceUnitDefinition
          ) {
            suggestedUnitDefinitionId = unit.sourceUnitDefinition.id;
          }
        }
        return {
          id: observation.id,
          rawName: observation.rawName,
          rawCode: observation.rawCode,
          rawUnit: observation.rawUnit,
          resourceType: observation.resourceType,
          origin: observation.origin,
          status: observation.status,
          candidates,
          suggestedUnitDefinitionId,
          identicalQuestion,
        };
      }),
    );
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  }

  /**
   * HUMAN DECISION — this observation is one SIMPROK already has. Record the
   * chosen existing ResourceCatalog identity on the observation. Mints nothing.
   * The chosen id must be a real, ACTIVE catalog row the workspace may see
   * (its own or a global one).
   *
   * IQL-01: with `rememberForIdenticalQuestions === true` the SAME row decision
   * is also offered as an exact-question learning CANDIDATE (a TEACH). That is
   * the only way learning begins, and it is never effective by itself.
   */
  async curateExisting(params: {
    workspaceId: string;
    observationId: string;
    selectedResourceCatalogId: string;
    actorAccountId: string;
    reason?: string | null;
    rememberForIdenticalQuestions?: boolean;
    decisionContextToken?: string | null;
  }) {
    if (params.rememberForIdenticalQuestions === true) {
      return this.curateExistingAndTeach(params);
    }
    return this.prisma.$transaction(async (tx) => {
      const observation = await this.loadOpen(
        tx,
        params.workspaceId,
        params.observationId,
      );
      const catalog = await tx.resourceCatalog.findFirst({
        where: {
          id: params.selectedResourceCatalogId,
          status: 'ACTIVE',
          OR: [{ workspaceId: params.workspaceId }, { workspaceId: null }],
        },
        select: { id: true },
      });
      if (!catalog)
        throw new ConflictException('SELECTED_RESOURCE_NOT_VISIBLE');
      return tx.observedResource.update({
        where: { id: observation.id },
        data: {
          status: ObservedResourceStatus.RESOLVED_EXISTING,
          resolvedResourceCatalogId: catalog.id,
          decidedByAccountId: params.actorAccountId,
          decidedAt: new Date(),
          reason: params.reason ?? null,
        },
      });
    });
  }

  /**
   * HUMAN DECISION — this observation is genuinely new. The reviewer names a
   * canonical unit (never invented here), and the ONE admission authority mints
   * exactly one ResourceCatalog + one ResourceSourceIdentity. Fails closed if the
   * identity turns out to still be known, if the unit is not representable, or if
   * the observation lacks the provenance a sighting requires.
   */
  async curateNew(params: {
    workspaceId: string;
    observationId: string;
    unitDefinitionId: string;
    actorAccountId: string;
    reason?: string | null;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const observation = await this.loadOpen(
          tx,
          params.workspaceId,
          params.observationId,
        );

        const unitDefinition = await tx.unitDefinition.findFirst({
          where: { id: params.unitDefinitionId, isActive: true },
        });
        if (!unitDefinition)
          throw new ConflictException('UNIT_UNKNOWN_OR_INACTIVE');

        // The Unit Kernel is the authority; a definition existing is not the
        // same fact as its code being resolvable. No new alias, no new rule.
        const unitProof = await this.unitKernel.resolve(
          unitDefinition.code,
          unitDefinition.code,
          undefined,
          // Behaviour-neutral against today's vocabulary — every canonical code
          // carries a context-free self-alias — but asked the same way as every
          // other proof on this path, so a future canonical unit catalogued
          // only under a context cannot silently fail this admission gate.
          trustedUnitContext(observation.resourceType),
        );
        if (unitProof.status !== UNIT_RESOLUTION_STATUS.RESOLVED) {
          throw new ConflictException(
            'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY',
          );
        }

        const admissionInput: AdmitObservedResourceInput = {
          workspaceId: params.workspaceId,
          rawName: observation.rawName,
          rawCode: observation.rawCode,
          rawUnit: observation.rawUnit,
          resourceType: observation.resourceType,
          baseUnit: unitDefinition.code,
          provenance: {
            sourceSha256: observation.sourceSha256 ?? '',
            sourceFileName: observation.sourceFileName ?? '',
            parserContractVersion: observation.parserContractVersion ?? '',
            sheetName: observation.sheetName ?? '',
            sourceRowNumber: observation.sourceRowNumber ?? 0,
            sourceNameCellAddress: observation.sourceNameCellAddress ?? '',
            sourceCodeCellAddress: observation.sourceCodeCellAddress,
            sourceUnitCellAddress: observation.sourceUnitCellAddress,
          },
        };

        const catalog = await this.admission
          .admitObservedResource(tx, admissionInput)
          .catch((error: unknown) => {
            if (error instanceof ResourceAdmissionNotExhaustedError) {
              throw new ConflictException('RESOURCE_IDENTITY_NOT_EXHAUSTED');
            }
            if (error instanceof ResourceProvenanceAlreadyBoundError) {
              throw new ConflictException('RESOURCE_PROVENANCE_ALREADY_BOUND');
            }
            if (error instanceof ResourceAdmissionProvenanceIncompleteError) {
              throw new ConflictException({
                statusCode: 409,
                error: 'Conflict',
                message: 'OBSERVATION_PROVENANCE_INCOMPLETE',
                missing: error.missing,
              });
            }
            throw error;
          });

        const updated = await tx.observedResource.update({
          where: { id: observation.id },
          data: {
            status: ObservedResourceStatus.ADMITTED_NEW,
            resolvedResourceCatalogId: catalog.id,
            decidedByAccountId: params.actorAccountId,
            decidedAt: new Date(),
            reason: params.reason ?? null,
          },
        });
        return { admittedResource: catalog, observation: updated };
      },
      // The admission advisory lock can make a genuine-race loser wait for the
      // winner's whole admission to commit; the default 5s would time that out.
      { timeout: 20_000, maxWait: 20_000 },
    );
  }

  // ===========================================================================
  // IQL-01 — GOVERNED EXACT-QUESTION LEARNING MEMORY
  //
  // One human decision on one row may be OFFERED as learning (TEACH). It
  // becomes reusable only through an APPROVE by a different authorized
  // account, only for a byte-identical question, and only through the existing
  // Resource Identity kernel. Every governance act is the next generation of an
  // append-only ledger; nothing here resolves, prices, or mints anything.
  // ===========================================================================

  /** APPROVE — the only act that makes an exact-question answer effective. */
  async approveQuestion(params: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    decisionContextToken?: string | null;
    reason?: string | null;
  }) {
    return this.governQuestion('APPROVE', params);
  }

  /** REJECT — a pending candidate leaves no memory. */
  async rejectQuestion(params: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    decisionContextToken?: string | null;
    reason?: string | null;
  }) {
    return this.governQuestion('REJECT', params);
  }

  /** SUPERSEDE — a different answer for an effective question; reuse stops until it is approved. */
  async supersedeQuestion(params: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    selectedResourceCatalogId?: string | null;
    decisionContextToken?: string | null;
    reason?: string | null;
  }) {
    return this.governQuestion('SUPERSEDE', params);
  }

  /** REVOKE — an approved answer stops being reused; its history stays. */
  async revokeQuestion(params: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    decisionContextToken?: string | null;
    reason?: string | null;
  }) {
    return this.governQuestion('REVOKE', params);
  }

  /**
   * Every exact question this workspace has governed: its current state, its
   * full history, and — for THIS actor — the doors governance allows. A READ:
   * nothing is written, and account ids never leave the server.
   *
   * `authority.mayDecide` is whether the actor holds full identity curation.
   * A second holder who may only judge sees APPROVE / REJECT for a pending
   * candidate, and never a REVOKE or SUPERSEDE door its routes would refuse.
   */
  async listQuestions(
    workspaceId: string,
    actorAccountId: string,
    authority: { mayDecide: boolean },
  ) {
    const rows = await this.prisma.resourceIdentityQuestionDecision.findMany({
      where: { workspaceId },
      orderBy: [{ questionKey: 'asc' }, { generation: 'asc' }],
      include: {
        selectedResourceCatalog: { select: { id: true, name: true } },
        originObservation: {
          select: {
            workspaceId: true,
            resourceType: true,
            rawName: true,
            rawCode: true,
            rawUnit: true,
          },
        },
      },
    });
    if (rows.length === 0) return [];

    const byQuestion = new Map<string, typeof rows>();
    for (const row of rows) {
      const events = byQuestion.get(row.questionKey) ?? [];
      events.push(row);
      byQuestion.set(row.questionKey, events);
    }
    // The machine's own verdicts, against ONE evidence load for the workspace.
    const evidence = await this.identity.loadEvidence(this.prisma, workspaceId);

    const views = await Promise.all(
      [...byQuestion.entries()].map(async ([questionKey, events]) => {
        const latestRow = events[events.length - 1];
        const byId = new Map(events.map((event) => [event.id, event]));
        const previousRow = latestRow.previousDecisionId
          ? (byId.get(latestRow.previousDecisionId) ?? null)
          : null;
        const latest = asQuestionEvent(latestRow);
        const state = identicalQuestionState(
          latest,
          previousRow ? asQuestionEvent(previousRow) : null,
        );
        // The answer this state is ABOUT: the pending candidate, the approved or
        // rejected answer, or the answer a revocation withdrew.
        const answerRow =
          state.kind === 'PENDING'
            ? latestRow
            : state.kind === 'APPROVED' || state.kind === 'REJECTED'
              ? previousRow
              : state.kind === 'REVOKED' && previousRow?.previousDecisionId
                ? (byId.get(previousRow.previousDecisionId) ?? null)
                : null;
        const origin = latestRow.originObservation;
        const verdict = await this.identity.resolve(
          evidence,
          this.referenceOf(origin),
        );
        const liveDigest = candidateDigestOf(verdict);
        const label = this.stateLabel(state, () => liveDigest);
        const authoredBy = answerRow?.decidedByAccountId ?? null;

        const mayApprove =
          state.kind === 'PENDING' && authoredBy !== actorAccountId;
        const mayReject = state.kind === 'PENDING';
        const mayRevoke = authority.mayDecide && state.kind === 'APPROVED';
        const maySupersede =
          authority.mayDecide &&
          label === 'EFFECTIVE' &&
          verdict.status !== 'RESOLVED' &&
          isIdenticalQuestionDecidable(verdict);
        const token =
          mayApprove || mayReject || mayRevoke || maySupersede
            ? this.issueQuestionContext({
                workspaceId,
                questionKey,
                actorAccountId,
                expectedGeneration: latest.generation,
                candidateContextDigest: liveDigest,
              })
            : null;
        const open = token !== null;

        return {
          questionKey,
          rawName: origin.rawName,
          rawCode: origin.rawCode,
          rawUnit: origin.rawUnit,
          resourceType: origin.resourceType,
          state: label,
          answer: answerRow?.selectedResourceCatalog
            ? {
                resourceCatalogId: answerRow.selectedResourceCatalog.id,
                name: answerRow.selectedResourceCatalog.name,
              }
            : null,
          authoredByYou: authoredBy !== null && authoredBy === actorAccountId,
          generation: latest.generation,
          decidedAt: latestRow.decidedAt,
          canApprove: open && mayApprove,
          canReject: open && mayReject,
          canRevoke: open && mayRevoke,
          canSupersede: open && maySupersede,
          supersedeCandidates:
            open && maySupersede
              ? verdict.candidates
                  .filter(
                    (candidate) =>
                      candidate.resourceCatalogId !==
                        answerRow?.selectedResourceCatalogId &&
                      !candidate.specificationUnproved,
                  )
                  .map((candidate) => ({
                    resourceCatalogId: candidate.resourceCatalogId,
                    name: candidate.name,
                  }))
              : [],
          decisionContextToken: token,
          history: events.map((event) => ({
            generation: event.generation,
            action: event.action,
            byYou: event.decidedByAccountId === actorAccountId,
            decidedAt: event.decidedAt,
            reason: event.reason,
          })),
        };
      }),
    );
    // What still needs a human first; then what is in force; then history.
    const order: Record<IdenticalQuestionStateLabel, number> = {
      PENDING: 0,
      EFFECTIVE: 1,
      INAPPLICABLE: 2,
      REJECTED: 3,
      REVOKED: 4,
      NONE: 5,
    };
    return views.sort((left, right) => order[left.state] - order[right.state]);
  }

  /**
   * TEACH — the row decision exactly as `curateExisting` records it, plus ONE
   * exact-question learning candidate. The signed context proves the human was
   * shown THIS question with THIS candidate set; the lock serializes the
   * question; the pure law decides append, replay or refusal.
   */
  private async curateExistingAndTeach(params: {
    workspaceId: string;
    observationId: string;
    selectedResourceCatalogId: string;
    actorAccountId: string;
    reason?: string | null;
    decisionContextToken?: string | null;
  }) {
    const token = params.decisionContextToken;
    if (typeof token !== 'string' || token.length === 0) {
      throw new BadRequestException('DECISION_CONTEXT_TOKEN_REQUIRED');
    }
    // The question is derived from raw fields no code path rewrites, so it can
    // be read before the lock; it is proven again inside it.
    const located = await this.prisma.observedResource.findFirst({
      where: { id: params.observationId, workspaceId: params.workspaceId },
    });
    if (!located) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    const questionKey = identicalQuestionKey(this.questionOf(located));
    const claims = this.tokens.verifyIdenticalQuestionContext(token, {
      workspaceId: params.workspaceId,
      questionKey,
      actorAccountId: params.actorAccountId,
      resolutionPolicyVersion: LIVE_POLICY,
    });

    return this.withQuestionRetry(() =>
      this.prisma.$transaction(
        async (txc) => {
          const tx = txc as Prisma.TransactionClient;
          await this.lockQuestion(tx, params.workspaceId, questionKey);
          const observation = await this.loadOpen(
            tx,
            params.workspaceId,
            params.observationId,
          );
          if (
            identicalQuestionKey(this.questionOf(observation)) !== questionKey
          ) {
            throw new ConflictException('QUESTION_PROVENANCE_MISMATCH');
          }
          const catalog = await tx.resourceCatalog.findFirst({
            where: {
              id: params.selectedResourceCatalogId,
              status: 'ACTIVE',
              OR: [{ workspaceId: params.workspaceId }, { workspaceId: null }],
            },
            select: { id: true },
          });
          if (!catalog)
            throw new ConflictException('SELECTED_RESOURCE_NOT_VISIBLE');

          const verdict = await this.machineVerdict(
            tx,
            params.workspaceId,
            this.referenceOf(observation),
          );
          const liveDigest = this.assertAnswerable(
            verdict,
            claims.candidateContextDigest,
            catalog.id,
          );
          const { latest, state } = this.readState(
            await this.latestQuestionRow(tx, params.workspaceId, questionKey),
          );
          const plan = planTeach({
            state,
            latest,
            expectedGeneration: claims.expectedGeneration,
            selectedResourceCatalogId: catalog.id,
            live: {
              candidateContextDigest: liveDigest,
              resolutionPolicyVersion: LIVE_POLICY,
            },
          });
          if (plan.outcome === 'CONFLICT') {
            throw new ConflictException(plan.code);
          }

          // The row decision itself — identical to the existing command.
          const decided = await tx.observedResource.update({
            where: { id: observation.id },
            data: {
              status: ObservedResourceStatus.RESOLVED_EXISTING,
              resolvedResourceCatalogId: catalog.id,
              decidedByAccountId: params.actorAccountId,
              decidedAt: new Date(),
              reason: params.reason ?? null,
            },
          });
          const event =
            plan.outcome === 'APPEND'
              ? await tx.resourceIdentityQuestionDecision.create({
                  data: {
                    workspaceId: params.workspaceId,
                    questionKey,
                    generation: plan.generation,
                    previousDecisionId: plan.previousDecisionId,
                    action: 'TEACH',
                    selectedResourceCatalogId: catalog.id,
                    candidateContextDigest: liveDigest,
                    resolutionPolicyVersion: LIVE_POLICY,
                    originObservationId: observation.id,
                    decidedByAccountId: params.actorAccountId,
                    reason: params.reason ?? null,
                  },
                })
              : plan.event;
          return {
            ...decided,
            identicalQuestion: {
              questionKey,
              decisionId: event.id,
              generation: event.generation,
              state:
                LABEL_AFTER[event.action === 'APPROVE' ? 'APPROVE' : 'TEACH'],
              replayed: plan.outcome === 'REPLAY',
            },
          };
        },
        { timeout: 20_000, maxWait: 20_000 },
      ),
    );
  }

  /** APPROVE / REJECT / SUPERSEDE / REVOKE — one path, one lock, one law. */
  private async governQuestion(
    action: Exclude<IdenticalQuestionAction, 'TEACH'>,
    params: {
      workspaceId: string;
      questionKey: string;
      actorAccountId: string;
      decisionContextToken?: string | null;
      reason?: string | null;
      selectedResourceCatalogId?: string | null;
    },
  ) {
    if (!QUESTION_KEY_SHAPE.test(params.questionKey)) {
      throw new NotFoundException('QUESTION_NOT_FOUND');
    }
    const reasonGiven =
      typeof params.reason === 'string' && params.reason.trim().length > 0;
    if (action !== 'APPROVE' && !reasonGiven) {
      throw new BadRequestException('REASON_REQUIRED');
    }
    const selected = params.selectedResourceCatalogId ?? null;
    if (action === 'SUPERSEDE' && !selected) {
      throw new BadRequestException('SELECTED_RESOURCE_CATALOG_ID_REQUIRED');
    }
    const token = params.decisionContextToken;
    if (typeof token !== 'string' || token.length === 0) {
      throw new BadRequestException('DECISION_CONTEXT_TOKEN_REQUIRED');
    }
    const claims = this.tokens.verifyIdenticalQuestionContext(token, {
      workspaceId: params.workspaceId,
      questionKey: params.questionKey,
      actorAccountId: params.actorAccountId,
      resolutionPolicyVersion: LIVE_POLICY,
    });

    return this.withQuestionRetry(() =>
      this.prisma.$transaction(
        async (txc) => {
          const tx = txc as Prisma.TransactionClient;
          await this.lockQuestion(tx, params.workspaceId, params.questionKey);
          const row = await this.latestQuestionRow(
            tx,
            params.workspaceId,
            params.questionKey,
          );
          if (!row) throw new NotFoundException('QUESTION_NOT_FOUND');
          // Every event carries its question's provenance; the raw question is
          // re-proven from it, never taken from the request.
          const origin = row.originObservation;
          if (
            identicalQuestionKey(this.questionOf(origin)) !== params.questionKey
          ) {
            throw new ConflictException('QUESTION_PROVENANCE_MISMATCH');
          }
          const reference = this.referenceOf(origin);
          const { latest, state } = this.readState(row);
          const base = {
            state,
            latest,
            expectedGeneration: claims.expectedGeneration,
            actorAccountId: params.actorAccountId,
          };

          let answer: {
            selectedResourceCatalogId: string;
            candidateContextDigest: string;
            resolutionPolicyVersion: string;
          } | null = null;
          let plan: GovernancePlan;
          if (action === 'APPROVE') {
            plan = planApprove(base);
            if (plan.outcome === 'APPEND' && state.kind === 'PENDING') {
              // The candidate must STILL answer the live question: machine
              // first, same candidate context, same policy, still a legitimate
              // spec-safe candidate.
              const verdict = await this.machineVerdict(
                tx,
                params.workspaceId,
                reference,
              );
              const liveDigest = this.assertAnswerable(
                verdict,
                claims.candidateContextDigest,
                state.candidate.selectedResourceCatalogId ?? '',
              );
              if (
                !isAnswerApplicable(state.candidate, {
                  candidateContextDigest: liveDigest,
                  resolutionPolicyVersion: LIVE_POLICY,
                })
              ) {
                throw new ConflictException('DECISION_CONTEXT_STALE');
              }
            }
          } else if (action === 'SUPERSEDE') {
            const verdict = await this.machineVerdict(
              tx,
              params.workspaceId,
              reference,
            );
            const liveDigest = this.assertAnswerable(
              verdict,
              claims.candidateContextDigest,
              selected as string,
            );
            plan = planSupersede({
              ...base,
              selectedResourceCatalogId: selected as string,
              live: {
                candidateContextDigest: liveDigest,
                resolutionPolicyVersion: LIVE_POLICY,
              },
            });
            answer = {
              selectedResourceCatalogId: selected as string,
              candidateContextDigest: liveDigest,
              resolutionPolicyVersion: LIVE_POLICY,
            };
          } else if (action === 'REJECT') {
            plan = planReject(base);
          } else {
            plan = planRevoke(base);
          }
          if (plan.outcome === 'CONFLICT') {
            throw new ConflictException(plan.code);
          }

          const event =
            plan.outcome === 'APPEND'
              ? await tx.resourceIdentityQuestionDecision.create({
                  data: {
                    workspaceId: params.workspaceId,
                    questionKey: params.questionKey,
                    generation: plan.generation,
                    previousDecisionId: plan.previousDecisionId,
                    action,
                    ...(answer ?? {}),
                    // A judging act keeps its question's provenance.
                    originObservationId: row.originObservationId,
                    decidedByAccountId: params.actorAccountId,
                    reason: reasonGiven ? (params.reason as string) : null,
                  },
                })
              : plan.event;

          const result = {
            questionKey: params.questionKey,
            decisionId: event.id,
            generation: event.generation,
            action: event.action,
            state: LABEL_AFTER[event.action],
            replayed: plan.outcome === 'REPLAY',
          };
          if (event.action !== 'APPROVE') return result;
          // Reported by re-running the SAME pipeline with the memory in place —
          // never asserted from the approval itself.
          const evidence = await this.identity.loadEvidence(
            tx,
            params.workspaceId,
            undefined,
            { identicalQuestionKeys: [params.questionKey] },
          );
          const after = await this.identity.resolve(evidence, reference, tx);
          return {
            ...result,
            identityAfterApproval: {
              status: after.status,
              authority: after.authority,
              resolvedResourceCatalogId: after.resolvedResourceCatalogId,
            },
          };
        },
        { timeout: 20_000, maxWait: 20_000 },
      ),
    );
  }

  /**
   * The exact-question state for ONE open row. Learning is offered only to a
   * known actor, only for a verdict an exact-question answer may settle, and
   * never while a candidate for the same question awaits judgement.
   */
  private describeOpenQuestion(params: {
    workspaceId: string;
    questionKey: string;
    resolution: ResourceIdentityResolution;
    latest: IdenticalQuestionLatestEvent | null;
    actorAccountId?: string;
  }) {
    const { questionKey, resolution, actorAccountId } = params;
    const latest = params.latest ? asQuestionEvent(params.latest) : null;
    const previous = params.latest?.previousDecision
      ? asQuestionEvent(params.latest.previousDecision)
      : null;
    const state = identicalQuestionState(latest, previous);
    const pending = state.kind === 'PENDING' ? state.candidate : null;
    const view = {
      questionKey,
      state: this.stateLabel(state, () => candidateDigestOf(resolution)),
      rememberable: false,
      decisionContextToken: null as string | null,
      pendingAnswerName: pending
        ? (resolution.candidates.find(
            (candidate) =>
              candidate.resourceCatalogId === pending.selectedResourceCatalogId,
          )?.name ?? null)
        : null,
      pendingAuthoredByYou:
        pending !== null &&
        actorAccountId !== undefined &&
        pending.decidedByAccountId === actorAccountId,
    };
    if (!actorAccountId || state.kind === 'PENDING') return view;
    if (
      resolution.status === 'RESOLVED' ||
      !isIdenticalQuestionDecidable(resolution)
    ) {
      return view;
    }
    const token = this.issueQuestionContext({
      workspaceId: params.workspaceId,
      questionKey,
      actorAccountId,
      expectedGeneration: latest?.generation ?? 0,
      candidateContextDigest: candidateDigestOf(resolution),
    });
    return token === null
      ? view
      : { ...view, rememberable: true, decisionContextToken: token };
  }

  private stateLabel(
    state: IdenticalQuestionState,
    liveDigest: () => string,
  ): IdenticalQuestionStateLabel {
    switch (state.kind) {
      case 'NONE':
        return 'NONE';
      case 'PENDING':
        return 'PENDING';
      case 'REJECTED':
        return 'REJECTED';
      case 'REVOKED':
        return 'REVOKED';
      case 'APPROVED':
        return isAnswerApplicable(state.answer, {
          candidateContextDigest: liveDigest(),
          resolutionPolicyVersion: LIVE_POLICY,
        })
          ? 'EFFECTIVE'
          : 'INAPPLICABLE';
    }
  }

  /**
   * The signed context, or null when the capability is not configured. A
   * missing secret disables learning only — never the curation list itself.
   */
  private issueQuestionContext(input: {
    workspaceId: string;
    questionKey: string;
    actorAccountId: string;
    expectedGeneration: number;
    candidateContextDigest: string;
  }): string | null {
    try {
      return this.tokens.issueIdenticalQuestionContext({
        ...input,
        resolutionPolicyVersion: LIVE_POLICY,
      });
    } catch (error) {
      if (error instanceof GhxDecisionContextConfigurationError) return null;
      throw error;
    }
  }

  /**
   * An answer must still answer the question its signed context described:
   * the machine did not resolve it, it is a question an exact-question answer
   * may settle, the candidate context is unchanged, and the chosen row is one
   * the machine itself nominated with its specification proven.
   */
  private assertAnswerable(
    verdict: ResourceIdentityResolution,
    signedDigest: string,
    selectedResourceCatalogId: string,
  ): string {
    if (verdict.status === 'RESOLVED') {
      throw new ConflictException(
        'NOT_HUMAN_DECIDABLE_IDENTITY_ALREADY_PROVEN',
      );
    }
    if (!isIdenticalQuestionDecidable(verdict)) {
      throw new ConflictException('NOT_IDENTICAL_QUESTION_DECIDABLE');
    }
    const liveDigest = candidateDigestOf(verdict);
    if (liveDigest !== signedDigest) {
      throw new ConflictException('DECISION_CONTEXT_STALE');
    }
    const chosen = verdict.candidates.find(
      (candidate) => candidate.resourceCatalogId === selectedResourceCatalogId,
    );
    if (!chosen || chosen.specificationUnproved) {
      throw new ConflictException('CANDIDATE_NOT_LEGITIMATE_FOR_LEARNING');
    }
    return liveDigest;
  }

  /** The machine's own verdict for a question — no governed memory applied. */
  private async machineVerdict(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    reference: RawResourceReference,
  ): Promise<ResourceIdentityResolution> {
    const evidence = await this.identity.loadEvidence(tx, workspaceId);
    return this.identity.resolve(evidence, reference, tx);
  }

  /** Serialize governance of ONE exact question — the first statement of its transaction. */
  private async lockQuestion(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    questionKey: string,
  ): Promise<void> {
    const key = resourceAdmissionLockKey(`${workspaceId}|${questionKey}`);
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${IQL01_LOCK_NAMESPACE}::int4, ${key}::int4)`,
    );
  }

  private latestQuestionRow(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    questionKey: string,
  ) {
    const questionFields = {
      select: {
        workspaceId: true,
        resourceType: true,
        rawName: true,
        rawCode: true,
        rawUnit: true,
      },
    } as const;
    return tx.resourceIdentityQuestionDecision.findFirst({
      where: { workspaceId, questionKey },
      orderBy: { generation: 'desc' },
      include: {
        originObservation: questionFields,
        previousDecision: true,
      },
    });
  }

  private readState(
    row:
      | (Parameters<typeof asQuestionEvent>[0] & {
          previousDecision: Parameters<typeof asQuestionEvent>[0] | null;
        })
      | null,
  ): { latest: IdenticalQuestionEvent | null; state: IdenticalQuestionState } {
    const latest = row ? asQuestionEvent(row) : null;
    const previous = row?.previousDecision
      ? asQuestionEvent(row.previousDecision)
      : null;
    return { latest, state: identicalQuestionState(latest, previous) };
  }

  /** Bounded retry for a serialization failure or a lost generation race only. */
  private async withQuestionRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (attempt < QUESTION_RETRY_LIMIT && isRetryableQuestionWrite(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /** The exact question an observation asks, verbatim from its raw fields. */
  private questionOf(observation: {
    workspaceId: string;
    resourceType: string;
    rawName: string;
    rawCode: string | null;
    rawUnit: string | null;
  }): IdenticalQuestion {
    return {
      workspaceId: observation.workspaceId,
      resourceType: observation.resourceType,
      rawName: observation.rawName,
      rawCode: observation.rawCode,
      rawUnit: observation.rawUnit,
    };
  }

  private referenceOf(observation: {
    rawName: string;
    rawCode: string | null;
    rawUnit: string | null;
    resourceType: string;
  }): RawResourceReference {
    return {
      rawName: observation.rawName,
      rawCode: observation.rawCode,
      rawUnit: observation.rawUnit,
      resourceType: observation.resourceType,
    };
  }

  private async loadOpen(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    observationId: string,
  ) {
    const observation = await tx.observedResource.findFirst({
      where: { id: observationId, workspaceId },
    });
    if (!observation) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    if (observation.status !== ObservedResourceStatus.OBSERVED) {
      throw new ConflictException('OBSERVATION_ALREADY_DECIDED');
    }
    return observation;
  }
}

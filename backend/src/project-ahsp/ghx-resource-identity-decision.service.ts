import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  isHumanDecidable,
} from '../resource-catalog/resource-identity-resolution.kernel';
import { candidateContextDigest } from '../resource-catalog/ghx-candidate-context';
import {
  GhxDecisionContextTokenService,
} from '../resource-catalog/ghx-decision-context-token.service';
import {
  ResourceIdentityEvidence,
  ResourceIdentityResolutionService,
} from '../resource-catalog/resource-identity-resolution.service';
import { E1A_RESOLUTION_POLICY_VERSION } from './ahsp-resource-resolution.orchestrator';

/**
 * GHX-01 — the governed human Resource Identity decision: READ the current
 * question, and RECORD the answer.
 *
 * TWO COMMANDS, ONE LAW. The read issues a bounded, signed decision context; the
 * write spends it. Both derive every fact server-side from the target resolution
 * — the client supplies a resolution id, a chosen candidate and a token, and
 * nothing else. Workspace, source fact, project, occurrence, AHSP version, actor,
 * policy, generation, candidate set and digest are never taken from input.
 *
 * THIS SERVICE RESOLVES NOTHING. It does not decide identity, does not price, and
 * does not write an occurrence. It records governed MEMORY, and the existing
 * Resource Identity pipeline consumes that memory on the next normal
 * reevaluation. That separation is what keeps one resolver and one current truth.
 */

/** What a human needs to answer the question, and nothing more. */
export interface GhxDecisionContextView {
  readonly humanDecidable: boolean;
  /** Plain business reason, safe for a future UI to show verbatim. */
  readonly reason: string;
  readonly resource: {
    readonly statedName: string;
    readonly statedType: string;
    readonly statedUnit: string;
  };
  readonly candidates: ReadonlyArray<{
    readonly resourceCatalogId: string;
    readonly name: string;
    readonly type: string;
    readonly baseUnit: string;
    readonly specifications: unknown;
  }>;
  /** Present only when a decision may lawfully be made. */
  readonly decisionContextToken: string | null;
  readonly currentDecision: {
    readonly generation: number;
    readonly selectedResourceCatalogId: string;
    readonly applicable: boolean;
  } | null;
}

export interface GhxDecideInput {
  readonly projectId: string;
  readonly resolutionId: string;
  readonly actorAccountId: string;
  readonly workspaceId: string;
  readonly selectedResourceCatalogId: string;
  readonly reason?: string | null;
  readonly decisionContextToken: string;
}

export interface GhxDecideResult {
  readonly decisionId: string;
  readonly generation: number;
  readonly idempotent: boolean;
  readonly selectedResourceCatalogId: string;
  /**
   * The Resource Identity truth AFTER the decision, produced by re-running the
   * EXISTING pipeline with the new memory in place — never asserted from the
   * human's choice directly. If Unit or any other independent truth is still
   * unproved, this reports that honestly.
   */
  readonly identityAfterDecision: {
    readonly status: string;
    readonly authority: string | null;
    readonly resolvedResourceCatalogId: string | null;
  };
}

/** Bounded retry for genuine serialization failures only. Never a spin. */
const SERIALIZATION_RETRY_LIMIT = 1;
const SERIALIZATION_FAILURE = '40001';

/**
 * The subject/generation unique index, by name. Prisma reports the constraint in
 * `meta.target`; matching it explicitly is what keeps an unrelated unique
 * violation from being mistaken for the expected race.
 */
const SUBJECT_GENERATION_CONSTRAINT =
  'ahsp_resource_identity_decisions_subject_generation_key';

function isSubjectGenerationRace(
  error: Prisma.PrismaClientKnownRequestError,
): boolean {
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const named = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return (
    named.includes(SUBJECT_GENERATION_CONSTRAINT) ||
    // Prisma may report the composing COLUMNS instead of the index name. The
    // match must then be the FULL unique subject — workspaceId + ahspResourceId
    // + generation. A partial pair would let a different future unique index
    // that happens to share two of these columns be mistaken for this race.
    (named.includes('workspaceId') &&
      named.includes('ahspResourceId') &&
      named.includes('generation'))
  );
}

@Injectable()
export class GhxResourceIdentityDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: ResourceIdentityResolutionService,
    private readonly tokens: GhxDecisionContextTokenService,
  ) {}

  /**
   * Load the target resolution and everything the subject is derived FROM.
   *
   * Tenant scope is proven here, once: the occurrence's own workspace must equal
   * the caller's authorized workspace, and the resolution must belong to the
   * project on the route. A resolution from another tenant is simply not found —
   * the caller learns nothing about whether it exists.
   */
  private async loadSubject(
    tx: Prisma.TransactionClient,
    params: { projectId: string; resolutionId: string; workspaceId: string },
  ) {
    const resolution = await tx.projectAhspResourceResolution.findFirst({
      where: {
        id: params.resolutionId,
        occurrence: {
          projectId: params.projectId,
          workspaceId: params.workspaceId,
        },
      },
      include: {
        occurrence: { include: { project: { select: { id: true, name: true } } } },
        originalResource: true,
      },
    });
    if (!resolution) throw new NotFoundException('RESOLUTION_NOT_FOUND');
    return resolution;
  }

  /**
   * Re-run the CURRENT machine verdict for this resolution's source fact, using
   * the caller's transaction so every evidence read shares one snapshot.
   *
   * Machine-first lives here: whatever this returns is the truth the human path
   * must respect. If it resolved, there is no question to ask.
   */
  private async currentMachineVerdict(
    tx: Prisma.TransactionClient,
    resolution: Awaited<ReturnType<GhxResourceIdentityDecisionService['loadSubject']>>,
  ) {
    const workspaceId = resolution.occurrence.workspaceId;
    const ahspResourceId = resolution.ahspResourceId;
    const evidence = await this.identity.loadEvidence(tx, workspaceId, [
      ahspResourceId,
    ]);
    const verdict = await this.identity.resolve(
      // MACHINE-ONLY, DELIBERATELY. `ghxSubject` is withheld so this verdict is
      // what the machine can prove BY ITSELF, with no governed memory applied.
      //
      // Including it was a real defect: once a decision existed, a replay of the
      // very same command saw RESOLVED/VERIFIED_MAPPING_REUSED and was rejected
      // as "identity already proven" — the idempotent branch became unreachable
      // and a safe retry looked like an error. The write must judge the HUMAN
      // question against machine truth; whether memory already answers it is a
      // separate question, answered from the decision row itself below.
      evidence,
      {
        rawName: resolution.rawAhspResourceRef,
        rawCode: null,
        rawUnit: resolution.ahspUnit,
        resourceType: resolution.rawAhspResourceType,
      },
      tx,
    );
    return { evidence, verdict, workspaceId, ahspResourceId };
  }

  /**
   * DEFECT 4 — reevaluate through the SAME pipeline, never by assertion.
   *
   * Once memory exists, the resulting truth is produced by re-running the
   * existing Resource Identity service WITH the subject supplied, so the verdict
   * comes from the one kernel and carries its own provenance. It is never
   * written as "the human chose X, therefore identity = X": if the decision has
   * since become inapplicable, or Unit and other independent truth remain
   * unproved, this reports that honestly instead of inventing certainty.
   *
   * `preloaded` exists for the READ, and only for the READ. The write MUST
   * re-load, because it calls this AFTER creating a decision row and the
   * evidence it judged the command against was captured BEFORE — reusing that
   * snapshot would report the truth as it was one statement ago. The read
   * changes nothing, so its evidence is still current and a second identical
   * load would be a round trip that provably cannot change the answer.
   */
  private async reevaluateWithMemory(
    tx: Prisma.TransactionClient,
    resolution: Awaited<ReturnType<GhxResourceIdentityDecisionService['loadSubject']>>,
    preloaded?: ResourceIdentityEvidence,
  ) {
    const workspaceId = resolution.occurrence.workspaceId;
    const ahspResourceId = resolution.ahspResourceId;
    const evidence =
      preloaded ??
      (await this.identity.loadEvidence(tx, workspaceId, [ahspResourceId]));
    const verdict = await this.identity.resolve(
      {
        ...evidence,
        ghxSubject: {
          workspaceId,
          ahspResourceId,
          resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
        },
      },
      {
        rawName: resolution.rawAhspResourceRef,
        rawCode: null,
        rawUnit: resolution.ahspUnit,
        resourceType: resolution.rawAhspResourceType,
      },
      tx,
    );
    return {
      status: verdict.status,
      authority: verdict.authority,
      resolvedResourceCatalogId: verdict.resolvedResourceCatalogId,
    };
  }

  /** The bounded candidate set, in the exact shape the digest is computed over. */
  private candidateEntries(
    verdict: { candidates: ReadonlyArray<{ resourceCatalogId: string; name: string; type: string; baseUnit: string; specifications: unknown }> },
  ) {
    return verdict.candidates.map((candidate) => ({
      resourceCatalogId: candidate.resourceCatalogId,
      name: candidate.name,
      type: candidate.type,
      baseUnit: candidate.baseUnit,
      specifications: candidate.specifications,
    }));
  }

  private async latestDecision(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    ahspResourceId: string,
  ) {
    return tx.ahspResourceIdentityDecision.findFirst({
      where: { workspaceId, ahspResourceId },
      orderBy: { generation: 'desc' },
    });
  }

  /**
   * READ — what is the current legitimate question, and may a human answer it?
   *
   * Runs in REPEATABLE READ so the candidate set the human is shown, the digest
   * that describes it and the generation the token pins are all one consistent
   * reality rather than three separate snapshots.
   *
   * TWO VERDICTS, TWO DIFFERENT QUESTIONS, AND CONFLATING THEM WAS A DEFECT.
   *
   *   MACHINE-ONLY  — "is this a question a human MAY answer?" The candidate set
   *                   and human-decidability come from here, because a human may
   *                   only choose between rows the machine itself nominated.
   *   WITH MEMORY   — "is this question STILL OPEN?" This is the verdict the
   *                   occurrence lifecycle will actually reach, so it is the only
   *                   honest basis for saying whether anything remains to decide.
   *
   * Deciding both from the machine-only verdict — as this did — made the read lie
   * twice over once a decision existed: it offered a fresh decision context for a
   * question governed memory had already answered, and it reported the decision
   * being applied downstream as `applicable: false`. It also made the
   * VERIFIED_MAPPING_REUSED branch below unreachable, so the one sentence that
   * says "a recorded human decision settled this" could never be shown.
   *
   * Nothing new resolves anything: both verdicts come from the SAME pipeline and
   * the SAME kernel, and the read still writes nothing.
   */
  async readContext(params: {
    projectId: string;
    resolutionId: string;
    workspaceId: string;
    actorAccountId: string;
  }): Promise<GhxDecisionContextView> {
    return this.prisma.$transaction(
      async (tx) => {
        const resolution = await this.loadSubject(tx as Prisma.TransactionClient, params);
        const { evidence, verdict, workspaceId, ahspResourceId } =
          await this.currentMachineVerdict(tx as Prisma.TransactionClient, resolution);

        const base = {
          resource: {
            statedName: resolution.rawAhspResourceRef,
            statedType: resolution.rawAhspResourceType,
            statedUnit: resolution.ahspUnit,
          },
          candidates: this.candidateEntries(verdict),
        };

        // Already settled by the machine ALONE. Memory is not even consulted —
        // machine-first, and there is no question to ask.
        if (verdict.status === 'RESOLVED') {
          return {
            ...base,
            humanDecidable: false,
            reason:
              'Identitas sudah terbukti otomatis. Tidak ada keputusan manusia yang diperlukan.',
            decisionContextToken: null,
            currentDecision: null,
          };
        }

        if (!isHumanDecidable(verdict)) {
          return {
            ...base,
            humanDecidable: false,
            // The machine's own explanation, which already says WHY in business
            // terms — never a fabricated review opportunity.
            reason: verdict.explanation,
            decisionContextToken: null,
            currentDecision: null,
          };
        }

        const latest = await this.latestDecision(
          tx as Prisma.TransactionClient,
          workspaceId,
          ahspResourceId,
        );

        // The question is one a human MAY answer. Is it still OPEN? Only the
        // memory-applied pipeline can say, and it is the same pipeline the next
        // normal evaluation will run.
        const settled = await this.reevaluateWithMemory(
          tx as Prisma.TransactionClient,
          resolution,
          evidence,
        );
        if (settled.status === 'RESOLVED' && latest) {
          return {
            ...base,
            humanDecidable: false,
            reason:
              'Identitas sudah ditetapkan oleh keputusan manusia yang tercatat. ' +
              'Tidak ada pertanyaan yang terbuka.',
            decisionContextToken: null,
            currentDecision: {
              generation: latest.generation,
              selectedResourceCatalogId: latest.selectedResourceCatalogId,
              applicable: true,
            },
          };
        }

        const digest = candidateContextDigest(base.candidates);

        return {
          ...base,
          humanDecidable: true,
          reason: verdict.explanation,
          decisionContextToken: this.tokens.issue({
            workspaceId,
            ahspResourceId,
            originResolutionId: resolution.id,
            actorAccountId: params.actorAccountId,
            resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
            expectedGeneration: latest?.generation ?? 0,
            candidateContextDigest: digest,
          }),
          currentDecision: latest
            ? {
                generation: latest.generation,
                selectedResourceCatalogId: latest.selectedResourceCatalogId,
                // A decision is on record and the memory-applied pipeline still
                // did NOT settle this — so it genuinely does not apply, and now
                // that is a measured fact rather than an assumption.
                applicable: false,
              }
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * WRITE — record the decision, exactly once.
   *
   * Bounded retry exists for ONE reason: PostgreSQL may abort a REPEATABLE READ
   * transaction with 40001 when a concurrent writer touched the same rows. That
   * is an expected, safe-to-retry outcome and nothing else is retried — a
   * business conflict, a stale context or a permission failure is final.
   */
  async decide(input: GhxDecideInput): Promise<GhxDecideResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.decideOnce(input);
      } catch (error) {
        if (
          attempt < SERIALIZATION_RETRY_LIMIT &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === SERIALIZATION_FAILURE || error.code === 'P2034')
        ) {
          continue;
        }
        // A unique violation on the subject/generation index is the expected
        // race, and it is resolved by re-reading the winner in a NEW
        // transaction — never by retrying the same losing write.
        // ONLY the exact subject/generation uniqueness race is reconciled. Any
        // other unique violation is a different bug and must surface as itself —
        // swallowing arbitrary P2002s would hide real defects behind a
        // reassuring "idempotent success".
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          isSubjectGenerationRace(error)
        ) {
          return this.resolveGenerationRace(input);
        }
        throw error;
      }
    }
  }

  private async decideOnce(input: GhxDecideInput): Promise<GhxDecideResult> {
    return this.prisma.$transaction(
      async (txc) => {
        const tx = txc as Prisma.TransactionClient;
        const resolution = await this.loadSubject(tx, input);
        const workspaceId = resolution.occurrence.workspaceId;
        const ahspResourceId = resolution.ahspResourceId;

        // 1. TOKEN — integrity and every binding, before any real work.
        const claims = this.tokens.verify(input.decisionContextToken, {
          workspaceId,
          ahspResourceId,
          originResolutionId: resolution.id,
          actorAccountId: input.actorAccountId,
          resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
        });

        // 2. SERIALIZE THIS SUBJECT, and only this subject. The AHSP source fact
        //    is immutable, so this lock contends with nothing except a competing
        //    decision about the very same fact.
        await tx.$queryRaw`SELECT "id" FROM "ahsp_resources" WHERE "id" = ${ahspResourceId}::uuid FOR UPDATE`;

        // 3. MACHINE FIRST, re-read inside the lock and the snapshot.
        const { verdict } = await this.currentMachineVerdict(tx, resolution);
        if (verdict.status === 'RESOLVED') {
          throw new ConflictException('NOT_HUMAN_DECIDABLE_IDENTITY_ALREADY_PROVEN');
        }
        if (!isHumanDecidable(verdict)) {
          throw new ConflictException('NOT_HUMAN_DECIDABLE');
        }

        // 4. IS THIS STILL THE SAME QUESTION?
        const candidates = this.candidateEntries(verdict);
        const liveDigest = candidateContextDigest(candidates);
        if (liveDigest !== claims.candidateContextDigest) {
          throw new ConflictException('DECISION_CONTEXT_STALE');
        }

        // 5. The selection must be one of the rows the machine itself nominated,
        //    and must still be spec-safe. `isHumanDecidable` already excluded
        //    SPECIFICATION_UNPROVED verdicts; this pins the chosen row.
        const chosen = verdict.candidates.find(
          (candidate) => candidate.resourceCatalogId === input.selectedResourceCatalogId,
        );
        if (!chosen) throw new ConflictException('CANDIDATE_NOT_LEGITIMATE');
        if (chosen.specificationUnproved) {
          throw new ConflictException('CANDIDATE_SPECIFICATION_UNPROVED');
        }

        // 6. Generation is SERVER-CONTROLLED, derived under the lock.
        const latest = await this.latestDecision(tx, workspaceId, ahspResourceId);
        const currentGeneration = latest?.generation ?? 0;

        // Identical decision already on record → idempotent, no second row.
        if (
          latest &&
          latest.selectedResourceCatalogId === input.selectedResourceCatalogId &&
          latest.candidateContextDigest === liveDigest &&
          latest.resolutionPolicyVersion === E1A_RESOLUTION_POLICY_VERSION
        ) {
          return {
            decisionId: latest.id,
            generation: latest.generation,
            idempotent: true,
            selectedResourceCatalogId: latest.selectedResourceCatalogId,
            identityAfterDecision: await this.reevaluateWithMemory(tx, resolution),
          };
        }

        // A decision landed since the context was issued and it is NOT identical.
        if (currentGeneration !== claims.expectedGeneration) {
          throw new ConflictException('DECISION_GENERATION_STALE');
        }

        const created = await tx.ahspResourceIdentityDecision.create({
          data: {
            workspaceId,
            ahspResourceId,
            selectedResourceCatalogId: input.selectedResourceCatalogId,
            generation: currentGeneration + 1,
            previousDecisionId: latest?.id ?? null,
            candidateContextDigest: liveDigest,
            candidateCountAtDecision: candidates.length,
            resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
            decidedByAccountId: input.actorAccountId,
            reason: input.reason ?? null,
            // Origin is derived, never client-authored.
            originProjectId: resolution.occurrence.projectId,
            originProjectName: resolution.occurrence.project.name,
            originOccurrenceId: resolution.occurrenceId,
            originResolutionId: resolution.id,
            originAhspVersionId: resolution.occurrence.ahspVersionId,
          },
        });

        return {
          decisionId: created.id,
          generation: created.generation,
          idempotent: false,
          selectedResourceCatalogId: created.selectedResourceCatalogId,
          identityAfterDecision: await this.reevaluateWithMemory(tx, resolution),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * The loser of a generation race re-reads the winner in a NEW transaction —
   * the aborted one cannot be queried further.
   *
   * If the winner recorded the SAME decision, both callers were asking for the
   * same truth and both succeed against one row. If it recorded something else,
   * the loser's context is genuinely stale and it is told so.
   */
  /**
   * The loser of a generation race reconciles in a REAL FRESH TRANSACTION.
   *
   * Two things were wrong before and both are corrected here. The old code
   * cast the global client to `Prisma.TransactionClient` — a TypeScript cast
   * creates no BEGIN, no snapshot and no commit, so the reconciliation read a
   * different reality than the one it was reasoning about. And it compared the
   * winner against a digest lifted from the token WITHOUT verifying the
   * signature: a forged or malformed token could then decide whether a real
   * decision counted as this caller's own.
   *
   * Now the token is re-verified inside the fresh transaction and only VERIFIED
   * claims are trusted. Unsigned token content has no authority anywhere.
   */
  private async resolveGenerationRace(
    input: GhxDecideInput,
  ): Promise<GhxDecideResult> {
    return this.prisma.$transaction(
      async (txc) => {
        const tx = txc as Prisma.TransactionClient;
        const resolution = await this.loadSubject(tx, input);
        const workspaceId = resolution.occurrence.workspaceId;
        const ahspResourceId = resolution.ahspResourceId;

        // FULL verification, again, against this fresh truth boundary.
        const claims = this.tokens.verify(input.decisionContextToken, {
          workspaceId,
          ahspResourceId,
          originResolutionId: resolution.id,
          actorAccountId: input.actorAccountId,
          resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
        });

        const winner = await this.latestDecision(tx, workspaceId, ahspResourceId);

        // SEMANTIC replay identity, from VERIFIED claims only. The same catalog
        // row chosen under a different candidate context or policy is a
        // different command, not a replay of this one.
        if (
          winner &&
          winner.selectedResourceCatalogId === input.selectedResourceCatalogId &&
          winner.candidateContextDigest === claims.candidateContextDigest &&
          winner.resolutionPolicyVersion === E1A_RESOLUTION_POLICY_VERSION
        ) {
          return {
            decisionId: winner.id,
            generation: winner.generation,
            idempotent: true,
            selectedResourceCatalogId: winner.selectedResourceCatalogId,
            identityAfterDecision: await this.reevaluateWithMemory(tx, resolution),
          };
        }
        throw new ConflictException('DECISION_SUPERSEDED');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

}

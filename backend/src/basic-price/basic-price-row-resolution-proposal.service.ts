import { Injectable } from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  UNIT_ALIAS_CONTEXT,
  UNIT_KERNEL_POLICY_VERSION,
  UNIT_RESOLUTION_STATUS,
  UnitAliasContext,
} from '../unit-kernel/unit-kernel.contracts';
import {
  RESOURCE_IDENTITY_POLICY_VERSION,
  ResourceIdentityResolutionService,
  type EvidenceClient,
} from '../resource-catalog/resource-identity-resolution.service';
import { ResourceIdentityCandidate } from '../resource-catalog/resource-identity-resolution.kernel';

/**
 * INT-CONNECT-01 — THE SEAM, NOT A SECOND AUTHORITY.
 *
 * Basic Price already owned two canonical authorities and asked neither of them
 * anything until AFTER a human had done the work by hand: the Unit Kernel was
 * consulted only to VERIFY a unit a reviewer had already typed and picked, and
 * Resource Identity was consulted only to REFUSE admission of a new catalog row.
 * Both engines could have answered first. Nobody asked.
 *
 * This service asks. It contains no matching logic, no normalization, no alias
 * table, no name comparison and no threshold of its own: `UnitKernelService` and
 * `ResourceIdentityResolutionService` remain the SOURCE OF TRUTH for what a raw
 * unit spelling and a raw resource name mean, and nothing here re-derives,
 * second-guesses or replaces either of them.
 *
 * IT IS A PROJECTION, NOT A BYTE-FOR-BYTE PIPE — and the distinction matters
 * enough to state, because an earlier note here said every verdict was returned
 * "verbatim" and that was too broad. This seam projects the authorities'
 * governed facts into the Basic Price workflow contract, and lawfully ADDS the
 * workflow-specific safety state that contract needs:
 *
 *   NOT_STATED                            a source row that carried no unit, so
 *                                         the authority was deliberately never asked
 *   ROW_SOURCE_SECTION_UNRESOLVED         the row's family is unknown, so identity
 *                                         was deliberately never asked
 *   UNIT_NOT_REPRESENTABLE_BY_...         a canonical code that did not round-trip
 *   admissibleForResolve                  Basic Price's own actionability question
 *   identityPairProven / blockingFacts    this workflow's preconditions, named
 *
 * and lawfully OMITS what this workflow does not need — see the outward-boundary
 * note below on `explanation`. Adding safety state and narrowing a projection are
 * both different from deciding identity, and this file does only the former.
 *
 * Its whole job is to call the authorities once per batch, in bounded queries,
 * and to say plainly which backend precondition each row still fails.
 *
 * IT PROPOSES. IT NEVER DECIDES, AND IT NEVER WRITES.
 *
 * Nothing here persists a resolution, and that is a deliberate reading of the
 * law rather than an omission. `BasicPriceImportRowResourceMapping` — the
 * append-only record every resolve MUST produce — carries a NOT NULL
 * `reviewerAccountId` with a foreign key to a real Account. There is no truthful
 * way for a machine to write that record, and writing a resolution WITHOUT it
 * would both break the audit contract and make a proposal indistinguishable from
 * a decision to every other reader of the row (collision detection joins on
 * `resourceCatalogId`). So the machine's work stops exactly where human
 * authority begins: SIMPROK arrives with the answer already proven and its
 * reason attached, and a human still performs the act that binds it.
 *
 * REUSE THIS SEAM. DO NOT REPLICATE THE DOMAIN LOGIC BEHIND IT. If another
 * workflow needs to know what a raw unit or a raw resource name means, it must
 * call the same two authorities — never re-derive their answers here or anywhere.
 *
 * ---------------------------------------------------------------------------
 * THE OUTWARD BOUNDARY: RICH INSIDE, MINIMUM NECESSARY OUTSIDE.
 *
 * This seam is a PROJECTION, not a pipe. What each authority knows and what
 * Basic Price sends to a browser are two different sets, and the second is the
 * smaller one by design.
 *
 * NEITHER AUTHORITY'S `explanation` IS CARRIED OUT OF HERE. Both engines build
 * one, both keep it, and both are right to: an auditor reading
 * `ResourceIdentityResolution.explanation` needs the ResourceCatalog row ids it
 * names, the model vocabulary, the raw reason codes, the deciding alias ids —
 * and on the governed-decision path the account, the moment and the free-text
 * note of the human who settled it. Every one of those is lawful INTERNAL
 * knowledge and none of it is deleted, archived, or made harder to reach.
 *
 * It is simply not COPIED into this proposal. Basic Price does not need a
 * sentence written for an auditor; it needs the structured facts its review room
 * acts on — status, ids it may select, candidate names/codes/units, named reason
 * codes, and the two booleans that gate the action. The reviewer's sentence is
 * composed from exactly those facts by `rowMachineNarrative` on the frontend,
 * which is the one canonical normal-user narrative.
 *
 * SO THERE IS NOTHING TO SANITISE, AND NOTHING TO OUTWIT. A private note cannot
 * leak through a string this contract does not have. Do not reintroduce it under
 * another name — no `rawExplanation`, no `internalExplanation`, no
 * `debugExplanation`, no `machineExplanation`. If an auditor surface is ever
 * built, it reads the authorities directly under its own law, not this one.
 * ---------------------------------------------------------------------------
 */

/** What the Unit authority proved about ONE row's raw unit spelling. */
export interface BasicPriceRowUnitProposal {
  /** The source cell, verbatim. Null stays null; blank stays blank. */
  rawUnit: string | null;
  /**
   * The Unit authority's own verdict vocabulary, plus `NOT_STATED` for the one
   * case the authority is deliberately never asked about: a source row that
   * carried no unit at all. Resolving '' would make safety depend on the
   * catalogue happening to hold no empty alias, so the kernel is not consulted
   * and this does not report a verdict nobody gave.
   */
  status: 'RESOLVED' | 'NEEDS_REVIEW' | 'NOT_STATED';
  unitDefinitionId: string | null;
  unitCode: string | null;
  unitDisplayName: string | null;
  unitSymbol: string | null;
  unitDimension: string | null;
  /** Needed so the review room can pre-fill its existing selector honestly. */
  unitKind: string | null;
  /** UNIT_REASON code, or `UNIT_REQUIRED` — the intake's own existing code. */
  reasonCode: string;
  /** True when a context-scoped alias answered; the meaning holds only there. */
  contextScoped: boolean;
  /** The governed class the answer actually depended on, or null. */
  trustedContext: string | null;
  policyVersion: string;
}

/** One catalog row the identity authority nominated, described for a human. */
export interface BasicPriceRowResourceCandidate {
  resourceCatalogId: string;
  name: string;
  code: string | null;
  type: string;
  baseUnit: string;
  evidence: string[];
  specificationUnproved: boolean;
  unprovedSpecificationFacts: string[];
  /**
   * THE EXISTENCE OF A PRIOR HUMAN DECISION, AND NOTHING ELSE.
   *
   * The internal `PriorHumanDecision` the identity authority builds carries a
   * reviewer account id, a timestamp and the reviewer's free-text reason. Every
   * one of those is legitimate INTERNAL evidence — and none of it belongs in
   * another person's browser. A batch is user-owned: account B reviewing B's own
   * import must not read the private note account A typed on A's batch, even
   * though both work in the same workspace and SIMPROK may lawfully KNOW about
   * A's decision.
   *
   * So this is the whole outward projection: a boolean. The reviewer's identity,
   * the moment they decided, and what they wrote stay inside the engine.
   *
   * IT IS NOT A DOWNGRADE OF THE KNOWLEDGE. `decidedAt` and `mappingId` still
   * decide, internally, WHICH mapping is the latest for a catalog row; the
   * mapping's `rawName`/`rawCode`/`resourceType` still nominate candidates
   * through REVIEWED_MAPPING_NAME_MATCH / REVIEWED_MAPPING_CODE_MATCH. Nothing
   * is deleted, archived, or stopped from being loaded. Only the projection is
   * narrowed — which is where privacy belongs, not in making SIMPROK forget.
   */
  hasPriorHumanDecision: boolean;
}

/**
 * THE ONE DEFINITION OF "A BASIC PRICE-SAFE CANDIDATE".
 *
 * Built FIELD BY FIELD, never spread from the authority's candidate — a spread
 * would carry whatever the engine adds next straight into a browser, and that is
 * exactly how the rich `priorHumanDecision` and the raw `specifications` blob
 * reached an outward response before this projection existed.
 *
 * It lives here, exported, because Basic Price has TWO outward seams that hand a
 * reviewer candidates — the review room's `machineProposal` and the resolve
 * lifecycle's identity refusal — and two copies of a privacy rule is one copy
 * too many. They drift, and the looser one is the one that eventually ships.
 *
 * Pure, and deliberately takes the kernel's own candidate type so a change to
 * that type surfaces here at compile time rather than as a silent leak.
 */
export const toBasicPriceSafeCandidate = (
  candidate: ResourceIdentityCandidate,
): BasicPriceRowResourceCandidate => ({
  resourceCatalogId: candidate.resourceCatalogId,
  name: candidate.name,
  code: candidate.code,
  type: candidate.type,
  baseUnit: candidate.baseUnit,
  evidence: [...candidate.evidence],
  specificationUnproved: candidate.specificationUnproved,
  unprovedSpecificationFacts: [...candidate.unprovedSpecificationFacts],
  // The prior decision collapses to its EXISTENCE here and nowhere else.
  hasPriorHumanDecision: candidate.priorHumanDecision !== null,
});

/** What the Resource Identity authority proved about ONE row's raw name. */
export interface BasicPriceRowResourceProposal {
  /**
   * `ResourceIdentityStatus` as the authority returned it — EXCEPT on the one
   * branch where the authority was deliberately never asked: a row whose family
   * the source did not state is reported UNRESOLVED by this seam itself, with
   * ROW_SOURCE_SECTION_UNRESOLVED naming why. Asking without a family would mean
   * guessing the family, which intake already refused to do.
   */
  status: 'RESOLVED' | 'NEEDS_REVIEW' | 'UNRESOLVED';
  /**
   * `ResourceIdentityAuthority` as the authority returned it — which law settled
   * the identity. Null when none did, including the never-asked branch above.
   */
  authority: string | null;
  resourceCatalogId: string | null;
  resourceName: string | null;
  resourceCode: string | null;
  resourceType: string | null;
  resourceBaseUnit: string | null;
  candidates: BasicPriceRowResourceCandidate[];
  reasonCodes: string[];
  policyVersion: string;
  /**
   * WHETHER BASIC PRICE MAY ACT ON THE IDENTITY ABOVE — a NARROWER question than
   * whether the authority proved it, and deliberately a separate field.
   *
   * The Resource Identity authority is shared, and its evidence set is
   * `{ OR: [{ workspaceId }, { workspaceId: null }] }` — a null-workspace row is
   * genuinely GLOBAL reference data, and AHSP occurrence resolution legitimately
   * uses it. Basic Price row resolution does not: `resolveWithinTransaction`
   * looks the chosen row up with `{ id, workspaceId, status: 'ACTIVE' }`, strict
   * equality, and answers RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE otherwise. The
   * lookup endpoint a human searches through is workspace-strict for the same
   * reason.
   *
   * So a globally-scoped identity is a TRUE answer that this workflow may not
   * act on. Reporting it as actionable would pre-fill a selection the endpoint
   * would then refuse. So the authority's verdict is NOT narrowed by this flag —
   * its status, authority and candidates say exactly what they said, and no other
   * domain's view of the identity changes — while THIS flag records Basic Price's
   * own admissibility alongside it. (The projection separately omits the
   * authority's `explanation` prose for every row; that is the outward-boundary
   * law above, and it is a different thing from narrowing a verdict.)
   *
   * False whenever no identity was asserted at all.
   */
  admissibleForResolve: boolean;
}

export interface BasicPriceRowMachineProposal {
  rowId: string;
  unit: BasicPriceRowUnitProposal;
  resource: BasicPriceRowResourceProposal;
  /**
   * The RESOURCE leg and the UNIT leg required by a Basic Price identity
   * SELECTION are both proven and admissible for this workspace.
   *
   * IT DOES NOT MEAN THE ROW IS FINISHED. `resolveRow` will accept this exact
   * pair, but the row's final status still depends on facts this seam does not
   * judge — a canonical price being present, and no same-identity collision with
   * another row in the batch. See `compose` for why that distinction is the
   * whole reason this field is named after the pair and not after the row.
   */
  identityPairProven: boolean;
  /**
   * The named facts still missing, in the vocabulary the engines and the
   * resolve endpoint already use. Nothing invented: every entry is either a
   * UNIT_REASON code, a ResourceIdentityReasonCode, or one of the resolve
   * endpoint's own refusal codes.
   */
  blockingFacts: string[];
}

/** The row facts this seam reads. Everything comes from the row itself. */
export interface BasicPriceRowProposalInput {
  id: string;
  sourceSection: ResourceType | null;
  rawResourceNameText: string;
  rawResourceCodeText: string | null;
  rawUnitText: string | null;
}

/**
 * The row's own governed class, mapped to the only unit context this seam will
 * ever supply — exactly as `ResourceIdentityResolutionService` does it. An
 * unknown class yields NO context, which is fail-closed: a context-scoped alias
 * then stays ineligible instead of defaulting to whichever row is found first.
 */
function trustedUnitContext(
  section: ResourceType | null,
): UnitAliasContext | undefined {
  if (section === null) return undefined;
  const upper = String(section).trim().toUpperCase();
  return upper in UNIT_ALIAS_CONTEXT
    ? UNIT_ALIAS_CONTEXT[upper as keyof typeof UNIT_ALIAS_CONTEXT]
    : undefined;
}

@Injectable()
export class BasicPriceRowResolutionProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitKernelService,
    private readonly identity: ResourceIdentityResolutionService,
  ) {}

  /**
   * Ask both authorities about a WHOLE batch, with the database work BATCHED and
   * BOUNDED rather than issued per row.
   *
   * WHAT IS GUARANTEED: no row-linear N+1 on the common path. The work is bounded
   * by the number of DISTINCT governed contexts, the number of DISTINCT unit
   * spellings, the number of DISTINCT canonical codes those produce, and the
   * number of DISTINCT proposed catalog ids — never by the row count.
   *
   *   - identity evidence  — ONE `loadEvidence` for the workspace (3 queries),
   *     after which `resolve()` is pure for the common path;
   *   - unit identities    — ONE batched call per distinct governed context
   *     (at most four: MATERIAL, LABOR, EQUIPMENT, and no-context), each asking
   *     about DISTINCT spellings only;
   *   - unit round-trip    — ONE further batched call for the distinct canonical
   *     codes those answers produced;
   *   - unit labels        — ONE call for the distinct proven unit ids;
   *   - admissibility      — ONE call for the distinct proposed catalog ids.
   *
   * WHAT IS NOT CLAIMED: that the query count is a constant. The identity
   * authority's RM-03D2 representation-tie path may read canonical unit
   * identities, and although its `unitIdentityCache` lives for this whole batch —
   * so a spelling is asked about once per context however many ties share it — a
   * source whose rows tie on many DISTINCT spellings will legitimately issue more
   * of those reads than one that does not. That is bounded by the evidence, not
   * by the rows.
   */
  async proposeForRows(
    workspaceId: string,
    rows: ReadonlyArray<BasicPriceRowProposalInput>,
    /**
     * The client to read evidence through. Defaults to the ambient connection,
     * which is what the review read path wants.
     *
     * A TRANSACTION may be passed instead, and one caller needs that: the
     * RESOLVE path records what the machine offered at the moment a human
     * decided, and it must see the same rows its own transaction sees — a row
     * admitted moments earlier in the same transaction is not yet visible
     * outside it. It is a read either way; nothing here writes.
     */
    client: EvidenceClient = this.prisma,
  ): Promise<Map<string, BasicPriceRowMachineProposal>> {
    const proposals = new Map<string, BasicPriceRowMachineProposal>();
    if (rows.length === 0) return proposals;

    const unitByRow = await this.proveUnits(rows);

    // The identity authority's evidence set for this workspace, loaded ONCE.
    // Its `unitIdentityCache` also lives for the whole batch, so the rare
    // representation-tie path re-uses a spelling it has already proved instead
    // of asking again per row.
    const evidence = await this.identity.loadEvidence(client, workspaceId);

    const resourceByRow = new Map<string, BasicPriceRowResourceProposal>();
    for (const row of rows) {
      resourceByRow.set(row.id, await this.proveResource(evidence, row));
    }

    const admissible = await this.admissibleCatalogIds(client, workspaceId, [
      ...resourceByRow.values(),
    ]);

    for (const row of rows) {
      const unit = unitByRow.get(row.id)!;
      const resource = resourceByRow.get(row.id)!;
      proposals.set(
        row.id,
        this.compose(row, unit, {
          ...resource,
          admissibleForResolve:
            resource.resourceCatalogId !== null &&
            admissible.has(resource.resourceCatalogId),
        }),
      );
    }
    return proposals;
  }

  /**
   * WHICH PROPOSED CATALOG IDS BASIC PRICE MAY ACTUALLY ACT ON.
   *
   * The predicate below is a DELIBERATE MIRROR of the one
   * `BasicPriceRowResolutionService.resolveWithinTransaction` applies to
   * `dto.resourceCatalogId` — `{ id, workspaceId, status: 'ACTIVE' }`, strict
   * workspace equality — and it exists so this seam can never offer a selection
   * that endpoint would refuse with RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE.
   *
   * It is asked HERE rather than by narrowing the shared authority, because the
   * globality it excludes is legitimate elsewhere: AHSP occurrence resolution
   * genuinely resolves against global reference rows, and tightening
   * `loadEvidence` would silently change what the Golden Thread can resolve. One
   * workflow's admissibility rule belongs to that workflow.
   *
   * ONE query for the DISTINCT ids actually proposed — never one per row, and
   * nothing at all when the authority proposed no identity in this batch.
   *
   * IT READS THROUGH THE CALLER'S CLIENT, and that is not tidiness. It used to
   * read `this.prisma` while its own caller threaded a transaction into
   * `loadEvidence` beside it — so on the resolve path the evidence saw the
   * transaction and the admissibility check did not. That is exactly the case
   * the `client` parameter exists for: `admit-resource` creates a catalog row
   * and resolves the row in ONE transaction, so the authority would propose the
   * resource it had just been shown and this check, reading outside, would find
   * no such row and answer `admissibleForResolve: false`. The seam would then
   * record that the machine offered nothing at the moment a human decided —
   * an audit trail describing a screen nobody saw, which is the precise defect
   * the caller's own comment says passing `tx` was meant to prevent.
   */
  private async admissibleCatalogIds(
    client: EvidenceClient,
    workspaceId: string,
    resources: ReadonlyArray<BasicPriceRowResourceProposal>,
  ): Promise<ReadonlySet<string>> {
    const proposed = [
      ...new Set(
        resources
          .map((r) => r.resourceCatalogId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (proposed.length === 0) return new Set<string>();
    const rows = await client.resourceCatalog.findMany({
      where: { id: { in: proposed }, workspaceId, status: 'ACTIVE' },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * Every row's raw unit spelling, answered by the Unit authority — batched by
   * the governed context each answer must be read under.
   *
   * Grouping by context is not an optimisation, it is the law: "jam" is a
   * labour hour on a LABOR row and an equipment hour on an EQUIPMENT row, and
   * asking about both in one context-free call would return AMBIGUOUS for both
   * and lose two answers SIMPROK can actually prove.
   */
  private async proveUnits(
    rows: ReadonlyArray<BasicPriceRowProposalInput>,
  ): Promise<Map<string, BasicPriceRowUnitProposal>> {
    const notStated: BasicPriceRowUnitProposal = {
      rawUnit: null,
      status: 'NOT_STATED',
      unitDefinitionId: null,
      unitCode: null,
      unitDisplayName: null,
      unitSymbol: null,
      unitDimension: null,
      unitKind: null,
      // The intake adapter's own existing code for exactly this fact, already
      // carried on the row the reviewer is looking at.
      reasonCode: 'UNIT_REQUIRED',
      contextScoped: false,
      trustedContext: null,
      policyVersion: UNIT_KERNEL_POLICY_VERSION,
    };

    // key = context ?? '' ; value = distinct raw spellings asked under it
    const byContext = new Map<string, Set<string>>();
    for (const row of rows) {
      const raw = row.rawUnitText?.trim() ?? '';
      if (raw === '') continue;
      const key = trustedUnitContext(row.sourceSection) ?? '';
      const bucket = byContext.get(key) ?? new Set<string>();
      bucket.add(raw);
      byContext.set(key, bucket);
    }

    // Nested rather than one composite string key: a raw unit spelling is
    // arbitrary source text and may contain any character at all, so any
    // separator chosen for a flat key would be a spelling waiting to break it.
    type UnitIdentity = Awaited<
      ReturnType<UnitKernelService['resolveCanonicalUnitIdentities']>
    >[number];
    const identities = new Map<string, Map<string, UnitIdentity>>();
    for (const [key, spellings] of byContext) {
      const answers = await this.units.resolveCanonicalUnitIdentities(
        [...spellings],
        key === '' ? undefined : (key as UnitAliasContext),
      );
      identities.set(key, new Map(answers.map((a) => [a.rawUnit, a])));
    }

    // ROUND-TRIP PROOF, batched.
    //
    // A canonical unit having been IDENTIFIED is not the same fact as the
    // resolve endpoint being able to accept it: that endpoint proves the chosen
    // unit against the source spelling through `UnitKernelService.resolve`,
    // which looks the TARGET up by its canonical CODE. A definition whose own
    // code carries no active alias is vocabulary the kernel cannot see, and the
    // endpoint answers UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY. Proving it here
    // — once per distinct code, never per row — is what keeps `identityPairProven`
    // a prediction of the backend's real answer rather than a hope.
    const codes = [
      ...new Set(
        [...identities.values()]
          .flatMap((bySpelling) => [...bySpelling.values()])
          .filter((i) => i.status === UNIT_RESOLUTION_STATUS.RESOLVED)
          .map((i) => i.unitDefinition!.code),
      ),
    ];
    const representable = new Map<string, boolean>();
    if (codes.length > 0) {
      for (const answer of await this.units.resolveCanonicalUnitIdentities(
        codes,
      )) {
        representable.set(
          answer.rawUnit,
          answer.status === UNIT_RESOLUTION_STATUS.RESOLVED,
        );
      }
    }

    // HUMAN LABELS ONLY, AND DELIBERATELY NOT FROM THE AUTHORITY'S CONTRACT.
    //
    // `CanonicalUnitIdentity.unitDefinition` is narrowed to id/code/dimension on
    // purpose — it is an IDENTITY answer, not a presentation record. Widening
    // that contract so a screen could print "Litre" would make every future
    // caller of the unit authority carry display concerns. So the display name
    // and symbol are read here instead, in ONE bounded query for the distinct
    // ids the authority already decided. Nothing about the verdict comes from
    // this read; if it returned nothing, the proposal would still be correct and
    // would simply show the canonical code.
    const provenIds = [
      ...new Set(
        [...identities.values()]
          .flatMap((bySpelling) => [...bySpelling.values()])
          .filter((i) => i.status === UNIT_RESOLUTION_STATUS.RESOLVED)
          .map((i) => i.unitDefinition!.id),
      ),
    ];
    const labels = new Map(
      (provenIds.length === 0
        ? []
        : await this.prisma.unitDefinition.findMany({
            where: { id: { in: provenIds } },
            select: { id: true, displayName: true, symbol: true, kind: true },
          })
      ).map((u) => [u.id, u]),
    );

    const result = new Map<string, BasicPriceRowUnitProposal>();
    for (const row of rows) {
      const raw = row.rawUnitText?.trim() ?? '';
      if (raw === '') {
        result.set(row.id, { ...notStated, rawUnit: row.rawUnitText });
        continue;
      }
      const key = trustedUnitContext(row.sourceSection) ?? '';
      const answer = identities.get(key)!.get(raw)!;
      const proven =
        answer.status === UNIT_RESOLUTION_STATUS.RESOLVED &&
        representable.get(answer.unitDefinition!.code) === true;
      const label = answer.unitDefinition
        ? labels.get(answer.unitDefinition.id)
        : undefined;
      // The canonical code is the last-resort label, never a fabricated name.
      const readable =
        label?.displayName ?? answer.unitDefinition?.code ?? null;

      result.set(row.id, {
        rawUnit: row.rawUnitText,
        status: answer.status,
        unitDefinitionId: proven ? answer.unitDefinition!.id : null,
        unitCode: answer.unitDefinition?.code ?? null,
        unitDisplayName: readable,
        unitSymbol: label?.symbol ?? null,
        unitDimension: answer.unitDefinition?.dimension ?? null,
        unitKind: label?.kind ?? null,
        reasonCode:
          answer.status === UNIT_RESOLUTION_STATUS.RESOLVED && !proven
            ? 'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY'
            : answer.reasonCode,
        contextScoped: answer.contextScoped,
        trustedContext: answer.resolvedContext,
        policyVersion: answer.policyVersion,
      });
    }
    return result;
  }

  /**
   * The identity authority's verdict for ONE row, asked with every fact the row
   * itself carries and nothing a client could steer.
   *
   * A row whose resource family the source stated in words SIMPROK does not know
   * is NOT asked at all. `resourceType` is a required input, and supplying a
   * default would mean picking that family by guess — exactly what intake
   * already refused to do. The refusal is reported under the resolve endpoint's
   * own code so the two say the same thing.
   */
  private async proveResource(
    evidence: Awaited<
      ReturnType<ResourceIdentityResolutionService['loadEvidence']>
    >,
    row: BasicPriceRowProposalInput,
  ): Promise<BasicPriceRowResourceProposal> {
    if (row.sourceSection === null) {
      return {
        status: 'UNRESOLVED',
        authority: null,
        resourceCatalogId: null,
        resourceName: null,
        resourceCode: null,
        resourceType: null,
        resourceBaseUnit: null,
        candidates: [],
        reasonCodes: ['ROW_SOURCE_SECTION_UNRESOLVED'],
        // Settled by the caller once the whole batch's proposed ids are known.
        // False here is the fail-closed default, not a verdict.
        admissibleForResolve: false,
        policyVersion: RESOURCE_IDENTITY_POLICY_VERSION,
      };
    }

    const verdict = await this.identity.resolve(evidence, {
      rawName: row.rawResourceNameText,
      rawCode: row.rawResourceCodeText,
      rawUnit: row.rawUnitText,
      resourceType: row.sourceSection,
    });

    const resolved =
      verdict.resolvedResourceCatalogId === null
        ? null
        : (verdict.candidates.find(
            (c) => c.resourceCatalogId === verdict.resolvedResourceCatalogId,
          ) ?? null);

    return {
      status: verdict.status,
      authority: verdict.authority,
      resourceCatalogId: verdict.resolvedResourceCatalogId,
      resourceName: resolved?.name ?? null,
      resourceCode: resolved?.code ?? null,
      resourceType: resolved?.type ?? null,
      resourceBaseUnit: resolved?.baseUnit ?? null,
      // THE PROJECTION BOUNDARY, through the one shared definition above — the
      // same one the resolve lifecycle's identity refusal uses, so both outward
      // seams narrow identically and cannot drift apart.
      candidates: verdict.candidates.map(toBasicPriceSafeCandidate),
      reasonCodes: [...verdict.reasonCodes],
      // `verdict.explanation` IS NOT COPIED, and that is the whole repair.
      // See this file's header note on the outward boundary.
      // Settled by the caller — see `admissibleCatalogIds`. Fail-closed default.
      admissibleForResolve: false,
      policyVersion: RESOURCE_IDENTITY_POLICY_VERSION,
    };
  }

  /**
   * `identityPairProven` names EXACTLY ONE FACT, and the name is load-bearing:
   *
   *   the RESOURCE leg and the UNIT leg that a Basic Price identity SELECTION
   *   requires are both proven AND admissible for this workflow.
   *
   * IT IS NOT "THE ROW IS FINISHED", and it never was. `resolveRow` accepts such
   * a pair, writes the identity and the append-only mapping decision — and then
   * decides the row's FINAL status from facts this seam does not judge and must
   * not pretend to:
   *
   *   - `proposedCanonicalPrice` must be non-null, and
   *   - the (resourceCatalogId, unitDefinitionId) pair must not collide with
   *     another row in the same batch.
   *
   * A row whose identity pair is proven can therefore still come back
   * NEEDS_REVIEW with SAME_IDENTITY_SAME_VALUE / SAME_IDENTITY_DIFFERENT_VALUE,
   * because a collision is a fact about a BATCH and about a decision that has not
   * happened yet — not a fact about this row's identity. Calling that "complete"
   * claimed a lifecycle outcome from an identity proof, so the name was wrong and
   * the name is what changed. The law in `BasicPriceRowResolutionService` is
   * untouched.
   *
   * Every clause below names the exact refusal it predicts:
   *
   *   ROW_SOURCE_SECTION_UNRESOLVED         the row's family is unknown
   *   RESOURCE_TYPE_MISMATCH                the chosen row's type is not this row's
   *   RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE the identity is real but not this
   *                                         workspace's to select
   *   UNIT_REQUIRED                         the source stated no unit to prove against
   *   <UNIT_REASON code>                    the Unit authority could not prove the spelling
   *   UNIT_NOT_REPRESENTABLE_...            the canonical code has no alias the kernel sees
   *   <ResourceIdentityReasonCode>          the identity authority did not assert one
   *
   * The pair is proven only when the list is EMPTY. There is no partial credit
   * and no "probably fine".
   */
  private compose(
    row: BasicPriceRowProposalInput,
    unit: BasicPriceRowUnitProposal,
    resource: BasicPriceRowResourceProposal,
  ): BasicPriceRowMachineProposal {
    const blocking: string[] = [];

    if (row.sourceSection === null)
      blocking.push('ROW_SOURCE_SECTION_UNRESOLVED');
    if (unit.unitDefinitionId === null) blocking.push(unit.reasonCode);
    if (resource.resourceCatalogId === null) {
      // The authority's own reasons, or the plain fact that it found nothing to
      // say — never a code this file invented.
      blocking.push(
        ...(resource.reasonCodes.length > 0
          ? resource.reasonCodes
          : ['RESOURCE_NOT_FOUND']),
      );
    } else {
      // A real identity this workspace may not select. The authority's verdict
      // stays as it is; only Basic Price's actionability is refused, under the
      // resolve endpoint's own code for exactly this fact.
      if (!resource.admissibleForResolve)
        blocking.push('RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE');
      // The kernel scopes an asserted identity to the requested type, so this
      // can only fire if that ever changed. Checked rather than assumed: a
      // silent type crossing is the one failure this seam must never introduce.
      const chosen = resource.candidates.find(
        (c) => c.resourceCatalogId === resource.resourceCatalogId,
      );
      if (chosen && chosen.type !== row.sourceSection)
        blocking.push('RESOURCE_TYPE_MISMATCH');
    }

    // De-duplicated, order preserved: a reviewer reading "1 hal lagi diperlukan"
    // must not be shown the same missing fact twice because two legs named it.
    const blockingFacts = [...new Set(blocking)];
    return {
      rowId: row.id,
      unit,
      resource,
      identityPairProven: blockingFacts.length === 0,
      blockingFacts,
    };
  }
}

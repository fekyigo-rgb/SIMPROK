import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GetBasicPricesDto } from './dto/get-basic-prices.dto';
import { Prisma } from '@prisma/client';
import {
  BasicPriceEligibilityPolicy,
  PUBLIC_BASIC_PRICE_VERIFICATION_STATUS,
} from './basic-price-eligibility.policy';
import {
  mapBasicPriceCorrectionEntry,
  mapBasicPriceDomesticContent,
  mapBasicPriceEvidence,
  mapExplorerItem,
  deriveExplorerSourceName,
  sameSourceObservationPredecessorId,
  type BasicPriceDetail,
  type BasicPriceExplorerItem,
  type ExplorerRowSource,
  type HistoryRowSource,
} from '../common/basic-price-workflow.projection';
import { nextUtcDayStart, parseDateOnlyUtc } from '../common/date-only.util';
import { sourceOriginsForFamily } from './basic-price-source-family.util';
import { promotionLineagePrecedenceWhere } from './basic-price-promotion-precedence';
import {
  basicPriceCurrentnessWhere,
  mergeCurrentnessAnd,
} from './basic-price-currentness';
import { basicPriceApplicabilityAnd } from './basic-price-applicability';
import { basicPriceSourceNameWhere } from './basic-price-source-name.filter';
import { basicPriceRegionApplicabilityWhere } from './basic-price-region-applicability';
import {
  BASIC_PRICE_HISTORY_MAX_GENERATIONS,
  buildSupersessionTimeline,
} from './basic-price-history';

const EXPLORER_ROW_SELECT = {
  id: true,
  workspaceId: true,
  // RM-03C: the Explorer must say WHICH asset family a row belongs to. A
  // workspace's own private price sitting silently among curated catalog rows,
  // visually indistinguishable from them, would be exactly the kind of
  // unlabelled claim SIMPROK does not make.
  assetScope: true,
  value: true,
  effectiveDate: true,
  validUntil: true,
  // Soft re-verification advice. Selected so the Explorer can say "check this
  // again by" — it filters nothing and gates nothing.
  reviewDate: true,
  sourceType: true,
  sourceOrigin: true,
  freshnessStatus: true,
  resource: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      baseUnit: true,
    },
  },
  region: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  regionCoverageSet: {
    select: { members: { select: { regionId: true } } },
  },
  sourceSubmission: {
    select: {
      importRow: {
        select: {
          batch: {
            select: {
              sourceOrganizationName: true,
              sourceVendorName: true,
            },
          },
        },
      },
    },
  },
  // RM-03C: a WORKSPACE_PRIVATE row reaches the very same import batch
  // directly, because it has no PriceSubmission to travel through. Same
  // provenance subsystem, one link shorter — never a second one.
  sourceImportRow: {
    select: {
      batch: {
        select: {
          sourceOrganizationName: true,
          sourceVendorName: true,
        },
      },
    },
  },
  /**
   * BP-EVIDENCE-MIG-04 — ONE birth-audit row, names only.
   *
   * A Detail-born observation has no import-row pointer, so Explorer would
   * otherwise print "Sumber tidak tersedia" for a shop whose identity was
   * retained. Oldest audit carries `after.sourceIdentityName`. The JSON is
   * not projected; `deriveExplorerSourceName` extracts the name only.
   * Not an N+1: this is a nested take-1 on the same list query.
   */
  provenanceCorrections: {
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { before: true, after: true },
  },
} satisfies Prisma.BasicPriceSelect;

/**
 * BP-UX-FINAL-01D GAP-B — THE ONE EXTRA EVIDENCE COLUMN, ON DETAIL ONLY.
 *
 * `sourceStorageRef` is USI-01R2 §5's answer to "what exactly was received?" —
 * the pointer to a batch's retained original bytes, null for every batch
 * imported before bytes were kept. It is the ONLY thing that can prove the
 * Detail screen's strongest evidence sentence, and `importBatchLinked` never
 * could: a relation to a batch says nothing about whether that batch's file
 * still exists.
 *
 * IT IS NOT ADDED TO `EXPLORER_ROW_SELECT`. The list has no sentence to say
 * about retained bytes, so reading the column for every row on every page would
 * be work done for nobody. Detail overrides the two provenance branches with
 * this richer shape instead — the same two chains, one column deeper.
 *
 * THE COLUMN NEVER LEAVES THE SERVER. `mapBasicPriceEvidence` turns it into a
 * boolean; an internal storage path is not a browser's business.
 */
const DETAIL_EVIDENCE_BATCH_SELECT = {
  select: {
    sourceOrganizationName: true,
    sourceVendorName: true,
    sourceStorageRef: true,
  },
} satisfies { select: Prisma.BasicPriceImportBatchSelect };

const DETAIL_PROVENANCE_SELECT = {
  sourceSubmission: {
    select: { importRow: { select: { batch: DETAIL_EVIDENCE_BATCH_SELECT } } },
  },
  sourceImportRow: {
    select: {
      sourceKdnHeaderText: true,
      batch: {
        select: {
          ...DETAIL_EVIDENCE_BATCH_SELECT.select,
          sourceFileName: true,
        },
      },
    },
  },
  /**
   * BP-KDN-01 — the OBSERVATION's %KDN fact, on DETAIL only.
   *
   * Canonical persistence is `BasicPrice.kdnPercent`, not
   * `ResourceCatalog.tkdnValue` (legacy scalar; not written here).
   * NOT added to `EXPLORER_ROW_SELECT`: the list has no KDN column.
   */
  kdnPercent: true,
  kdnEstablishment: true,
  /**
   * Correction predecessor evidence, Detail only. New observations have
   * `supersedesBasicPriceId` null and therefore load nothing here. The
   * unique import-row pointer stays on the predecessor; this nested read
   * reuses original documentary facts without a second round-trip.
   */
  supersedes: {
    select: {
      sourceSubmission: {
        select: {
          importRow: { select: { batch: DETAIL_EVIDENCE_BATCH_SELECT } },
        },
      },
      sourceImportRow: {
        select: { batch: DETAIL_EVIDENCE_BATCH_SELECT },
      },
    },
  },
  resource: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      baseUnit: true,
    },
  },
} satisfies Prisma.BasicPriceSelect;

/**
 * Public Basic Price eligibility — OWNER-LOCKED.
 *
 * Ruang publik hanya menerima harga yang sudah lolos PUBLIKASI manusia.
 * Dua sumbu wajib (keduanya):
 *   - lifecycle:      status = 'PUBLISHED'
 *   - verification:   verificationStatus = PUBLISHED (terminal)
 *
 * VERIFIED != PUBLISHED. VERIFIED berarti "terbukti valid" tetapi belum diputuskan
 * publikasi → tetap internal/kurasi dan tidak boleh keluar via API publik.
 *
 * As of RM-02B, the two-axis predicate itself lives in
 * BasicPriceEligibilityPolicy.publicEligibilityWhere() (single source of
 * truth shared with any future AHSP-resolution/Cost-Kernel caller, per
 * schema contract §10) — this service only re-exports the verification
 * constant it still references directly below (DTO validation, etc.), and
 * calls the policy for every eligibility where-clause it builds. Extracted
 * behavior-preserving: the resulting where-clause shape is unchanged.
 *
 * Catatan (controlled schema debt, TIDAK diperbaiki di slice ini): BasicPrice.status
 * ber-default 'PUBLISHED' pada baris lama sebelum RM-02B (default sekarang
 * 'UNPUBLISHED' untuk baris baru) — status='PUBLISHED' sendirian tidak
 * membuktikan kelolosan kurasi, karena itu verificationStatus=PUBLISHED
 * wajib ikut.
 */
export { PUBLIC_BASIC_PRICE_VERIFICATION_STATUS };

/**
 * BasicPriceService — Golden Path v0 Slice A
 *
 * Hanya read operations untuk Golden Path v0.
 * Write operations (submit harga) ada di reality-intake domain.
 * Semua query scoped by workspaceId.
 */
@Injectable()
export class BasicPriceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: BasicPriceEligibilityPolicy,
  ) {}

  /**
   * Existing birth-audit lineage applied to source-name SEARCH, before count
   * and skip/take. The list and Detail already inherit the identical evidence;
   * this query only exposes exact descendants, never approximate same-names.
   * A cap FAILS CLOSED rather than returning a falsely complete search.
   */
  private async sourceNameObservationDescendantIds(
    workspaceId: string,
    sourceName: string,
  ): Promise<string[]> {
    type LineageMatch = { id: string; depth: number };
    const rows = await this.prisma.$queryRaw<LineageMatch[]>(
      Prisma.sql`
        WITH RECURSIVE source_chain AS (
          SELECT root.id, root."workspaceId", root."resourceId",
                 root."regionId", root."regionCoverageSetId",
                 root."sourceType", root."sourceOrigin",
                 0::integer AS depth
          FROM "basic_prices" root
          JOIN "basic_price_provenance_corrections" birth
            ON birth."basicPriceId" = root.id
           AND birth."workspaceId" = root."workspaceId"
          WHERE root."workspaceId" = ${workspaceId}::uuid
            AND root."assetScope" = 'WORKSPACE_PRIVATE'
            AND strpos(lower(birth.after->>'sourceIdentityName'),
                       lower(${sourceName})) > 0

          UNION ALL

          SELECT next.id, next."workspaceId", next."resourceId",
                 next."regionId", next."regionCoverageSetId",
                 next."sourceType", next."sourceOrigin",
                 chain.depth + 1
          FROM source_chain chain
          JOIN "basic_price_provenance_corrections" audit
            ON audit.before->>'observedAfterBasicPriceId' = chain.id::text
           AND audit."workspaceId" = chain."workspaceId"
          JOIN "basic_prices" next
            ON next.id = audit."basicPriceId"
           AND next."workspaceId" = chain."workspaceId"
          WHERE next."assetScope" = 'WORKSPACE_PRIVATE'
            AND next."recordsNewObservation" = TRUE
            AND next."resourceId" = chain."resourceId"
            AND next."regionId" IS NOT DISTINCT FROM chain."regionId"
            AND next."regionCoverageSetId" IS NOT DISTINCT FROM chain."regionCoverageSetId"
            AND next."sourceType" = chain."sourceType"
            AND next."sourceOrigin" = chain."sourceOrigin"
            AND audit.before->>'semantic' = 'NEW_OBSERVATION'
            AND audit.after->>'semantic' = 'NEW_OBSERVATION'
            AND audit.after->>'sameSourceIdentity' = 'true'
            AND chain.depth < ${BASIC_PRICE_HISTORY_MAX_GENERATIONS}
        )
        SELECT DISTINCT id, depth
        FROM source_chain
        WHERE depth > 0
        LIMIT 10001
      `,
    );
    if (
      rows.length > 10000 ||
      rows.some((row) => row.depth >= BASIC_PRICE_HISTORY_MAX_GENERATIONS)
    ) {
      throw new ConflictException('SOURCE_IDENTITY_LINEAGE_SEARCH_INCOMPLETE');
    }
    return [...new Set(rows.map((row) => row.id))];
  }

  /**
   * An explicit SAME-SOURCE NEW_OBSERVATION is a later observation, NOT a
   * correction. Preserve all rows by ID and historical date; for the OFFER
   * alone, omit a predecessor only when a genuinely LATER eligible observation
   * in that exact audit chain applies on the requested date.
   *
   * Same-day prices stay competing candidates for human review. Source names,
   * values and sourceOrigin categories NEVER establish an identity link.
   * The existing eligibility/currentness/applicability laws must also accept
   * the descendant before it can remove an older candidate from the offer.
   */
  static async olderSameSourceObservationOfferIds(
    db: Pick<Prisma.TransactionClient, '$queryRaw' | 'basicPrice'>,
    eligibility: BasicPriceEligibilityPolicy,
    workspaceId: string,
    asOf: Date,
    precedence: Prisma.BasicPriceWhereInput,
  ): Promise<string[]> {
    type Pair = { predecessorId: string; descendantId: string; depth: number };
    const pairs = await db.$queryRaw<Pair[]>(Prisma.sql`
      WITH RECURSIVE edge AS (
        SELECT child.id AS child_id, parent.id AS parent_id
        FROM "basic_price_provenance_corrections" audit
        JOIN "basic_prices" child
          ON child.id = audit."basicPriceId"
         AND child."workspaceId" = audit."workspaceId"
        JOIN "basic_prices" parent
          ON parent.id::text = audit.before->>'observedAfterBasicPriceId'
         AND parent."workspaceId" = child."workspaceId"
        WHERE child."workspaceId" = ${workspaceId}::uuid
          AND child."assetScope" = 'WORKSPACE_PRIVATE'
          AND parent."assetScope" = 'WORKSPACE_PRIVATE'
          AND child."recordsNewObservation" = TRUE
          AND audit.before->>'semantic' = 'NEW_OBSERVATION'
          AND audit.after->>'semantic' = 'NEW_OBSERVATION'
          AND audit.after->>'sameSourceIdentity' = 'true'
          AND child."resourceId" = parent."resourceId"
          AND child."regionId" IS NOT DISTINCT FROM parent."regionId"
          AND child."regionCoverageSetId" IS NOT DISTINCT FROM parent."regionCoverageSetId"
          AND child."sourceType" = parent."sourceType"
          AND child."effectiveDate" >= parent."effectiveDate"
          AND child."effectiveDate" <= ${asOf}
      ),
      lineage AS (
        SELECT child_id AS descendant_id, parent_id AS predecessor_id,
               parent_id AS cursor_id, 1::integer AS depth,
               ARRAY[child_id, parent_id] AS visited
        FROM edge
        UNION ALL
        SELECT chain.descendant_id, e.parent_id, e.parent_id,
               chain.depth + 1, chain.visited || e.parent_id
        FROM lineage chain
        JOIN edge e ON e.child_id = chain.cursor_id
        WHERE chain.depth < ${BASIC_PRICE_HISTORY_MAX_GENERATIONS}
          AND NOT (e.parent_id = ANY(chain.visited))
      )
      SELECT DISTINCT chain.predecessor_id AS "predecessorId",
                      chain.descendant_id AS "descendantId",
                      chain.depth
      FROM lineage chain
      JOIN "basic_prices" ancestor ON ancestor.id = chain.predecessor_id
      JOIN "basic_prices" newer ON newer.id = chain.descendant_id
      WHERE newer."effectiveDate" > ancestor."effectiveDate"
        AND newer."effectiveDate" <= ${asOf}
      LIMIT 10001
    `);
    if (
      pairs.length > 10000 ||
      pairs.some((pair) => pair.depth >= BASIC_PRICE_HISTORY_MAX_GENERATIONS)
    ) {
      throw new ConflictException('OBSERVATION_OFFER_LINEAGE_INCOMPLETE');
    }
    const descendantIds = [...new Set(pairs.map((pair) => pair.descendantId))];
    const eligibleDescendants = descendantIds.length
      ? await db.basicPrice.findMany({
          where: {
            id: { in: descendantIds },
            ...eligibility.usableWhere(workspaceId),
            ...precedence,
            ...mergeCurrentnessAnd(basicPriceCurrentnessWhere({ asOf }), [
              ...basicPriceApplicabilityAnd({ asOf }),
            ]),
          },
          select: { id: true, effectiveDate: true },
        })
      : [];
    const eligibleById = new Map(
      eligibleDescendants.map((row) => [row.id, row.effectiveDate]),
    );
    const lawfulPairs = pairs.filter((pair) =>
      eligibleById.has(pair.descendantId),
    );
    const omitted = new Set(lawfulPairs.map((pair) => pair.predecessorId));

    // The exact same import document row may have been interpreted again in a
    // separate import job. Import identities and their dates remain immutable.
    // For a current OFFER, comparable identical document-row readings must not
    // masquerade as independent sellers or independent observations.
    const repeatedImportIds = await BasicPriceService.repeatedImportOfferIds(
      db,
      eligibility,
      workspaceId,
      asOf,
      precedence,
      lawfulPairs,
      eligibleById,
    );
    repeatedImportIds.forEach((id) => omitted.add(id));
    return [...omitted];
  }

  /**
   * A repeated interpretation of EXACT DOCUMENT BYTES + SHEET + SOURCE ROW
   * is not a second independent market observation. Never merge import-job
   * identities, rewrite dates, or infer equivalence from publisher/name alone.
   * Source price disagreements and differing applicability remain untouched.
   */
  private static async repeatedImportOfferIds(
    db: Pick<Prisma.TransactionClient, '$queryRaw' | 'basicPrice'>,
    eligibility: BasicPriceEligibilityPolicy,
    workspaceId: string,
    asOf: Date,
    precedence: Prisma.BasicPriceWhereInput,
    lawfulPairs: Array<{ predecessorId: string; descendantId: string }>,
    eligibleManualDates: Map<string, Date>,
  ): Promise<string[]> {
    type DocRow = {
      id: string;
      effectiveDate: Date;
      amount: string;
      kdnPercent: string | null;
      docKey: string;
    };
    const docs = await db.$queryRaw<DocRow[]>(Prisma.sql`
      WITH matching_source_rows AS (
        SELECT p.id, p."effectiveDate", p.value::text AS amount,
               p."kdnPercent"::text AS "kdnPercent",
               jsonb_build_array(
                 p."workspaceId", p."resourceId", p."regionId",
                 p."regionCoverageSetId", p."sourceType", p."validUntil",
                 b."sourceSha256", b."selectedSheetName", r."sourceRowNumber",
                 r."sourceCodeCellAddress", r."sourceNameCellAddress",
                 r."sourceUnitCellAddress", r."sourcePriceCellAddress",
                 r."sourceKdnCellAddress",
                 b."sourceOrganizationName", b."sourceVendorName",
                 b."sourceObservationKey", b."sourcePeriodLabel",
                 b."sourceObservedAt", b."effectiveDateProvenance",
                 b."sourceRegionScopeLabel", b."sourceRegionScopeKind",
                 b."sourceRegionScopeGeographicEvidence",
                 b."regionScopeConfirmedRegionId",
                 b."parserContractVersion", b."sourceLocatorDialect",
                 b."ingestionExternalSourceId", b."ingestionExternalRecordId",
                 b."ingestionExternalVersion"
               )::text AS "docKey"
        FROM "basic_prices" p
        JOIN "basic_price_import_rows" r ON r.id = p."sourceImportRowId"
        JOIN "basic_price_import_batches" b ON b.id = r."batchId"
        WHERE p."workspaceId" = ${workspaceId}::uuid
          AND p."assetScope" = 'WORKSPACE_PRIVATE'
          AND p."effectiveDate" <= ${asOf}
          AND (p."validUntil" IS NULL OR p."validUntil" >= ${asOf})
          AND b."sourceSha256" ~ '^[0-9A-Fa-f]{64}$'
          AND length(trim(b."selectedSheetName")) > 0
          AND r."sourceRowNumber" > 0
          AND (
            length(trim(coalesce(b."sourceOrganizationName", ''))) > 0
            OR length(trim(coalesce(b."sourceVendorName", ''))) > 0
          )
      ),
      repeated AS (
        SELECT "docKey"
        FROM matching_source_rows
        GROUP BY "docKey"
        HAVING count(*) > 1
      )
      SELECT s.id, s."effectiveDate", s.amount, s."kdnPercent", s."docKey"
      FROM matching_source_rows s
      JOIN repeated r ON r."docKey" = s."docKey"
      LIMIT 10001
    `);
    if (docs.length > 10000) {
      throw new ConflictException('DOCUMENT_ROW_OFFER_SEARCH_INCOMPLETE');
    }
    if (docs.length === 0) return [];

    const eligibleImports = await db.basicPrice.findMany({
      where: {
        id: { in: docs.map((row) => row.id) },
        ...eligibility.usableWhere(workspaceId),
        ...precedence,
        ...mergeCurrentnessAnd(basicPriceCurrentnessWhere({ asOf }), [
          ...basicPriceApplicabilityAnd({ asOf }),
        ]),
      },
      select: { id: true },
    });
    const usable = new Set(eligibleImports.map((row) => row.id));
    const byDocument = new Map<string, DocRow[]>();
    for (const row of docs) {
      const group = byDocument.get(row.docKey) ?? [];
      group.push(row);
      byDocument.set(row.docKey, group);
    }
    const omitted = new Set<string>();
    for (const group of byDocument.values()) {
      // Different prices from the same document row imply a contested reading.
      // Never choose a monetary winner based on import date or insertion order.
      if (new Set(group.map((row) => row.amount)).size !== 1) continue;
      // KDN is an independent fact. An unknown percentage is NEVER 0 or 100,
      // and no percentage is copied. Conflicting explicit percentages require
      // review rather than a silent representative chosen by its import date.
      const knownKdn = new Set(
        group.map((row) => row.kdnPercent).filter((v) => v != null),
      );
      if (knownKdn.size > 1) continue;
      const eligibleGroup = group.filter((row) => usable.has(row.id));
      if (eligibleGroup.length === 0) continue;
      const ids = new Set(group.map((row) => row.id));
      const provenLaterObservations = lawfulPairs
        .filter((pair) => ids.has(pair.predecessorId))
        .map((pair) => eligibleManualDates.get(pair.descendantId))
        .filter((date): date is Date => date instanceof Date);
      const candidates = eligibleGroup.filter((row) => {
        const supersededByLaterObservation = provenLaterObservations.some(
          (date) => date.getTime() > row.effectiveDate.getTime(),
        );
        if (supersededByLaterObservation) omitted.add(row.id);
        return !supersededByLaterObservation;
      });
      // Identical source money should appear once per source document. Favor
      // the latest applicable reading, retaining original dates and row IDs.
      candidates.sort(
        (a, b) =>
          b.effectiveDate.getTime() - a.effectiveDate.getTime() ||
          b.id.localeCompare(a.id),
      );
      candidates.slice(1).forEach((row) => omitted.add(row.id));
    }
    return [...omitted];
  }

  /**
   * BP-ONE-TRUTH-01 — recover a retained SOURCE IDENTITY, not old price evidence.
   * The NEW_OBSERVATION birth audit may explicitly identify a predecessor as
   * the same source while omitting sourceIdentityName on the newest row.
   * Fetch only the page's missing-name ancestors, batched by generation.
   * Never cross workspace/resource/region/coverage/source-type boundaries,
   * and never infer identity from similar names, amounts or dates.
   */
  private async inheritedExplorerSourceNames(
    rows: ExplorerRowSource[],
    workspaceId: string,
  ): Promise<Map<string, string>> {
    type Cursor = {
      root: ExplorerRowSource;
      id: string;
      visited: Set<string>;
    };
    const names = new Map<string, string>();
    let pending: Cursor[] = rows.flatMap((root) => {
      if (
        root.workspaceId !== workspaceId ||
        root.assetScope !== 'WORKSPACE_PRIVATE'
      )
        return [];
      if (deriveExplorerSourceName(root)) return [];
      const id = sameSourceObservationPredecessorId(
        root.provenanceCorrections?.[0],
      );
      return id ? [{ root, id, visited: new Set([root.id]) }] : [];
    });

    for (
      let generation = 0;
      generation < BASIC_PRICE_HISTORY_MAX_GENERATIONS && pending.length > 0;
      generation += 1
    ) {
      const ancestors = (await this.prisma.basicPrice.findMany({
        where: {
          id: { in: [...new Set(pending.map((cursor) => cursor.id))] },
          workspaceId,
          assetScope: 'WORKSPACE_PRIVATE',
        },
        select: EXPLORER_ROW_SELECT,
      })) as ExplorerRowSource[];
      const byId = new Map(ancestors.map((row) => [row.id, row]));
      const next: Cursor[] = [];

      for (const cursor of pending) {
        if (cursor.visited.has(cursor.id)) continue;
        cursor.visited.add(cursor.id);
        const ancestor = byId.get(cursor.id);
        if (!ancestor || ancestor.workspaceId !== workspaceId) continue;
        if (ancestor.assetScope !== 'WORKSPACE_PRIVATE') continue;
        if (ancestor.resource.id !== cursor.root.resource.id) continue;
        if (
          ancestor.sourceType !== cursor.root.sourceType ||
          ancestor.sourceOrigin !== cursor.root.sourceOrigin
        )
          continue;
        if (ancestor.region?.id !== cursor.root.region?.id) continue;
        const coverage = (row: ExplorerRowSource) =>
          (row.regionCoverageSet?.members ?? [])
            .map((member) => member.regionId)
            .sort()
            .join('|');
        if (coverage(ancestor) !== coverage(cursor.root)) continue;
        const name = deriveExplorerSourceName(ancestor);
        if (name) {
          names.set(cursor.root.id, name);
          continue;
        }
        const id = sameSourceObservationPredecessorId(
          ancestor.provenanceCorrections?.[0],
        );
        if (id && !cursor.visited.has(id)) next.push({ ...cursor, id });
      }
      pending = next;
    }
    return names;
  }

  /**
   * Ambil semua harga dasar yang berlaku untuk workspace ini.
   * Termasuk harga workspace-specific dan harga global (workspaceId = null, status PUBLISHED).
   */
  async findAllForWorkspace(
    workspaceId: string,
    query: GetBasicPricesDto = {},
  ): Promise<{
    data: BasicPriceExplorerItem[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const {
      search,
      resourceId,
      regionId,
      year,
      dateFrom,
      dateTo,
      // Renamed on destructure so the RAW string and the RESOLVED instant can
      // never be confused for one another below.
      asOf: asOfInput,
      sourceOrigin,
      sourceFamily,
      sourceName,
      verificationStatus,
      freshnessStatus,
      unit,
      resourceType,
      page = 1,
      limit = 20,
      sortBy = 'effectiveDate',
      sortOrder = 'desc',
    } = query;

    // Defensive enforcement (independent of ValidationPipe): the public API must not
    // accept internal-curation verification statuses as a way to open data.
    if (
      verificationStatus &&
      verificationStatus !== PUBLIC_BASIC_PRICE_VERIFICATION_STATUS
    ) {
      throw new BadRequestException(
        `verificationStatus '${verificationStatus}' is not permitted on the public Basic Price API`,
      );
    }

    // `year` and an explicit dateFrom/dateTo range are two different ways of
    // describing the same axis (effectiveDate) — combining them would be an
    // ambiguous time interpretation, so it is rejected rather than silently
    // merged or silently overridden.
    if (year && (dateFrom || dateTo)) {
      throw new BadRequestException(
        'year cannot be combined with dateFrom/dateTo — choose one time filter',
      );
    }

    // Date-only contract: dateFrom/dateTo are exact calendar days, parsed via
    // the shared date-only helper (exact YYYY-MM-DD + year/month/day
    // round-trip) — never a bare `new Date(...)`, which would silently roll
    // a calendar-invalid date forward instead of rejecting it.
    const parsedDateFrom = dateFrom
      ? parseDateOnlyUtc(dateFrom, 'dateFrom')
      : undefined;
    // Parsed as the START of the dateTo day so "dateFrom after dateTo" below
    // compares calendar days, not the exclusive query bound derived from it.
    const parsedDateToStart = dateTo
      ? parseDateOnlyUtc(dateTo, 'dateTo')
      : undefined;

    if (
      parsedDateFrom &&
      parsedDateToStart &&
      parsedDateFrom.getTime() > parsedDateToStart.getTime()
    ) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }

    // Base eligibility (hard lock). Two additive branches, never one widened
    // predicate (RM-03C):
    //   catalog — status PUBLISHED AND verification terminal PUBLISHED, for
    //             this workspace or the global catalog. Unchanged.
    //   private — this workspace's OWN assetScope=WORKSPACE_PRIVATE rows,
    //             matched on strict workspaceId equality. Never null, never
    //             another tenant's.
    // The optional query param cannot widen either branch — it is validated
    // above and otherwise ignored.
    // BP-CAT-01E — two questions, composed rather than merged. Eligibility says
    // WHICH ROWS ARE LAWFUL; precedence says which of those lawful rows is the
    // one logical candidate here. The Explorer is a candidate list, so a
    // workspace must not be shown its own price twice — once as the origin it
    // owns and again as the descendant it donated.
    // BP-CORR-01 — the third question, composed the same way. The Explorer is a
    // CANDIDATE list (that is why precedence already applies here), so a price
    // a published correction has replaced must not be offered as though it were
    // still the answer. It is not hidden from SIMPROK: `findOneForWorkspace`
    // below stays raw-lawful, so the superseded row remains fully readable by
    // id — history stays rich, the offer stays one truth.
    /**
     * BP-UX-FINAL-01C — THE ONE INSTANT THIS WHOLE REQUEST IS ANSWERED FOR.
     *
     * Resolved ONCE, here, and then handed to every fragment that needs it.
     * Currentness used to receive its own `new Date()` while applicability did
     * not exist at all, so the room could not even state which clock it was on.
     *
     * `asOf` absent means the PRESENT — the ordinary case, and the only one the
     * Explorer had before. An explicit `asOf` is a deliberate historical or
     * future lens, parsed through the shared exact-calendar-date helper so an
     * impossible date is refused (400) rather than silently rolled forward into
     * a different question.
     */
    const asOf = asOfInput ? parseDateOnlyUtc(asOfInput, 'asOf') : new Date();

    const precedence = promotionLineagePrecedenceWhere(workspaceId);
    const where: Prisma.BasicPriceWhereInput = {
      ...this.eligibility.usableWhere(workspaceId),
      ...precedence,
      // BP-CORR-01B TEMPORAL + BP-UX-FINAL-01C + BP-DETAIL-MAINT-02R.
      // Currentness now owns an `AND` (private successor recorded-by-asOf).
      // Applicability also needs `AND`. A later `AND:` assignment would drop
      // the successor clause and resurrect the March-lens leak. Merge once.
      ...mergeCurrentnessAnd(basicPriceCurrentnessWhere({ asOf }), [
        ...basicPriceApplicabilityAnd({ asOf }),
        ...(regionId ? [basicPriceRegionApplicabilityWhere(regionId)] : []),
      ]),
    };

    const olderOffers =
      await BasicPriceService.olderSameSourceObservationOfferIds(
        this.prisma,
        this.eligibility,
        workspaceId,
        asOf,
        precedence,
      );
    if (olderOffers.length > 0) {
      (where.AND as Prisma.BasicPriceWhereInput[]).push({
        id: { notIn: olderOffers },
      });
    }

    const resourceFilter: Prisma.ResourceCatalogWhereInput = {
      OR: [{ workspaceId }, { workspaceId: null }],
    };

    if (search) {
      resourceFilter.AND = [
        {
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (unit) {
      resourceFilter.baseUnit = unit;
    }

    if (resourceType) {
      resourceFilter.type = resourceType;
    }

    if (Object.keys(resourceFilter).length > 0) {
      where.resource = resourceFilter;
    }

    if (resourceId) {
      where.resourceId = resourceId;
    }

    if (year) {
      const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
      const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);
      where.effectiveDate = { gte: startOfYear, lte: endOfYear };
    } else if (parsedDateFrom || parsedDateToStart) {
      // dateFrom is inclusive (>= start of that UTC day). dateTo is
      // exclusive-next-day (< start of the day AFTER it) — using `lte` on a
      // midnight instant would only cover the very first moment of the
      // dateTo day and silently exclude the rest of it.
      where.effectiveDate = {
        ...(parsedDateFrom ? { gte: parsedDateFrom } : {}),
        ...(parsedDateToStart
          ? { lt: nextUtcDayStart(parsedDateToStart) }
          : {}),
      };
    }

    // sourceFamily is a coarser grouping over sourceOrigin (never a new
    // schema field). Both filters narrow the same axis: if both are given,
    // the effective set is their intersection (exact sourceOrigin values
    // outside the requested family are dropped, never added back) — this
    // can never widen eligibility, only narrow it further or to empty.
    if (sourceFamily) {
      const familyOrigins = sourceOriginsForFamily(sourceFamily);
      const allowedOrigins = sourceOrigin
        ? familyOrigins.filter((origin) => origin === sourceOrigin)
        : familyOrigins;
      where.sourceOrigin =
        allowedOrigins.length === 1
          ? allowedOrigins[0]
          : { in: allowedOrigins };
    } else if (sourceOrigin) {
      where.sourceOrigin = sourceOrigin;
    }

    /**
     * BP-UX-FINAL-01C GAP-A — BOTH LAWFUL PROVENANCE PATHS, NOT ONE.
     *
     * This used to assign `where.sourceSubmission` directly, which reaches ONLY
     * the catalog chain (BasicPrice -> PriceSubmission -> importRow -> batch).
     * A WORKSPACE_PRIVATE row has no PriceSubmission at all — it links to the
     * very same batch one step shorter, through `sourceImportRow` — so the
     * filter silently excluded every private price in existence, while the
     * SUMBER column beside it printed those same rows' source names happily.
     *
     * PUSHED INTO `AND`, NEVER ASSIGNED TO `OR`. The fragment needs an `OR` of
     * its two provenance alternatives, and the top-level `OR` key belongs to
     * eligibility — assigning it here would delete tenant isolation instead of
     * narrowing the result. See basic-price-source-name.filter.ts.
     */
    if (sourceName) {
      const fragment = basicPriceSourceNameWhere(sourceName);
      const ids = await this.sourceNameObservationDescendantIds(
        workspaceId,
        sourceName,
      );
      if (ids.length > 0) {
        (fragment.OR as Prisma.BasicPriceWhereInput[]).push({
          id: { in: ids },
        });
      }
      (where.AND as Prisma.BasicPriceWhereInput[]).push(fragment);
    }

    if (freshnessStatus) {
      where.freshnessStatus = freshnessStatus;
    }

    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      this.prisma.basicPrice.count({ where }),
      this.prisma.basicPrice.findMany({
        where,
        select: EXPLORER_ROW_SELECT,
        orderBy: [
          { [sortBy]: sortOrder },
          { id: 'asc' }, // deterministic sorting tie-breaker
        ],
        skip,
        take: limit,
      }),
    ]);

    const explorerRows = rows as ExplorerRowSource[];
    const inheritedNames = await this.inheritedExplorerSourceNames(
      explorerRows,
      workspaceId,
    );

    return {
      // Selection and display share the same temporal context. Source identity
      // is inherited only through a proved SAME-SOURCE observation audit;
      // no old price/effective date/document is copied to the new observation.
      data: explorerRows.map((row) => {
        const item = mapExplorerItem(row, workspaceId, asOf);
        const inherited = inheritedNames.get(row.id);
        return item.sourceName === null && inherited
          ? { ...item, sourceName: inherited }
          : item;
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Ambil satu BasicPrice by ID, pastikan scoped ke workspace.
   */
  async findOneForWorkspace(id: string, workspaceId: string) {
    const price = await this.prisma.basicPrice.findFirst({
      where: {
        id,
        ...this.eligibility.usableWhere(workspaceId),
      },
      include: {
        resource: true,
      },
    });

    // Anti-enumeration: a foreign workspace's private price is reported as
    // plain non-existence, exactly like an unknown id — the caller must not be
    // able to infer that some other tenant owns a price with this id.
    if (!price) {
      throw new NotFoundException('BasicPrice not found');
    }

    return price;
  }

  /**
   * BP-UX-FINAL-01C — ONE PROJECTED DETAIL READ, WITH REAL PRICE HISTORY.
   *
   * WHY THIS IS A NEW ROUTE AND NOT AN UPGRADE OF `findOneForWorkspace`.
   *
   * That method's raw response is a PROVEN contract: eight end-to-end
   * assertions across four acceptance specs read `verificationStatus`,
   * `status` and `supersedesBasicPriceId` straight off it — including HIST-01,
   * which exists precisely to prove that a superseded price stays readable by
   * id. Replacing that shape with a projection to tidy it would break working
   * law tests in order to improve nothing a user can see. So the raw read is
   * left exactly as it is, and the browser gets its own bounded door.
   *
   * IT IS RAW-LAWFUL, DELIBERATELY. Only `usableWhere` applies here — no
   * currentness, no precedence. Asking for a specific row by id is a
   * LAWFULNESS question, not a selection one, so a superseded or withdrawn
   * price remains fully readable and its history remains rich. That is the same
   * distinction `findAllForWorkspace` documents from the other side.
   *
   * ANTI-ENUMERATION IS UNCHANGED: an id in another tenant is reported as plain
   * non-existence, identical to an unknown id.
   */
  async findDetailForWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<BasicPriceDetail> {
    const row = await this.prisma.basicPrice.findFirst({
      where: {
        id,
        ...this.eligibility.usableWhere(workspaceId),
      },
      select: {
        ...EXPLORER_ROW_SELECT,
        // Detail's two provenance branches go one column deeper than the
        // list's, so the evidence sentence can distinguish "linked to a batch"
        // from "the original bytes are retained". Declared AFTER the spread so
        // it overrides, never races.
        ...DETAIL_PROVENANCE_SELECT,
        // RM-03D1 evidence facts — the source's own period wording and whether
        // SIMPROK derived the effective date or was told it. Human-readable,
        // and the only reason Detail may speak about provenance at all.
        sourcePeriodLabel: true,
        effectiveDateProvenance: true,
        effectiveDateDerivationRule: true,
        // Needed to place THIS row inside its own timeline. Never projected —
        // `mapExplorerItem` and `mapBasicPriceEvidence` are explicit
        // allow-lists, so a column selected here cannot reach the browser by
        // accident the way an `include` would have let it.
        resourceId: true,
        regionId: true,
        supersedesBasicPriceId: true,
      },
    });

    if (!row) {
      throw new NotFoundException('BasicPrice not found');
    }

    // The Detail and Explorer must project the same proven source identity.
    // Neither projection inherits the predecessor's MONEY or document bytes.
    const displayedPrice = mapExplorerItem(row, workspaceId, new Date());
    const inheritedName = (
      await this.inheritedExplorerSourceNames([row], workspaceId)
    ).get(row.id);
    return {
      price:
        displayedPrice.sourceName === null && inheritedName
          ? { ...displayedPrice, sourceName: inheritedName }
          : displayedPrice,
      evidence: mapBasicPriceEvidence(row),
      // KDN ADDENDUM — a RESOURCE-level domestic-content fact, carried beside
      // the price and never folded into it. It changes no money, no currentness
      // and no eligibility; a price with an unknown %KDN is exactly as usable
      // as one with a stated 80%.
      domesticContent: mapBasicPriceDomesticContent(row),
      corrections: await this.readCorrectionLineage(row, workspaceId),
    };
  }

  /**
   * THE PRICE'S OWN CORRECTIONS — ONE QUERY, EXACT LINEAGE, NO N+1.
   *
   * NAMED FOR WHAT IT READS. It follows `supersedesBasicPriceId`, which is one
   * sentence only: "a human published this price as an explicit correction of
   * that one". It is NOT the price's observation history — a later, equally
   * valid reading of the same market carries no pointer and never appears here
   * — and the endpoint, the contract and every label above it say KOREKSI so
   * that an empty lineage can never be read as "this resource has no past".
   *
   * IT REPORTS ITS OWN LIMITS. The read is bounded; `buildSupersessionTimeline`
   * returns `truncated` when the oldest entry it emitted still names a
   * predecessor it could not resolve — the ceiling below, or a row this
   * workspace may not read. A bounded answer that admits it is bounded is the
   * only kind this may return.
   *
   * The naive shape is a loop: read a row, follow `supersedesBasicPriceId`,
   * read the next, repeat. That is one round trip per generation and it grows
   * without a ceiling, which is exactly the request-per-generation pattern this
   * read is forbidden to use.
   *
   * IT IS NOT NEEDED, BECAUSE THE DATABASE ALREADY PROVES THE CHAIN'S SHAPE.
   * The publication writer refuses `SUPERSESSION_RESOURCE_MISMATCH` and
   * `SUPERSESSION_REGION_MISMATCH`, so every member of a correction chain
   * shares the SAME resource and the SAME region. That makes
   * `(resourceId, regionId)` a guaranteed SUPERSET of the chain — so ONE
   * bounded, tenant-filtered read fetches every candidate, and the timeline is
   * then assembled in memory by following exact id pointers.
   *
   * THE FETCH SCOPE IS NOT THE MEMBERSHIP RULE. A row that shares the resource,
   * the region, the value and the date but is NOT named by a
   * `supersedesBasicPriceId` pointer is a different observation and never
   * enters the timeline — see `buildSupersessionTimeline`, which decides
   * membership from pointers alone.
   *
   * TENANCY IS THE SAME ONE GATE. `usableWhere` filters the lineage read
   * exactly as it filters the anchor, so a chain can never walk into a row this
   * workspace may not read. And the walk follows `supersedes` ONLY — never
   * `promotedFrom`, which points at another tenant's private origin and is a
   * different question entirely (that lineage is never traversed here, so no
   * foreign workspace, account or private id can reach this projection).
   */
  private async readCorrectionLineage(
    anchor: {
      id: string;
      value: Prisma.Decimal | string;
      effectiveDate: Date;
      resourceId: string;
      regionId: string | null;
      supersedesBasicPriceId: string | null;
    },
    workspaceId: string,
  ): Promise<BasicPriceDetail['corrections']> {
    const lineageRows = await this.prisma.basicPrice.findMany({
      where: {
        ...this.eligibility.usableWhere(workspaceId),
        resourceId: anchor.resourceId,
        // Exact equality including NULL — a region-less price and a regional
        // one are different logical contexts, and the writer says so.
        regionId: anchor.regionId,
      },
      select: {
        id: true,
        value: true,
        effectiveDate: true,
        supersedesBasicPriceId: true,
      },
      /**
       * A CEILING, NOT A PAGE — AND ONE ROW MORE THAN THE CEILING, ON PURPOSE.
       *
       * BP-UX-FINAL-01D GAP-C. The chain is a linked list inside one logical
       * context, so the ceiling is far above any real correction chain. But the
       * FETCH is scoped by (resource, region), which is a SUPERSET of the
       * chain: two hundred perfectly ordinary, unrelated observations of the
       * same resource in the same region would fill it, and a genuine older
       * correction could then fall outside the rows read — invisibly.
       *
       * Reading MAX + 1 costs one row and buys the only thing that matters: the
       * ability to KNOW the superset was capped. Absence outside a capped read
       * is not provable, so a capped read must never be presented as a complete
       * lineage, even when the chain it did find looks whole.
       *
       * The extra row is not thrown away — every row read is offered to the
       * walk, which has its own generation bound. More truth, same ceiling.
       */
      take: BASIC_PRICE_HISTORY_MAX_GENERATIONS + 1,
      orderBy: [{ effectiveDate: 'desc' }, { id: 'asc' }],
    });

    /**
     * DID THE CANDIDATE READ ITSELF HIT ITS LIMIT?
     *
     * Distinct from the walk's own truncation, and either one alone is enough
     * to forbid a completeness claim:
     *
     *   walk truncation      the oldest entry emitted still NAMES a predecessor
     *                        that is not in the answer.
     *   superset truncation  the fetch stopped at its ceiling, so a predecessor
     *                        might exist that was never read and therefore
     *                        never named.
     */
    const candidateSupersetCapped =
      lineageRows.length > BASIC_PRICE_HISTORY_MAX_GENERATIONS;

    /**
     * THE ANCHOR IS ALWAYS IN ITS OWN TIMELINE — GUARANTEED HERE, NOT ASSUMED.
     *
     * It satisfies the lineage predicate by construction (same resource, same
     * region, and it already passed `usableWhere` when it was read), so the
     * only way it can be missing is the `take` ceiling above truncating it out.
     * Seeding it from its OWN REAL COLUMNS closes that case with the truth
     * rather than with a placeholder: a fabricated zero price with an epoch
     * date would be exactly the invented history this whole read exists to
     * refuse. `Map` de-duplicates, so when the fetch already contained it
     * nothing is added.
     */
    const rows = [...lineageRows];
    if (!rows.some((row) => row.id === anchor.id)) {
      rows.push({
        id: anchor.id,
        value: anchor.value,
        effectiveDate: anchor.effectiveDate,
        supersedesBasicPriceId: anchor.supersedesBasicPriceId,
      } as (typeof lineageRows)[number]);
    }

    const timeline = buildSupersessionTimeline(anchor.id, rows);
    return {
      entries: timeline.entries.map((entry) =>
        mapBasicPriceCorrectionEntry(
          entry.row as HistoryRowSource,
          entry.state,
        ),
      ),
      // Either kind of boundedness forbids the unbounded heading. A lineage
      // that LOOKS complete inside a capped read is not proven complete, and
      // the screen must not say it is.
      truncated: timeline.truncated || candidateSupersetCapped,
    };
  }

  /**
   * Cari BasicPrice berdasarkan resourceId untuk workspace.
   *
   * The `orderBy` below is a PRE-EXISTING display order (workspace-owned rows
   * listed before global ones) and is left exactly as it was. RM-03C does NOT
   * touch it and does NOT add assetScope to it: ordering a read is not the
   * same thing as deciding which price wins, and private-vs-catalog precedence
   * remains an open Owner decision. Nothing downstream selects a price from
   * this list's order.
   */
  async findByResource(resourceId: string, workspaceId: string) {
    const asOf = new Date();
    const precedence = promotionLineagePrecedenceWhere(workspaceId);
    const olderOffers =
      await BasicPriceService.olderSameSourceObservationOfferIds(
        this.prisma,
        this.eligibility,
        workspaceId,
        asOf,
        precedence,
      );
    return this.prisma.basicPrice.findMany({
      where: {
        resourceId,
        ...this.eligibility.usableWhere(workspaceId),
        ...(olderOffers.length > 0 ? { id: { notIn: olderOffers } } : {}),
        // BP-CAT-01E — a per-resource candidate list, so the same one-logical-
        // truth rule applies here as in the Explorer. `findOneForWorkspace`
        // below deliberately does NOT compose this: asking for a specific row
        // by id is a lawfulness question, not a selection one.
        ...precedence,
        // BP-CORR-01 — and for the same reason, a replaced price is not one of
        // this resource's current candidates. Same exemption applies:
        // `findOneForWorkspace` keeps returning it by id.
        // BP-CORR-01B TEMPORAL — present-tense read, so it states the present.
        ...basicPriceCurrentnessWhere({ asOf }),
      },
      // BP-CAT-01D — RICH INSIDE, SAFE OUTSIDE.
      //
      // This used to be an `include`, which returns EVERY scalar on the row.
      // That was survivable while every row a caller could see belonged to
      // them; shared promotion ended that. A promoted row truthfully carries
      // the ORIGIN's `reportedByAccountId`, and it carries
      // `promotedFromBasicPriceId` — the id of a BasicPrice in a workspace the
      // reader may not read. Both were being handed to every other tenant.
      //
      // Stated as an explicit allow-list, exactly like EXPLORER_ROW_SELECT
      // above, so a future column is private until someone deliberately adds it
      // here. An `include` would have adopted it silently, which is how this
      // leak happened in the first place.
      //
      // Nothing is deleted from persistence: the internal trail and the Cost
      // Kernel still read every one of these facts directly.
      select: {
        id: true,
        // Kept: NULL on a shared row and the caller's own id otherwise, so it
        // says "catalog or mine" without naming anyone else's tenant.
        workspaceId: true,
        assetScope: true,
        resourceId: true,
        regionId: true,
        value: true,
        effectiveDate: true,
        validUntil: true,
        reviewDate: true,
        sourceType: true,
        sourceOrigin: true,
        freshnessStatus: true,
        status: true,
        verificationStatus: true,
        sourcePeriodLabel: true,
        sourcePeriodGranularity: true,
        effectiveDateProvenance: true,
        effectiveDateDerivationRule: true,
        createdAt: true,
        updatedAt: true,
        resource: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            baseUnit: true,
          },
        },
      },
      orderBy: [
        { workspaceId: 'desc' }, // workspace-specific first
        { effectiveDate: 'desc' },
      ],
    });
  }

  healthCheck() {
    return { module: 'basic-price', status: 'ok' };
  }
}

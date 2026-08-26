import {
  BadRequestException,
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
  mapExplorerItem,
  type BasicPriceExplorerItem,
  type ExplorerRowSource,
} from '../common/basic-price-workflow.projection';
import { nextUtcDayStart, parseDateOnlyUtc } from '../common/date-only.util';
import { sourceOriginsForFamily } from './basic-price-source-family.util';
import { promotionLineagePrecedenceWhere } from './basic-price-promotion-precedence';
import { basicPriceCurrentnessWhere } from './basic-price-currentness';

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
    const where: Prisma.BasicPriceWhereInput = {
      ...this.eligibility.usableWhere(workspaceId),
      ...promotionLineagePrecedenceWhere(workspaceId),
      // BP-CORR-01B TEMPORAL — the Explorer has no business date of its own, so
      // it states the one it IS on: the present, resolved once for this request.
      // Passing nothing used to mean "a withdrawal exists somewhere in time,
      // therefore not current", which removed a future-dated withdrawal's price
      // before its own effective date.
      ...basicPriceCurrentnessWhere({ asOf: new Date() }),
    };

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

    if (regionId) {
      where.regionId = regionId;
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

    if (sourceName) {
      where.sourceSubmission = {
        is: {
          importRow: {
            is: {
              batch: {
                is: {
                  OR: [
                    {
                      sourceVendorName: {
                        contains: sourceName,
                        mode: 'insensitive',
                      },
                    },
                    {
                      sourceOrganizationName: {
                        contains: sourceName,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      };
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

    return {
      data: (rows as ExplorerRowSource[]).map((row) =>
        mapExplorerItem(row, workspaceId),
      ),
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
    return this.prisma.basicPrice.findMany({
      where: {
        resourceId,
        ...this.eligibility.usableWhere(workspaceId),
        // BP-CAT-01E — a per-resource candidate list, so the same one-logical-
        // truth rule applies here as in the Explorer. `findOneForWorkspace`
        // below deliberately does NOT compose this: asking for a specific row
        // by id is a lawfulness question, not a selection one.
        ...promotionLineagePrecedenceWhere(workspaceId),
        // BP-CORR-01 — and for the same reason, a replaced price is not one of
        // this resource's current candidates. Same exemption applies:
        // `findOneForWorkspace` keeps returning it by id.
        // BP-CORR-01B TEMPORAL — present-tense read, so it states the present.
        ...basicPriceCurrentnessWhere({ asOf: new Date() }),
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

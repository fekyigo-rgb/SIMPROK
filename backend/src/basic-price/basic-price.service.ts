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

const EXPLORER_ROW_SELECT = {
  id: true,
  workspaceId: true,
  value: true,
  effectiveDate: true,
  validUntil: true,
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
      sourceName,
      verificationStatus,
      freshnessStatus,
      unit,
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

    if (
      dateFrom &&
      dateTo &&
      new Date(dateFrom).getTime() > new Date(dateTo).getTime()
    ) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }

    // Base eligibility (hard lock): status PUBLISHED AND verification terminal PUBLISHED.
    // The optional query param cannot widen this — it is validated above and otherwise ignored.
    const where: Prisma.BasicPriceWhereInput = {
      ...this.eligibility.publicEligibilityWhere(),
      OR: [{ workspaceId }, { workspaceId: null }],
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
    } else if (dateFrom || dateTo) {
      where.effectiveDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    if (sourceOrigin) {
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
        ...this.eligibility.publicEligibilityWhere(),
        OR: [{ workspaceId }, { workspaceId: null }],
      },
      include: {
        resource: true,
      },
    });

    if (!price) {
      throw new NotFoundException('BasicPrice not found');
    }

    return price;
  }

  /**
   * Cari BasicPrice berdasarkan resourceId untuk workspace.
   * Prioritas: workspace-specific > global.
   */
  async findByResource(resourceId: string, workspaceId: string) {
    return this.prisma.basicPrice.findMany({
      where: {
        resourceId,
        ...this.eligibility.publicEligibilityWhere(),
        OR: [{ workspaceId }, { workspaceId: null }],
      },
      include: {
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

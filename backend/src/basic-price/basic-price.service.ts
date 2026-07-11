import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GetBasicPricesDto } from './dto/get-basic-prices.dto';
import { Prisma, PriceVerificationStatus } from '@prisma/client';

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
 * Catatan (controlled schema debt, TIDAK diperbaiki di slice ini): BasicPrice.status
 * ber-default 'PUBLISHED', sehingga status='PUBLISHED' sendirian tidak membuktikan
 * kelolosan kurasi — karena itu verificationStatus=PUBLISHED wajib ikut.
 */
const PUBLIC_BASIC_PRICE_VERIFICATION_STATUS = PriceVerificationStatus.PUBLISHED;

/**
 * BasicPriceService — Golden Path v0 Slice A
 *
 * Hanya read operations untuk Golden Path v0.
 * Write operations (submit harga) ada di reality-intake domain.
 * Semua query scoped by workspaceId.
 */
@Injectable()
export class BasicPriceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ambil semua harga dasar yang berlaku untuk workspace ini.
   * Termasuk harga workspace-specific dan harga global (workspaceId = null, status PUBLISHED).
   */
  async findAllForWorkspace(workspaceId: string, query: GetBasicPricesDto = {}) {
    const {
      search,
      resourceId,
      regionId,
      year,
      sourceOrigin,
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

    // Base eligibility (hard lock): status PUBLISHED AND verification terminal PUBLISHED.
    // The optional query param cannot widen this — it is validated above and otherwise ignored.
    const where: Prisma.BasicPriceWhereInput = {
      status: 'PUBLISHED',
      verificationStatus: PUBLIC_BASIC_PRICE_VERIFICATION_STATUS,
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
    }

    if (sourceOrigin) {
      where.sourceOrigin = sourceOrigin;
    }

    if (freshnessStatus) {
      where.freshnessStatus = freshnessStatus;
    }

    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      this.prisma.basicPrice.count({ where }),
      this.prisma.basicPrice.findMany({
        where,
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
          { [sortBy]: sortOrder },
          { id: 'asc' }, // deterministic sorting tie-breaker
        ],
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
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
        status: 'PUBLISHED',
        verificationStatus: PUBLIC_BASIC_PRICE_VERIFICATION_STATUS,
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
        status: 'PUBLISHED',
        verificationStatus: PUBLIC_BASIC_PRICE_VERIFICATION_STATUS,
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

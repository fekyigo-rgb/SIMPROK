import { Injectable } from '@nestjs/common';
import { Prisma, ResourceType, UnitDimension, UnitKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SearchRegionDto,
  SearchResourceCatalogDto,
  SearchUnitDefinitionDto,
} from './dto/search-basic-price-import-lookups.dto';

interface CountRow {
  count: bigint;
}

export interface ResourceLookupRow {
  id: string;
  code: string | null;
  name: string;
  type: ResourceType;
  baseUnit: string;
  status: string;
}

export interface UnitLookupRow {
  id: string;
  code: string;
  displayName: string;
  symbol: string;
  dimension: UnitDimension;
  kind: UnitKind;
}

@Injectable()
export class BasicPriceImportLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async searchResources(workspaceId: string, dto: SearchResourceCatalogDto) {
    const q = dto.q?.trim() ?? '';
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const typeFilter = dto.type ? Prisma.sql`AND "type" = ${dto.type}::"ResourceType"` : Prisma.empty;
    const searchFilter =
      q.length > 0
        ? Prisma.sql`AND (
            lower(coalesce("code", '')) = lower(${q})
            OR lower("name") = lower(${q})
            OR left(lower(coalesce("code", '')), length(${q})) = lower(${q})
            OR left(lower("name"), length(${q})) = lower(${q})
            OR position(lower(${q}) in lower(coalesce("code", ''))) > 0
            OR position(lower(${q}) in lower("name")) > 0
            OR position(lower(${q}) in lower("baseUnit")) > 0
          )`
        : Prisma.empty;

    const [items, countRows] = await Promise.all([
      this.prisma.$queryRaw<ResourceLookupRow[]>(Prisma.sql`
        SELECT "id", "code", "name", "type", "baseUnit", "status"
        FROM "resource_catalogs"
        WHERE "workspaceId" = ${workspaceId}::uuid
          AND "status" = 'ACTIVE'
          ${typeFilter}
          ${searchFilter}
        ORDER BY
          CASE
            WHEN ${q} <> '' AND lower(coalesce("code", '')) = lower(${q}) THEN 0
            WHEN ${q} <> '' AND lower("name") = lower(${q}) THEN 1
            WHEN ${q} <> '' AND left(lower(coalesce("code", '')), length(${q})) = lower(${q}) THEN 2
            WHEN ${q} <> '' AND left(lower("name"), length(${q})) = lower(${q}) THEN 3
            ELSE 4
          END,
          lower("name") ASC,
          lower("baseUnit") ASC,
          "code" ASC NULLS LAST,
          "id" ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT count(*)::bigint AS "count"
        FROM "resource_catalogs"
        WHERE "workspaceId" = ${workspaceId}::uuid
          AND "status" = 'ACTIVE'
          ${typeFilter}
          ${searchFilter}
      `),
    ]);

    const total = Number(countRows[0]?.count ?? 0);
    return { items, page, limit, total, hasNext: offset + items.length < total };
  }

  /**
   * RM-02D2A2 — canonical GLOBAL active Region list for the import Region
   * selector. Region has no workspaceId, so this is intentionally not
   * workspace-scoped; access is still gated by JwtAuthGuard + PermissionsGuard
   * (BASIC_PRICE_IMPORT) at the controller. Returns only id/code/name — never
   * a bare UUID label — filtered to isActive=true. Optional `q` matches code
   * OR name, case-insensitive.
   */
  async searchRegions(dto: SearchRegionDto) {
    const q = dto.q?.trim() ?? '';
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const where: Prisma.RegionWhereInput = {
      isActive: true,
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.region.findMany({
        where,
        // BY NAME, because a person is looking for a PLACE. Ordering by `code`
        // sorted the list by provisioning identity, so a page of regions came
        // back grouped by whichever fixture or batch created them rather than
        // alphabetically by the only field a human reads. `code` stays as the
        // tie-break so the order is still total and deterministic.
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
        skip: offset,
        take: limit,
        select: { id: true, code: true, name: true },
      }),
      this.prisma.region.count({ where }),
    ]);

    return { items, page, limit, total, hasNext: offset + items.length < total };
  }

  async searchUnits(dto: SearchUnitDefinitionDto) {
    const q = dto.q?.trim() ?? '';
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const dimensionFilter = dto.dimension
      ? Prisma.sql`AND unit."dimension" = ${dto.dimension}::"UnitDimension"`
      : Prisma.empty;
    const kindFilter = dto.kind ? Prisma.sql`AND unit."kind" = ${dto.kind}::"UnitKind"` : Prisma.empty;
    const aliasExact = Prisma.sql`EXISTS (
      SELECT 1 FROM "unit_aliases" alias
      WHERE alias."unitDefinitionId" = unit."id"
        AND alias."isActive" = true
        AND (lower(alias."rawAlias") = lower(${q}) OR lower(alias."normalizedAlias") = lower(${q}))
    )`;
    const aliasPrefix = Prisma.sql`EXISTS (
      SELECT 1 FROM "unit_aliases" alias
      WHERE alias."unitDefinitionId" = unit."id"
        AND alias."isActive" = true
        AND (
          left(lower(alias."rawAlias"), length(${q})) = lower(${q})
          OR left(lower(alias."normalizedAlias"), length(${q})) = lower(${q})
        )
    )`;
    const aliasContains = Prisma.sql`EXISTS (
      SELECT 1 FROM "unit_aliases" alias
      WHERE alias."unitDefinitionId" = unit."id"
        AND alias."isActive" = true
        AND (
          position(lower(${q}) in lower(alias."rawAlias")) > 0
          OR position(lower(${q}) in lower(alias."normalizedAlias")) > 0
        )
    )`;
    const searchFilter =
      q.length > 0
        ? Prisma.sql`AND (
            lower(unit."code") = lower(${q})
            OR lower(unit."symbol") = lower(${q})
            OR lower(unit."displayName") = lower(${q})
            OR ${aliasExact}
            OR left(lower(unit."code"), length(${q})) = lower(${q})
            OR left(lower(unit."symbol"), length(${q})) = lower(${q})
            OR left(lower(unit."displayName"), length(${q})) = lower(${q})
            OR ${aliasPrefix}
            OR position(lower(${q}) in lower(unit."code")) > 0
            OR position(lower(${q}) in lower(unit."symbol")) > 0
            OR position(lower(${q}) in lower(unit."displayName")) > 0
            OR ${aliasContains}
          )`
        : Prisma.empty;

    const [items, countRows] = await Promise.all([
      this.prisma.$queryRaw<UnitLookupRow[]>(Prisma.sql`
        SELECT unit."id", unit."code", unit."displayName", unit."symbol", unit."dimension", unit."kind"
        FROM "unit_definitions" unit
        WHERE unit."isActive" = true
          ${dimensionFilter}
          ${kindFilter}
          ${searchFilter}
        ORDER BY
          CASE
            WHEN ${q} <> '' AND lower(unit."code") = lower(${q}) THEN 0
            WHEN ${q} <> '' AND lower(unit."symbol") = lower(${q}) THEN 1
            WHEN ${q} <> '' AND lower(unit."displayName") = lower(${q}) THEN 2
            WHEN ${q} <> '' AND ${aliasExact} THEN 3
            WHEN ${q} <> '' AND (
              left(lower(unit."code"), length(${q})) = lower(${q})
              OR left(lower(unit."symbol"), length(${q})) = lower(${q})
              OR left(lower(unit."displayName"), length(${q})) = lower(${q})
              OR ${aliasPrefix}
            ) THEN 4
            ELSE 5
          END,
          lower(unit."displayName") ASC,
          lower(unit."code") ASC,
          unit."id" ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT count(*)::bigint AS "count"
        FROM "unit_definitions" unit
        WHERE unit."isActive" = true
          ${dimensionFilter}
          ${kindFilter}
          ${searchFilter}
      `),
    ]);

    const total = Number(countRows[0]?.count ?? 0);
    return { items, page, limit, total, hasNext: offset + items.length < total };
  }
}

# RM-02C2 API Contract

Both routes require `JwtAuthGuard`, `PermissionsGuard`, and
`BASIC_PRICE_REVIEW_VIEW`.

## Resource lookup

`GET /basic-price-import-lookups/resources`

Parameters: `q` (maximum 100), `type`, `page` (default 1), and `limit`
(default 20, maximum 50). Search covers code, name, and base unit.
Ordering is exact code, exact name, code prefix, name prefix, contains,
name, base unit, nullable code last, then ID. The response contains only:
`id`, `code`, `name`, `type`, `baseUnit`, and `status`.

Eligibility is exactly active-workspace ownership plus `status = ACTIVE`.
There is no global-resource fallback.

## Unit lookup

`GET /basic-price-import-lookups/units`

Parameters: `q` (maximum 100), `dimension`, `kind`, `page` (default 1),
and `limit` (default 20, maximum 50). Search covers code, display name,
symbol, and active raw/normalized aliases. Active-alias matches use `EXISTS`,
so UnitDefinition IDs are not duplicated. Ordering is exact code, symbol,
display name, active alias, prefix, contains, display name, code, then ID.
The response contains only `id`, `code`, `displayName`, `symbol`,
`dimension`, and `kind`; no conversion rule is returned or inferred.

All dynamic query values are bound through `Prisma.sql`. Both routes execute
only read queries.

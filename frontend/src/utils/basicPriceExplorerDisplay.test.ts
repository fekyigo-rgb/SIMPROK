import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_TYPE_OPTIONS,
  SOURCE_FAMILY_OPTIONS,
  buildExplorerQueryParams,
  explorerErrorMessageFromStatus,
  explorerErrorStateFromStatus,
  explorerSourceNameLabel,
  formatExplorerPrice,
  freshnessLabel,
  isAmbiguousTimeFilter,
  isInvalidDateRange,
  regionLabel,
  resourceLabel,
  resourceTypeLabel,
  sourceFamilyLabel,
  sourceOriginLabel,
  sourceTypeLabel,
  workspaceScopeLabel,
} from './basicPriceExplorerDisplay.ts';
import type { ExplorerResourceIdentity } from './basicPriceExplorerDisplay.ts';

test('buildExplorerQueryParams — only non-empty fields become query params', () => {
  const params = buildExplorerQueryParams({ search: '  Semen  ', page: 2, limit: undefined });
  assert.deepEqual(params, { search: 'Semen', page: '2' });
});

test('buildExplorerQueryParams — omits blank strings entirely', () => {
  const params = buildExplorerQueryParams({ search: '   ', regionId: '' });
  assert.deepEqual(params, {});
});

test('buildExplorerQueryParams — carries dateFrom/dateTo/sourceName through untouched', () => {
  const params = buildExplorerQueryParams({
    dateFrom: '2026-01-01',
    dateTo: '2026-06-30',
    sourceName: 'Toko Jaya',
  });
  assert.deepEqual(params, {
    dateFrom: '2026-01-01',
    dateTo: '2026-06-30',
    sourceName: 'Toko Jaya',
  });
});

test('isAmbiguousTimeFilter — true only when year AND a date-range bound are both present', () => {
  assert.equal(isAmbiguousTimeFilter({ year: '2026', dateFrom: '2026-01-01' }), true);
  assert.equal(isAmbiguousTimeFilter({ year: '2026', dateTo: '2026-12-31' }), true);
  assert.equal(isAmbiguousTimeFilter({ year: '2026' }), false);
  assert.equal(isAmbiguousTimeFilter({ dateFrom: '2026-01-01', dateTo: '2026-12-31' }), false);
  assert.equal(isAmbiguousTimeFilter({}), false);
});

test('isInvalidDateRange — true only when dateFrom is strictly after dateTo', () => {
  assert.equal(isInvalidDateRange('2026-06-30', '2026-01-01'), true);
  assert.equal(isInvalidDateRange('2026-01-01', '2026-06-30'), false);
  assert.equal(isInvalidDateRange('2026-01-01', '2026-01-01'), false);
  assert.equal(isInvalidDateRange(undefined, '2026-01-01'), false);
  assert.equal(isInvalidDateRange('2026-01-01', undefined), false);
});

test('resourceLabel/regionLabel are re-exported and apply to the Explorer identity shape (baseUnit is a superset field)', () => {
  const explorerResource: ExplorerResourceIdentity = {
    id: 'r1',
    code: 'MAT-01',
    name: 'Semen',
    type: 'MATERIAL',
    baseUnit: 'Zak',
  };
  assert.equal(resourceLabel(explorerResource), 'MAT-01 — Semen');
  assert.equal(regionLabel({ id: 'reg1', code: 'ID-JK', name: 'DKI Jakarta' }), 'ID-JK — DKI Jakarta');
  assert.equal(regionLabel(null), 'Umum (tanpa wilayah)');
});

test('formatExplorerPrice — exact string formatting, no float math', () => {
  assert.equal(formatExplorerPrice('125000.00'), 'Rp 125.000,00');
  assert.equal(formatExplorerPrice('99.50'), 'Rp 99,50');
});

test('explorerSourceNameLabel — honest "Sumber tidak tersedia" when null, never fabricated', () => {
  assert.equal(explorerSourceNameLabel(null), 'Sumber tidak tersedia');
  assert.equal(explorerSourceNameLabel('Toko Jaya'), 'Toko Jaya');
});

test('sourceOriginLabel / sourceTypeLabel / freshnessLabel — known codes map, unknown codes pass through', () => {
  assert.equal(sourceOriginLabel('GOVERNMENT'), 'Pemerintah');
  assert.equal(sourceOriginLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  assert.equal(sourceTypeLabel('MARKET_SURVEY'), 'Survei Pasar');
  assert.equal(freshnessLabel('EXPIRED'), 'Kedaluwarsa');
});

test('workspaceScopeLabel — human copy for WORKSPACE vs GLOBAL', () => {
  assert.equal(workspaceScopeLabel('WORKSPACE'), 'Workspace Anda');
  assert.equal(workspaceScopeLabel('GLOBAL'), 'Umum (Global)');
});

test('resourceTypeLabel — canonical MATERIAL/LABOR/EQUIPMENT map to human category labels', () => {
  assert.equal(resourceTypeLabel('MATERIAL'), 'Material/Bahan');
  assert.equal(resourceTypeLabel('LABOR'), 'Upah/Tenaga Kerja');
  assert.equal(resourceTypeLabel('EQUIPMENT'), 'Peralatan');
  assert.equal(resourceTypeLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  assert.deepEqual(RESOURCE_TYPE_OPTIONS, ['MATERIAL', 'LABOR', 'EQUIPMENT']);
});

test('sourceFamilyLabel — owner-locked GOVERNMENT/STORE_SUPPLIER/FIELD_PRICE map to human family labels', () => {
  assert.equal(sourceFamilyLabel('GOVERNMENT'), 'Harga Pemerintah');
  assert.equal(sourceFamilyLabel('STORE_SUPPLIER'), 'Harga Toko/Supplier');
  assert.equal(sourceFamilyLabel('FIELD_PRICE'), 'Harga Lapangan');
  assert.equal(sourceFamilyLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  assert.deepEqual(SOURCE_FAMILY_OPTIONS, ['GOVERNMENT', 'STORE_SUPPLIER', 'FIELD_PRICE']);
});

test('buildExplorerQueryParams — carries resourceType and sourceFamily through untouched, alongside sourceOrigin', () => {
  const params = buildExplorerQueryParams({
    resourceType: 'LABOR',
    sourceFamily: 'STORE_SUPPLIER',
    sourceOrigin: 'STORE',
  });
  assert.deepEqual(params, {
    resourceType: 'LABOR',
    sourceFamily: 'STORE_SUPPLIER',
    sourceOrigin: 'STORE',
  });
});

test('explorerErrorStateFromStatus / explorerErrorMessageFromStatus — honest states per HTTP status', () => {
  assert.equal(explorerErrorStateFromStatus(403), 'FORBIDDEN');
  assert.equal(explorerErrorStateFromStatus(400), 'INVALID_FILTER');
  assert.equal(explorerErrorStateFromStatus(404), 'NOT_FOUND');
  assert.equal(explorerErrorStateFromStatus(500), 'SERVER_ERROR');
  assert.equal(explorerErrorStateFromStatus(418), 'ERROR');
  assert.equal(explorerErrorMessageFromStatus(400), explorerErrorMessageFromStatus(400));
  assert.match(explorerErrorMessageFromStatus(400), /[Ff]ilter/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { canLinkExistingImportedPricePair, type BasicPriceExplorerItem } from './basicPriceExplorerDisplay.ts';
const item = (change: Record<string, unknown> = {}): BasicPriceExplorerItem => ({
  basicPriceId: 'price-a',
  assetScope: 'WORKSPACE_PRIVATE',
  resource: { id: 'amp-10', code: 'E01', name: 'AMP 10 Ton/Jam', type: 'EQUIPMENT', baseUnit: 'EQUIPMENT_HOUR' },
  region: { id: 'tebet', code: 'TBT', name: 'Tebet' },
  regionCoverageSummary: null,
  price: '12500000.00',
  effectiveDate: '2026-10-01',
  validUntil: null, sourceType: 'MARKET_SURVEY', sourceOrigin: 'FIELD_REPORT',
  sourceName: 'Tim Simprok', freshnessStatus: 'CURRENT', workspaceScope: 'WORKSPACE',
  ...change,
} as BasicPriceExplorerItem);
test('BP-C2 UI invites explicit correction ONLY for an identifiable same-context pair', () => {
  assert.equal(canLinkExistingImportedPricePair(item(),item({
    basicPriceId:'price-b',price:'6500000.00',sourceName:'TIM   SIMPROK',
  })),true);
});
test('BP-C2 UI does not invite false correction for another technical resource, publisher, region or date', () => {
  const correct=item({basicPriceId:'price-b',price:'6500000.00'});
  for (const distinct of [
    {resource:{...correct.resource,id:'amp-60',name:'AMP 60 Ton/Jam'}},
    {sourceName:'Penerbit Lain'},
    {region:{id:'pancoran',code:'PNC',name:'Pancoran'}},
    {effectiveDate:'2026-11-01'},
    {price:'12500000.00'},
    {assetScope:'SIMPROK_CATALOG'},
    {sourceName:null},
  ]) assert.equal(canLinkExistingImportedPricePair(item(),item({...correct,...distinct})),false);
});

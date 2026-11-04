import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./RabWorkspacePage.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const handleReuseProvenAhsp = async () => {');
const end = source.indexOf('const handlePickAhsp = () => {', start);
const journey = start < 0 || end < start ? '' : source.slice(start, end);


const priceStart = source.indexOf('const handleAutoPriceReady = async () => {');
const priceEnd = source.indexOf('const handleReuseProvenAhsp = async () => {', priceStart);
const priceJourney = priceStart < 0 || priceEnd < priceStart
  ? '' : source.slice(priceStart, priceEnd);

test('RAB auto-price UI consumes and accumulates official revalidation counts before reporting completion', () => {
  assert.ok(priceJourney.length > 0);
  assert.match(priceJourney, /parseRabAutoPricePage\(payload, projectId\)/);
  assert.match(priceJourney, /outcome = accumulateRabAutoPriceOutcome\(outcome, pageResult\.counts\)/);
  assert.match(priceJourney, /if \(!pageResult\.hasNext\)/);
  assert.match(priceJourney, /setStatusMessage\(describeRabAutoPriceOutcome\(outcome\)\)/);
  assert.match(priceJourney, /AUTO_PRICE_INCOMPLETE_PAGINATION/);
});

test('RAB-level automation connects first-source proof before proven-reuse then official Cost Kernel action', () => {
  assert.ok(journey.length > 0);
  const first = journey.indexOf('/auto-bind-explicit-references?');
  const reuse = journey.indexOf('/auto-reuse-proven?');
  const pricing = journey.indexOf('await handleAutoPriceReady()');
  assert.ok(first >= 0 && reuse > first && pricing > reuse,
    'The ordering must be source proof → governed reuse → canonical calculation');
});

test('does not trigger pricing unless canonical association actually succeeded', () => {
  assert.match(journey, /row.kind === 'FIRST_UNCODED_EXACT_WORK_LINKED'/);
  assert.match(journey, /const totalLinked = firstBound \+ uncodedBound \+ reused/);
  assert.match(journey, /if \(totalLinked > 0\) \{\s*await handleAutoPriceReady\(\)/);
  assert.match(journey, /!workingDraftLoaded \|\| !canEditDraft/);
  assert.match(journey, /draftDirty \|\| isReusingProven \|\| isAutoPricing/);
});

test('the UI passes one date and does not select AHSP candidates or invent a price', () => {
  assert.equal((journey.match(/businessPricingAsOfDate: calculationAsOfDate/g) ?? []).length, 2);
  assert.doesNotMatch(journey, /selectedAhspVersionId|unitPrice:\s*0|lineTotal:\s*0/);
  assert.match(journey, /tidak menebak pasangan atau harga/);
});

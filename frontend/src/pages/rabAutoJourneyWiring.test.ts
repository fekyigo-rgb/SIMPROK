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
  assert.match(priceJourney, /const message = describeRabAutoPriceOutcome\(outcome\)/);
  assert.match(priceJourney, /setStatusMessage\(message\)/);
  assert.match(priceJourney, /AUTO_PRICE_INCOMPLETE_PAGINATION/);
});


test('RAB failed-write notice remains visible after retryToken draft reload in normal and focus modes', () => {
  assert.match(priceJourney, /if \(outcome\.requiresRevalidation > 0\) \{\s*setAutoPriceNotice\(\{/);
  const persisted = priceJourney.indexOf('setAutoPriceNotice({');
  const reloaded = priceJourney.indexOf('setRetryToken((value) => value + 1)', persisted);
  assert.ok(persisted >= 0 && reloaded > persisted,
    'warning must be stored separately before the canonical reload');
  const reloadStart = source.indexOf('const projectChanged = previousProjectIdRef.current !== projectId;');
  const reloadEnd = source.indexOf('}, [projectId, retryToken, isProvisional]);', reloadStart);
  assert.ok(reloadStart >= 0 && reloadEnd > reloadStart);
  const reloadEffect = source.slice(reloadStart, reloadEnd);
  assert.match(reloadEffect, /if \(projectChanged\) \{\s*markPersistContextChanged\(\);\s*setAutoPriceNotice\(null\)/);
  const sameProjectReload = reloadEffect.slice(reloadEffect.indexOf('let cancelled = false;'));
  assert.match(sameProjectReload, /setStatusMessage\('Memuat draft\.\.\.'\)/);
  assert.match(sameProjectReload, /Draft tersimpan dimuat\. Ruang kerja siap\./);
  assert.doesNotMatch(sameProjectReload, /setAutoPriceNotice\(/,
    'retryToken-only reload must never clear the outcome alert');
  const sheetStart = source.indexOf('<section className="simprok-rab-sheet"');
  const alertAt = source.indexOf('aria-label="Hasil penyimpanan RAB Otomatis perlu perhatian"', sheetStart);
  assert.ok(sheetStart >= 0 && alertAt > sheetStart);
  assert.match(source.slice(sheetStart, alertAt), /isRabAutoPriceNoticeCurrent\(autoPriceNotice/);
  assert.match(source.slice(alertAt - 75, alertAt + 180), /role="alert"/);
  assert.ok(source.indexOf('focusMode ? null : (', 0) < sheetStart,
    'shared RAB sheet must remain present even when normal header is hidden');
});

test('in-flight auto-price checks date-only epoch before further pages, warning and reload', () => {
  assert.match(priceJourney, /isRabAutoPriceRunScopeCurrent\(runScope/);
  assert.match(priceJourney, /calculationDate: currentAutoPriceDateRef\.current/);
  assert.match(priceJourney, /calculationDateRevision: autoPriceDateRevisionRef\.current/);
  assert.match(priceJourney, /for \(let page = 1; page <= 20; page\+\+\) \{\s*if \(stopOnChangedContext\(\)\) return/);
  assert.match(priceJourney, /const payload: unknown = await response\.json\(\);\s*if \(stopOnChangedContext\(\)\) return/);
  assert.match(priceJourney, /if \(!pageResult\.hasNext\) \{\s*if \(stopOnChangedContext\(\)\) return/);
  assert.match(priceJourney, /\} catch \{[\s\S]*?if \(stopOnChangedContext\(\)\) return/);
  assert.match(source, /const handleCalculationAsOfDateChange = \(value: string\) => \{\s*if \(value !== currentAutoPriceDateRef\.current\) \{[\s\S]*?autoPriceDateRevisionRef\.current \+= 1/);
  // Selecting a row changes persistContextRevisionRef but not the auto-price date epoch.
  const rowSelection = source.slice(source.indexOf('const activateRow = ('), source.indexOf('const handleRowClick = ('));
  assert.doesNotMatch(rowSelection, /autoPriceDateRevisionRef\.current/);
});

test('RAB failed-write notice clears on fresh calculation, user BOQ edit and date change', () => {
  assert.match(priceJourney, /setIsAutoPricing\(true\);\s*setAutoPriceNotice\(null\)/);
  assert.match(source, /const markDraftMutated = \(\) => \{\s*setAutoPriceNotice\(null\)/);
  assert.match(source, /const handleCalculationAsOfDateChange = \(value: string\) => \{[\s\S]*?setAutoPriceNotice\(null\)/);
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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { filterUnitIssues, previewUnitIssues, type UnitResolutionIssue } from '../utils/ahspImportIntakeDisplay.ts';

const page = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const manual = readFileSync('src/pages/AhspManualPage.tsx', 'utf8');
const panel = readFileSync('src/components/AhspUnitResolutionPanel.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

test('three doors open one unit resolution surface', () => {
  assert.equal(page.includes('AhspUnitResolutionPanel'), true);
  assert.equal(page.includes('Selesaikan satuan'), true);
  assert.equal(page.includes('Selesaikan satuan AHSP ini'), true);
  assert.equal(page.includes('Lanjutkan ke Tinjauan'), true);
  assert.equal(page.includes("source: 'preview'"), true);
  assert.equal(page.includes("source: 'job'"), true);
  assert.equal(page.includes('openIdentityReview'), true);
  assert.equal(page.includes('row.actionLabel'), true);
  assert.equal(page.includes('scrollIntoView'), true);
  assert.equal(panel.includes('filterUnitIssues'), true);
  assert.equal(panel.includes('searchUnitDefinitions'), true);
});

test('manual unit search follows the resource family and the formula stays three columns', () => {
  assert.equal(manual.includes('resourceType: props.resourceType'), true);
  assert.equal(manual.includes('LEGACY_INVALID_FOR_RESOURCE_TYPE'), true);
  assert.match(css, /\.ahsp-manual-comp-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u);
});

test('summary, review, and one AHSP filter the same issue id', () => {
  const issues: UnitResolutionIssue[] = [
    { id: 'preview:0:Bh', lineKey: '0', title: 'A — pasangan', spelling: 'Bh', uses: 2 },
    { id: 'preview:1:ton', lineKey: '1', title: 'B — galian', spelling: 'ton', uses: 1 },
  ];
  const fromSummary = filterUnitIssues(issues, { spelling: 'Bh', lineKey: null });
  const fromReview = filterUnitIssues(issues, { spelling: null, lineKey: null });
  const fromAhsp = filterUnitIssues(issues, { spelling: null, lineKey: '0' });
  assert.deepEqual(fromSummary.map((issue) => issue.id), ['preview:0:Bh']);
  assert.deepEqual(fromReview.map((issue) => issue.id), ['preview:0:Bh', 'preview:1:ton']);
  assert.deepEqual(fromAhsp.map((issue) => issue.id), ['preview:0:Bh']);
  const after = issues.filter((issue) => issue.id !== 'preview:0:Bh');
  assert.deepEqual(filterUnitIssues(after, { spelling: 'Bh', lineKey: null }), []);
  assert.deepEqual(filterUnitIssues(after, { spelling: null, lineKey: null }).map((issue) => issue.id), ['preview:1:ton']);
  assert.deepEqual(filterUnitIssues(after, { spelling: null, lineKey: '0' }), []);
});

test('a preview unit question uses the same spelling the summary groups', () => {
  const issues = previewUnitIssues([
    {
      admission: 'HELD',
      reasonCodes: ['UNIT_UNRESOLVED'],
      workType: { raw: 'B.1' },
      methodName: { raw: 'Pasangan' },
      resources: [{ rawName: 'Baut', group: 'MATERIAL', rawUnit: 'Bh', reasonCodes: ['UNIT_UNRESOLVED'] }],
    },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].spelling, 'Bh');
  assert.equal(issues[0].id, 'preview:0:resource:0');
  assert.equal(issues[0].occurrenceKey, 'resource:0');
  assert.equal(issues[0].resourceGroup, 'MATERIAL');
});

test('the shared panel can confirm one stored occurrence and leave another unresolved', () => {
  assert.equal(panel.includes('Konfirmasi satuan'), true);
  assert.equal(panel.includes('Biarkan belum terselesaikan'), true);
  assert.equal(panel.includes('aria-pressed'), true);
  assert.equal(panel.includes('resourceType: props.issue.resourceGroup'), true);
  assert.equal(panel.includes('onConfirm'), true);
  assert.equal(page.includes('onConfirm='), true);
  assert.equal(page.includes("source: 'preview'"), true);
  assert.equal(page.includes("source: 'job'"), true);
  assert.equal(page.includes('/unit-decisions/'), true);
  assert.equal(page.split('AhspUnitResolutionPanel').length > 2, true);
  const navEnd = page.indexOf('</nav>');
  const heading = page.indexOf('<h1', navEnd);
  assert.equal(page.slice(navEnd, heading).includes('AhspUnitResolutionPanel'), false);
  assert.equal(page.slice(navEnd, heading).includes('renderUnitWorkspace'), false);
  const ringkasan = page.indexOf('Ringkasan hasil analisis');
  assert.ok(page.indexOf("renderUnitWorkspace('preview', null)", ringkasan) > ringkasan);
  const journalRecheck = page.slice(page.indexOf('const recheckJournal'), page.indexOf('const confirmPreviewUnit'));
  assert.equal(journalRecheck.includes('/recheck'), true);
  assert.equal(journalRecheck.includes('/continue'), false);
  const previewConfirm = page.slice(page.indexOf('const confirmPreviewUnit'), page.indexOf('const confirmUnitDecision'));
  assert.equal(previewConfirm.includes('/ahsp/document/intake'), true);
  assert.equal(previewConfirm.includes('recheckJournal('), true);
  assert.equal(previewConfirm.includes('/ahsp/document/commit'), false);
  assert.equal(previewConfirm.includes('recheckImport('), false);
  const savedConfirm = page.slice(page.indexOf('const confirmUnitDecision'), page.indexOf('const governQuestion'));
  assert.equal(savedConfirm.includes('recheckJournal('), true);
  assert.equal(savedConfirm.includes('recheckImport('), false);
  assert.equal(savedConfirm.includes('/ahsp/document/commit'), false);
  assert.equal(page.includes("unitDoor.source === 'preview'"), true);
});

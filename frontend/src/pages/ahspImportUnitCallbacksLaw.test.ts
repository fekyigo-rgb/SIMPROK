import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const page = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const begin = page.indexOf('  const recheckUnitJobOnClick = () => {');
const end = page.indexOf('  const renderUnitWorkspace = ', begin);
assert.ok(begin > 0 && end > begin, 'both event handlers must precede the existing render helper');
const handlersSource = page.slice(begin, end);
const scripted = ts.transpileModule(
  handlersSource + '\n({ recheckUnitJobOnClick, confirmUnitJobOnClick });',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
type Job = { key: string; title: string };
type Door = { source: 'preview' | 'job'; jobKey: string | null } | null;
type Issue = { lineKey: string; occurrenceKey: string };
type Calls = { recheck: Array<[Job, number]>; confirm: Array<[Job, Issue, string]> };
const jobs: Job[] = [
  { key: 'job-a', title: 'A' },
  { key: 'job-b', title: 'B' },
];
const issue: Issue = { lineKey: '3', occurrenceKey: 'resource:5' };

function instantiate(initialDoor: Door) {
  const calls: Calls = { recheck: [], confirm: [] };
  const sandbox = {
    unitDoor: initialDoor,
    waitingImports: jobs,
    recheckImport: (job: Job, index: number) => { calls.recheck.push([job, index]); },
    confirmUnitDecision: (job: Job, item: Issue, unitId: string) => {
      calls.confirm.push([job, item, unitId]);
    },
  };
  const handlers = vm.runInNewContext(scripted, sandbox) as {
    recheckUnitJobOnClick: () => void;
    confirmUnitJobOnClick: (issue: Issue, unitId: string) => void;
  };
  return { sandbox, calls, handlers };
}

test('callbacks are inert during render; recheck uses selected persisted job and real list index only after click', () => {
  const h = instantiate({ source: 'job', jobKey: 'job-b' });
  assert.equal(h.calls.recheck.length, 0);
  assert.equal(h.calls.confirm.length, 0);
  h.handlers.recheckUnitJobOnClick();
  assert.equal(h.calls.recheck.length, 1);
  assert.equal(h.calls.recheck[0][0], jobs[1]);
  assert.equal(h.calls.recheck[0][1], 1);
  assert.equal(h.calls.confirm.length, 0);
});

test('confirmation forwards the exact issue, selected job identity, and unit id on user action', () => {
  const h = instantiate({ source: 'job', jobKey: 'job-a' });
  h.handlers.confirmUnitJobOnClick(issue, 'unit-9');
  assert.equal(h.calls.confirm.length, 1);
  assert.equal(h.calls.confirm[0][0], jobs[0]);
  assert.equal(h.calls.confirm[0][1], issue);
  assert.equal(h.calls.confirm[0][2], 'unit-9');
  assert.equal(h.calls.recheck.length, 0);
});

test('missing, preview, and obsolete saved import contexts perform no writer action', () => {
  for (const door of [null, { source: 'preview', jobKey: null }, { source: 'job', jobKey: 'gone' }, { source: 'job', jobKey: null }] as Door[]) {
    const h = instantiate(door);
    h.handlers.recheckUnitJobOnClick();
    h.handlers.confirmUnitJobOnClick(issue, 'unit-9');
    assert.equal(h.calls.recheck.length, 0);
    assert.equal(h.calls.confirm.length, 0);
  }
});

test('same event callbacks wire only to saved-job door; preview uses its existing writer', () => {
  const workspace = page.slice(page.indexOf('  const renderUnitWorkspace ='), page.indexOf('  const renderImportJob ='));
  assert.ok(workspace.includes("unitDoor.source === 'job' && unitDoor.jobKey ? recheckUnitJobOnClick : null"));
  assert.ok(workspace.includes('? confirmUnitJobOnClick'));
  assert.ok(workspace.includes("unitDoor.source === 'preview'"));
  assert.ok(workspace.includes('void confirmPreviewUnit(issue, unitDefinitionId);'));
  assert.ok(!workspace.includes('recheckImport(job, at)'));
  assert.ok(!workspace.includes('confirmUnitDecision(job, issue, unitDefinitionId)'));
  assert.ok(workspace.includes('if (!unitDoor || unitDoor.source !== source) return null;'));
  assert.ok(workspace.includes("if (source === 'job' && unitDoor.jobKey !== jobKey) return null;"));
});

test('canonical writer and authorization contracts remain unchanged; no write runs in this test', () => {
  const recheck = page.slice(page.indexOf('  const recheckImport ='), page.indexOf('  const shownQuestions ='));
  const confirm = page.slice(page.indexOf('  const confirmUnitDecision ='), page.indexOf('  const governQuestion ='));
  assert.ok(recheck.includes("if (!canManage || jobLock.current !== null || importPhase === 'UNAUTHORIZED') return;"));
  assert.ok(recheck.includes("const ticket = reads.captureAction('imports');"));
  assert.ok(recheck.includes("jobLock.current = ticket;"));
  assert.ok(recheck.includes("apiFetch('/ahsp/document/jobs/' + job.key + '/continue', {"));
  assert.ok(recheck.includes("method: 'POST'"));
  assert.ok(recheck.includes('body: JSON.stringify({ decisions, assistedClassification })'));
  assert.ok(recheck.includes("reads.mayApply(ticket)"));
  assert.ok(confirm.includes('if (!issue.occurrenceKey) return;'));
  assert.ok(confirm.includes("'/ahsp/document/jobs/' + job.key + '/lines/' + issue.lineKey + '/unit-decisions/' + encodeURIComponent(issue.occurrenceKey)"));
  assert.ok(confirm.includes("method: 'PUT'"));
  assert.ok(confirm.includes('body: JSON.stringify({ unitDefinitionId })'));
  assert.ok(confirm.includes('await recheckJournal(job.key);'));
  assert.ok(confirm.includes('await loadImportJobs();'));
});

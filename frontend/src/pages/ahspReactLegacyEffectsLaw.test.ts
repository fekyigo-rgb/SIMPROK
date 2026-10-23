import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/AhspClassificationRevisionPanel.tsx', 'utf8');
const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');

function between(source: string, first: string, last: string): string {
  const start = source.indexOf(first);
  assert.ok(start >= 0, 'missing first anchor: ' + first);
  const end = source.indexOf(last, start + first.length);
  assert.ok(end > start, 'missing last anchor: ' + last);
  return source.slice(start, end);
}

test('classification read is deferred and canceled on AHSP identity switch or unmount', () => {
  const effect = between(panel, '// Keep the identity guard synchronous;', 'const deactivate = async');
  assert.ok(effect.includes('currentAhsp.current = ahspId;'));
  assert.ok(effect.includes('mounted.current = true;'));
  assert.ok(effect.includes('void Promise.resolve().then(() => {'));
  assert.ok(effect.includes('if (active) return load();'));
  assert.ok(effect.includes('active = false;'));
  assert.ok(effect.includes('mounted.current = false;'));
  assert.ok(effect.includes('readGeneration.current += 1;'));
  assert.ok(effect.includes('}, [ahspId, load]);'));
  assert.ok(panel.includes('generation !== readGeneration.current'));
});

test('absent detail identity reports the exact existing error after effect with cancel guard', () => {
  const effect = between(detail, "useEffect(() => {\n    let active = true;\n    if (!ahspId)", 'const load = async () => {');
  assert.ok(effect.includes("phase: 'FAILED'"));
  assert.ok(effect.includes('AHSP ini tidak dapat dibuka karena identitasnya tidak ada di alamat.'));
  assert.ok(effect.includes('void Promise.resolve().then(() => {'));
  assert.ok(effect.includes("if (active) setState({"));
  assert.ok(effect.includes('return () => { active = false; };'));
});

test('proposal subject stale result resets without reusing another AHSP identity', () => {
  const effect = between(detail, "if (state.phase !== 'READY' || !ahspId || !state.ahsp.proposedAt)", 'const loadSubject = async () => {');
  assert.ok(effect.includes('void Promise.resolve().then(() => {'));
  assert.ok(effect.includes('if (active) setProposalSubject(null);'));
  assert.ok(effect.includes('return () => { active = false; };'));
  assert.ok(detail.includes("'/ahsp/' + ahspId + '/proposal-subject'"));
});

test('resource-review effect resets all three existing flags after cleanup-aware scheduling', () => {
  const effect = between(detail, "if (state.phase !== 'READY' || !canCurate || !ahspId)", 'const openResourceReview = async () => {');
  assert.ok(effect.includes('void Promise.resolve().then(() => {'));
  assert.ok(effect.includes('if (!active) return;'));
  assert.ok(effect.includes('setReviewRows([]);'));
  assert.ok(effect.includes("setReviewPhase('IDLE');"));
  assert.ok(effect.includes('setReviewOpen(false);'));
  assert.ok(effect.includes('if (active) return loadResourceReview();'));
  assert.ok(effect.includes('return () => { active = false; };'));
  assert.ok(effect.includes('[state.phase, canCurate, ahspId, loadResourceReview]'));
  assert.ok(detail.includes("'/resource-observations?ahspId=' + encodeURIComponent(ahspId)"));
});

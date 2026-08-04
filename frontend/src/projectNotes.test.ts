import assert from 'node:assert/strict';
import test from 'node:test';
import { getProjectNoteSummary, getProjectNotes } from './projectNotes.ts';

test('getProjectNotes never fabricates a note: any projectId returns an empty list, never seeded/local fixture data', () => {
  assert.deepEqual(getProjectNotes('any-project-id'), []);
  assert.deepEqual(getProjectNotes(''), []);
});

test('getProjectNoteSummary reports an honest zero count with no unread/red-dot signal when no authoritative data exists', () => {
  const summary = getProjectNoteSummary('any-project-id');
  assert.equal(summary.jumlah, 0);
  assert.equal(summary.titikMerah, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * STAGE 2A Door B — AHSP Detail exposes Tinjau Resource as an ENTRY to the
 * EXISTING observation lifecycle scoped by ahspId. Never a second writer,
 * readiness engine, or client-side workspace filter.
 */

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const codeOnly = (source: string) =>
  source
    .split(CARRIAGE_RETURN)
    .join('')
    .split(NEWLINE)
    .filter((line) => {
      const t = line.trim();
      return (
        !t.startsWith('//') &&
        !t.startsWith('*') &&
        !t.startsWith('/*') &&
        !t.startsWith('{/*')
      );
    })
    .join(NEWLINE);

const detail = codeOnly(readFileSync('src/pages/AhspDetailPage.tsx', 'utf8'));

test('Door B reuses EXISTING observation endpoints scoped by ahspId', () => {
  assert.ok(detail.includes("'/resource-observations?ahspId='"));
  assert.ok(detail.includes("'/curate-existing'"));
  assert.ok(detail.includes("'/curate-new'"));
  assert.ok(!detail.includes('resourceCatalog.create'));
  assert.ok(!detail.includes('ResourceAdmissionService'));
});

test('Door B is gated on the governed identity-decision permission', () => {
  assert.ok(detail.includes("hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE')"));
  assert.ok(detail.includes('canCurate'));
});

test('Tinjau Resource appears only when unresolved scoped work exists', () => {
  assert.ok(detail.includes('Tinjau Resource'));
  assert.ok(detail.includes('showTinjauResource'));
  assert.ok(detail.includes('reviewRows.length > 0'));
});

test('Door B does not invent a second review store or readiness engine', () => {
  assert.ok(!detail.includes('resource_review'));
  assert.ok(!detail.includes('readinessEngine'));
  assert.ok(!detail.includes('NEEDS_REVIEW'));
  assert.ok(detail.includes('groupIdenticalObservations'));
});

test('Door B asks the server for ahspId scope — version truth stays on the backend', () => {
  assert.ok(detail.includes("'/resource-observations?ahspId='"));
  // Detail may display versionNumber for history; it must not select applicability.
  assert.ok(!detail.includes('pickCurrentApplicableAhspVersions'));
  assert.ok(!detail.includes('buildEligibleAhspVersionWhere'));
});

test('opening Door B is a read of the scoped list, not a write', () => {
  const open = detail.slice(
    detail.indexOf('const openResourceReview = async'),
    detail.indexOf('const curateOnDetail = async'),
  );
  assert.ok(open.includes('loadResourceReview'));
  assert.ok(!open.includes('/curate-existing'));
  assert.ok(!open.includes('/curate-new'));
});

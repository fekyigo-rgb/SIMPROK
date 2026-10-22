import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../pages/RabWorkspacePage.tsx', import.meta.url), 'utf8');
const preparation = readFileSync(new URL('../pages/ProjectSetupPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../../../backend/src/project/project.controller.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../backend/src/project/boq-import.service.ts', import.meta.url), 'utf8');

test('BOQ-ONE-DOOR: one import action in the RAB workspace; preview and approval share it', () => {
  assert.equal((workspace.match(/aria-label="Import BOQ"/g) ?? []).length, 1);
  assert.equal((workspace.match(/type="file" accept="\.xlsx"/g) ?? []).length, 1);
  assert.match(workspace, /boq\/import\/preview/);
  assert.match(workspace, /boq\/import\/approve/);
  assert.equal((controller.match(/@Post\(':projectId\/boq\/import\/preview'\)/g) ?? []).length, 1);
  assert.equal((controller.match(/@Post\(':projectId\/boq\/import\/approve'\)/g) ?? []).length, 1);
});

test('BOQ-ONE-TRUTH: import replaces only the canonical Working Draft, with append-only evidence', () => {
  assert.match(service, /WORKING_DRAFT_STRUCTURE_NAME/);
  assert.match(service, /MULTIPLE_WORKING_DRAFTS/);
  assert.match(service, /boqItem\.deleteMany\(\{ where: \{ boqStructureId: draft\.id \} \}\)/);
  assert.match(service, /boqItem\.create\(/);
  assert.match(service, /boqBusinessUseEvent\.create\(/);
  assert.doesNotMatch(service, /boqStructure\.create\(/);
});

test('RI-01: no unused legacy RAB page or hardcoded localhost:3000 setup door', () => {
  assert.doesNotMatch(preparation, /LegacyRabWorkspacePage|localhost:3000/);
  assert.doesNotMatch(app, /LegacyRabWorkspacePage/);
  assert.match(app, /<ProjectSetupPage/);
  assert.match(app, /<RabWorkspacePage/);
});

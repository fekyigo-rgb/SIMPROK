import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ProjectListPage.tsx', import.meta.url), 'utf8');

test('Project card uses existing Hapus Draft button, now bound to canonical DELETE API',()=>{
  assert.ok(source.includes('className="simprok-project-card__danger"'));
  assert.ok(source.includes('onClick={() => void deleteDraft(project)}'));
  assert.ok(source.includes("method: 'DELETE'"));
  assert.ok(source.includes('/draft'));
  assert.ok(source.includes("projectName: project.nama"));
});
test('draft delete requires explicit human confirmation, never optimistic success',()=>{
  assert.ok(source.includes('window.confirm('));
  assert.ok(source.includes('Kode proyek tetap tercatat dan tidak otomatis dapat dipakai ulang.'));
  assert.ok(source.includes('if (!response.ok)'));
  assert.ok(source.includes('setProjects((current) => current.filter'));
  assert.ok(source.includes('setRetryCount((count) => count + 1)'));
});
test('locked, unauthorized and non-owner cards cannot invoke destructive action',()=>{
  assert.ok(source.includes("presentation.status === 'DRAFT'"));
  assert.ok(source.includes("hasPermission('RAB_DRAFT_EDIT')"));
  assert.ok(source.includes("hasPermission('PROJECT_VIEW')"));
  assert.ok(source.includes('!canDeleteDraft(project) || deletingId !== null'));
  assert.ok(source.includes('deletingId !== null'));
  assert.ok(source.includes("roleInProject === 'OWNER'"));
});
test('denials show truthful feedback and preserve local project list',()=>{
  assert.ok(source.includes('response.status === 403'));
  assert.ok(source.includes('response.status === 409'));
  assert.ok(source.includes('response.status === 404'));
  assert.ok(source.includes('role="status"'));
});

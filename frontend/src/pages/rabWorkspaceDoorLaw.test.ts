import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const app = readFileSync('src/App.tsx', 'utf8');
const observatory = readFileSync('src/pages/ObservatoryPage.tsx', 'utf8');
const workspace = readFileSync('src/pages/RabWorkspacePage.tsx', 'utf8');
const protectedRoute = readFileSync('src/components/layout/ProtectedRoute.tsx', 'utf8');

const codeOnly = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const tsxFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [full] : [];
  });

test('canonical RAB workspace route is behind RAB_DRAFT_EDIT', () => {
  const code = codeOnly(app);
  assert.ok(code.includes('project/:projectId/rab/workspace'));
  assert.match(
    code,
    /permission=.RAB_DRAFT_EDIT.><RabWorkspacePage \/><\/PermissionRoute>/,
  );
});

test('RAB workspace takes project identity only from the path parameter', () => {
  const code = codeOnly(workspace);
  assert.match(code, /const \{ projectId: routeProjectId \} = useParams\(\)/);
  assert.match(code, /const projectId = routeProjectId \?\? null/);
  assert.doesNotMatch(code, /searchParams\.get\('projectId'\)/);
  assert.doesNotMatch(code, /useSearchParams/);
});

test('PermissionRoute fails closed when permission is absent or unresolved', () => {
  const code = codeOnly(protectedRoute);
  assert.match(code, /const codes: readonly string\[\]/);
  assert.match(code, /codes\.some\(\(code\) => hasPermission\(code\)\)/);
  assert.match(code, /permissionState === 'IDLE' \|\| permissionState === 'LOADING'/);
  assert.match(code, /AccessDeniedPanel/);
});

test('ObservatoryPage cannot render the RAB workspace', () => {
  const code = codeOnly(observatory);
  assert.doesNotMatch(code, /RabWorkspacePage/);
  assert.doesNotMatch(code, /placeholderRoom === 'ruang-kerja-rab'/);
});

test('App.tsx is the only RabWorkspacePage renderer', () => {
  const renderers = tsxFiles('src').filter((file) => {
    if (file.endsWith(join('pages', 'RabWorkspacePage.tsx'))) return false;
    return /<RabWorkspacePage\b/.test(codeOnly(readFileSync(file, 'utf8')));
  });
  assert.deepEqual(renderers, [join('src', 'App.tsx')]);
});

test('every RAB workspace mount uses the permission gate', () => {
  const code = codeOnly(app);
  const mounts = code.match(/<RabWorkspacePage\b/g) ?? [];
  const gated =
    code.match(/permission=.RAB_DRAFT_EDIT.>\s*<RabWorkspacePage \/>\s*<\/PermissionRoute>/g) ?? [];
  assert.equal(mounts.length, 1);
  assert.equal(gated.length, mounts.length);
  assert.doesNotMatch(code, /<RoleRoute[^>]*>\s*<RabWorkspacePage/);
});

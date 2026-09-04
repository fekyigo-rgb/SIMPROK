import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  REGION_SEARCH_PLACEHOLDER,
  regionSearchAfterClear,
  regionSearchShouldReloadOnFocus,
} from './regionSearchRecovery.ts';

test('clear restores an immediately searchable field', () => {
  assert.deepEqual(regionSearchAfterClear(), {
    query: '',
    open: true,
    reload: true,
  });
});

test('focus after select/clear idle dead-end reloads; a chosen region does not', () => {
  assert.equal(
    regionSearchShouldReloadOnFocus({ hasSelection: true, panelState: 'idle' }),
    false,
  );
  assert.equal(
    regionSearchShouldReloadOnFocus({ hasSelection: false, panelState: 'idle' }),
    true,
  );
  assert.equal(
    regionSearchShouldReloadOnFocus({ hasSelection: false, panelState: 'error' }),
    true,
  );
  assert.equal(
    regionSearchShouldReloadOnFocus({ hasSelection: false, panelState: 'ready' }),
    false,
  );
  assert.equal(
    regionSearchShouldReloadOnFocus({ hasSelection: false, panelState: 'loading' }),
    false,
  );
});

test('placeholder tells the person to type a place name', () => {
  assert.equal(REGION_SEARCH_PLACEHOLDER, 'Ketik nama wilayah...');
});

const importSelect = readFileSync(
  'src/components/basic-price/RegionSearchSelect.tsx',
  'utf8',
);
const explorerSelect = readFileSync(
  'src/components/basic-price/ExplorerRegionFilterSelect.tsx',
  'utf8',
);

test('both existing selectors consume the one recovery law', () => {
  for (const source of [importSelect, explorerSelect]) {
    assert.match(source, /regionSearchAfterClear/);
    assert.match(source, /regionSearchShouldReloadOnFocus/);
  }
  assert.match(importSelect, /REGION_SEARCH_PLACEHOLDER/);
});

test('import selector does not close the list on clear without reloading', () => {
  assert.match(importSelect, /const recovery = regionSearchAfterClear\(\)/);
  assert.match(importSelect, /void runSearch\(recovery\.query\)/);
  assert.doesNotMatch(
    importSelect,
    /onSelect\(null\);\s*setQuery\(''\);\s*setOpen\(false\)/,
  );
});

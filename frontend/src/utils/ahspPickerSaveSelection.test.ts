import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { emptyAssistedContext } from './ahspAssistedContext.ts';
import vm from 'node:vm';
import ts from 'typescript';

type MockNode = { type: unknown; props: Record<string, unknown> };
type AssistedValue = { jenisPengadaanRootId: string | null; paths: unknown[]; pendingPaths: unknown[] };
type ReactMockState = unknown;

test('real picker emits Bina Marga / Drainase Jalan / Beton as a saveable pending path', async () => {
  const states: ReactMockState[] = [];
  let cursor = 0;
  const effects: Array<() => unknown> = [];
  const root = { id: 'root', name: 'Pekerjaan Konstruksi', level: 'JENIS_PENGADAAN', parentId: null, workspaceId: null };
  const kat = { id: 'kat', name: 'Bina Marga', level: 'KATEGORI', parentId: 'root', workspaceId: 'ws' };
  const sub = { id: 'sub', name: 'Drainase Jalan', level: 'SUBKATEGORI', parentId: 'kat', workspaceId: 'ws' };
  const react = {
    useState: (initial: unknown) => {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [states[i], (next: unknown) => {
        states[i] = typeof next === 'function' ? (next as (prior: unknown) => unknown)(states[i]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const i = cursor++;
      if (!(i in states)) states[i] = { current: initial };
      return states[i];
    },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => unknown) => { effects.push(fn); },
  };
  const jsx = (type: unknown, props: Record<string, unknown>): MockNode => ({ type, props });
  const cache = new Map<string, Record<string, unknown>>();
  const native = createRequire(import.meta.url);
  function load(file: string): Record<string, unknown> {
    const cached = cache.get(file);
    if (cached) return cached;
    const module: { exports: Record<string, unknown> } = { exports: {} };
    cache.set(file, module.exports);
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports,
      require: (id: string) => {
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (id.endsWith('/apiClient')) return {
          apiFetch: async (url: string) => {
            const data = url.endsWith('/roots') ? [root] : url.endsWith('parentId=root') ? [kat]
              : url.endsWith('parentId=kat') ? [sub] : [];
            return { ok: true, json: async () => data };
          },
        };
        if (id.startsWith('.')) {
          const target = resolve(dirname(file), id);
          if (target.endsWith('.json')) return JSON.parse(readFileSync(target, 'utf8'));
          const candidate = [target, target + '.ts', target + '.tsx'].find(existsSync);
          if (candidate) return load(candidate);
        }
        return native(id);
      },
    });
    return module.exports;
  }
  const component = load(resolve('src/components/AhspImportAssistedClassificationPanel.tsx'));
  const empty = emptyAssistedContext as () => AssistedValue;
  const picker = component.AhspImportAssistedClassificationPanel as
    (props: Record<string, unknown>) => MockNode;
  let value = empty();
  const render = () => {
    cursor = 0;
    return picker({
      enabled: true, embedded: true, showMetadata: false, value,
      onChange: (next: AssistedValue) => { value = next; },
    });
  };
  const all = (node: unknown): MockNode[] => {
    if (!node) return [];
    if (Array.isArray(node)) return node.flatMap(all);
    if (typeof node !== 'object') return [];
    const element = node as MockNode;
    return [element, ...all(element.props?.children)];
  };
  const settle = async () => { for (let n = 0; n < 6; n++) await new Promise(resolve => setImmediate(resolve)); };
  const choose = (node: MockNode | undefined) => {
    assert.ok(node, 'option/input required');
    const fn = node.props.onChange as ((value?: unknown) => void) | undefined;
    assert.ok(fn, 'onChange required');
    fn();
  };

  render();
  assert.ok(effects[0], 'initial hierarchy effect is registered');
  effects[0]();
  await settle();
  const rootSelect = all(render()).find(n => n.type === 'select');
  assert.ok(rootSelect);
  const onRootChange = rootSelect.props.onChange as ((value: unknown) => void) | undefined;
  assert.ok(onRootChange);
  onRootChange({ target: { value: 'root' } });
  await settle();
  for (const [label, name] of [['Kategori', 'Bina Marga'], ['Subkategori', 'Drainase Jalan'], ['Jenis Pekerjaan', 'Beton']]) {
    const menu = all(render()).find(n => n.props?.label === label);
    assert.ok(menu, label);
    const option = all(menu.props.children).find(n => n.type === 'label' && JSON.stringify(n).includes(name));
    assert.ok(option, name);
    choose(all(option).find(n => n.type === 'input'));
    await settle();
  }
  assert.equal(value.jenisPengadaanRootId, 'root');
  assert.equal(value.paths.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(value.pendingPaths)), [
    { kategori: 'Bina Marga', subkategori: 'Drainase Jalan', jenisPekerjaan: 'Beton' },
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { verifySavedVersion } from './ahspSaveReadback.ts';
import { emptyAssistedContext } from './ahspAssistedContext.ts';
import { validatedAssignments } from './ahspClassificationAssignments.ts';

type Element = { type: unknown; props: Record<string, unknown> };
type ReactMockState = unknown;
type ReactMockSetter = (value: unknown) => void;
function harness() {
  const states: ReactMockState[] = [];
  let cursor = 0;
  const effects: Array<() => unknown> = [];
  const requests: string[] = [];
  const responses: unknown[] = [];
  let saved = 0, attempts = 0, cancelled = 0, finished = 0;
  const empty = emptyAssistedContext;
  const react = {
    useState: (initial: unknown): [unknown, ReactMockSetter] => {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [states[i], (next: unknown) => {
        states[i] = typeof next === 'function' ? (next as (previous: unknown) => unknown)(states[i]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const i = cursor++;
      if (!(i in states)) states[i] = { current: initial };
      return states[i];
    },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => unknown) => { effects.push(fn); },
  };
  const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
  const module: { exports: Record<string, unknown> } = { exports: {} };
  const source = readFileSync('src/components/AhspClassificationRevisionPanel.tsx', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(compiled, {
    exports: module.exports, module,
    require: (id: string) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id.includes('ahspClassificationAssignments')) return { validatedAssignments };
      if (id.includes('ahspAssistedContext')) return { emptyAssistedContext };
      if (id.includes('AhspImportAssisted')) return {
        emptyAssistedContext: empty,
        AhspImportAssistedClassificationPanel: 'Picker',
      };
      if (id.includes('apiClient')) return {
        apiFetch: async (url: string) => {
          requests.push(url);
          const response = responses.shift();
          if (response instanceof Promise) return response;
          if (!response) throw Error('no response');
          return response;
        },
      };
      return nativeRequire(id);
    },
  });
  const props = {
    ahspId: 'ahsp-1', enabled: true,
    onSaved: () => { saved++; },
    onSaveAttempt: () => { attempts++; return true; },
    onSaveFinished: () => { finished++; },
    onCancelled: () => { cancelled++; },
  };
  const component = module.exports.AhspClassificationRevisionPanel as (input: typeof props) => Element;
  const render = () => { cursor = 0; return component(props); };
  const all = (node: unknown): Element[] => {
    if (!node) return [];
    if (Array.isArray(node)) return node.flatMap(all);
    if (typeof node !== 'object') return [];
    const element = node as Element;
    return [element, ...all(element.props?.children)];
  };
  const click = (label: string) => {
    const element = all(render()).find(x => x.type === 'button' && x.props.children === label);
    assert.ok(element, 'button ' + label);
    assert.equal(Boolean(element.props.disabled), false, 'button must be enabled: ' + label);
    const onClick = element.props.onClick as (() => void) | undefined;
    assert.ok(onClick, 'click handler for ' + label);
    onClick();
  };
  const queue = (payload: unknown, ok = true) => responses.push({ ok, json: async () => payload });
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  const activateLatestEffect = () => {
    const effect = effects[effects.length - 1];
    assert.ok(effect, 'current AHSP effect must be registered');
    return effect();
  };
  const init = async (rows: unknown) => {
    queue(rows);
    render();
    assert.ok(effects[0]);
    const cleanup = effects[0]();
    await settle();
    return cleanup as () => void;
  };
  const draft = (value: unknown) => {
    click('Tambahkan pilihan klasifikasi');
    const picker = all(render()).find(x => x.type === 'Picker');
    assert.ok(picker);
    const onChange = picker.props.onChange as ((next: unknown) => void) | undefined;
    assert.ok(onChange);
    onChange(value);
  };
  return {
    props, init, render, activateLatestEffect, click, draft, queue, settle, responses, requests,
    validate: validatedAssignments,
    stats: () => ({ saved, attempts, cancelled, finished }),
    alerts: () => all(render()).filter(x => x.props?.role === 'alert').map(x => x.props.children),
  };
}

const levels=['JENIS_PENGADAAN','KATEGORI','SUBKATEGORI','JENIS_PEKERJAAN'];
const row=(root='root-1')=>({id:'assignment-1',ahspId:'ahsp-1',leafNodeId:'leaf-1',jenisPengadaanRootId:root,
  isActive:true,provenance:'HUMAN_ADDED',path:[root,'kat','sub','leaf-1'].map((id,i)=>({
    id,level:levels[i],name:['Pekerjaan Konstruksi','Cipta Karya','Bangunan Gedung','Beton'][i]}))});
const pending={jenisPengadaanRootId:'root-1',paths:[],
  pendingPaths:[{kategori:'Cipta Karya',subkategori:'Bangunan Gedung',jenisPekerjaan:'Beton'}]};
test('queued classification read is canceled before network access on immediate unmount', async () => {
  const h = harness();
  h.render();
  const cleanup = h.activateLatestEffect();
  assert.equal(typeof cleanup, 'function');
  (cleanup as () => void)();
  await h.settle();
  assert.equal(h.requests.length, 0, 'a cleaned-up effect never starts an obsolete classification GET');
  assert.equal(h.stats().saved, 0, 'a canceled initial read cannot claim a save');
});

test('read-back rejects malformed shape, identity, lineage and duplicate roots',()=>{
  const h=harness();
  for(const value of [{},null,[{}],[{...row(),ahspId:'other'}],[{...row(),path:[]}],
    [{...row(),jenisPengadaanRootId:'wrong'}],[row(),{...row('root-2'),id:'other'}]]) {
    assert.throws(()=>h.validate(value,'ahsp-1'));
  }
  assert.equal(h.validate([row()],'ahsp-1').length,1);
});
test('classification delete waits for explicit confirmation; cancel leaves server untouched',async()=>{
  const h=harness();await h.init([row()]);
  h.click('Hapus pilihan klasifikasi');
  assert.equal(h.requests.length,1,'clicking Hapus only opens confirmation');
  assert.equal(h.stats().attempts,0,'no save attempt before confirmation');
  h.click('Batal');
  assert.equal(h.requests.length,1,'cancel must not send a request');
  assert.equal(h.stats().finished,0,'cancel must not start a transaction');
  h.click('Hapus pilihan klasifikasi');
  h.queue({});h.queue([]);
  h.click('Ya, hapus pilihan');await h.settle();
  assert.equal(h.requests.length,3,'only confirmed action sends POST and GET readback');
  assert.equal(h.stats().saved,1);
  assert.equal(h.stats().finished,1);
});
test('deactivate POST success plus malformed GET never calls onSaved',async()=>{
  const h=harness();await h.init([row()]);
  h.queue({});h.queue({unexpected:[]});h.click('Hapus pilihan klasifikasi');h.click('Ya, hapus pilihan');await h.settle();
  assert.equal(h.stats().saved,0);assert.equal(h.stats().finished,1);assert.ok(h.alerts().length>0);
});
test('deactivate verifies absence; unchanged assignment fails; empty valid array succeeds',async()=>{
  for(const absent of [false,true]){
    const h=harness();await h.init([row()]);
    h.queue({});h.queue(absent?[]:[row()]);h.click('Hapus pilihan klasifikasi');h.click('Ya, hapus pilihan');await h.settle();
    assert.equal(h.stats().saved,absent?1:0);
  }
});
test('pending paths require matching root and human assignment, not merely same labels',async()=>{
  for(const scenario of ['wrong-root','source-only','match']){
    const h=harness();await h.init([]);h.draft(pending);
    h.queue({});h.queue([{...row(scenario==='wrong-root'?'root-2':'root-1'),
      provenance:scenario==='source-only'?'SOURCE_DERIVED':'HUMAN_ADDED'}]);
    h.click('Tambahkan pilihan terpilih');await h.settle();
    assert.equal(h.stats().saved,scenario==='match'?1:0);
  }
});
test('persisted path mismatch and malformed GET refuse green',async()=>{
  for(const response of [[],{},[{...row(),leafNodeId:'missing'}]]){
    const h=harness();await h.init([]);h.draft({...pending,paths:[{leafNodeId:'leaf-1'}],pendingPaths:[]});
    h.queue({});h.queue(response);h.click('Tambahkan pilihan terpilih');await h.settle();
    assert.equal(h.stats().saved,0);
  }
});
test('late response after AHSP switch cannot report saved',async()=>{
  const h=harness();await h.init([row()]);
  let resolve!: (v:unknown)=>void;
  h.queue({});h.responses.push(new Promise(r=>{resolve=r;}));
  h.click('Hapus pilihan klasifikasi');h.click('Ya, hapus pilihan');await h.settle();
  h.props.ahspId='ahsp-2';h.render();h.activateLatestEffect();
  resolve({ok:true,json:async()=>[]});await h.settle();
  assert.equal(h.stats().saved,0);
});
test('late response after unmount cannot report saved',async()=>{
  const h=harness();const cleanup=await h.init([row()]);
  let resolve!: (v:unknown)=>void;
  h.queue({});h.responses.push(new Promise(r=>{resolve=r;}));
  h.click('Hapus pilihan klasifikasi');h.click('Ya, hapus pilihan');await h.settle();cleanup();
  resolve({ok:true,json:async()=>[]});await h.settle();
  assert.equal(h.stats().saved,0);
});
test('cancel invokes feedback reset and never writes',async()=>{
  const h=harness();await h.init([]);h.draft(pending);h.click('Batal tambah');await h.settle();
  assert.equal(h.stats().cancelled,1);assert.equal(h.stats().saved,0);assert.equal(h.requests.length,1);
});
test('version receipt requires exact AHSP, version, metadata and recipe; decimal formatting may differ',()=>{
  const expected={outputUnit:'m3',regulationReference:'SE',issuerInstitution:'PUPR',effectiveDate:'2026-10-21',
    resources:[{resourceId:'res',resourceType:'MATERIAL',baseUnit:'kg',coefficient:1.25}]};
  const detail={id:'ahsp-1',versions:[{id:'v1',...expected,resources:[{...expected.resources[0],coefficient:'1.250000'}]}]};
  assert.equal(verifySavedVersion(detail,'ahsp-1','v1',expected),true);
  for(const changed of [{...detail,id:'other'},{...detail,versions:[]},
    {...detail,versions:[{...detail.versions[0],outputUnit:'m2'}]},
    {...detail,versions:[{...detail.versions[0],resources:[]}]},{}]) {
    assert.equal(verifySavedVersion(changed,'ahsp-1','v1',expected),false);
  }
  assert.equal(verifySavedVersion(detail,'ahsp-1','v2',expected),false);
});

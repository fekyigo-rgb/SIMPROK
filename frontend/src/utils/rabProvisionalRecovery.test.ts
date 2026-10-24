import test from 'node:test';
import assert from 'node:assert/strict';
import { readRabRecovery, writeRabRecovery, clearRabRecovery } from './rabProvisionalRecovery.ts';

const memory = new Map<string,string>();
Object.assign(globalThis, {
  sessionStorage: {
    getItem(k:string) { return memory.get(k) ?? null; },
    setItem(k:string,v:string) { memory.set(k,v); },
    removeItem(k:string) { memory.delete(k); },
  },
});
const workspaceId='22222222-2222-4222-8222-222222222222';
const rootId='33333333-3333-4333-8333-333333333333';
const regionId='44444444-4444-4444-8444-444444444444';
const snapshot = {
  preparedProject:{name:'Jembatan',code:'LOCAL-001',description:'',
    workspaceId,classificationNodeIds:[rootId],
    classificationVocabularyPaths:[{kategori:'Bina Marga'}],locationRegionIds:[regionId]},
  rows:[{id:'r1',name:'Galian',type:'item'}],
  volumes:{r1:5},unitPrices:{r1:0},marginPercent:10,ppnPercent:11,projectCode:'LOCAL-001',
};
test('local RAB recovery survives view unmount but is account/workspace isolated',()=>{
  assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot),true);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),snapshot);
  assert.equal(readRabRecovery('actor-b',workspaceId),null);
  assert.equal(readRabRecovery('actor-a','elsewhere'),null);
  clearRabRecovery('actor-a',workspaceId);
  assert.equal(readRabRecovery('actor-a',workspaceId),null);
});
test('malformed data cannot impersonate another workspace',()=>{
  assert.equal(writeRabRecovery('actor-a','elsewhere',snapshot),false);
  assert.equal(readRabRecovery('actor-a','elsewhere'),null);
});
test('a second provisional RAB cannot overwrite the first in the same account/workspace',()=>{
  clearRabRecovery('actor-a',workspaceId);
  assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot),true);
  const second = { ...snapshot, preparedProject: { ...snapshot.preparedProject, name:'Gedung B', code:'LOCAL-002' } };
  assert.equal(writeRabRecovery('actor-a',workspaceId,second),false);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),snapshot);
  const editedFirst = { ...snapshot, rows:[{ id:'r1', name:'Galian berubah', type:'item' }] };
  assert.equal(writeRabRecovery('actor-a',workspaceId,editedFirst),true);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),editedFirst);
  clearRabRecovery('actor-a',workspaceId);
});
test('write never reports success for an unreadable snapshot and never damages an earlier good one',()=>{
  clearRabRecovery('actor-a',workspaceId);
  assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot),true);
  const tooManyRows = { ...snapshot, rows:Array.from({length:5001},(_,i)=>({id:'row-'+i,name:'Pekerjaan '+i,type:'item'})) };
  assert.equal(writeRabRecovery('actor-a',workspaceId,tooManyRows),false);
  assert.equal(writeRabRecovery('actor-a',workspaceId,{ ...snapshot, marginPercent:Infinity }),false);
  assert.equal(writeRabRecovery('actor-a',workspaceId,{ ...snapshot, volumes:{r1:NaN} }),false);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),snapshot);
  clearRabRecovery('actor-a',workspaceId);
});
test('backflow revises only its own prepared context without discarding any RAB rows or prices',()=>{
  clearRabRecovery('actor-a',workspaceId);
  assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot),true);
  const editedContext = {...snapshot, preparedProject: {
    ...snapshot.preparedProject, name:'Jembatan Baru', description:'Alamat Detail: Jalan Uji',
    classificationVocabularyPaths:[{kategori:'Cipta Karya'}],
  }};
  assert.equal(writeRabRecovery('actor-a',workspaceId,editedContext),false);
  assert.equal(writeRabRecovery('actor-a',workspaceId,editedContext,snapshot.preparedProject),true);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),editedContext);
  assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot,snapshot.preparedProject),false);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),editedContext);
  clearRabRecovery('actor-a',workspaceId);
  assert.equal(writeRabRecovery('actor-a',workspaceId,editedContext,snapshot.preparedProject),false);
});
test('backflow declines replacing another recoverable draft, including after a stale first-read',()=>{
  clearRabRecovery('actor-a',workspaceId);
  assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot),true);
  const unrelated = {...snapshot, preparedProject:{...snapshot.preparedProject,name:'Other Project'}};
  assert.equal(writeRabRecovery('actor-a',workspaceId,unrelated,unrelated.preparedProject),false);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),snapshot);
  clearRabRecovery('actor-a',workspaceId);
});
test('unreadable stale backup does not poison subsequent legitimate recovery',()=>{
  clearRabRecovery('actor-a',workspaceId);
  const key = 'simprok-rab-provisional-v1:actor-a:'+workspaceId;
  memory.set(key,'{"malformed":');
  assert.equal(readRabRecovery('actor-a',workspaceId),null);
  assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot),true);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),snapshot);
  clearRabRecovery('actor-a',workspaceId);
});
test('backup failures are visible as false and do not silently replace prior data',()=>{
  clearRabRecovery('actor-a',workspaceId);
  const oversized = { ...snapshot, rows:[{ id:'r1', name:'A'.repeat(2_000_001), type:'item' }] };
  assert.equal(writeRabRecovery('actor-a',workspaceId,oversized),false);
  assert.equal(readRabRecovery('actor-a',workspaceId),null);
  const originalSetItem = sessionStorage.setItem;
  try {
    sessionStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot),false);
    assert.equal(readRabRecovery('actor-a',workspaceId),null);
  } finally {
    sessionStorage.setItem = originalSetItem;
  }
  assert.equal(writeRabRecovery('actor-a',workspaceId,snapshot),true);
  assert.deepEqual(readRabRecovery('actor-a',workspaceId),snapshot);
  clearRabRecovery('actor-a',workspaceId);
});

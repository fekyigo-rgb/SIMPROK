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

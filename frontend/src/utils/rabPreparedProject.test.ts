import test from 'node:test';
import assert from 'node:assert/strict';
import { readRabPreparedProject } from './rabPreparedProject.ts';

const root='00000000-0000-4000-8000-000000000001';
const location='00000000-0000-4000-8000-000000000002';
const preparedProject={
  name:'Jembatan', code:'RAB-LOCAL-01', description:'Persiapan lokal',
  workspaceId:'workspace-current',
  classificationNodeIds:[root],classificationVocabularyPaths:[{kategori:'Bina Marga'}],
  locationRegionIds:[location],
};

test('canonical prepared RAB is available only from valid browser navigation state',()=>{
  assert.deepEqual(readRabPreparedProject({ preparedProject }),preparedProject);
});
test('absence of navigation state is not a fabricated project',()=>{
  assert.equal(readRabPreparedProject(null),null);
  assert.equal(readRabPreparedProject({}),null);
  assert.equal(readRabPreparedProject({ preparedProject:{name:'x'}}),null);
});
test('invalid canonical identities cannot enter a provisional workspace',()=>{
  assert.equal(readRabPreparedProject({preparedProject:{...preparedProject,classificationNodeIds:['fake']}}),null);
  assert.equal(readRabPreparedProject({preparedProject:{...preparedProject,locationRegionIds:[]}}),null);
  assert.equal(readRabPreparedProject({preparedProject:{...preparedProject,classificationVocabularyPaths:[{}]}}),null);
});

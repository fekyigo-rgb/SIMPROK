import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldBlockRabLeave,shouldWarnOnBrowserExit,isFreshDraftSave} from './rabUnsavedExit.ts';

const currentPath='/project/1/rab/workspace';
test('saved draft does not block exit',()=>{
  assert.equal(shouldBlockRabLeave({draftDirty:false,saving:false,currentPath,nextPath:'/proyek'}),false);
  assert.equal(shouldWarnOnBrowserExit({draftDirty:false,saving:false}),false);
});
test('unsaved edit blocks dashboard, cross-project, and browser back',()=>{
  for(const nextPath of ['/','/proyek','/project/2/rab/workspace']){
    assert.equal(shouldBlockRabLeave({draftDirty:true,saving:false,currentPath,nextPath}),true);
  }
  assert.equal(shouldWarnOnBrowserExit({draftDirty:true,saving:false}),true);
});
test('in-flight saving blocks leaving even when dirty flag is temporarily false',()=>{
  assert.equal(shouldBlockRabLeave({draftDirty:false,saving:true,currentPath,nextPath:'/proyek'}),true);
  assert.equal(shouldWarnOnBrowserExit({draftDirty:false,saving:true}),true);
});
test('same-path changes are not blocked',()=>{
  assert.equal(shouldBlockRabLeave({draftDirty:true,saving:false,currentPath,nextPath:currentPath}),false);
});

test('late response from another project cannot clear the active workspace',()=>{
  assert.equal(isFreshDraftSave({submittedProjectId:'project-1',currentProjectId:'project-2',submittedRevision:4,currentRevision:4}),false);
});
test('late response for an older revision cannot erase newer local edits',()=>{
  assert.equal(isFreshDraftSave({submittedProjectId:'project-1',currentProjectId:'project-1',submittedRevision:4,currentRevision:5}),false);
});
test('only exact project and revision may acknowledge a save',()=>{
  assert.equal(isFreshDraftSave({submittedProjectId:'project-1',currentProjectId:'project-1',submittedRevision:5,currentRevision:5}),true);
});

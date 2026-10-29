import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { manualSaveDisposition, manualSaveOutcomeMessage } from './ahspManualSaveOutcome.ts';

test('AHSP Manual speaks the EXACT backend disposition, not always new AHSP', () => {
  const name = 'Pemeliharaan Jembatan';
  const expectations = [
    ['CREATED', 'berhasil dibuat'],
    ['REVISION_CREATED', 'Revisi AHSP'],
    ['CLASSIFICATION_EXTENDED', 'Jalur klasifikasi'],
  ] as const;
  for (const [wire, wording] of expectations) {
    const disposition = manualSaveDisposition(wire);
    const message = manualSaveOutcomeMessage({ name, disposition, resourceReviewPrepared: true });
    assert.ok(message.includes(wording), `${wire}: ${message}`);
    assert.ok(message.includes(name));
  }
  assert.doesNotMatch(manualSaveOutcomeMessage({ name, disposition: 'REVISION_CREATED' }), /AHSP baru berhasil dibuat/);
  assert.doesNotMatch(manualSaveOutcomeMessage({ name, disposition: 'CLASSIFICATION_EXTENDED' }), /AHSP baru berhasil dibuat/);
});

test('unknown disposition is not painted as an AHSP creation; resource review preparation is a separate fact', () => {
  assert.equal(manualSaveDisposition(undefined), 'UNCONFIRMED');
  assert.equal(manualSaveDisposition('NEW_AHSP'), 'UNCONFIRMED');
  assert.match(manualSaveOutcomeMessage({ name: 'Paket', disposition: 'UNCONFIRMED' }), /belum terkonfirmasi/);
  assert.match(manualSaveOutcomeMessage({
    name: 'Paket', disposition: 'CREATED', resourceReviewPrepared: false,
  }), /Pemeriksaan sumber daya belum siap/);
  assert.doesNotMatch(manualSaveOutcomeMessage({
    name: 'Paket', disposition: 'CREATED', resourceReviewPrepared: true,
  }), /belum siap/);
});

test('AHSP Manual reads server disposition and no longer hardcodes all outcomes as a new parent', () => {
  const ui = readFileSync(new URL('../pages/AhspManualPage.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../../../backend/src/ahsp/ahsp.controller.ts', import.meta.url), 'utf8');
  assert.ok(ui.includes('manualSaveDisposition(created.disposition)'));
  assert.ok(ui.includes('manualSaveOutcomeMessage(lastSaved)'));
  assert.ok(ui.includes('resourceReviewPrepared: typeof created.resourceReviewPrepared'));
  for (const outcome of ['CREATED', 'REVISION_CREATED', 'CLASSIFICATION_EXTENDED']) {
    assert.ok(api.includes(`'${outcome}'`), `backend outcome ${outcome}`);
  }
  assert.ok(ui.includes("to={'/ahsp/' + lastSaved.id}"));
});

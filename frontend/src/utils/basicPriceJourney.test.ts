import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEY_STAGE_KEYS,
  ROW_TONE_CLASS,
  journeyView,
  reviewCounters,
  rowTone,
} from './basicPriceJourney.ts';
import type {
  BasicPriceImportBatchSummary,
  BasicPriceImportRowSummary,
} from './basicPriceImportDisplay.ts';

/**
 * THE JOURNEY IS A PROJECTION, NOT A SECOND STATE MACHINE
 * (BP-UX-FINAL-01 §11, §12, §15).
 *
 * A workflow bar is the cheapest place in a product to invent a status. It
 * looks decorative, so nobody audits it, and it sits directly above the money.
 * These tests hold the line: every stage verdict must be traceable to a field
 * the batch payload actually carries, and the two stages the payload CANNOT
 * see must never claim to have happened.
 *
 * They also pin the shape of the journey itself — that keeping a price for your
 * own workspace and proposing it to SIMPROK are two separate outcomes, not one
 * line of six boxes everybody must walk.
 */

type ReviewGate = BasicPriceImportBatchSummary['actions']['reviewGate'];

const gate = (over: Partial<ReviewGate> = {}): ReviewGate => ({
  requiredFacts: ['EFFECTIVE_DATE', 'REGION', 'SOURCE_ORIGIN', 'SOURCE_TYPE'],
  missingRequiredFacts: [],
  metadataComplete: true,
  metadataCoherent: true,
  reviewAllowed: true,
  reasonCode: null,
  ...over,
});

const batchOf = (over: Partial<BasicPriceImportBatchSummary> = {}): BasicPriceImportBatchSummary =>
  ({
    batchId: 'b-1',
    status: 'NEEDS_REVIEW',
    importFingerprint: 'fp',
    effectiveDate: '2026-08-26',
    regionId: 'r-1',
    sourceType: 'MARKET_SURVEY',
    sourceOrganizationName: 'Tim Simprok',
    sourceOrigin: 'COMMUNITY_REPORT',
    version: 1,
    totalRows: 86,
    needsReviewRows: 73,
    readyForSubmissionRows: 13,
    rejectedRows: 0,
    submittedRows: 0,
    identityPairProvenRows: 13,
    alreadyPrivateRows: 0,
    rows: [],
    actions: {
      privateUse: { offered: true, reasonCode: null, actionableRows: 13 },
      simprokProposal: { offered: true, reasonCode: null, sourceFamily: 'FIELD_PRICE' },
      reviewGate: gate(),
    },
    ...over,
  }) as unknown as BasicPriceImportBatchSummary;

const stageBy = (batch: BasicPriceImportBatchSummary | null, key: string) => {
  const found = journeyView(batch).stages.find((stage) => stage.key === key);
  assert.ok(found, `stage ${key} must exist`);
  return found;
};

/* ── Shape ─────────────────────────────────────────────────────────────── */

test('J-1. the journey is six stages, in one fixed order', () => {
  const view = journeyView(batchOf());
  assert.deepEqual(
    view.stages.map((stage) => stage.key),
    [...JOURNEY_STAGE_KEYS],
  );
});

test('J-2. the entrance state promises nothing about a batch that does not exist', () => {
  const view = journeyView(null);
  assert.equal(view.stages[0].state, 'CURRENT');
  // Everything after the file is genuinely unknown before a file is read.
  for (const stage of view.stages.slice(1)) {
    assert.equal(stage.state, 'UPCOMING', `${stage.key} must not claim a verdict yet`);
  }
});

test('J-3. proposing to SIMPROK is marked OPTIONAL, because it is', () => {
  // The ordinary outcome is Simpan & Gunakan, which never enters curation at
  // all. A bar that drew Usulkan as mandatory would make the common path look
  // like an unfinished one.
  assert.equal(stageBy(batchOf(), 'PROPOSE').optional, true);
  const mandatory = journeyView(batchOf()).stages.filter((stage) => !stage.optional);
  assert.equal(mandatory.length, 5);
});

/* ── Verdicts trace to fields ──────────────────────────────────────────── */

test('J-4. the source stage reports the SERVER gate, not the form', () => {
  assert.equal(stageBy(batchOf(), 'SOURCE').state, 'DONE');
  assert.equal(
    stageBy(batchOf({ actions: { ...batchOf().actions, reviewGate: gate({ reviewAllowed: false, metadataComplete: false }) } }), 'SOURCE').state,
    'CURRENT',
  );
});

test('J-5. incomplete metadata and INCOHERENT metadata are different verdicts', () => {
  // The review gate reports these as two different reason codes precisely
  // because they are two different problems — "you have not answered yet" and
  // "your answers contradict each other". Collapsing them is the defect that
  // once told a COMPLETE batch its metadata was "belum lengkap".
  const incoherent = batchOf({
    actions: {
      ...batchOf().actions,
      reviewGate: gate({ reviewAllowed: false, metadataComplete: true, metadataCoherent: false }),
    },
  });
  assert.equal(stageBy(incoherent, 'SOURCE').state, 'ATTENTION');
});

test('J-6. the row stage counts the rows the server says are still open', () => {
  assert.equal(stageBy(batchOf(), 'ROWS').state, 'CURRENT');
  assert.match(stageBy(batchOf(), 'ROWS').hint, /73 baris/u);
  assert.equal(stageBy(batchOf({ needsReviewRows: 0 }), 'ROWS').state, 'DONE');
});

test('J-7. a locked review gate leaves the row stage UPCOMING, never current', () => {
  const blocked = batchOf({
    actions: { ...batchOf().actions, reviewGate: gate({ reviewAllowed: false, metadataComplete: false }) },
  });
  assert.equal(stageBy(blocked, 'ROWS').state, 'UPCOMING');
});

/* ── The two stages the payload cannot see ─────────────────────────────── */

test('J-8. Diterbitkan is NEVER marked done from an import batch', () => {
  // Publication is a decision taken elsewhere, by another authority, and the
  // batch carries no field that records it. Inferring it from `submittedRows`
  // would be manufacturing a governance verdict out of an intake count.
  for (const batch of [
    batchOf(),
    batchOf({ submittedRows: 13, status: 'SUBMITTED' }),
    batchOf({ needsReviewRows: 0, submittedRows: 86, status: 'SUBMITTED' }),
  ]) {
    assert.equal(stageBy(batch, 'PUBLISH').state, 'UPCOMING');
  }
});

test('J-9. Verifikasi becomes current only once rows were really proposed', () => {
  assert.equal(stageBy(batchOf(), 'VERIFY').state, 'UPCOMING');
  // `submittedRows > 0` means PriceSubmissions exist and a curator genuinely
  // has something waiting — that is a fact, not a guess.
  assert.equal(stageBy(batchOf({ submittedRows: 13 }), 'VERIFY').state, 'CURRENT');
});

test('J-10. a batch curation will never route says so, instead of "later"', () => {
  const notRouted = batchOf({
    actions: {
      ...batchOf().actions,
      simprokProposal: {
        offered: false,
        // The server's OWN reason code, spelled exactly as the contract does —
        // a fixture that invents a shorter one proves nothing about the real
        // government/regulation batch in the Owner's database.
        reasonCode: 'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION',
        sourceFamily: 'GOVERNMENT',
      },
    },
  });
  // NOT_OFFERED, not UPCOMING: for a government/regulation batch this door
  // will never open, and drawing it as pending would promise otherwise.
  assert.equal(stageBy(notRouted as BasicPriceImportBatchSummary, 'PROPOSE').state, 'NOT_OFFERED');
});

/* ── GAP-F — the whole curation tail, not just its first step ──────────── */

const notRoutedBatch = () =>
  batchOf({
    actions: {
      ...batchOf().actions,
      simprokProposal: {
        offered: false,
        reasonCode: 'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION',
        sourceFamily: 'GOVERNMENT',
      },
    },
  }) as BasicPriceImportBatchSummary;

test('F2. when curation cannot apply, PROPOSE, VERIFY and PUBLISH all say NOT_OFFERED', () => {
  // "This happens later" and "this path does not apply" are DIFFERENT truths.
  // Leaving VERIFY and PUBLISH as UPCOMING told a person to wait for two doors
  // that will never open — and quietly framed the ORDINARY outcome (Simpan &
  // Gunakan) as an unfinished version of the exceptional one.
  const batch = notRoutedBatch();
  for (const key of ['PROPOSE', 'VERIFY', 'PUBLISH'] as const) {
    assert.equal(
      stageBy(batch, key).state,
      'NOT_OFFERED',
      `${key} must not promise a door that will never open`,
    );
  }
});

test('F2b. a NOT_OFFERED stage says WHY, in ordinary words', () => {
  const publish = stageBy(notRoutedBatch(), 'PUBLISH');
  assert.match(publish.hint, /Tidak berlaku/u);
  assert.match(publish.hint, /kurasi SIMPROK/u);
});

test('F3. a batch that WAS proposed keeps its real curation progress', () => {
  // The flag can go false after a terminal submit. Real proposed rows are the
  // stronger fact, so progress already earned is never taken away.
  const proposedThenClosed = batchOf({
    status: 'SUBMITTED',
    submittedRows: 13,
    actions: {
      ...batchOf().actions,
      simprokProposal: {
        offered: false,
        reasonCode: 'ALREADY_PROPOSED',
        sourceFamily: 'FIELD_PRICE',
      },
    },
  }) as BasicPriceImportBatchSummary;

  assert.equal(stageBy(proposedThenClosed, 'PROPOSE').state, 'DONE');
  assert.equal(stageBy(proposedThenClosed, 'VERIFY').state, 'CURRENT');
  // Still never DONE — publication is another room's verdict, and no import
  // count can prove it.
  assert.equal(stageBy(proposedThenClosed, 'PUBLISH').state, 'UPCOMING');
});

test('BP-UX-REPAIR-01. a part-finished FIELD_PRICE batch does not rewind Lengkapi Sumber', () => {
  // CASE A — IKK shape after BP-CONTINUATION-02: 17 ready, 67 still open,
  // proposal offered NOW. Source must stay DONE.
  const notReady = batchOf({
    status: 'NEEDS_REVIEW',
    needsReviewRows: 67,
    readyForSubmissionRows: 17,
    alreadyPrivateRows: 17,
    submittedRows: 0,
    actions: {
      ...batchOf().actions,
      simprokProposal: {
        offered: true,
        reasonCode: null,
        sourceFamily: 'FIELD_PRICE',
      },
    },
  }) as BasicPriceImportBatchSummary;

  assert.equal(stageBy(notReady, 'SOURCE').state, 'DONE');
  assert.doesNotMatch(stageBy(notReady, 'SOURCE').hint, /lengkapi konteks/iu);
  assert.equal(stageBy(notReady, 'PROPOSE').state, 'CURRENT');
  assert.match(stageBy(notReady, 'PROPOSE').hint, /17 baris siap diusulkan/u);
});

test('BP-UX-REPAIR-01. SUBMITTED must not show Lengkapi Sumber as still running', () => {
  // CASE B — ACC-02 live shape: terminal propose, review room shut
  // (`reviewAllowed: false`) even though source was already accepted.
  const acc02 = batchOf({
    status: 'SUBMITTED',
    needsReviewRows: 0,
    readyForSubmissionRows: 0,
    submittedRows: 3,
    actions: {
      ...batchOf().actions,
      reviewGate: gate({
        reviewAllowed: false,
        metadataComplete: false,
        metadataCoherent: false,
      }),
      simprokProposal: {
        offered: false,
        reasonCode: 'ALREADY_PROPOSED',
        sourceFamily: 'FIELD_PRICE',
      },
    },
  }) as BasicPriceImportBatchSummary;

  const source = stageBy(acc02, 'SOURCE');
  assert.equal(source.state, 'DONE');
  assert.doesNotMatch(source.hint, /sedang berjalan/iu);
  assert.doesNotMatch(source.hint, /lengkapi konteks/iu);
  assert.doesNotMatch(source.hint, /belum/iu);
  assert.equal(stageBy(acc02, 'PROPOSE').state, 'DONE');
  assert.equal(acc02.actions.simprokProposal.offered, false);
});

test('BP-SHARED-PROPOSAL-01. FIELD_PRICE with ready rows offers CURRENT propose, not "tidak dirutekan"', () => {
  const ownerIkk = batchOf({
    status: 'NEEDS_REVIEW',
    needsReviewRows: 67,
    readyForSubmissionRows: 17,
    alreadyPrivateRows: 17,
    actions: {
      ...batchOf().actions,
      simprokProposal: {
        offered: true,
        reasonCode: null,
        sourceFamily: 'FIELD_PRICE',
      },
    },
  }) as BasicPriceImportBatchSummary;

  const propose = stageBy(ownerIkk, 'PROPOSE');
  assert.equal(propose.state, 'CURRENT');
  assert.equal(propose.optional, true);
  assert.match(propose.hint, /17 baris siap diusulkan/u);
  assert.doesNotMatch(propose.hint, /tidak dirutekan/u);
  assert.doesNotMatch(propose.hint, /semua baris/u);
  assert.equal(stageBy(ownerIkk, 'VERIFY').state, 'UPCOMING');
  assert.equal(stageBy(ownerIkk, 'PUBLISH').state, 'UPCOMING');
  assert.doesNotMatch(journeyView(ownerIkk).note ?? '', /tidak berlaku untuk sumber ini/u);
});

test('BP-CONTINUATION-02. after a partial wave, propose stays open for later eligible rows', () => {
  const afterWave = batchOf({
    status: 'NEEDS_REVIEW',
    needsReviewRows: 70,
    readyForSubmissionRows: 0,
    submittedRows: 16,
    actions: {
      ...batchOf().actions,
      simprokProposal: {
        offered: false,
        reasonCode: 'NO_ROWS_READY_FOR_SUBMISSION',
        sourceFamily: 'FIELD_PRICE',
      },
    },
  }) as BasicPriceImportBatchSummary;

  assert.equal(stageBy(afterWave, 'PROPOSE').state, 'CURRENT');
  assert.match(stageBy(afterWave, 'PROPOSE').hint, /16 harga sudah diusulkan/u);
  assert.match(stageBy(afterWave, 'PROPOSE').hint, /setelah dikonfirmasi/u);
  assert.equal(stageBy(afterWave, 'VERIFY').state, 'CURRENT');
});

test('F5. the private path is stated as usable NOW, not as pending', () => {
  const view = journeyView(notRoutedBatch());
  assert.match(view.note ?? '', /langsung tersimpan untuk ruang kerja ini/u);
  assert.match(view.note ?? '', /tidak berlaku untuk sumber ini/iu);
});

/* ── The sentence a bar cannot draw ────────────────────────────────────── */

test('J-11. saved prices are announced as USABLE NOW, not as pending', () => {
  const view = journeyView(batchOf({ alreadyPrivateRows: 13 }));
  assert.match(view.note ?? '', /bisa dipakai sekarang/u);
  assert.match(view.note ?? '', /tanpa menunggu kurasi/u);
});

test('J-12. keeping and proposing are described as two separate paths', () => {
  const both = journeyView(batchOf({ alreadyPrivateRows: 13, submittedRows: 13 }));
  assert.match(both.note ?? '', /terpisah/u);
});

/* ── Counters (§15) ────────────────────────────────────────────────────── */

test('J-13. every counter is a field the server actually sent', () => {
  const counters = reviewCounters(batchOf());
  assert.deepEqual(
    counters.map((counter) => [counter.label, counter.value]),
    [
      ['Baris terbaca', 86],
      ['Dikenali otomatis', 13],
      // BP-VISUAL-TRUTH-07 §16 — the PARENT of two classes must not wear one
      // child's name. 73 is "perlu keputusan Anda" PLUS "belum dikenali", and
      // the breakdown under the counters still names both classes separately.
      ['Belum selesai', 73],
      ['Selesai ditinjau', 13],
    ],
  );
});

test('J-14. a zero rejection count is not shown as if it were a problem', () => {
  assert.equal(reviewCounters(batchOf()).some((counter) => counter.key === 'REJECTED'), false);
  assert.equal(
    reviewCounters(batchOf({ rejectedRows: 2 })).some((counter) => counter.key === 'REJECTED'),
    true,
  );
});

/* ── Row tone (§15) ────────────────────────────────────────────────────── */

const rowOf = (over: Partial<BasicPriceImportRowSummary> = {}): BasicPriceImportRowSummary =>
  ({
    id: 'r-1',
    status: 'NEEDS_REVIEW',
    resolutionStatus: 'PENDING',
    code: 'M-01',
    name: 'Semen PC 50 kg',
    unit: 'Zak',
    rawPriceDisplayText: '62.500',
    proposedCanonicalPrice: '62500.00',
    section: 'MATERIAL',
    sectionProvenance: 'SOURCE_ROW_CATEGORY',
    sourceCategoryCode: null,
    sourceCategoryName: null,
    sourceRowNumber: 12,
    collisionType: 'NONE',
    collisionOfRowId: null,
    resourceCatalogId: null,
    unitDefinitionId: null,
    reasonCodes: [],
    version: 1,
    ...over,
  }) as unknown as BasicPriceImportRowSummary;

test('J-15. RED is reserved for a row a human actually rejected', () => {
  assert.equal(rowTone(rowOf({ status: 'REJECTED' })), 'rejected');
  // A row SIMPROK could not identify is UNRESOLVED, which is attention.
  // Nothing went wrong: the file did not prove enough and a person has to say.
  // Painting that red claims SIMPROK failed at something it never could do.
  assert.equal(rowTone(rowOf()), 'attention');
  assert.notEqual(rowTone(rowOf()), 'rejected');
});

test('J-16. a machine-proven row reads as safe, not as another alert', () => {
  const proven = rowOf({
    machineProposal: {
      identityPairProven: true,
      resource: { candidates: [] },
      unit: { unitCode: 'ZAK' },
    },
  } as unknown as Partial<BasicPriceImportRowSummary>);
  assert.equal(rowTone(proven), 'proven');
});

test('J-17. finished work is finished, whichever lawful outcome it took', () => {
  assert.equal(rowTone(rowOf({ status: 'READY_FOR_SUBMISSION' })), 'proven');
  assert.equal(rowTone(rowOf({ status: 'SUBMISSION_CREATED' })), 'proven');
  assert.equal(rowTone(rowOf({ savedAsPrivatePrice: true })), 'proven');
});

test('J-18. every tone maps to exactly one class, and only rejection is red', () => {
  assert.equal(ROW_TONE_CLASS.rejected, 'bp-rowcard--rejected');
  assert.equal(ROW_TONE_CLASS.attention, 'bp-rowcard--attention');
  assert.equal(ROW_TONE_CLASS.proven, 'bp-rowcard--proven');
  const reds = Object.entries(ROW_TONE_CLASS).filter(([, css]) => css.includes('rejected'));
  assert.equal(reds.length, 1);
});

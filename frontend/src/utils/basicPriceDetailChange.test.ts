import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOG_PUBLICATION_PATH,
  CATALOG_REVIEW_PATH,
  classifyKdnFact,
  classifyRequestedChange,
  DETAIL_CHANGE_DOOR_LABEL,
  DETAIL_FIELD_INVENTORY,
  detailChangeDoorLive,
  detailSubjectOffers,
  IDENTITY_NO_PATCH,
  KDN_CATALOG_NO_WRITER,
  KDN_COMPLETION_CATALOG_NOTE,
  KDN_COMPLETION_CONFLICT_NOTE,
  KDN_COMPLETION_FAILED_NOTE,
  KDN_COMPLETION_FORBIDDEN_NOTE,
  KDN_NO_SILENT_OVERWRITE,
  PRICE_PRIVATE_NO_AUTHORITY,
  PRICE_CHANGE_QUESTION,
  PRICE_CHOICE_CORRECTION,
  PRICE_CHOICE_NEW_OBSERVATION,
  KDN_CHANGE_QUESTION,
  KDN_CHOICE_CORRECTION,
  KDN_CHOICE_NEW_OBSERVATION,
  SOURCE_STILL_SAME_QUESTION,
  EVIDENCE_BASIS_DOCUMENT,
  EVIDENCE_BASIS_FIELD,
  BASIC_PRICE_IMPORT_PATH,
  STALE_FACT_MESSAGE,
  kdnCompletionDoor,
  kdnEnrichmentRefusalLabel,
  priceCorrectionRefusalLabel,
} from './basicPriceDetailChange.ts';

const privateReady = {
  detailReady: true,
  kdnPercent: null as string | null,
  assetScope: 'WORKSPACE_PRIVATE' as const,
  workspaceScope: 'WORKSPACE' as const,
  canSubmit: true,
  canReview: false,
  canPublish: false,
  canVerify: false,
  canPromoteShared: false,
};

test('DETAIL-CHG-01 LIVE only when the read is ready, KDN is unstated, the asset is private, and submit is allowed', () => {
  assert.deepEqual(
    kdnCompletionDoor({
      detailReady: true,
      kdnPercent: null,
      assetScope: 'WORKSPACE_PRIVATE',
      canSubmit: true,
    }),
    { kind: 'LIVE' },
  );
  const kdn = detailSubjectOffers(privateReady).find((offer) => offer.subject === 'KDN');
  assert.deepEqual(kdn, {
    subject: 'KDN',
    kind: 'LIVE',
    action: 'ENRICH',
    verb: 'Lengkapi',
    writer: 'enrichKdn',
  });
});

test('DETAIL-CHG-02 / DETAIL-CHG-03 stated KDN including 0.00 never opens an overwrite door', () => {
  assert.equal(classifyKdnFact('72.50'), 'STATED');
  assert.equal(classifyKdnFact('0.00'), 'STATED');
  assert.deepEqual(
    kdnCompletionDoor({
      detailReady: true,
      kdnPercent: '72.50',
      assetScope: 'WORKSPACE_PRIVATE',
      canSubmit: true,
    }),
    { kind: 'HIDDEN' },
  );
  assert.deepEqual(
    kdnCompletionDoor({
      detailReady: true,
      kdnPercent: '0.00',
      assetScope: 'WORKSPACE_PRIVATE',
      canSubmit: true,
    }),
    { kind: 'HIDDEN' },
  );
  const stated = detailSubjectOffers({
    ...privateReady,
    kdnPercent: '0.00',
  }).filter((offer) => offer.subject === 'KDN');
  assert.equal(stated.length, 2);
  assert.equal(stated[0]?.kind, 'LIVE');
  if (stated[0]?.kind === 'LIVE') {
    assert.equal(stated[0].action, 'OBSERVE_PRIVATE');
  }
  if (stated[1]?.kind === 'LIVE') {
    assert.equal(stated[1].action, 'CORRECT_PRIVATE');
  }
});

test('DETAIL-CHG-06 ordinary catalog observations get an honest sentence, not a live write', () => {
  assert.deepEqual(
    kdnCompletionDoor({
      detailReady: true,
      kdnPercent: null,
      assetScope: 'SIMPROK_CATALOG',
      workspaceScope: 'WORKSPACE',
      canSubmit: true,
    }),
    { kind: 'HONEST', reason: 'CATALOG' },
  );
  const offers = detailSubjectOffers({
    detailReady: true,
    kdnPercent: null,
    assetScope: 'SIMPROK_CATALOG',
    workspaceScope: 'WORKSPACE',
    canSubmit: true,
    canReview: false,
    canPublish: false,
    canVerify: false,
    canPromoteShared: false,
  });
  assert.equal(detailChangeDoorLive(offers), false);
  assert.ok(
    offers.some(
      (offer) =>
        offer.subject === 'KDN' &&
        offer.kind === 'HONEST' &&
        offer.action === 'CATALOG_NO_WRITER' &&
        offer.message === KDN_CATALOG_NO_WRITER,
    ),
  );
});

test('DETAIL-MAINT-02 workspace catalog curator LIVE-enriches missing KDN', () => {
  assert.deepEqual(
    kdnCompletionDoor({
      detailReady: true,
      kdnPercent: null,
      assetScope: 'SIMPROK_CATALOG',
      workspaceScope: 'WORKSPACE',
      canSubmit: false,
      canVerify: true,
    }),
    { kind: 'LIVE' },
  );
});

test('DETAIL-CHG-05 / DETAIL-GOV-05 missing permission or unread detail hides the enrich writer', () => {
  assert.deepEqual(
    kdnCompletionDoor({
      detailReady: true,
      kdnPercent: null,
      assetScope: 'WORKSPACE_PRIVATE',
      canSubmit: false,
    }),
    { kind: 'HIDDEN' },
  );
  assert.deepEqual(
    kdnCompletionDoor({
      detailReady: false,
      kdnPercent: undefined,
      assetScope: 'WORKSPACE_PRIVATE',
      canSubmit: true,
    }),
    { kind: 'HIDDEN' },
  );
});

test('DETAIL-CHG-07 / DETAIL-GOV-07 curator authority routes into existing rooms', () => {
  const offers = detailSubjectOffers({
    detailReady: true,
    kdnPercent: '72.50',
    assetScope: 'SIMPROK_CATALOG',
    workspaceScope: 'WORKSPACE',
    canSubmit: false,
    canReview: true,
    canPublish: true,
    canVerify: true,
    canPromoteShared: false,
  });
  assert.equal(detailChangeDoorLive(offers), true);
  assert.ok(
    offers.some(
      (offer) =>
        offer.kind === 'LIVE' &&
        offer.subject === 'PRICE' &&
        offer.action === 'ROUTE_REVIEW' &&
        offer.path === CATALOG_REVIEW_PATH,
    ),
  );
  assert.ok(
    offers.some(
      (offer) =>
        offer.kind === 'LIVE' &&
        offer.subject === 'PRICE' &&
        offer.action === 'ROUTE_PUBLICATION' &&
        offer.path === CATALOG_PUBLICATION_PATH,
    ),
  );
  assert.equal(
    offers.some((offer) => offer.subject === 'KDN' && offer.kind === 'LIVE'),
    false,
  );
  assert.ok(
    offers.some(
      (offer) =>
        offer.subject === 'KDN' &&
        offer.kind === 'HONEST' &&
        offer.action === 'NO_SILENT_OVERWRITE' &&
        offer.message === KDN_NO_SILENT_OVERWRITE,
    ),
  );
});

test('DETAIL-CHG-08 / DETAIL-GOV-01 missing fact is ENRICHMENT', () => {
  assert.equal(
    classifyRequestedChange({
      subject: 'KDN',
      current: null,
      proposed: '72.50',
    }),
    'ENRICHMENT',
  );
});

test('DETAIL-CHG-09 / DETAIL-GOV-02 existing fact needs an intent, never a silent correction', () => {
  assert.equal(
    classifyRequestedChange({
      subject: 'KDN',
      current: '72.50',
      proposed: '63.20',
    }),
    'UNAVAILABLE',
  );
  assert.equal(
    classifyRequestedChange({
      subject: 'PRICE',
      current: '62500.00',
      proposed: '65000.00',
      intent: 'NEW_OBSERVATION',
    }),
    'NEW_OBSERVATION',
  );
  assert.equal(
    classifyRequestedChange({
      subject: 'PRICE',
      current: '62500.00',
      proposed: '65000.00',
      intent: 'CORRECTION',
    }),
    'CORRECTION',
  );
});

test('DETAIL-GOV-03 identity-sensitive change is IDENTITY and has no Detail door', () => {
  assert.equal(
    classifyRequestedChange({
      subject: 'IDENTITY',
      current: 'm3',
      proposed: 'm2',
    }),
    'IDENTITY_OR_CONTEXT_CHANGE',
  );
  assert.equal(
    detailSubjectOffers(privateReady).some((offer) => offer.subject === 'IDENTITY'),
    false,
  );
  assert.ok(IDENTITY_NO_PATCH.length > 0);
});

test('DETAIL-CHG-10 private money with submit offers new observation and correction', () => {
  const prices = detailSubjectOffers(privateReady).filter((offer) => offer.subject === 'PRICE');
  assert.equal(prices.length, 2);
  if (prices[0]?.kind === 'LIVE') {
    assert.equal(prices[0].action, 'OBSERVE_PRIVATE');
    assert.equal(prices[0].writer, 'observePrivatePrice');
  }
  if (prices[1]?.kind === 'LIVE') {
    assert.equal(prices[1].action, 'CORRECT_PRIVATE');
    assert.equal(prices[1].writer, 'correctPrivatePrice');
  }
});

test('DETAIL-CHG-10b private money without submit is honest', () => {
  const price = detailSubjectOffers({
    ...privateReady,
    canSubmit: false,
  }).find((offer) => offer.subject === 'PRICE');
  assert.equal(price?.kind, 'HONEST');
  if (price?.kind === 'HONEST') {
    assert.equal(price.action, 'PRIVATE_NO_AUTHORITY');
    assert.equal(price.message, PRICE_PRIVATE_NO_AUTHORITY);
  }
});

test('DETAIL-FIELD-01 general missing-fact enrichment is PARTIAL', () => {
  assert.deepEqual([...DETAIL_FIELD_INVENTORY.enrichableNonIdentity], ['kdnPercent']);
  assert.deepEqual([...DETAIL_FIELD_INVENTORY.newObservationCapable], ['value', 'kdnPercent']);
  assert.deepEqual([...DETAIL_FIELD_INVENTORY.correctable], ['value', 'kdnPercent']);
});

test('DETAIL-ROUTE human choices stay ordinary Indonesian', () => {
  assert.equal(PRICE_CHANGE_QUESTION, 'Apa yang terjadi dengan harga ini?');
  assert.equal(PRICE_CHOICE_NEW_OBSERVATION, 'Harga terbaru');
  assert.equal(PRICE_CHOICE_CORRECTION, 'Koreksi data sebelumnya');
  assert.equal(
    KDN_CHANGE_QUESTION,
    'Apakah ini informasi KDN terbaru atau koreksi nilai sebelumnya?',
  );
  assert.equal(KDN_CHOICE_NEW_OBSERVATION, 'Informasi KDN terbaru');
  assert.equal(KDN_CHOICE_CORRECTION, 'Koreksi nilai sebelumnya');
  assert.equal(SOURCE_STILL_SAME_QUESTION, 'Sumber harga masih sama?');
  assert.equal(EVIDENCE_BASIS_DOCUMENT, 'Bukti/dokumen sumber');
  assert.equal(EVIDENCE_BASIS_FIELD, 'Hasil survei/laporan lapangan');
  assert.equal(BASIC_PRICE_IMPORT_PATH, '/basic-price/import');
  assert.doesNotMatch(PRICE_CHANGE_QUESTION, /supersession|lineage|effectiveDate/iu);
  assert.doesNotMatch(KDN_CHANGE_QUESTION, /cardinality|observationId/iu);
});

test('DETAIL-CONC-01 stale refusal is ordinary Indonesian, never the server body', () => {
  assert.equal(
    kdnEnrichmentRefusalLabel(409, '{"message":"KDN_STALE_FACT"}'),
    STALE_FACT_MESSAGE,
  );
  assert.equal(
    priceCorrectionRefusalLabel(409, '{"message":"PRICE_STALE_FACT"}'),
    STALE_FACT_MESSAGE,
  );
});

test('refusal labels never print the server body', () => {
  assert.equal(
    kdnEnrichmentRefusalLabel(409, '{"message":"KDN_CONFLICT_NO_SILENT_OVERWRITE"}'),
    KDN_COMPLETION_CONFLICT_NOTE,
  );
  assert.equal(kdnEnrichmentRefusalLabel(403, 'anything'), KDN_COMPLETION_FORBIDDEN_NOTE);
  assert.equal(kdnEnrichmentRefusalLabel(404, 'anything'), KDN_COMPLETION_FORBIDDEN_NOTE);
  assert.equal(kdnEnrichmentRefusalLabel(500, 'stack'), KDN_COMPLETION_FAILED_NOTE);
  assert.match(KDN_COMPLETION_CATALOG_NOTE, /kurator yang berwenang/u);
});

test('DETAIL-CHG-14 the door label is compact and contains no internal id', () => {
  assert.equal(DETAIL_CHANGE_DOOR_LABEL, 'Lengkapi / Ajukan perubahan');
  assert.doesNotMatch(DETAIL_CHANGE_DOOR_LABEL, /[0-9a-f-]{8}/iu);
});

test('DETAIL-PROPOSE-01 field-report private price offers Usulkan ke SIMPROK', () => {
  const offer = detailSubjectOffers({
    ...privateReady,
    sourceOrigin: 'FIELD_REPORT',
  }).find((item) => item.subject === 'PROPOSAL');
  assert.equal(offer?.kind, 'LIVE');
  if (offer?.kind === 'LIVE') {
    assert.equal(offer.action, 'PROPOSE_PRIVATE');
    assert.equal(offer.writer, 'submitPrivatePrice');
    assert.equal(offer.verb, 'Usulkan ke SIMPROK');
  }
});

test('DETAIL-PROPOSE-02 government private price stays honest, not a second engine', () => {
  const offer = detailSubjectOffers({
    ...privateReady,
    sourceOrigin: 'GOVERNMENT',
  }).find((item) => item.subject === 'PROPOSAL');
  assert.equal(offer?.kind, 'HONEST');
  if (offer?.kind === 'HONEST') {
    assert.equal(offer.action, 'FAMILY_NOT_ROUTED');
  }
});

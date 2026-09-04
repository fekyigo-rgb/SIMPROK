import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CATALOG_PUBLICATION_PATH,
  CATALOG_REVIEW_PATH,
  classifyKdnFact,
  classifyRequestedChange,
  DETAIL_CHANGE_DOOR_LABEL,
  DETAIL_FIELD_INVENTORY,
  detailChangeDoorVisible,
  detailSubjectOffers,
  expectedKdnMatchesStored,
  IDENTITY_NO_PATCH,
  KDN_CATALOG_NO_WRITER,
  KDN_NO_SILENT_OVERWRITE,
  PRICE_CATALOG_NO_AUTHORITY,
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
} from './basic-price-detail-change.policy';

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

describe('BP-DETAIL-CHANGE-01 / BP-DETAIL-MAINT-02 classification and door policy', () => {
  it('DETAIL-CHG-01 — private missing KDN + submit opens LIVE enrich', () => {
    const kdn = detailSubjectOffers(privateReady).find(
      (offer) => offer.subject === 'KDN',
    );
    expect(kdn).toEqual({
      subject: 'KDN',
      kind: 'LIVE',
      action: 'ENRICH',
      verb: 'Lengkapi',
      writer: 'enrichKdn',
    });
  });

  it('DETAIL-CHG-02 / DETAIL-CHG-03 — stated KDN including 0.00 is not missing and is not enrich', () => {
    expect(classifyKdnFact('72.50')).toBe('STATED');
    expect(classifyKdnFact('0.00')).toBe('STATED');
    expect(classifyKdnFact(null)).toBe('MISSING');

    for (const stated of ['72.50', '0.00']) {
      const kdnOffers = detailSubjectOffers({
        ...privateReady,
        kdnPercent: stated,
      }).filter((offer) => offer.subject === 'KDN');
      expect(kdnOffers).toEqual([
        {
          subject: 'KDN',
          kind: 'LIVE',
          action: 'OBSERVE_PRIVATE',
          verb: 'Ajukan Perubahan',
          writer: 'observePrivateKdn',
        },
        {
          subject: 'KDN',
          kind: 'LIVE',
          action: 'CORRECT_PRIVATE',
          verb: 'Ajukan Perubahan',
          writer: 'correctPrivateKdn',
        },
      ]);
    }
  });

  it('DETAIL-CHG-05 / DETAIL-GOV-05 — submit authority is required for private enrich', () => {
    const kdn = detailSubjectOffers({
      ...privateReady,
      canSubmit: false,
    }).find((offer) => offer.subject === 'KDN');
    expect(kdn).toBeUndefined();
  });

  it('DETAIL-CHG-06 / DETAIL-GOV-06 — ordinary catalog actor has no direct write', () => {
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
    expect(offers.some((offer) => offer.kind === 'LIVE')).toBe(false);
    expect(offers).toEqual(
      expect.arrayContaining([
        {
          subject: 'KDN',
          kind: 'HONEST',
          action: 'CATALOG_NO_WRITER',
          message: KDN_CATALOG_NO_WRITER,
        },
        {
          subject: 'PRICE',
          kind: 'HONEST',
          action: 'CATALOG_NO_AUTHORITY',
          message: PRICE_CATALOG_NO_AUTHORITY,
        },
      ]),
    );
  });

  it('DETAIL-MAINT-02 — workspace catalog curator may LIVE-enrich missing KDN', () => {
    const kdn = detailSubjectOffers({
      detailReady: true,
      kdnPercent: null,
      assetScope: 'SIMPROK_CATALOG',
      workspaceScope: 'WORKSPACE',
      canSubmit: false,
      canReview: true,
      canPublish: false,
      canVerify: true,
      canPromoteShared: false,
    }).find((offer) => offer.subject === 'KDN');
    expect(kdn).toEqual({
      subject: 'KDN',
      kind: 'LIVE',
      action: 'ENRICH',
      verb: 'Lengkapi',
      writer: 'enrichCatalogKdn',
    });
  });

  it('DETAIL-MAINT-02 — shared catalog curator may LIVE-enrich missing KDN', () => {
    const kdn = detailSubjectOffers({
      detailReady: true,
      kdnPercent: null,
      assetScope: 'SIMPROK_CATALOG',
      workspaceScope: 'GLOBAL',
      canSubmit: false,
      canReview: false,
      canPublish: false,
      canVerify: false,
      canPromoteShared: true,
    }).find((offer) => offer.subject === 'KDN');
    expect(kdn).toEqual({
      subject: 'KDN',
      kind: 'LIVE',
      action: 'ENRICH',
      verb: 'Lengkapi',
      writer: 'enrichCatalogKdn',
    });
  });

  it('DETAIL-CHG-07 / DETAIL-GOV-07 — curator authority routes catalog money into existing rooms', () => {
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
    expect(offers).toEqual(
      expect.arrayContaining([
        {
          subject: 'KDN',
          kind: 'HONEST',
          action: 'NO_SILENT_OVERWRITE',
          message: KDN_NO_SILENT_OVERWRITE,
        },
        {
          subject: 'PRICE',
          kind: 'LIVE',
          action: 'ROUTE_REVIEW',
          path: CATALOG_REVIEW_PATH,
          verb: 'Ajukan Perubahan',
        },
        {
          subject: 'PRICE',
          kind: 'LIVE',
          action: 'ROUTE_PUBLICATION',
          path: CATALOG_PUBLICATION_PATH,
          verb: 'Ajukan Perubahan',
        },
      ]),
    );
    expect(
      offers.some((offer) => offer.subject === 'KDN' && offer.kind === 'LIVE'),
    ).toBe(false);
  });

  it('DETAIL-CHG-08 / DETAIL-GOV-01 — missing fact is ENRICHMENT', () => {
    expect(
      classifyRequestedChange({
        subject: 'KDN',
        current: null,
        proposed: '72.50',
      }),
    ).toBe('ENRICHMENT');
  });

  it('DETAIL-CHG-09 / DETAIL-GOV-02 — stated fact without intent is not a silent correction', () => {
    expect(
      classifyRequestedChange({
        subject: 'KDN',
        current: '72.50',
        proposed: '63.20',
      }),
    ).toBe('UNAVAILABLE');
    expect(
      classifyRequestedChange({
        subject: 'PRICE',
        current: '62500.00',
        proposed: '65000.00',
      }),
    ).toBe('UNAVAILABLE');
    expect(
      classifyRequestedChange({
        subject: 'PRICE',
        current: '62500.00',
        proposed: '65000.00',
        intent: 'NEW_OBSERVATION',
      }),
    ).toBe('NEW_OBSERVATION');
    expect(
      classifyRequestedChange({
        subject: 'PRICE',
        current: '62500.00',
        proposed: '65000.00',
        intent: 'CORRECTION',
      }),
    ).toBe('CORRECTION');
    expect(
      classifyRequestedChange({
        subject: 'KDN',
        current: '72.50',
        proposed: '68.20',
        intent: 'CORRECTION',
      }),
    ).toBe('CORRECTION');
    expect(
      classifyRequestedChange({
        subject: 'KDN',
        current: '72.50',
        proposed: '68.20',
        intent: 'NEW_OBSERVATION',
      }),
    ).toBe('NEW_OBSERVATION');
  });

  it('DETAIL-GOV-03 — identity-sensitive change is never a generic patch', () => {
    expect(
      classifyRequestedChange({
        subject: 'IDENTITY',
        current: 'm3',
        proposed: 'm2',
      }),
    ).toBe('IDENTITY_OR_CONTEXT_CHANGE');
    expect(
      detailSubjectOffers(privateReady).some(
        (offer) => offer.subject === 'IDENTITY',
      ),
    ).toBe(false);
    expect(IDENTITY_NO_PATCH.length).toBeGreaterThan(0);
  });

  it('DETAIL-CHG-10 — private money with submit offers new observation and correction', () => {
    const privatePrices = detailSubjectOffers(privateReady).filter(
      (offer) => offer.subject === 'PRICE',
    );
    expect(privatePrices).toEqual([
      {
        subject: 'PRICE',
        kind: 'LIVE',
        action: 'OBSERVE_PRIVATE',
        verb: 'Ajukan Perubahan',
        writer: 'observePrivatePrice',
      },
      {
        subject: 'PRICE',
        kind: 'LIVE',
        action: 'CORRECT_PRIVATE',
        verb: 'Ajukan Perubahan',
        writer: 'correctPrivatePrice',
      },
    ]);
  });

  it('DETAIL-CHG-10b — private money without submit is honest, not a dead door', () => {
    const privatePrice = detailSubjectOffers({
      ...privateReady,
      canSubmit: false,
    }).find((offer) => offer.subject === 'PRICE');
    expect(privatePrice).toEqual({
      subject: 'PRICE',
      kind: 'HONEST',
      action: 'PRIVATE_NO_AUTHORITY',
      message: PRICE_PRIVATE_NO_AUTHORITY,
    });
  });

  it('DETAIL-FIELD-01 — general private missing-fact enrichment is PARTIAL and named', () => {
    expect([...DETAIL_FIELD_INVENTORY.enrichableNonIdentity]).toEqual([
      'kdnPercent',
    ]);
    expect(DETAIL_FIELD_INVENTORY.identity).toEqual([
      'unit',
      'resource',
      'region',
      'effectiveDate',
    ]);
    expect(DETAIL_FIELD_INVENTORY.notEditableByDesign).toEqual(
      expect.arrayContaining([
        'assetScope',
        'moneyViaPatch',
        'statedKdnViaEnrich',
      ]),
    );
    expect([...DETAIL_FIELD_INVENTORY.newObservationCapable]).toEqual([
      'value',
      'kdnPercent',
    ]);
    expect([...DETAIL_FIELD_INVENTORY.correctable]).toEqual([
      'value',
      'kdnPercent',
    ]);
    expect([...DETAIL_FIELD_INVENTORY.identitySensitive]).toEqual([
      'unit',
      'resource',
      'region',
      'effectiveDate',
    ]);
  });

  it('DETAIL-CONC-01 expected token distinguishes stale from matching', () => {
    expect(expectedKdnMatchesStored(undefined, null)).toBe(true);
    expect(expectedKdnMatchesStored(null, null)).toBe(true);
    expect(expectedKdnMatchesStored(null, '72.50')).toBe(false);
    expect(expectedKdnMatchesStored('72.50', '72.50')).toBe(true);
  });

  it('the door label is the Owner-locked compact wording', () => {
    expect(DETAIL_CHANGE_DOOR_LABEL).toBe('Lengkapi / Ajukan Perubahan');
    expect(PRICE_CHANGE_QUESTION).toBe('Apa yang terjadi dengan harga ini?');
    expect(PRICE_CHOICE_NEW_OBSERVATION).toBe('Harga terbaru');
    expect(PRICE_CHOICE_CORRECTION).toBe('Koreksi data sebelumnya');
    expect(KDN_CHANGE_QUESTION).toBe(
      'Apakah ini informasi KDN terbaru atau koreksi nilai sebelumnya?',
    );
    expect(KDN_CHOICE_NEW_OBSERVATION).toBe('Informasi KDN terbaru');
    expect(KDN_CHOICE_CORRECTION).toBe('Koreksi nilai sebelumnya');
    expect(SOURCE_STILL_SAME_QUESTION).toBe('Sumber harga masih sama?');
    expect(EVIDENCE_BASIS_DOCUMENT).toBe('Bukti/dokumen sumber');
    expect(EVIDENCE_BASIS_FIELD).toBe('Hasil survei/laporan lapangan');
    expect(BASIC_PRICE_IMPORT_PATH).toBe('/basic-price/import');
    expect(detailChangeDoorVisible(detailSubjectOffers(privateReady))).toBe(
      true,
    );
    expect(detailChangeDoorVisible([])).toBe(false);
  });

  it('GENERIC_PATCH_ENDPOINT = NO — Detail and import controllers add no generic Basic Price patch', () => {
    const importController = readFileSync(
      join(__dirname, 'basic-price-import.controller.ts'),
      'utf8',
    );
    const detailController = readFileSync(
      join(__dirname, 'basic-price.controller.ts'),
      'utf8',
    );
    expect(importController).not.toMatch(/@Put\(/);
    expect(detailController).not.toMatch(/@Put\(/);
    expect(detailController).not.toMatch(/updateBasicPrice/);
    expect(detailController).toMatch(/@Get\(':id\/detail'\)/);
    expect(importController).toMatch(
      /@Post\('prices\/:priceId\/catalog-kdn'\)/,
    );
    expect(importController).toMatch(
      /@Post\('prices\/:priceId\/corrections'\)/,
    );
    expect(importController).toMatch(
      /@Post\('prices\/:priceId\/observations'\)/,
    );
    expect(importController).toMatch(
      /@Post\('prices\/:priceId\/kdn-observations'\)/,
    );
    expect(importController).toMatch(
      /@Post\('prices\/:priceId\/kdn-corrections'\)/,
    );
    expect(importController).toMatch(
      /@Post\('prices\/:priceId\/submit'\)/,
    );
  });

  it('DETAIL-PROPOSE-01 — field-report private price with submit offers Usulkan ke SIMPROK', () => {
    const offer = detailSubjectOffers({
      ...privateReady,
      sourceOrigin: 'FIELD_REPORT',
    }).find((item) => item.subject === 'PROPOSAL');
    expect(offer).toEqual({
      subject: 'PROPOSAL',
      kind: 'LIVE',
      action: 'PROPOSE_PRIVATE',
      verb: 'Usulkan ke SIMPROK',
      writer: 'submitPrivatePrice',
    });
  });

  it('DETAIL-PROPOSE-02 — government private price is honest, not a second door', () => {
    const offer = detailSubjectOffers({
      ...privateReady,
      sourceOrigin: 'GOVERNMENT',
    }).find((item) => item.subject === 'PROPOSAL');
    expect(offer?.kind).toBe('HONEST');
    if (offer?.kind === 'HONEST') {
      expect(offer.action).toBe('FAMILY_NOT_ROUTED');
    }
  });
});

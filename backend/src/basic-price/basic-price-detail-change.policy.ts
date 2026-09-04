/**
 * BP-DETAIL-CHANGE-01 / BP-DETAIL-MAINT-02 / BP-CHANGE-SEM-03 — ONE CHANGE LAW.
 *
 * Classifies a requested Detail change. It does not write. It does not invent
 * a generic PATCH. Each LIVE offer names an EXISTING writer or an EXISTING
 * curation room. HONEST offers exist so the screen never paints a dead door.
 *
 * Backend policy is authoritative. The frontend file
 * `frontend/src/utils/basicPriceDetailChange.ts` is a presentation/capability
 * mirror and must stay in parity.
 */

import { PriceSourceOrigin } from '@prisma/client';
import { familyOffersCommunityCuration } from './basic-price-batch-actions.policy';
import { sourceFamilyOfOrigin } from './basic-price-source-family.util';

export const DETAIL_CHANGE_DOOR_LABEL = 'Lengkapi / Ajukan Perubahan';

export const CATALOG_REVIEW_PATH = '/basic-price/reviews';
export const CATALOG_PUBLICATION_PATH = '/basic-price/publications';

export const STALE_FACT_MESSAGE =
  'Data ini telah berubah sejak Anda membukanya. Tinjau versi terbaru sebelum melanjutkan.';

export const PRICE_CHANGE_QUESTION = 'Apa yang terjadi dengan harga ini?';
export const PRICE_CHOICE_NEW_OBSERVATION = 'Harga terbaru';
export const PRICE_CHOICE_NEW_OBSERVATION_HELP =
  'Harga sebelumnya benar, tetapi sekarang tersedia harga yang lebih baru.';
export const PRICE_CHOICE_CORRECTION = 'Koreksi data sebelumnya';
export const PRICE_CHOICE_CORRECTION_HELP =
  'Harga yang tersimpan sebelumnya ternyata salah dan perlu diperbaiki.';

export const SOURCE_STILL_SAME_QUESTION = 'Sumber harga masih sama?';
export const SOURCE_STILL_SAME_YES = 'Ya, sumber yang sama';
export const SOURCE_STILL_SAME_NO = 'Tidak, sumber berbeda';
export const EVIDENCE_BASIS_QUESTION = 'Dasar informasi';
export const EVIDENCE_BASIS_DOCUMENT = 'Bukti/dokumen sumber';
export const EVIDENCE_BASIS_FIELD = 'Hasil survei/laporan lapangan';
export const BASIC_PRICE_IMPORT_PATH = '/basic-price/import';
export const DOCUMENTARY_INTAKE_NOTE =
  'Bukti dokumen masuk lewat pintu Impor. Observasi ini tidak menimpa sumber sebelumnya.';
export const FIELD_REPORTED_SOURCE_NAME_LABEL = 'Nama sumber';
export const KDN_USER_REPORTED_NOTE =
  'Nilai KDN ini tercatat sebagai pengisian/laporan, bukan otomatis sebagai sertifikat pabrik.';

export const KDN_CHANGE_QUESTION =
  'Apakah ini informasi KDN terbaru atau koreksi nilai sebelumnya?';
export const KDN_CHOICE_NEW_OBSERVATION = 'Informasi KDN terbaru';
export const KDN_CHOICE_CORRECTION = 'Koreksi nilai sebelumnya';

/**
 * BP-CHANGE-SEM-03 — honest field inventory for the Detail surface.
 *
 * GENERAL_PRIVATE_MISSING_FACT_ENRICHMENT = PARTIAL. Missing %KDN may be
 * filled later. Stated money and stated KDN are not enrichable: they route
 * as NEW_OBSERVATION or CORRECTION. Identity, source, derived, and
 * money-via-PATCH remain not editable here.
 */
export const DETAIL_FIELD_INVENTORY = {
  enrichable: ['kdnPercent'] as const,
  enrichableNonIdentity: ['kdnPercent'] as const,
  newObservationCapable: ['value', 'kdnPercent'] as const,
  correctable: ['value', 'kdnPercent'] as const,
  identitySensitive: ['unit', 'resource', 'region', 'effectiveDate'] as const,
  identity: ['unit', 'resource', 'region', 'effectiveDate'] as const,
  derived: ['freshness', 'workspaceScope', 'kesegaran'] as const,
  sourceViaBatchProvenance: [
    'sourceType',
    'sourceOrigin',
    'sourcePeriodLabel',
  ] as const,
  notEditableByDesign: [
    'assetScope',
    'moneyViaPatch',
    'statedKdnViaEnrich',
  ] as const,
};

export type KdnFactState = 'UNKNOWN' | 'MISSING' | 'STATED';

export function classifyKdnFact(
  kdnPercent: string | null | undefined,
): KdnFactState {
  if (kdnPercent === undefined) return 'UNKNOWN';
  if (kdnPercent === null) return 'MISSING';
  return 'STATED';
}

export type DetailChangeIntent = 'NEW_OBSERVATION' | 'CORRECTION';

export type DetailChangeClass =
  | 'ENRICHMENT'
  | 'NEW_OBSERVATION'
  | 'CORRECTION'
  | 'IDENTITY_OR_CONTEXT_CHANGE'
  | 'NOT_EDITABLE'
  | 'UNAVAILABLE';

export function classifyRequestedChange(input: {
  subject: 'KDN' | 'PRICE' | 'SOURCE' | 'IDENTITY' | 'DATE';
  current: string | null | undefined;
  proposed: string | null | undefined;
  intent?: DetailChangeIntent;
}): DetailChangeClass {
  if (input.subject === 'IDENTITY') return 'IDENTITY_OR_CONTEXT_CHANGE';
  if (
    input.subject === 'PRICE' &&
    input.current != null &&
    input.proposed != null
  ) {
    if (input.current === input.proposed) return 'UNAVAILABLE';
    if (input.intent === 'NEW_OBSERVATION') return 'NEW_OBSERVATION';
    if (input.intent === 'CORRECTION') return 'CORRECTION';
    return 'UNAVAILABLE';
  }
  if (input.subject === 'KDN') {
    const current = classifyKdnFact(input.current);
    if (
      current === 'MISSING' &&
      input.proposed != null &&
      input.proposed !== ''
    ) {
      return 'ENRICHMENT';
    }
    if (
      current === 'STATED' &&
      input.proposed != null &&
      input.proposed !== input.current
    ) {
      if (input.intent === 'NEW_OBSERVATION') return 'NEW_OBSERVATION';
      if (input.intent === 'CORRECTION') return 'CORRECTION';
      return 'UNAVAILABLE';
    }
    return 'UNAVAILABLE';
  }
  if (
    (input.subject === 'SOURCE' || input.subject === 'DATE') &&
    (input.current == null || input.current === '') &&
    input.proposed
  ) {
    return 'ENRICHMENT';
  }
  if (
    (input.subject === 'SOURCE' || input.subject === 'DATE') &&
    input.current &&
    input.proposed &&
    input.current !== input.proposed
  ) {
    return 'NOT_EDITABLE';
  }
  return 'UNAVAILABLE';
}

export type DetailSubjectOffer =
  | {
      subject: 'KDN';
      kind: 'LIVE';
      action: 'ENRICH';
      verb: 'Lengkapi';
      writer: 'enrichKdn' | 'enrichCatalogKdn';
    }
  | {
      subject: 'KDN';
      kind: 'LIVE';
      action: 'OBSERVE_PRIVATE';
      verb: 'Ajukan Perubahan';
      writer: 'observePrivateKdn';
    }
  | {
      subject: 'KDN';
      kind: 'LIVE';
      action: 'CORRECT_PRIVATE';
      verb: 'Ajukan Perubahan';
      writer: 'correctPrivateKdn';
    }
  | {
      subject: 'KDN';
      kind: 'HONEST';
      action: 'NO_SILENT_OVERWRITE' | 'CATALOG_NO_WRITER';
      message: string;
    }
  | {
      subject: 'PRICE';
      kind: 'LIVE';
      action: 'OBSERVE_PRIVATE';
      verb: 'Ajukan Perubahan';
      writer: 'observePrivatePrice';
    }
  | {
      subject: 'PRICE';
      kind: 'LIVE';
      action: 'CORRECT_PRIVATE';
      verb: 'Ajukan Perubahan';
      writer: 'correctPrivatePrice';
    }
  | {
      subject: 'PRICE';
      kind: 'LIVE';
      action: 'ROUTE_REVIEW' | 'ROUTE_PUBLICATION';
      path: string;
      verb: 'Ajukan Perubahan';
    }
  | {
      subject: 'PRICE';
      kind: 'HONEST';
      action: 'PRIVATE_NO_AUTHORITY' | 'CATALOG_NO_AUTHORITY';
      message: string;
    }
  | {
      subject: 'PROPOSAL';
      kind: 'LIVE';
      action: 'PROPOSE_PRIVATE';
      verb: 'Usulkan ke SIMPROK';
      writer: 'submitPrivatePrice';
    }
  | {
      subject: 'PROPOSAL';
      kind: 'HONEST';
      action: 'FAMILY_NOT_ROUTED' | 'PRIVATE_NO_AUTHORITY' | 'ALREADY_PROPOSED';
      message: string;
    }
  | {
      subject: 'SOURCE' | 'IDENTITY' | 'DATE';
      kind: 'HONEST';
      message: string;
    };

export type DetailWorkspaceScope = 'WORKSPACE' | 'GLOBAL';

export interface DetailChangeActorFacts {
  detailReady: boolean;
  kdnPercent: string | null | undefined;
  assetScope: 'WORKSPACE_PRIVATE' | 'SIMPROK_CATALOG' | undefined;
  workspaceScope?: DetailWorkspaceScope;
  canSubmit: boolean;
  canReview: boolean;
  canPublish: boolean;
  canVerify: boolean;
  canPromoteShared: boolean;
  sourceOrigin?: string | null;
  alreadyProposed?: boolean;
}

export const KDN_CATALOG_NO_WRITER =
  'Pelengkapan %KDN katalog hanya untuk kurator yang berwenang. Pengguna biasa tidak mengisi %KDN katalog dari layar ini.';

export const KDN_NO_SILENT_OVERWRITE =
  'KDN yang sudah tercatat tidak ditimpa diam-diam. Perubahan %KDN yang sudah ada bukan pelengkapan.';

export const PRICE_PRIVATE_NO_AUTHORITY =
  'Perubahan angka harga milik ruang kerja membutuhkan kewenangan pengajuan Basic Price di ruang kerja ini.';

export const PRICE_CATALOG_NO_AUTHORITY =
  'Harga katalog SIMPROK tidak diubah langsung dari ruang kerja biasa.';

export const PROPOSAL_FAMILY_NOT_ROUTED =
  'Sumber harga ini tidak diusulkan lewat kurasi lapangan SIMPROK. Harga tetap dapat digunakan sebagai milik ruang kerja.';

export const PROPOSAL_PRIVATE_NO_AUTHORITY =
  'Mengusulkan harga ke SIMPROK membutuhkan kewenangan pengajuan Basic Price di ruang kerja ini.';

export const PROPOSAL_ALREADY_SENT =
  'Harga ini sudah diusulkan ke SIMPROK. Status usulan ada di Pengajuan harga.';

export const IDENTITY_NO_PATCH =
  'Satuan, sumber daya, dan wilayah tidak diubah lewat patch generik. Itu observasi atau identitas baru.';

function catalogKdnWriter(
  input: DetailChangeActorFacts,
): 'enrichCatalogKdn' | null {
  if (input.assetScope !== 'SIMPROK_CATALOG') return null;
  if (input.workspaceScope === 'GLOBAL' && input.canPromoteShared) {
    return 'enrichCatalogKdn';
  }
  if (input.workspaceScope === 'WORKSPACE' && input.canVerify) {
    return 'enrichCatalogKdn';
  }
  return null;
}

export function detailSubjectOffers(
  input: DetailChangeActorFacts,
): DetailSubjectOffer[] {
  if (!input.detailReady) return [];

  const offers: DetailSubjectOffer[] = [];
  const kdn = classifyKdnFact(input.kdnPercent);
  const catalog = input.assetScope === 'SIMPROK_CATALOG';
  const privateAsset = input.assetScope === 'WORKSPACE_PRIVATE';

  if (privateAsset && input.canSubmit && kdn === 'MISSING') {
    offers.push({
      subject: 'KDN',
      kind: 'LIVE',
      action: 'ENRICH',
      verb: 'Lengkapi',
      writer: 'enrichKdn',
    });
  } else if (privateAsset && input.canSubmit && kdn === 'STATED') {
    offers.push({
      subject: 'KDN',
      kind: 'LIVE',
      action: 'OBSERVE_PRIVATE',
      verb: 'Ajukan Perubahan',
      writer: 'observePrivateKdn',
    });
    offers.push({
      subject: 'KDN',
      kind: 'LIVE',
      action: 'CORRECT_PRIVATE',
      verb: 'Ajukan Perubahan',
      writer: 'correctPrivateKdn',
    });
  } else if (privateAsset && kdn === 'STATED') {
    offers.push({
      subject: 'KDN',
      kind: 'HONEST',
      action: 'NO_SILENT_OVERWRITE',
      message: KDN_NO_SILENT_OVERWRITE,
    });
  } else if (catalog && kdn === 'MISSING') {
    const writer = catalogKdnWriter(input);
    if (writer) {
      offers.push({
        subject: 'KDN',
        kind: 'LIVE',
        action: 'ENRICH',
        verb: 'Lengkapi',
        writer,
      });
    } else {
      offers.push({
        subject: 'KDN',
        kind: 'HONEST',
        action: 'CATALOG_NO_WRITER',
        message: KDN_CATALOG_NO_WRITER,
      });
    }
  } else if (catalog && kdn === 'STATED') {
    offers.push({
      subject: 'KDN',
      kind: 'HONEST',
      action: 'NO_SILENT_OVERWRITE',
      message: KDN_NO_SILENT_OVERWRITE,
    });
  }

  if (catalog && input.canReview) {
    offers.push({
      subject: 'PRICE',
      kind: 'LIVE',
      action: 'ROUTE_REVIEW',
      path: CATALOG_REVIEW_PATH,
      verb: 'Ajukan Perubahan',
    });
  }
  if (catalog && input.canPublish) {
    offers.push({
      subject: 'PRICE',
      kind: 'LIVE',
      action: 'ROUTE_PUBLICATION',
      path: CATALOG_PUBLICATION_PATH,
      verb: 'Ajukan Perubahan',
    });
  }
  if (catalog && !input.canReview && !input.canPublish) {
    offers.push({
      subject: 'PRICE',
      kind: 'HONEST',
      action: 'CATALOG_NO_AUTHORITY',
      message: PRICE_CATALOG_NO_AUTHORITY,
    });
  }
  if (privateAsset && input.canSubmit) {
    offers.push({
      subject: 'PRICE',
      kind: 'LIVE',
      action: 'OBSERVE_PRIVATE',
      verb: 'Ajukan Perubahan',
      writer: 'observePrivatePrice',
    });
    offers.push({
      subject: 'PRICE',
      kind: 'LIVE',
      action: 'CORRECT_PRIVATE',
      verb: 'Ajukan Perubahan',
      writer: 'correctPrivatePrice',
    });
  } else if (privateAsset) {
    offers.push({
      subject: 'PRICE',
      kind: 'HONEST',
      action: 'PRIVATE_NO_AUTHORITY',
      message: PRICE_PRIVATE_NO_AUTHORITY,
    });
  }

  if (privateAsset && input.alreadyProposed) {
    offers.push({
      subject: 'PROPOSAL',
      kind: 'HONEST',
      action: 'ALREADY_PROPOSED',
      message: PROPOSAL_ALREADY_SENT,
    });
  } else if (privateAsset && input.canSubmit && input.sourceOrigin) {
    const family = sourceFamilyOfOrigin(
      input.sourceOrigin as PriceSourceOrigin,
    );
    if (family && familyOffersCommunityCuration(family)) {
      offers.push({
        subject: 'PROPOSAL',
        kind: 'LIVE',
        action: 'PROPOSE_PRIVATE',
        verb: 'Usulkan ke SIMPROK',
        writer: 'submitPrivatePrice',
      });
    } else if (family) {
      offers.push({
        subject: 'PROPOSAL',
        kind: 'HONEST',
        action: 'FAMILY_NOT_ROUTED',
        message: PROPOSAL_FAMILY_NOT_ROUTED,
      });
    }
  } else if (privateAsset && !input.canSubmit) {
    offers.push({
      subject: 'PROPOSAL',
      kind: 'HONEST',
      action: 'PRIVATE_NO_AUTHORITY',
      message: PROPOSAL_PRIVATE_NO_AUTHORITY,
    });
  }

  return offers;
}

export function detailChangeDoorVisible(
  offers: readonly DetailSubjectOffer[],
): boolean {
  return offers.some(
    (offer) => offer.kind === 'LIVE' || offer.kind === 'HONEST',
  );
}

export function expectedKdnMatchesStored(
  expected: string | null | undefined,
  stored: string | null,
): boolean {
  if (expected === undefined) return true;
  const left = expected === null || expected === '' ? null : expected;
  return left === stored;
}

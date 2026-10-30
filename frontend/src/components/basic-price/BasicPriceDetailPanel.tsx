import { useState } from 'react';
import { previewCatalogNameImpact, correctActiveResourceCatalogName, type CatalogNameImpact } from '../../api/basicPriceExplorer';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { enrichBasicPriceKdn, enrichCatalogBasicPriceKdn, correctPrivateBasicPrice, observePrivateBasicPrice, observePrivateKdn, correctPrivateKdn, submitPrivateBasicPrice, ImportRequestError, type PriceSourceOrigin } from '../../api/basicPriceImport';
import { useAuth } from '../../contexts/AuthContext';
import {
  cakupanLabel,
  effectiveDateProvenanceLabel,
  EVIDENCE_FILE_RETAINED_NOTE,
  explorerSourceNameLabel,
  explorerVerifiedUnitLabel,
  formatExplorerPrice,
  kdnLabel,
  observationBasisLabel,
  basicPriceRegionLabel,
  privateProposalIsNotPublication,
  resourceLabel,
  resourceTypeLabel,
  sourceOriginLabel,
  sourceTypeLabel,
  type BasicPriceExplorerItem,
} from '../../utils/basicPriceExplorerDisplay';
import {
  BASIC_PRICE_IMPORT_PATH,
  DETAIL_CHANGE_DOOR_LABEL,
  DOCUMENTARY_INTAKE_NOTE,
  EVIDENCE_BASIS_DOCUMENT,
  EVIDENCE_BASIS_FIELD,
  EVIDENCE_BASIS_QUESTION,
  FIELD_REPORTED_SOURCE_NAME_LABEL,
  FIELD_REPORTED_SOURCE_ORIGIN_LABEL,
  DIFFERENT_SOURCE_IDENTITY_CONFLICT_NOTE,
  DIFFERENT_SOURCE_ORIGIN_REQUIRED_NOTE,
  OBSERVATION_SOURCE_ORIGIN_OPTIONS,
  KDN_CHANGE_HELP,
  KDN_CHANGE_QUESTION,
  KDN_CHOICE_CORRECTION,
  KDN_CHOICE_NEW_OBSERVATION,
  KDN_COMPLETION_CATALOG_NOTE,
  KDN_COMPLETION_HELP,
  KDN_USER_REPORTED_NOTE,
  PRICE_CHANGE_QUESTION,
  PRICE_CHOICE_CORRECTION,
  PRICE_CHOICE_CORRECTION_HELP,
  PRICE_CHOICE_NEW_OBSERVATION,
  PRICE_CHOICE_NEW_OBSERVATION_HELP,
  PRICE_CORRECTION_HELP,
  PRICE_NEW_OBSERVATION_HELP,
  SOURCE_STILL_SAME_NO,
  SOURCE_STILL_SAME_QUESTION,
  SOURCE_STILL_SAME_YES,
  detailChangeDoorLive,
  detailSubjectOffers,
  kdnCompletionDoor,
  kdnEnrichmentRefusalLabel,
  PROPOSAL_ALREADY_SENT,
  PROPOSAL_FAMILY_NOT_ROUTED,
  priceCorrectionRefusalLabel,
  priceRouteLabel,
  isGenuinelyDifferentSourceIdentity,
  type DetailChangeIntent,
  type DetailSubjectOffer,
} from '../../utils/basicPriceDetailChange';
import {
  FRESHNESS_VIEW_LABELS,
  freshnessMeaning,
  freshnessView,
  type TemporalContext,
} from '../../utils/basicPriceFreshness';
import { forgetBasicPriceDetail, useBasicPriceDetail } from './useBasicPriceDetail';
import { submissionStatusLabel } from '../../utils/basicPriceWorkflowDisplay';

interface BasicPriceDetailPanelProps {
  item: BasicPriceExplorerItem;
  formatDate: (iso: string) => string;
  onClose: () => void;
  temporal: TemporalContext;
  onCurrentChanged?: (successorId: string, notice?: string) => void;
  /** Truthful after-save sentence. Empty/null means nothing to announce. */
  notice?: string | null;
  onSavedNotice?: (notice: string) => void;
}

type TabKey = 'RINGKASAN' | 'SUMBER' | 'RIWAYAT';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'RINGKASAN', label: 'Ringkasan' },
  { key: 'SUMBER', label: 'Sumber & Bukti' },
  { key: 'RIWAYAT', label: 'Riwayat' },
];

/** Display a server-recorded INSTANT in the reader's local calendar zone.
 * Unlike effectiveDate (a UTC-encoded business date), recordedAt represents
 * the moment the update/correction was saved and must not be UTC-sliced.
 */
function formatPriceEventDate(iso: string): string {
  const recordedAt = new Date(iso);
  if (Number.isNaN(recordedAt.getTime())) return 'Tanggal belum tersedia';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(recordedAt);
}

/**
 * BP-UX-FINAL-01C §10/§12 — BASIC PRICE DETAIL, LAYERED AND HONEST.
 *
 * WHY THIS IS A PANEL AND NOT A ROUTE, WHICH REMAINS A DELIBERATE DECISION.
 * A `/basic-price/:id` route needs a read that serves a COLD DEEP LINK. The
 * detail projection now exists, so that route is buildable — but it is a
 * NAVIGATION change, not a truth change, and this mission is the truth one.
 * Detail therefore still opens in place, over the row's own canonical
 * projection, and is ENRICHED by the lawful detail read rather than replaced
 * by it. Ringkasan renders instantly from the row; nothing waits on a request
 * that only the deeper tabs need.
 *
 * WHAT CHANGED HERE, AND WHY IT HAD TO.
 *
 * This panel used to state, on every row, that the original upload was stored
 * and linked to this price's import batch. Nothing in the payload proved that.
 * 01C gated it on `evidence.importBatchLinked`; 01D found that still too
 * strong, because a RELATION to an import batch proves nothing about whether
 * that batch's file survives. Linkage and retention are now two facts, each
 * with its own sentence, and the strongest sentence is reachable only through
 * `evidence.originalFileRetained`.
 *
 * The Riwayat tab shows the REAL persisted lineage — and calls it RIWAYAT
 * KOREKSI, because `supersedesBasicPriceId` records corrections and nothing
 * else. A one-entry lineage now says only that this price has never been
 * corrected, and no longer claims no earlier price exists.
 *
 * RICH INSIDE, SIMPLE OUTSIDE. First read is Ringkasan and nothing else: eight
 * facts a site engineer can act on. Provenance, curation family and tenancy
 * live one tab across; nothing anywhere prints a UUID, a raw enum or an audit
 * payload.
 */
export function BasicPriceDetailPanel({
  item,
  formatDate,
  onClose,
  temporal,
  onCurrentChanged,
  notice,
  onSavedNotice,
}: BasicPriceDetailPanelProps) {
  const [tab, setTab] = useState<TabKey>('RINGKASAN');
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(5);
  const [detailEpoch, setDetailEpoch] = useState(0);
  const [changeOpen, setChangeOpen] = useState(false);
  const [alreadyProposed, setAlreadyProposed] = useState(false);
  const [nameImpactOpen, setNameImpactOpen] = useState(false);
  const [nameProposal, setNameProposal] = useState(item.resource.name);
  const [nameImpactBusy, setNameImpactBusy] = useState(false);
  const [nameImpactResult, setNameImpactResult] = useState<CatalogNameImpact | null>(null);
  const [nameImpactError, setNameImpactError] = useState<string | null>(null);
  const [nameCorrectionReason, setNameCorrectionReason] = useState('');
  const [nameCorrectionEvidence, setNameCorrectionEvidence] = useState('');
  const [nameCorrectionConfirmed, setNameCorrectionConfirmed] = useState(false);
  const [nomenclatureVerified, setNomenclatureVerified] = useState(false);
  const [confirmedCatalogCode, setConfirmedCatalogCode] = useState('');
  const [confirmedCatalogName, setConfirmedCatalogName] = useState('');
  const [confirmedCatalogBaseUnit, setConfirmedCatalogBaseUnit] = useState('');
  const [nameSourceReference, setNameSourceReference] = useState('');
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const detail = useBasicPriceDetail(
    item.basicPriceId, detailEpoch,
    temporal.mode === 'AS_OF' ? temporal.instant.toISOString().slice(0, 10) : undefined,
  );
  const kdnPercent =
    detail.kind === 'ready' ? detail.detail.domesticContent.kdnPercent : undefined;
  const completionDoor = kdnCompletionDoor({
    detailReady: detail.kind === 'ready',
    kdnPercent,
    assetScope: item.assetScope,
    workspaceScope: item.workspaceScope,
    canSubmit: hasPermission('BASIC_PRICE_SUBMIT'),
    canVerify: hasPermission('BASIC_PRICE_VERIFY'),
    canPromoteShared: hasPermission('BASIC_PRICE_PROMOTE_SHARED'),
  });
  const changeOffers = detailSubjectOffers({
    detailReady: detail.kind === 'ready',
    kdnPercent,
    assetScope: item.assetScope,
    workspaceScope: item.workspaceScope,
    canSubmit: hasPermission('BASIC_PRICE_SUBMIT'),
    canReview: hasPermission('BASIC_PRICE_REVIEW_VIEW'),
    canPublish: hasPermission('BASIC_PRICE_PUBLISH'),
    canVerify: hasPermission('BASIC_PRICE_VERIFY'),
    canPromoteShared: hasPermission('BASIC_PRICE_PROMOTE_SHARED'),
    sourceOrigin: item.sourceOrigin,
    alreadyProposed: alreadyProposed || detail.kind !== 'ready' || detail.detail.price.alreadyProposed !== false,
  });
  const changeDoorLive = detailChangeDoorLive(changeOffers);
  const freshness = FRESHNESS_VIEW_LABELS[freshnessView(item)];
  /*
   * Status uses the SAME temporal lens the Explorer list used for these rows.
   * The short label stays on the Fact; the lens-bound sentence sits under it.
   */
  const statusMeaning = freshnessMeaning(item, temporal, formatDate);

  const evidence = detail.kind === 'ready' ? detail.detail.evidence : null;
  // The Backend owns both event membership and wording. No client-side
  // source pairing, price sorting, or guessed observation classification.
  const priceHistory = detail.kind === 'ready' ? detail.detail.priceHistory : null;
  const derivationLabel = effectiveDateProvenanceLabel(
    evidence?.effectiveDateProvenance,
  );

  return (
    <section className="bp-detail" aria-label={`Detail harga ${resourceLabel(item.resource)}`}>
      <div className="bp-detail__head">
        <div>
          <div className="bp-detail__name">{resourceLabel(item.resource)}</div>
          <div className="bp-detail__meta">
            {resourceTypeLabel(item.resource.type)} · {basicPriceRegionLabel(item)}
          </div>
        </div>
        <div className="bp-detail__head-actions">
          {alreadyProposed || (detail.kind === 'ready' && detail.detail.price.alreadyProposed === true) ? (
            <p className="bp-field__help" role="status" aria-live="polite">
              {PROPOSAL_ALREADY_SENT}
              {detail.kind === 'ready' && detail.detail.proposalStatus
                ? ` Status usulan: ${submissionStatusLabel(detail.detail.proposalStatus)}.`
                : ' Status terbaru belum tersedia; muat ulang Detail Harga.'}
            </p>
          ) : detail.kind === 'ready' &&
            detail.detail.price.alreadyProposed === false &&
            changeOffers.some(
              (offer) =>
                offer.subject === 'PROPOSAL' &&
                offer.kind === 'LIVE' &&
                offer.action === 'PROPOSE_PRIVATE',
            ) ? (
            <PrivateProposalButton
              basicPriceId={item.basicPriceId}
              onProposed={() => {
                setAlreadyProposed(true);
                setDetailEpoch((epoch) => epoch + 1);
              }}
            />
          ) : null}
          {detail.kind === 'ready' && changeOffers.length > 0 ? (
            <button
              type="button"
              className={
                changeDoorLive
                  ? 'bp-btn bp-btn--primary bp-btn--sm'
                  : 'bp-btn bp-btn--sm'
              }
              aria-expanded={changeOpen}
              onClick={() => setChangeOpen((open) => !open)}
            >
              {DETAIL_CHANGE_DOOR_LABEL}
            </button>
          ) : null}
          <button type="button" className="bp-btn bp-btn--sm" onClick={onClose} title="Tutup detail">
            <X size={14} /> Tutup
          </button>
        </div>
      </div>

      {notice ? (
        <p className="bp-note bp-note--info" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div className="bp-tabs" role="tablist" aria-label="Bagian detail harga">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`bp-tab-${entry.key}`}
            aria-selected={tab === entry.key}
            aria-controls={`bp-tabpanel-${entry.key}`}
            className="bp-tab"
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {changeOpen && detail.kind === 'ready' ? (
        <DetailChangeSheet
          offers={changeOffers}
          completionDoor={completionDoor}
          basicPriceId={item.basicPriceId}
          expectedKdnPercent={kdnPercent ?? null}
          expectedValue={item.price}
          sourceName={item.sourceName}
          onRoute={(path) => navigate(path)}
          onCompleted={() => {
            forgetBasicPriceDetail(item.basicPriceId);
            setDetailEpoch((current) => current + 1);
            setChangeOpen(false);
            onSavedNotice?.('Data opsional berhasil disimpan.');
          }}
          onCurrentChanged={(successorId) => {
            forgetBasicPriceDetail(item.basicPriceId);
            setChangeOpen(false);
            onCurrentChanged?.(successorId, 'Perubahan harga berhasil disimpan.');
          }}
          onDismiss={() => setChangeOpen(false)}
        />
      ) : null}

      {tab === 'RINGKASAN' ? (
        <div
          className="bp-tabpanel"
          role="tabpanel"
          id="bp-tabpanel-RINGKASAN"
          aria-labelledby="bp-tab-RINGKASAN"
        >
          <dl className="bp-facts">
            <Fact label="Harga" value={formatExplorerPrice(item.price)} variant="price" />
            <Fact label="Satuan" value={explorerVerifiedUnitLabel(item.resource)} />
            {item.resource.displayUnit !== undefined && item.resource.baseUnit !== item.resource.displayUnit ? (
              <Fact label="Satuan katalog asal" value={item.resource.baseUnit} />
            ) : null}
            <Fact label="Kategori" value={resourceTypeLabel(item.resource.type)} />
            <Fact label="Wilayah" value={basicPriceRegionLabel(item)} />
            <Fact label="Sumber" value={explorerSourceNameLabel(item.sourceName)} />
            {/*
              KDN — THIS PRICE OBSERVATION's domestic-content fact (Owner Lock).

              NOT TKDN: that is the RAB/Project aggregate and nothing on this
              screen computes it. Two observations of one ResourceCatalog may
              lawfully carry different %KDN. Three states, three answers —
              pending, stated, and unstated — because an absent %KDN rendered
              as 0% would be a compliance claim SIMPROK was never given. No
              component breakdown is offered: the schema persists none, and
              deriving components backwards from a total would invent the
              evidence.
            */}
            <Fact
              label="KDN (%)"
              value={kdnLabel(
                detail.kind === 'ready'
                  ? detail.detail.domesticContent.kdnPercent
                  : undefined,
              )}
            />
            <Fact label="Status" value={freshness} />
            {statusMeaning ? (
              <p className="bp-field__help" style={{ gridColumn: '1 / -1', margin: 0 }}>
                {statusMeaning.body}
              </p>
            ) : null}
            <Fact label="Berlaku sejak" value={formatDate(item.effectiveDate)} />
            {/*
              TWO DIFFERENT DATES, AND ONLY THE ONE THAT EXISTS IS SHOWN.

              `validUntil` is a HARD boundary a source stated and the Cost
              Kernel enforces. Most prices have none, and rendering "—" there
              would read as a fact SIMPROK failed to fetch rather than a
              boundary the source never set.
            */}
            {item.validUntil ? (
              <Fact label="Berlaku sampai" value={formatDate(item.validUntil)} />
            ) : null}
          </dl>
        </div>
      ) : null}

      {tab === 'SUMBER' ? (
        <div
          className="bp-tabpanel"
          role="tabpanel"
          id="bp-tabpanel-SUMBER"
          aria-labelledby="bp-tab-SUMBER"
        >
          <dl className="bp-facts">
            <Fact label="Nama sumber" value={explorerSourceNameLabel(item.sourceName)} />
            {/*
              SOURCE_TYPE != SOURCE_ORIGIN — Owner law keeps the two axes apart
              (BASIC-PRICE-MASTER-DECISION §10), so they are read back as the
              two separate answers a person gave, never merged into one line.
            */}
            <Fact label="Asal data" value={sourceOriginLabel(item.sourceOrigin)} />
            <Fact label="Metode perolehan" value={sourceTypeLabel(item.sourceType)} />
            {evidence?.observationBasis ? (
              <Fact
                label="Dasar informasi"
                value={observationBasisLabel(evidence.observationBasis)}
              />
            ) : null}
            <Fact label="Cakupan" value={cakupanLabel(item)} />
            <Fact label="Tanggal harga" value={formatDate(item.effectiveDate)} />
            {/*
              RM-03D1 — the source's own period wording, verbatim, and whether
              SIMPROK was TOLD the effective date or DERIVED it. Both appear
              only when the payload actually carries them; an unrecognised
              provenance code renders nothing rather than an enum.
            */}
            {evidence?.sourcePeriodLabel ? (
              <Fact label="Periode sumber" value={evidence.sourcePeriodLabel} />
            ) : null}
            {derivationLabel ? (
              <Fact label="Asal tanggal berlaku" value={derivationLabel} />
            ) : null}
            {evidence?.kdnSourceSummary ? (
              <Fact label="Asal KDN" value={evidence.kdnSourceSummary} />
            ) : null}
            {/*
              SOFT ADVICE, NEVER A BOUNDARY. It sits here, beside the source
              that anchored it, rather than next to `validUntil` where the two
              would be read as one shrinking window.
            */}
            {item.reviewDate ? (
              <Fact label="Verifikasi ulang pada" value={formatDate(item.reviewDate)} />
            ) : null}
          </dl>

          {/* BP-C3 — catalog name impact preview only, NOT a false Edit writer. */}
          <div className="bp-note" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="bp-btn bp-btn--secondary"
              onClick={() => {
                setNameImpactOpen((open) => !open);
                setNameImpactResult(null);
                setNameImpactError(null);
              }}
              aria-expanded={nameImpactOpen}
            >
              {nameImpactOpen ? 'Tutup pemeriksaan nama' : 'Periksa usulan nama baku'}
            </button>
            {nameImpactOpen ? (
              <div style={{ paddingTop: 10 }}>
                <label className="bp-field">
                  <span className="bp-field__label">Usulan nama yang benar untuk katalog ini</span>
                  <input
                    className="bp-input"
                    value={nameProposal}
                    maxLength={180}
                    onChange={(event) => {
                      setNameProposal(event.target.value);
                      setNameImpactResult(null);
                      setNameImpactError(null);
                      setNameCorrectionConfirmed(false);
                      setNomenclatureVerified(false);
                    }}
                  />
                </label>
                <p className="bp-field__help">Pemeriksaan hanya membaca dampak nama pada katalog yang sudah aktif. Identitas, harga, satuan, dan catatan sumber tidak berubah.</p>
                <button
                  type="button"
                  className="bp-btn bp-btn--primary"
                  disabled={nameImpactBusy || nameProposal.trim().length < 3}
                  onClick={async () => {
                    setNameImpactBusy(true);
                    setNameImpactError(null);
                    setNameImpactResult(null);
                    try {
                      const outcome = await previewCatalogNameImpact(item.resource.id, nameProposal);
                      setNameImpactResult(outcome);
                    } catch {
                      setNameImpactError('Dampak belum dapat diperiksa. Tidak ada perubahan data.');
                    } finally {
                      setNameImpactBusy(false);
                    }
                  }}
                >
                  {nameImpactBusy ? 'Memeriksa...' : 'Periksa dampak, tanpa menyimpan'}
                </button>
                {nameImpactError ? <p role="alert" className="bp-field__help">{nameImpactError}</p> : null}
                {nameImpactResult ? (
                  <div className="bp-note" role="status" aria-live="polite" style={{ marginTop: 10 }}>
                    <p><strong>Nama katalog saat ini:</strong> <code style={{ whiteSpace: 'pre-wrap' }}>{nameImpactResult.currentName}</code></p>
                    <p><strong>Nama yang diusulkan:</strong> <code style={{ whiteSpace: 'pre-wrap' }}>{nameImpactResult.proposedName}</code></p>
                    <p className="bp-field__help">Spasi asli dipertahankan di atas agar perbedaan penulisan terlihat sebelum keputusan.</p>
                    <p>
                      {nameImpactResult.verdict === 'SPELLING_ONLY_PREVIEW'
                        ? 'Indikasi koreksi penulisan tanpa perubahan makna; tetap memerlukan otorisasi dan jurnal koreksi.'
                        : nameImpactResult.verdict === 'NO_CHANGE'
                          ? 'Tidak ada perubahan nama yang diajukan.'
                          : nameImpactResult.verdict === 'IDENTITY_CONFLICT_REVIEW_REQUIRED'
                            ? 'Terdapat nama serupa pada identitas katalog lain. Perlu adjudikasi identitas.'
                            : nameImpactResult.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED'
                              ? 'Penulisan istilah berbeda. Ini dapat berupa salah tulis (misalnya TC → Ton), BUKAN berarti kedua istilah sinonim. Kurator perlu mendokumentasikan dasar koreksi nama pada item yang sama.'
                              : 'Perubahan ini dapat mengubah mutu, kapasitas, atau identitas. Tidak boleh diproses sebagai koreksi nama.'}
                    </p>
                    <p>Jenis: {resourceTypeLabel(nameImpactResult.resourceType as typeof item.resource.type)} · Kode: {nameImpactResult.resourceCode ?? 'Tidak ditetapkan'} · Satuan: {nameImpactResult.baseUnit}</p>
                    {(nameImpactResult.specificationFacts?.length ?? 0) > 0 ? (
                      <p>Spesifikasi katalog: {nameImpactResult.specificationFacts.map((entry) => entry.name + ': ' + entry.value).join(' · ')}</p>
                    ) : (
                      <p className="bp-field__help">Tidak ada spesifikasi terverifikasi yang dapat ditampilkan. Cocokkan identitas dengan bukti sumber sebelum memutuskan.</p>
                    )}
                    <p>Dipakai oleh {nameImpactResult.impact.basicPrices} Basic Price, {nameImpactResult.impact.projectAhspResolutions} resolusi AHSP proyek, {nameImpactResult.impact.importRows} baris impor, {nameImpactResult.impact.sourceIdentityRecords} catatan sumber, dan {nameImpactResult.impact.conversionRules} aturan konversi.</p>
                    <p className="bp-field__help">Pemeriksaan ini belum menyimpan apa pun. ID resource, satuan, dan seluruh hubungan tetap utuh.</p>
                    {(nameImpactResult.verdict === 'SPELLING_ONLY_PREVIEW' ||
                      nameImpactResult.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED') &&
                      hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE') ? (
                      <div style={{ paddingTop: 10 }}>
                        <p><strong>Koreksi nama katalog — khusus kurator identitas</strong></p>
                        <p className="bp-field__help">Koreksi hanya untuk identitas resource yang SAMA. Angka mutu, kapasitas, jenis dan satuan tidak boleh berubah. Salah tulis seperti TC menjadi Ton bukan penyamaan arti dua istilah; keputusan koreksi harus dapat ditelusuri.</p>
                        {nameImpactResult.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED' ? (
                          <div>
                            <p><strong>Pemeriksaan salah tulis / nomenklatur — keputusan kurator</strong></p>
                            <label className="bp-field">
                              <span className="bp-field__label">Dasar koreksi nama (dokumen atau penetapan Owner/kurator yang nyata)</span>
                              <input className="bp-input" value={nameSourceReference}
                                onChange={(event) => setNameSourceReference(event.target.value)}
                                maxLength={350} placeholder="Mis. Penetapan Owner, 26 Oktober 2026, untuk item E07" />
                            </label>
                            <p className="bp-field__help">
                              Catat keputusan atau referensi yang benar-benar ada, beserta pihak dan tanggalnya. Jangan menyatakan dokumen impor menulis Ton bila sumbernya menulis TC.
                            </p>
                            {nameImpactResult.resourceCode ? (
                              <label className="bp-field">
                                <span className="bp-field__label">Ketik ulang kode katalog untuk memastikan item yang dipilih</span>
                                <input className="bp-input" value={confirmedCatalogCode}
                                  onChange={(event) => setConfirmedCatalogCode(event.target.value)}
                                  placeholder={'Ketik ' + nameImpactResult.resourceCode + ' secara manual'}
                                  maxLength={80} />
                              </label>
                            ) : (
                              <>
                                <p className="bp-field__help">Resource katalog ini tidak memiliki kode. Jangan membuat kode baru; konfirmasikan nama lama dan satuannya.</p>
                                <label className="bp-field">
                                  <span className="bp-field__label">Ketik ulang nama katalog lama ({nameImpactResult.currentName})</span>
                                  <input className="bp-input" value={confirmedCatalogName}
                                    onChange={(event) => setConfirmedCatalogName(event.target.value)} maxLength={180} />
                                </label>
                                <label className="bp-field">
                                  <span className="bp-field__label">Ketik ulang satuan katalog ({nameImpactResult.baseUnit})</span>
                                  <input className="bp-input" value={confirmedCatalogBaseUnit}
                                    onChange={(event) => setConfirmedCatalogBaseUnit(event.target.value)} maxLength={80} />
                                </label>
                              </>
                            )}
                            <p className="bp-field__help" role="status" aria-live="polite">
                              {!nameImpactResult.resourceCode
                                ? confirmedCatalogName.trim() === nameImpactResult.currentName &&
                                  confirmedCatalogBaseUnit.trim() === nameImpactResult.baseUnit
                                  ? 'Nama lama dan satuan katalog cocok. Simpan tetap memerlukan bukti dan keputusan kurator.'
                                  : 'Katalog tanpa kode: ketik ulang nama lama dan satuan persis seperti yang tampil.'
                                : !confirmedCatalogCode.trim()
                                  ? 'Kode katalog belum diisi. Ketik ulang kode yang tampil.'
                                  : confirmedCatalogCode.trim().toLocaleLowerCase('id-ID') !==
                                    nameImpactResult.resourceCode.toLocaleLowerCase('id-ID')
                                    ? 'Kode yang diketik tidak cocok dengan identitas katalog.'
                                    : 'Kode katalog sudah cocok.'}
                            </p>
                            <label className="bp-field">
                              <input type="checkbox" checked={nomenclatureVerified}
                                onChange={(event) => setNomenclatureVerified(event.target.checked)} />
                              <span className="bp-field__label">Saya telah memeriksa dasar koreksi: nama lama salah tulis, nama baru benar untuk resource dan spesifikasi yang sama (bukan klaim kedua istilah sinonim).</span>
                            </label>
                            <p className="bp-field__help">Jangan mengarang isi dokumen sumber: nama asli yang salah tetap disimpan. Cantumkan dasar penetapan yang nyata; jika kesalahan belum dapat dipastikan, jangan simpan.</p>
                          </div>
                        ) : null}
                        <label className="bp-field">
                          <span className="bp-field__label">Alasan koreksi</span>
                          <textarea
                            className="bp-input"
                            value={nameCorrectionReason}
                            maxLength={500}
                            aria-describedby="bp-c3-reason-guidance"
                            onChange={(event) => setNameCorrectionReason(event.target.value)}
                          />
                        </label>
                        <p id="bp-c3-reason-guidance" className="bp-field__help" role="status">
                          {nameCorrectionReason.trim().length < 10
                            ? `Alasan perlu minimal 10 karakter (sekarang ${nameCorrectionReason.trim().length}/10).`
                            : 'Alasan memenuhi panjang minimal.'}
                        </p>
                        <label className="bp-field">
                          <span className="bp-field__label">Bukti bahwa identitas item tetap sama</span>
                          <textarea
                            className="bp-input"
                            value={nameCorrectionEvidence}
                            maxLength={2000}
                            aria-describedby="bp-c3-evidence-guidance"
                            onChange={(event) => setNameCorrectionEvidence(event.target.value)}
                          />
                        </label>
                        <p id="bp-c3-evidence-guidance" className="bp-field__help" role="status">
                          {nameCorrectionEvidence.trim().length < 20
                            ? `Bukti perlu minimal 20 karakter (sekarang ${nameCorrectionEvidence.trim().length}/20). Jelaskan fakta yang menunjukkan resource dan spesifikasinya tetap sama.`
                            : 'Panjang bukti memenuhi syarat; pastikan bukti faktual dan benar.'}
                        </p>
                        <label className="bp-field">
                          <input
                            type="checkbox"
                            checked={nameCorrectionConfirmed}
                            onChange={(event) => setNameCorrectionConfirmed(event.target.checked)}
                          />
                          <span className="bp-field__label">Saya sudah memeriksa spesifikasi dan memastikan ini resource yang sama.</span>
                        </label>
                        <p className="bp-field__help" aria-live="polite">
                          {nameImpactResult.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED' &&
                            !(nameImpactResult.resourceCode
                              ? confirmedCatalogCode.trim().toLocaleLowerCase('id-ID') === nameImpactResult.resourceCode.toLocaleLowerCase('id-ID')
                              : confirmedCatalogName.trim() === nameImpactResult.currentName &&
                                confirmedCatalogBaseUnit.trim() === nameImpactResult.baseUnit)
                              ? 'Simpan belum aktif: pastikan kode katalog, atau untuk katalog tanpa kode, nama lama dan satuan persis sesuai data.'
                              : nameImpactResult.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED' &&
                                nameSourceReference.trim().length < 12
                                ? 'Simpan belum aktif: lengkapi dasar koreksi yang nyata (minimal 12 karakter).'
                                : nameImpactResult.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED' && !nomenclatureVerified
                                  ? 'Simpan belum aktif: konfirmasikan keputusan kurator mengenai salah tulis.'
                                  : !nameCorrectionConfirmed
                              ? 'Simpan belum aktif: konfirmasikan bahwa identitas dan spesifikasi resource tetap sama.'
                            : nameCorrectionReason.trim().length < 10
                              ? 'Simpan belum aktif: lengkapi alasan koreksi.'
                              : nameCorrectionEvidence.trim().length < 20
                                ? 'Simpan belum aktif: lengkapi bukti identitas minimal 20 karakter.'
                                : 'Persyaratan isian terpenuhi. Simpan akan memverifikasi ulang izin, identitas, versi data, dan jurnal audit.'}
                        </p>
                        <button
                          type="button"
                          className="bp-btn bp-btn--primary"
                          disabled={nameImpactBusy ||
                            !nameCorrectionConfirmed ||
                            nameCorrectionReason.trim().length < 10 ||
                            nameCorrectionEvidence.trim().length < 20 ||
                            (nameImpactResult.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED' &&
                              (!nomenclatureVerified ||
                               nameSourceReference.trim().length < 12 ||
                               !(nameImpactResult.resourceCode
                                 ? confirmedCatalogCode.trim().toLocaleLowerCase('id-ID') === nameImpactResult.resourceCode.toLocaleLowerCase('id-ID')
                                 : confirmedCatalogName.trim() === nameImpactResult.currentName &&
                                   confirmedCatalogBaseUnit.trim() === nameImpactResult.baseUnit)))}
                          onClick={async () => {
                            setNameImpactBusy(true);
                            setNameImpactError(null);
                            try {
                              await correctActiveResourceCatalogName(item.resource.id, {
                                previousName: nameImpactResult.currentName,
                                correctedName: nameImpactResult.proposedName,
                                expectedUpdatedAt: nameImpactResult.observedVersion,
                                reason: nameCorrectionReason,
                                evidence: nameCorrectionEvidence,
                                sameIdentityConfirmed: true,
                                nomenclatureVerified: nameImpactResult.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED' && nomenclatureVerified,
                                confirmedCatalogCode: nameImpactResult.resourceCode ? confirmedCatalogCode.trim() : undefined,
                                confirmedCatalogName: !nameImpactResult.resourceCode ? confirmedCatalogName.trim() : undefined,
                                confirmedCatalogBaseUnit: !nameImpactResult.resourceCode ? confirmedCatalogBaseUnit.trim() : undefined,
                                sourceReference: nameSourceReference.trim(),
                              });
                              setNameImpactOpen(false);
                              setNameImpactResult(null);
                              setNameCorrectionConfirmed(false);
                              onCurrentChanged?.(item.basicPriceId, 'Nama katalog berhasil dikoreksi; identitas, satuan dan harga tetap.');
                            } catch {
                              setNameImpactError('Koreksi ditolak atau kondisi katalog sudah berubah. Periksa dampak ulang; tidak ada penyimpanan sebagian.');
                              setNameImpactResult(null);
                              setNameCorrectionConfirmed(false);
                            } finally {
                              setNameImpactBusy(false);
                            }
                          }}
                        >
                          {nameImpactBusy ? 'Menyimpan koreksi...' : 'Konfirmasi & Simpan Koreksi Nama'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/*
            GAP-B — THREE SENTENCES, EACH GATED ON THE FACT THAT PROVES IT.

            This panel once printed "Bukti unggahan asli tersimpan di SIMPROK
            dan tertaut pada batch impor harga ini" unconditionally, for every
            row. 01C gated it on `importBatchLinked` — better, but still an
            overclaim: a RELATION to an import batch says nothing about whether
            that batch's file survives. `sourceStorageRef` is null for every
            batch imported before bytes were retained, so linkage could never
            have implied storage.

            The two facts are now separate, and each sentence says only what
            its own fact proves. The strongest one is reachable only through
            `originalFileRetained`.
          */}
          <p className="bp-field__help" style={{ marginTop: '12px' }}>
            {detail.kind === 'loading'
              ? 'Memeriksa ketertelusuran bukti...'
              : evidence?.originalFileRetained
                ? EVIDENCE_FILE_RETAINED_NOTE
                : evidence?.importBatchLinked
                  ? 'Harga ini tertaut pada catatan impor di SIMPROK. Berkas unggahan aslinya tidak tercatat tersimpan.'
                  : detail.kind === 'ready'
                    ? 'SIMPROK tidak memiliki tautan bukti unggahan untuk harga ini. Identitas sumber di atas adalah yang tercatat.'
                    : 'Ketertelusuran bukti belum dapat diperiksa. Coba buka kembali sebentar lagi.'}
          </p>
        </div>
      ) : null}

      {tab === 'RIWAYAT' ? (
        <div
          className="bp-tabpanel"
          role="tabpanel"
          id="bp-tabpanel-RIWAYAT"
          aria-labelledby="bp-tab-RIWAYAT"
        >
          {/*
            BP-HISTORY-ONE-TRUTH. This panel only FORMATS Backend decisions:
            price, Terkini, Diperbarui, Dikoreksi, Harga Awal, source and order
            are ALL selected by canonical Backend readback. No browser pairing.
          */}
          <span className="bp-pop__label">Riwayat Harga</span>
          {priceHistory ? (
            <>
              <div className="bp-history" style={{ marginBottom: '12px' }}>
                {priceHistory.entries.slice(0, visibleHistoryCount).map((entry, index) => (
                  <div className="bp-history__row bp-history__row--events" key={`price-event-${index}`}>
                    <span className="bp-history__price">{formatExplorerPrice(entry.price)}</span>
                    {entry.isCurrent ? (
                      <span className="bp-history__tag">{entry.changeLabel}</span>
                    ) : null}
                    <span className="bp-history__date">
                      {entry.actionLabel === 'Harga Awal'
                        ? 'Harga Awal'
                        : entry.actionLabel
                          ? `${entry.actionLabel} · ${formatPriceEventDate(entry.recordedAt)}`
                          : 'Riwayat belum lengkap'}
                    </span>
                    <span className="bp-history__date">
                      Sumber: {entry.sourceName ?? 'Belum tercatat'}
                    </span>
                  </div>
                ))}
              </div>
              {visibleHistoryCount < priceHistory.entries.length ? (
                <button
                  type="button"
                  className="bp-btn bp-btn--sm"
                  onClick={() => setVisibleHistoryCount((count) => count + 5)}
                >
                  Lihat riwayat lainnya
                </button>
              ) : null}
              {priceHistory.truncated ? (
                <p className="bp-field__help" role="status">
                  Sebagian riwayat belum dapat dibuktikan lengkap dari sumber canonical.
                </p>
              ) : null}
            </>
          ) : detail.kind === 'loading' ? (
            <p className="bp-field__help" role="status">Memuat riwayat harga...</p>
          ) : (
            <p className="bp-field__help" role="status">
              Riwayat harga lengkap belum tersedia dari Backend.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function DetailChangeSheet({
  offers,
  completionDoor,
  basicPriceId,
  expectedKdnPercent,
  expectedValue,
  sourceName,
  onRoute,
  onCompleted,
  onCurrentChanged,
  onDismiss,
}: {
  offers: DetailSubjectOffer[];
  completionDoor: ReturnType<typeof kdnCompletionDoor>;
  basicPriceId: string;
  expectedKdnPercent: string | null;
  expectedValue: string;
  sourceName: string | null;
  onRoute: (path: string) => void;
  onCompleted: () => void;
  onCurrentChanged: (successorId: string) => void;
  onDismiss: () => void;
}) {
  const liveKdnEnrich = offers.find(
    (
      offer,
    ): offer is Extract<
      DetailSubjectOffer,
      { subject: 'KDN'; kind: 'LIVE'; action: 'ENRICH' }
    > =>
      offer.subject === 'KDN' && offer.kind === 'LIVE' && offer.action === 'ENRICH',
  );
  const livePrivateKdnChange = offers.some(
    (offer) =>
      offer.subject === 'KDN' &&
      offer.kind === 'LIVE' &&
      (offer.action === 'OBSERVE_PRIVATE' || offer.action === 'CORRECT_PRIVATE'),
  );
  const livePrivatePriceChange = offers.some(
    (offer) =>
      offer.subject === 'PRICE' &&
      offer.kind === 'LIVE' &&
      (offer.action === 'OBSERVE_PRIVATE' || offer.action === 'CORRECT_PRIVATE'),
  );
  const liveCatalogPrices = offers.filter(
    (
      offer,
    ): offer is Extract<
      DetailSubjectOffer,
      { subject: 'PRICE'; kind: 'LIVE'; action: 'ROUTE_REVIEW' | 'ROUTE_PUBLICATION' }
    > =>
      offer.subject === 'PRICE' &&
      offer.kind === 'LIVE' &&
      (offer.action === 'ROUTE_REVIEW' || offer.action === 'ROUTE_PUBLICATION'),
  );
  const honest = offers.filter((offer) => {
    if (offer.kind !== 'HONEST') return false;
    if (offer.subject === 'KDN' && offer.action === 'CATALOG_NO_WRITER') {
      return false;
    }
    return true;
  });

  return (
    <div
      className="bp-detail-sheet"
      role="dialog"
      aria-label={DETAIL_CHANGE_DOOR_LABEL}
    >
      <div className="bp-detail-sheet__head">
        <span className="bp-detail-sheet__title">{DETAIL_CHANGE_DOOR_LABEL}</span>
        <button type="button" className="bp-btn bp-btn--sm" onClick={onDismiss}>
          Tutup
        </button>
      </div>
      {liveKdnEnrich ? (
        <KdnCompletionForm
          basicPriceId={basicPriceId}
          expectedKdnPercent={expectedKdnPercent}
          writer={liveKdnEnrich.writer}
          onCompleted={onCompleted}
        />
      ) : null}
      {livePrivateKdnChange && expectedKdnPercent !== null ? (
        <PrivateKdnChangeForm
          basicPriceId={basicPriceId}
          expectedValue={expectedValue}
          expectedKdnPercent={expectedKdnPercent}
          onCurrentChanged={onCurrentChanged}
        />
      ) : null}
      {completionDoor.kind === 'HONEST' ? (
        <p className="bp-field__help">{KDN_COMPLETION_CATALOG_NOTE}</p>
      ) : null}
      {livePrivatePriceChange ? (
        <PrivatePriceChangeForm
          basicPriceId={basicPriceId}
          expectedValue={expectedValue}
          sourceName={sourceName}
          onRoute={onRoute}
          onCurrentChanged={onCurrentChanged}
        />
      ) : null}
      {liveCatalogPrices.length > 0 ? (
        <div className="bp-detail-sheet__actions">
          {liveCatalogPrices.map((offer) => (
            <button
              key={offer.action}
              type="button"
              className="bp-btn bp-btn--primary bp-btn--sm"
              onClick={() => onRoute(offer.path)}
            >
              {priceRouteLabel(offer.action)}
            </button>
          ))}
          <p className="bp-field__help">
            Perubahan harga katalog ditinjau di ruang Pengajuan atau Penerbitan,
            bukan ditimpa di layar ini.
          </p>
        </div>
      ) : null}
      {honest.map((offer) => (
        <p className="bp-field__help" key={`${offer.subject}-${offer.kind}`}>
          {offer.kind === 'HONEST' ? offer.message : null}
        </p>
      ))}
    </div>
  );
}

function PrivateProposalButton({
  basicPriceId,
  onProposed,
}: {
  basicPriceId: string;
  onProposed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const handleSubmit = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const result = await submitPrivateBasicPrice(basicPriceId);
      if (!privateProposalIsNotPublication(result)) {
        setRefusal('Usulan tidak boleh menerbitkan harga secara otomatis.');
        return;
      }
      onProposed();
    } catch (error) {
      if (error instanceof ImportRequestError) {
        setRefusal(privateProposalRefusalLabel(error.httpStatus, error.detail));
      } else {
        setRefusal(privateProposalRefusalLabel(0, ''));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        className="bp-btn bp-btn--sm"
        disabled={busy}
        aria-disabled={busy}
        onClick={() => void handleSubmit()}
        title="Usulkan harga ini ke SIMPROK tanpa mengubahnya menjadi harga terbit"
      >
        Usulkan ke SIMPROK
      </button>
      {refusal ? (
        <p className="bp-field__help" role="status">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}

function privateProposalRefusalLabel(status: number, detail: string): string {
  if (status === 409 && /ALREADY|ROW_ALREADY_SUBMITTED/u.test(detail)) {
    return PROPOSAL_ALREADY_SENT;
  }
  if (status === 409 && /SOURCE_FAMILY_NOT_ROUTED/u.test(detail)) {
    return PROPOSAL_FAMILY_NOT_ROUTED;
  }
  if (status === 409 && /PRICE_NO_LONGER_CURRENT/u.test(detail)) {
    return 'Harga ini sudah dikoreksi. Tinjau versi terbaru sebelum mengusulkan.';
  }
  if (status === 403 || status === 404) {
    return 'Harga ini tidak dapat diusulkan dari ruang kerja Anda.';
  }
  return 'Usulan ke SIMPROK belum berhasil. Coba lagi.';
}

function KdnCompletionForm({
  basicPriceId,
  expectedKdnPercent,
  writer,
  onCompleted,
}: {
  basicPriceId: string;
  expectedKdnPercent: string | null;
  writer: 'enrichKdn' | 'enrichCatalogKdn';
  onCompleted: () => void;
}) {
  const [kdnPercent, setKdnPercent] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const enrich =
        writer === 'enrichCatalogKdn'
          ? enrichCatalogBasicPriceKdn
          : enrichBasicPriceKdn;
      await enrich(basicPriceId, kdnPercent, reason, expectedKdnPercent);
      onCompleted();
    } catch (error) {
      if (error instanceof ImportRequestError) {
        setRefusal(kdnEnrichmentRefusalLabel(error.httpStatus, error.detail));
      } else {
        setRefusal(kdnEnrichmentRefusalLabel(0, ''));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="bp-detail-complete"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="bp-field__help">{KDN_COMPLETION_HELP}</p>
      <p className="bp-field__help">{KDN_USER_REPORTED_NOTE}</p>
      <label className="bp-field">
        <span className="bp-field__label">KDN (%)</span>
        <input
          className="bp-input"
          value={kdnPercent}
          onChange={(event) => setKdnPercent(event.target.value)}
          disabled={busy}
          inputMode="decimal"
          autoComplete="off"
        />
      </label>
      <label className="bp-field" style={{ marginTop: '8px' }}>
        <span className="bp-field__label">Alasan</span>
        <textarea
          className="bp-textarea"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
        />
      </label>
      {refusal ? (
        <p className="bp-field__help" role="status">
          {refusal}
        </p>
      ) : null}
      <div className="bp-detail-complete__actions">
        <button type="submit" className="bp-btn bp-btn--primary bp-btn--sm" disabled={busy}>
          Simpan KDN
        </button>
      </div>
    </form>
  );
}

function PrivatePriceChangeForm({
  basicPriceId,
  expectedValue,
  sourceName,
  onRoute,
  onCurrentChanged,
}: {
  basicPriceId: string;
  expectedValue: string;
  sourceName: string | null;
  onRoute: (path: string) => void;
  onCurrentChanged: (successorId: string) => void;
}) {
  const [intent, setIntent] = useState<DetailChangeIntent | null>(null);
  const [evidenceBasis, setEvidenceBasis] = useState<'DOCUMENT' | 'FIELD' | null>(
    null,
  );
  const [sameSource, setSameSource] = useState<boolean | null>(
    sourceName ? null : true,
  );
  const [sourceIdentityName, setSourceIdentityName] = useState('');
  const [sourceOrigin, setSourceOrigin] = useState<PriceSourceOrigin | ''>('');
  const [proposedValue, setProposedValue] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmCorrection, setConfirmCorrection] = useState(false);
  const askSameSource = Boolean(sourceName);
  const fieldPath =
    intent === 'NEW_OBSERVATION' && evidenceBasis === 'FIELD';
  const documentaryPath =
    intent === 'NEW_OBSERVATION' && evidenceBasis === 'DOCUMENT';
  const showMoneyFields = intent === 'CORRECTION' || fieldPath;

  const submit = async () => {
    if (busy || !intent) return;
    if (intent === 'NEW_OBSERVATION' && evidenceBasis !== 'FIELD') return;
    if (fieldPath && askSameSource && sameSource === null) return;
    if (fieldPath && sameSource === false) {
      if (!isGenuinelyDifferentSourceIdentity(sourceName, sourceIdentityName)) {
        setRefusal(DIFFERENT_SOURCE_IDENTITY_CONFLICT_NOTE);
        return;
      }
      if (!sourceOrigin) {
        setRefusal(DIFFERENT_SOURCE_ORIGIN_REQUIRED_NOTE);
        return;
      }
    }
    if (intent === 'CORRECTION' && !confirmCorrection) {
      setConfirmCorrection(true);
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const result =
        intent === 'NEW_OBSERVATION'
          ? await observePrivateBasicPrice(
              basicPriceId,
              expectedValue,
              proposedValue,
              effectiveDate,
              reason,
              {
                sameSource: sameSource !== false,
                sourceIdentityName:
                  sameSource === false ? sourceIdentityName.trim() : undefined,
                sourceOrigin:
                  sameSource === false && sourceOrigin
                    ? sourceOrigin
                    : undefined,
              },
            )
          : await correctPrivateBasicPrice(
              basicPriceId,
              expectedValue,
              proposedValue,
              reason,
            );
      onCurrentChanged(result.basicPriceId);
    } catch (error) {
      if (error instanceof ImportRequestError) {
        setRefusal(priceCorrectionRefusalLabel(error.httpStatus, error.detail));
      } else {
        setRefusal(priceCorrectionRefusalLabel(0, ''));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="bp-detail-complete"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="bp-choice">
        <legend className="bp-field__label">{PRICE_CHANGE_QUESTION}</legend>
        <label className="bp-choice__item">
          <input
            type="radio"
            name="bp-price-intent"
            checked={intent === 'NEW_OBSERVATION'}
            onChange={() => {
              setIntent('NEW_OBSERVATION');
              setEvidenceBasis(null);
              setConfirmCorrection(false);
            }}
            disabled={busy}
          />
          <span>
            <strong>{PRICE_CHOICE_NEW_OBSERVATION}</strong>
            <span className="bp-field__help">{PRICE_CHOICE_NEW_OBSERVATION_HELP}</span>
          </span>
        </label>
        <label className="bp-choice__item">
          <input
            type="radio"
            name="bp-price-intent"
            checked={intent === 'CORRECTION'}
            onChange={() => {
              setIntent('CORRECTION');
              setEvidenceBasis(null);
              setConfirmCorrection(false);
            }}
            disabled={busy}
          />
          <span>
            <strong>{PRICE_CHOICE_CORRECTION}</strong>
            <span className="bp-field__help">{PRICE_CHOICE_CORRECTION_HELP}</span>
          </span>
        </label>
      </fieldset>
      {intent === 'NEW_OBSERVATION' ? (
        <fieldset className="bp-choice" style={{ marginTop: '8px' }}>
          <legend className="bp-field__label">{EVIDENCE_BASIS_QUESTION}</legend>
          <label className="bp-choice__item">
            <input
              type="radio"
              name="bp-price-evidence"
              checked={evidenceBasis === 'DOCUMENT'}
              onChange={() => setEvidenceBasis('DOCUMENT')}
              disabled={busy}
            />
            <span>
              <strong>{EVIDENCE_BASIS_DOCUMENT}</strong>
            </span>
          </label>
          <label className="bp-choice__item">
            <input
              type="radio"
              name="bp-price-evidence"
              checked={evidenceBasis === 'FIELD'}
              onChange={() => setEvidenceBasis('FIELD')}
              disabled={busy}
            />
            <span>
              <strong>{EVIDENCE_BASIS_FIELD}</strong>
            </span>
          </label>
        </fieldset>
      ) : null}
      {documentaryPath ? (
        <div className="bp-detail-complete__actions" style={{ marginTop: '8px' }}>
          <p className="bp-field__help">{DOCUMENTARY_INTAKE_NOTE}</p>
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-btn--sm"
            onClick={() => onRoute(BASIC_PRICE_IMPORT_PATH)}
            disabled={busy}
          >
            Buka Impor
          </button>
        </div>
      ) : null}
      {fieldPath && askSameSource ? (
        <fieldset className="bp-choice" style={{ marginTop: '8px' }}>
          <legend className="bp-field__label">{SOURCE_STILL_SAME_QUESTION}</legend>
          <label className="bp-choice__item">
            <input
              type="radio"
              name="bp-price-same-source"
              checked={sameSource === true}
              onChange={() => setSameSource(true)}
              disabled={busy}
            />
            <span>
              <strong>{SOURCE_STILL_SAME_YES}</strong>
              <span className="bp-field__help">{sourceName}</span>
            </span>
          </label>
          <label className="bp-choice__item">
            <input
              type="radio"
              name="bp-price-same-source"
              checked={sameSource === false}
              onChange={() => setSameSource(false)}
              disabled={busy}
            />
            <span>
              <strong>{SOURCE_STILL_SAME_NO}</strong>
            </span>
          </label>
        </fieldset>
      ) : null}
      {fieldPath && sameSource === false ? (
        <>
          <label className="bp-field" style={{ marginTop: '8px' }}>
            <span className="bp-field__label">{FIELD_REPORTED_SOURCE_NAME_LABEL}</span>
            <input
              className="bp-input"
              value={sourceIdentityName}
              onChange={(event) => setSourceIdentityName(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <label className="bp-field">
            <span className="bp-field__label">{FIELD_REPORTED_SOURCE_ORIGIN_LABEL}</span>
            <select
              className="bp-input"
              value={sourceOrigin}
              onChange={(event) =>
                setSourceOrigin(event.target.value as PriceSourceOrigin | '')
              }
              disabled={busy}
            >
              <option value="">Pilih asal sumber</option>
              {OBSERVATION_SOURCE_ORIGIN_OPTIONS.map((origin) => (
                <option key={origin} value={origin}>
                  {sourceOriginLabel(origin)}
                </option>
              ))}
            </select>
          </label>
          {sourceIdentityName.trim() &&
          !isGenuinelyDifferentSourceIdentity(sourceName, sourceIdentityName) ? (
            <p className="bp-field__error">{DIFFERENT_SOURCE_IDENTITY_CONFLICT_NOTE}</p>
          ) : null}
        </>
      ) : null}
      {showMoneyFields ? (
        <>
          <p className="bp-field__help">
            {intent === 'NEW_OBSERVATION'
              ? PRICE_NEW_OBSERVATION_HELP
              : PRICE_CORRECTION_HELP}
          </p>
          <label className="bp-field">
            <span className="bp-field__label">
              {intent === 'NEW_OBSERVATION' ? 'Harga terbaru' : 'Harga yang benar'}
            </span>
            <input
              className="bp-input"
              value={proposedValue}
              onChange={(event) => setProposedValue(event.target.value)}
              disabled={busy}
              inputMode="decimal"
              autoComplete="off"
            />
          </label>
          {intent === 'NEW_OBSERVATION' ? (
            <label className="bp-field" style={{ marginTop: '8px' }}>
              <span className="bp-field__label">Berlaku mulai</span>
              <input
                className="bp-input"
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
                disabled={busy}
              />
            </label>
          ) : null}
          <label className="bp-field" style={{ marginTop: '8px' }}>
            <span className="bp-field__label">Alasan</span>
            <textarea
              className="bp-textarea"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          </label>
        </>
      ) : null}
      {refusal ? (
        <p className="bp-field__help" role="status">
          {refusal}
        </p>
      ) : null}
      {showMoneyFields && intent === 'CORRECTION' && confirmCorrection ? (
        <div className="bp-detail-complete__actions" role="group" aria-label="Konfirmasi koreksi harga">
          <p className="bp-field__help">
            Simpan koreksi ini? Nilai sebelumnya tetap tercatat dalam riwayat.
            Nilai baru akan menjadi nilai saat ini.
          </p>
          <button
            type="button"
            className="bp-btn bp-btn--sm"
            disabled={busy}
            onClick={() => setConfirmCorrection(false)}
          >
            Batal
          </button>
          <button type="submit" className="bp-btn bp-btn--primary bp-btn--sm" disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan koreksi'}
          </button>
        </div>
      ) : showMoneyFields ? (
        <div className="bp-detail-complete__actions">
          <button type="submit" className="bp-btn bp-btn--primary bp-btn--sm" disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan harga'}
          </button>
        </div>
      ) : null}
    </form>
  );
}

function PrivateKdnChangeForm({
  basicPriceId,
  expectedValue,
  expectedKdnPercent,
  onCurrentChanged,
}: {
  basicPriceId: string;
  expectedValue: string;
  expectedKdnPercent: string;
  onCurrentChanged: (successorId: string) => void;
}) {
  const [intent, setIntent] = useState<DetailChangeIntent | null>(null);
  const [proposedKdn, setProposedKdn] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !intent) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result =
        intent === 'NEW_OBSERVATION'
          ? await observePrivateKdn(
              basicPriceId,
              expectedValue,
              expectedKdnPercent,
              proposedKdn,
              effectiveDate,
              reason,
            )
          : await correctPrivateKdn(
              basicPriceId,
              expectedValue,
              expectedKdnPercent,
              proposedKdn,
              reason,
            );
      onCurrentChanged(result.basicPriceId);
    } catch (error) {
      if (error instanceof ImportRequestError) {
        setRefusal(kdnEnrichmentRefusalLabel(error.httpStatus, error.detail));
      } else {
        setRefusal(kdnEnrichmentRefusalLabel(0, ''));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="bp-detail-complete"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="bp-field__help">{KDN_CHANGE_HELP}</p>
      <p className="bp-field__help">{KDN_USER_REPORTED_NOTE}</p>
      <fieldset className="bp-choice">
        <legend className="bp-field__label">{KDN_CHANGE_QUESTION}</legend>
        <label className="bp-choice__item">
          <input
            type="radio"
            name="bpKdnMeaning"
            checked={intent === 'NEW_OBSERVATION'}
            onChange={() => setIntent('NEW_OBSERVATION')}
            disabled={busy}
          />
          <span>
            <strong>{KDN_CHOICE_NEW_OBSERVATION}</strong>
          </span>
        </label>
        <label className="bp-choice__item">
          <input
            type="radio"
            name="bpKdnMeaning"
            checked={intent === 'CORRECTION'}
            onChange={() => setIntent('CORRECTION')}
            disabled={busy}
          />
          <span>
            <strong>{KDN_CHOICE_CORRECTION}</strong>
          </span>
        </label>
      </fieldset>
      {intent ? (
        <>
          <label className="bp-field" style={{ marginTop: '8px' }}>
            <span className="bp-field__label">KDN (%)</span>
            <input
              className="bp-input"
              value={proposedKdn}
              onChange={(event) => setProposedKdn(event.target.value)}
              disabled={busy}
              inputMode="decimal"
              autoComplete="off"
            />
          </label>
          {intent === 'NEW_OBSERVATION' ? (
            <label className="bp-field" style={{ marginTop: '8px' }}>
              <span className="bp-field__label">Berlaku mulai</span>
              <input
                className="bp-input"
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
                disabled={busy}
              />
            </label>
          ) : null}
          <label className="bp-field" style={{ marginTop: '8px' }}>
            <span className="bp-field__label">Alasan</span>
            <textarea
              className="bp-textarea"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          </label>
        </>
      ) : null}
      {refusal ? (
        <p className="bp-field__help" role="status">
          {refusal}
        </p>
      ) : null}
      {intent ? (
        <div className="bp-detail-complete__actions">
          <button type="submit" className="bp-btn bp-btn--primary bp-btn--sm" disabled={busy}>
            Simpan KDN
          </button>
        </div>
      ) : null}
    </form>
  );
}

function Fact({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: 'price';
}) {
  return (
    <div>
      <dt className="bp-fact__label">{label}</dt>
      <dd className={`bp-fact__value ${variant === 'price' ? 'bp-fact__value--price' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

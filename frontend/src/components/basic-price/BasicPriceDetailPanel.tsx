import { useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { enrichBasicPriceKdn, enrichCatalogBasicPriceKdn, correctPrivateBasicPrice, observePrivateBasicPrice, observePrivateKdn, correctPrivateKdn, submitPrivateBasicPrice, ImportRequestError } from '../../api/basicPriceImport';
import { useAuth } from '../../contexts/AuthContext';
import {
  cakupanLabel,
  effectiveDateProvenanceLabel,
  EVIDENCE_FILE_RETAINED_NOTE,
  explorerSourceNameLabel,
  formatExplorerPrice,
  kdnLabel,
  observationBasisLabel,
  regionLabel,
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
  type DetailChangeIntent,
  type DetailSubjectOffer,
} from '../../utils/basicPriceDetailChange';
import {
  CORRECTION_HISTORY_PARTIAL_NOTE,
  CORRECTION_HISTORY_UNAVAILABLE,
  FRESHNESS_VIEW_LABELS,
  NO_CORRECTION_RECORDED,
  anchorCorrectionRow,
  correctionHistoryLabel,
  correctionHistoryRows,
  freshnessMeaning,
  freshnessView,
  type TemporalContext,
} from '../../utils/basicPriceFreshness';
import { forgetBasicPriceDetail, useBasicPriceDetail } from './useBasicPriceDetail';

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
  const [detailEpoch, setDetailEpoch] = useState(0);
  const [changeOpen, setChangeOpen] = useState(false);
  const [alreadyProposed, setAlreadyProposed] = useState(false);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const detail = useBasicPriceDetail(item.basicPriceId, detailEpoch);
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
    alreadyProposed,
  });
  const changeDoorLive = detailChangeDoorLive(changeOffers);
  const freshness = FRESHNESS_VIEW_LABELS[freshnessView(item)];
  /*
   * Status uses the SAME temporal lens the Explorer list used for these rows.
   * The short label stays on the Fact; the lens-bound sentence sits under it.
   */
  const statusMeaning = freshnessMeaning(item, temporal, formatDate);

  const evidence = detail.kind === 'ready' ? detail.detail.evidence : null;
  const corrections = detail.kind === 'ready' ? detail.detail.corrections : null;
  const correctionRows = corrections
    ? correctionHistoryRows(corrections.entries, formatDate)
    : [anchorCorrectionRow(item, formatDate)];
  const derivationLabel = effectiveDateProvenanceLabel(
    evidence?.effectiveDateProvenance,
  );

  return (
    <section className="bp-detail" aria-label={`Detail harga ${resourceLabel(item.resource)}`}>
      <div className="bp-detail__head">
        <div>
          <div className="bp-detail__name">{resourceLabel(item.resource)}</div>
          <div className="bp-detail__meta">
            {resourceTypeLabel(item.resource.type)} · {regionLabel(item.region)}
          </div>
        </div>
        <div className="bp-detail__head-actions">
          {alreadyProposed ? (
            <p className="bp-field__help" role="status" aria-live="polite">
              {PROPOSAL_ALREADY_SENT}
            </p>
          ) : detail.kind === 'ready' &&
            changeOffers.some(
              (offer) =>
                offer.subject === 'PROPOSAL' &&
                offer.kind === 'LIVE' &&
                offer.action === 'PROPOSE_PRIVATE',
            ) ? (
            <PrivateProposalButton
              basicPriceId={item.basicPriceId}
              onProposed={() => setAlreadyProposed(true)}
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
            <Fact label="Satuan" value={item.resource.baseUnit} />
            <Fact label="Kategori" value={resourceTypeLabel(item.resource.type)} />
            <Fact label="Wilayah" value={regionLabel(item.region)} />
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
            THE TAB IS RIWAYAT ONLY. Pembanding is not a live Detail capability,
            so it is not advertised here.

            Everything below comes from `supersedesBasicPriceId` — corrections,
            and only corrections — and says "Terbaru" when the server's bounded
            read could not reach the end of the chain.
          */}
          <span className="bp-pop__label">
            {correctionHistoryLabel(Boolean(corrections?.truncated))}
          </span>
          <div className="bp-history" style={{ marginBottom: '12px' }}>
            {correctionRows.map((entry) => (
              <div className="bp-history__row" key={entry.key}>
                <span className="bp-history__date">{entry.date}</span>
                <span className="bp-history__price">{entry.price}</span>
                <span className="bp-history__tag">{entry.tag}</span>
              </div>
            ))}
          </div>
          {detail.kind === 'loading' ? (
            <p className="bp-field__help" role="status">
              Memuat riwayat koreksi...
            </p>
          ) : null}
          {detail.kind === 'error' ? (
            <p className="bp-field__help" role="status">
              {CORRECTION_HISTORY_UNAVAILABLE}
            </p>
          ) : null}
          {corrections?.truncated ? (
            <p className="bp-field__help">{CORRECTION_HISTORY_PARTIAL_NOTE}</p>
          ) : null}
          {corrections &&
          corrections.entries.length === 1 &&
          !corrections.truncated ? (
            <p className="bp-field__help">{NO_CORRECTION_RECORDED}</p>
          ) : null}
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
      if (result.status === 'PUBLISHED') {
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
  const [proposedValue, setProposedValue] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
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
    if (fieldPath && sameSource === false && !sourceIdentityName.trim()) return;
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
      {showMoneyFields ? (
        <div className="bp-detail-complete__actions">
          <button type="submit" className="bp-btn bp-btn--primary bp-btn--sm" disabled={busy}>
            Simpan harga
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

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  BasicPriceWorkflowError,
  acceptReview,
  fetchReviewDetail,
  reassignReview,
  rejectReview,
  type ReviewDetail,
  type ReviewerIdentity,
} from '../api/basicPriceWorkflow';
import { ReviewerSearchSelect } from '../components/basic-price/ReviewerSearchSelect';
import { computeReviewActionViewModel } from '../utils/reviewActionViewModel';
import '../styles/basicPrice.css';
import {
  acceptNeedsExplicitGeneralRegion,
  banner,
  bannerAfterRefetch,
  buildAcceptBody,
  buildReassignBody,
  buildRejectBody,
  canReject,
  errorMessageFromStatus,
  errorBanner,
  formatPrice,
  regionLabel,
  resourceLabel,
  reviewActionLabel,
  reviewerLabel,
  slaStateLabel,
  submissionStatusLabel,
  successBanner,
  type StatusBanner,
} from '../utils/basicPriceWorkflowDisplay';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * RM-02D2A2 — Basic Price review detail + decision room. Read is
 * BASIC_PRICE_REVIEW_VIEW; accept/reject/reassign are BASIC_PRICE_VERIFY. The
 * actor is always server-resolved from the JWT — this page never sends an
 * actor id. request-correction is intentionally NOT offered (the resubmission
 * path is unapproved). A success message is sticky: a follow-up refetch never
 * erases it.
 *
 * RM02D2A2 remediation — permission-honest mutation UI: a viewer who only has
 * BASIC_PRICE_REVIEW_VIEW (not BASIC_PRICE_VERIFY) never sees the accept/
 * reject/reassign controls, and — critically — the ReviewerSearchSelect
 * component (which calls GET /basic-price-reviews/reviewer-candidates, a
 * BASIC_PRICE_VERIFY-gated route) is never even mounted for them, so it never
 * fires that network call only to be met with a predictable 403. Rendering
 * decisions come from reviewActionViewModel (production-used, unit-tested),
 * not ad-hoc inline branching.
 */
export function BasicPriceReviewDetailPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canVerify = hasPermission('BASIC_PRICE_VERIFY');
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<StatusBanner>(banner('idle', ''));
  const [busy, setBusy] = useState(false);

  // Action drafts
  const [acceptNote, setAcceptNote] = useState('');
  const [explicitGeneralRegion, setExplicitGeneralRegion] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [reassignTarget, setReassignTarget] = useState<ReviewerIdentity | null>(null);
  const [reassignNote, setReassignNote] = useState('');

  // await-first (no synchronous setState) so the mount effect can call it
  // directly; the initial 'loading' state covers first paint.
  const load = async () => {
    if (!reviewId) return;
    try {
      const result = await fetchReviewDetail(reviewId);
      setDetail(result);
      setLoadState('ready');
      // Keep a sticky success banner across the post-action refetch.
      setStatus((prev) => bannerAfterRefetch(prev, banner('idle', '')));
    } catch (error) {
      setLoadState('error');
      setLoadError(
        error instanceof BasicPriceWorkflowError
          ? errorMessageFromStatus(error.status)
          : 'Gagal memuat detail review.',
      );
    }
  };

  useEffect(() => {
    // On-mount / reviewId-change server fetch (this app has no query library);
    // load() reads reviewId directly and is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  const runAction = async (action: () => Promise<unknown>, successText: string) => {
    if (!reviewId) return;
    setBusy(true);
    setStatus(banner('loading', 'Memproses...'));
    try {
      await action();
      setStatus(successBanner(successText));
      await load();
    } catch (error) {
      setStatus(
        error instanceof BasicPriceWorkflowError
          ? errorBanner(error.status)
          : banner('error', 'Tindakan gagal. Coba lagi.'),
      );
    } finally {
      setBusy(false);
    }
  };

  if (loadState === 'loading' && !detail) {
    return (
      <div className="bp-room">
        <header className="bp-head">
          <div>
            <div className="bp-head__crumb">SIMPROK / Basic Price / Pengajuan</div>
            <h1 className="bp-head__title">Detail Pengajuan Harga</h1>
            <p className="bp-head__sub" role="status">Memuat detail review...</p>
          </div>
        </header>
      </div>
    );
  }

  if (loadState === 'error' && !detail) {
    return (
      <div className="bp-room">
        <div className="bp-head__doors">
          <button type="button" className="bp-btn bp-btn--sm" onClick={() => navigate('/basic-price/reviews')}><ArrowLeft size={14} /> Antrean Pengajuan</button>
        </div>
        <header className="bp-head">
          <div>
            <div className="bp-head__crumb">SIMPROK / Basic Price / Pengajuan</div>
            <h1 className="bp-head__title">Detail Pengajuan Harga</h1>
            <p className="bp-note bp-note--danger" role="alert">{loadError}</p>
          </div>
        </header>
      </div>
    );
  }

  if (!detail) return null;

  const actionable =
    (detail.slaState === 'OPEN' || detail.slaState === 'ESCALATED') &&
    detail.submissionStatus === 'UNDER_REVIEW';
  const reviewAction = computeReviewActionViewModel({
    actionable,
    hasReviewView: hasPermission('BASIC_PRICE_REVIEW_VIEW'),
    hasVerify: canVerify,
  });
  const needsGeneralRegion = acceptNeedsExplicitGeneralRegion(detail.region);

  return (
    <div className="bp-room">
      <div className="bp-head__doors" aria-label="Navigasi Detail Review">
        <button type="button" className="bp-btn bp-btn--sm" onClick={() => navigate('/basic-price/reviews')} title="Kembali ke antrean pengajuan">
          <ArrowLeft size={14} /> Antrean Pengajuan
        </button>
        <button type="button" className="bp-btn bp-btn--link" onClick={() => navigate('/basic-price')} title="Kembali ke daftar Basic Price">
          Basic Price →
        </button>
      </div>

      <header className="bp-head">
        <div>
          <div className="bp-head__crumb">SIMPROK / Basic Price / Pengajuan</div>
          <h1 className="bp-head__title">{resourceLabel(detail.resource)}</h1>
          <p className="bp-head__sub">
            Wilayah: {regionLabel(detail.region)} · Harga saat ini: {formatPrice(detail.currentPrice)}
          </p>
          <p className="bp-head__sub">
            Keputusan: {submissionStatusLabel(detail.submissionStatus)} · SLA: {slaStateLabel(detail.slaState)} ·
            Reviewer: {reviewerLabel(detail.assignedReviewer)}
          </p>
        </div>
        {status.kind !== 'idle' ? (
          <span
            className={`bp-note ${status.kind === 'error' ? 'bp-note--danger' : status.kind === 'success' ? 'bp-note--ok' : 'bp-note--info'}`}
            role={status.kind === 'error' ? 'alert' : 'status'}
          >
            {status.text}
          </span>
        ) : null}
      </header>

      {reviewAction.showReadOnlyMessage ? (
        <p className="bp-note">
          Anda memiliki akses melihat, tetapi tidak memiliki kewenangan memutuskan review ini.
        </p>
      ) : null}

      {/*
        §16 — THE HUMAN-DECISION BOUNDARY, NAMED.

        Everything above this line is what SIMPROK and the importer produced.
        Everything below it is a governed act by THIS person, under
        BASIC_PRICE_VERIFY, recorded against their name. The page used to run
        the two together, so a curator met three action cards with no sentence
        saying the decision was theirs to make.
      */}
      {reviewAction.showActionArea ? (
        <>
          <p className="bp-section-title">Keputusan Anda</p>
          {reviewAction.showAcceptAction ? (
            // Color Lock: Accept is a trusted/positive action, not an error —
            // uses the neutral engineering-blue-bordered card, never the
            // critical-red validation-alert style.
            <section className="bp-note" aria-label="Terima harga">
              <strong className="bp-section-title">Terima (verifikasi) harga</strong>
              {needsGeneralRegion ? (
                <label>
                  <input
                    type="checkbox"
                    checked={explicitGeneralRegion}
                    onChange={(event) => setExplicitGeneralRegion(event.target.checked)}
                  />
                  Tidak ada wilayah — verifikasi sebagai harga umum (tanpa wilayah)
                </label>
              ) : null}
              <div className="bp-field">
                <label className="bp-field__label" htmlFor="bp-accept-note">Catatan (opsional)</label>
                <input id="bp-accept-note" className="bp-input" type="text" value={acceptNote} onChange={(event) => setAcceptNote(event.target.value)} />
              </div>
              <button
                type="button"
                className="bp-btn bp-btn--primary"
                aria-disabled={busy || (needsGeneralRegion && !explicitGeneralRegion)}
                disabled={busy || (needsGeneralRegion && !explicitGeneralRegion)}
                onClick={() =>
                  void runAction(
                    () => acceptReview(detail.reviewId, buildAcceptBody({ explicitGeneralRegion, note: acceptNote })),
                    'Harga diterima dan diverifikasi. Menunggu penerbitan oleh reviewer lain.',
                  )
                }
              >
                Terima Harga
              </button>
            </section>
          ) : null}

          {reviewAction.showRejectAction ? (
            // Color Lock: rejection is the one action Owner's lock explicitly
            // allows as critical-red — this is the only section that keeps it.
            <section className="bp-note bp-note--danger" aria-label="Tolak harga">
              <strong className="bp-section-title">Tolak harga</strong>
              <div className="bp-field">
                <label className="bp-field__label" htmlFor="bp-reject-note">Alasan penolakan (wajib)</label>
                <input id="bp-reject-note" className="bp-input" type="text" value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} />
              </div>
              <button
                type="button"
                className="bp-btn bp-btn--danger-quiet"
                aria-disabled={busy || !canReject(rejectNote)}
                disabled={busy || !canReject(rejectNote)}
                onClick={() =>
                  void runAction(
                    () => rejectReview(detail.reviewId, buildRejectBody(rejectNote)),
                    'Harga ditolak.',
                  )
                }
              >
                Tolak Harga
              </button>
            </section>
          ) : null}

          {reviewAction.showReassignAction ? (
            // Color Lock: reassignment is neutral/informational, not an error.
            <section className="bp-note" aria-label="Alihkan review">
              <strong className="bp-section-title">Alihkan ke reviewer lain</strong>
              {reviewAction.showReviewerSelector ? (
                <ReviewerSearchSelect selected={reassignTarget} disabled={busy} onSelect={setReassignTarget} />
              ) : null}
              <div className="bp-field">
                <label className="bp-field__label" htmlFor="bp-reassign-note">Catatan (opsional)</label>
                <input id="bp-reassign-note" className="bp-input" type="text" value={reassignNote} onChange={(event) => setReassignNote(event.target.value)} />
              </div>
              <button
                type="button"
                className="bp-btn"
                aria-disabled={busy}
                disabled={busy}
                onClick={() =>
                  void runAction(
                    () =>
                      reassignReview(
                        detail.reviewId,
                        buildReassignBody({ assignedToUserId: reassignTarget?.userId ?? null, note: reassignNote }),
                      ),
                    reassignTarget
                      ? `Review dialihkan ke ${reviewerLabel(reassignTarget)}.`
                      : 'Penugasan reviewer dilepas.',
                  )
                }
              >
                Alihkan Review
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      {!actionable ? (
        <p className="bp-note">Review ini sudah tidak dapat diubah ({slaStateLabel(detail.slaState)}).</p>
      ) : null}

      <section aria-label="Riwayat keputusan">
        <strong className="bp-section-title">Riwayat keputusan</strong>
        {detail.decisions.length === 0 ? (
          <p>Belum ada keputusan tercatat.</p>
        ) : (
          <ul>
            {detail.decisions.map((decision) => (
              <li key={decision.id}>
                {reviewActionLabel(decision.action)} oleh {reviewerLabel(decision.decidedBy)}
                {decision.note ? ` — "${decision.note}"` : ''} ({decision.decidedAt})
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

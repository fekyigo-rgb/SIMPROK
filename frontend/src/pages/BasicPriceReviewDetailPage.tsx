import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
 */
export function BasicPriceReviewDetailPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const navigate = useNavigate();
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
      <div className="simprok-rab-workspace">
        <header className="simprok-rab-workspace__header">
          <h1>Detail Review Harga Dasar</h1>
          <p role="status">Memuat detail review...</p>
        </header>
      </div>
    );
  }

  if (loadState === 'error' && !detail) {
    return (
      <div className="simprok-rab-workspace">
        <div className="simprok-rab-focus-nav">
          <button onClick={() => navigate('/basic-price/reviews')}><ArrowLeft size={17} /> Kembali ke Antrean</button>
        </div>
        <header className="simprok-rab-workspace__header">
          <h1>Detail Review Harga Dasar</h1>
          <p role="alert">{loadError}</p>
        </header>
      </div>
    );
  }

  if (!detail) return null;

  const actionable =
    (detail.slaState === 'OPEN' || detail.slaState === 'ESCALATED') &&
    detail.submissionStatus === 'UNDER_REVIEW';
  const needsGeneralRegion = acceptNeedsExplicitGeneralRegion(detail.region);

  return (
    <div className="simprok-rab-workspace">
      <div className="simprok-rab-focus-nav" aria-label="Navigasi Detail Review">
        <button onClick={() => navigate('/basic-price/reviews')} title="Kembali ke Antrean">
          <ArrowLeft size={17} /> Kembali ke Antrean
        </button>
      </div>

      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Basic Price / Review</div>
          <h1>{resourceLabel(detail.resource)}</h1>
          <p>
            Wilayah: {regionLabel(detail.region)} · Harga saat ini: {formatPrice(detail.currentPrice)}
          </p>
          <p>
            Status submission: {submissionStatusLabel(detail.submissionStatus)} · SLA: {slaStateLabel(detail.slaState)} ·
            Reviewer: {reviewerLabel(detail.assignedReviewer)}
          </p>
        </div>
        {status.kind !== 'idle' ? (
          <span
            className="simprok-rab-workspace__status"
            role={status.kind === 'error' ? 'alert' : 'status'}
          >
            {status.text}
          </span>
        ) : null}
      </header>

      {actionable ? (
        <>
          <section className="simprok-rab-validation-alert" aria-label="Terima harga">
            <strong>Terima (verifikasi) harga</strong>
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
            <label>
              Catatan (opsional)
              <input type="text" value={acceptNote} onChange={(event) => setAcceptNote(event.target.value)} />
            </label>
            <button
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

          <section className="simprok-rab-validation-alert" aria-label="Tolak harga">
            <strong>Tolak harga</strong>
            <label>
              Alasan penolakan (wajib)
              <input type="text" value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} />
            </label>
            <button
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

          <section className="simprok-rab-validation-alert" aria-label="Alihkan review">
            <strong>Alihkan ke reviewer lain</strong>
            <ReviewerSearchSelect selected={reassignTarget} disabled={busy} onSelect={setReassignTarget} />
            <label>
              Catatan (opsional)
              <input type="text" value={reassignNote} onChange={(event) => setReassignNote(event.target.value)} />
            </label>
            <button
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
        </>
      ) : (
        <p>Review ini sudah tidak dapat diubah ({slaStateLabel(detail.slaState)}).</p>
      )}

      <section aria-label="Riwayat keputusan" style={{ marginTop: '16px' }}>
        <strong>Riwayat keputusan</strong>
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

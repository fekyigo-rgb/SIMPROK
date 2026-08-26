import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { BasicPriceWorkflowError, fetchReviewQueue, type ReviewQueueItem } from '../api/basicPriceWorkflow';
import {
  errorMessageFromStatus,
  formatPrice,
  regionLabel,
  resourceLabel,
  reviewerLabel,
  slaStateLabel,
  submissionStatusLabel,
} from '../utils/basicPriceWorkflowDisplay';

type QueueState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; items: ReviewQueueItem[] }
  | { kind: 'error'; message: string };

/**
 * RM-02D2A2 — Basic Price review queue (BASIC_PRICE_REVIEW_VIEW). Every row is
 * human-readable: resource code/name, region code/name, the current price as
 * an exact decimal string, and the assigned reviewer. No raw UUID is shown.
 * States are honest: loading / empty / forbidden+error / ready.
 */
export function BasicPriceReviewQueuePage() {
  const navigate = useNavigate();
  const [state, setState] = useState<QueueState>({ kind: 'loading' });

  // await-first (no synchronous setState) so it is safe to call straight from
  // the mount effect; the initial 'loading' state covers first paint.
  const load = async () => {
    try {
      const items = await fetchReviewQueue();
      setState(items.length === 0 ? { kind: 'empty' } : { kind: 'ready', items });
    } catch (error) {
      const message =
        error instanceof BasicPriceWorkflowError
          ? errorMessageFromStatus(error.status)
          : 'Gagal memuat antrean review. Coba lagi.';
      setState({ kind: 'error', message });
    }
  };

  const reload = () => {
    setState({ kind: 'loading' });
    void load();
  };

  useEffect(() => {
    // On-mount server fetch (this app has no query library); syncing server
    // state into React state is the effect's whole purpose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  return (
    <div className="simprok-rab-workspace">
      <div className="simprok-rab-focus-nav" aria-label="Navigasi Antrean Review Basic Price">
        <button onClick={() => navigate('/')} title="Kembali ke Beranda" aria-label="Kembali ke Beranda">
          <ArrowLeft size={17} /> Kembali
        </button>
      </div>

      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Basic Price / Review</div>
          <h1>Antrean Review Harga Dasar</h1>
          <p>SIMPROK menyiapkan harga yang menunggu verifikasi manusia. Anda memutuskan menerima, menolak, atau mengalihkan.</p>
        </div>
        <button onClick={reload} title="Muat ulang antrean" aria-label="Muat ulang antrean">
          <RefreshCw size={16} /> Muat ulang
        </button>
      </header>

      {state.kind === 'loading' ? <p role="status">Memuat antrean review...</p> : null}
      {state.kind === 'empty' ? <p>Tidak ada harga yang menunggu review saat ini.</p> : null}
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}

      {state.kind === 'ready' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
          {state.items.map((item) => (
            <section
              key={item.reviewId}
              className="simprok-rab-validation-alert simprok-rab-validation-alert--info"
              aria-label={`Review ${resourceLabel(item.resource)}`}
            >
              <strong>{resourceLabel(item.resource)}</strong>
              {/*
                TWO DIFFERENT FACTS, AND THE ROW USED TO CARRY ONLY ONE.

                `slaState` is about the CLOCK — how long this has been waiting,
                and whether it has been resolved at all. `submissionStatus` is
                the GOVERNANCE verdict: awaiting a decision, verified, or
                rejected. A curator scanning this list needs the second one to
                know which rows are still theirs to decide, and the server had
                been sending it all along while the row printed only the clock.
                The detail page already showed both; the queue did not.
              */}
              <p>
                Wilayah: {regionLabel(item.region)} · Harga: {formatPrice(item.currentPrice)} ·
                Keputusan: {submissionStatusLabel(item.submissionStatus)} ·
                SLA: {slaStateLabel(item.slaState)}
              </p>
              <p>Reviewer: {reviewerLabel(item.assignedReviewer)}</p>
              <button
                onClick={() => navigate(`/basic-price/reviews/${item.reviewId}`)}
                title="Buka detail review"
              >
                Buka Detail Review
              </button>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

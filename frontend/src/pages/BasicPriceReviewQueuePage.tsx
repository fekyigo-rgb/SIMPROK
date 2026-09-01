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
import '../styles/basicPrice.css';

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
 *
 * BP-UX-FINAL-01 §17/§19 — THIS IS WHERE AN IMPORTED PRICE ARRIVES, so the room
 * says so. A curator landing here from the Explorer door had no sentence
 * telling them what these rows ARE or where they came from, and no way back
 * except the browser button. Both are now stated. The table layout, the two
 * separate verdict facts and every permission are unchanged.
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
    <div className="bp-room">
      <div className="bp-head__doors" aria-label="Navigasi Antrean Review Basic Price">
        <button
          type="button"
          className="bp-btn bp-btn--sm"
          onClick={() => navigate('/basic-price')}
          title="Kembali ke daftar Basic Price"
          aria-label="Kembali ke daftar Basic Price"
        >
          <ArrowLeft size={14} /> Basic Price
        </button>
      </div>

      <header className="bp-head">
        <div>
          <div className="bp-head__crumb">SIMPROK / Basic Price / Pengajuan</div>
          <h1 className="bp-head__title">Pengajuan Basic Price</h1>
          <p className="bp-head__sub">
            Harga yang diusulkan ke SIMPROK dari impor dan menunggu peninjauan
            manusia. Anda memutuskan menerima, menolak, atau mengalihkan.
          </p>
        </div>
        <div className="bp-head__actions">
          <button
            type="button"
            className="bp-btn"
            onClick={reload}
            title="Muat ulang antrean"
            aria-label="Muat ulang antrean"
          >
            <RefreshCw size={14} /> Muat ulang
          </button>
        </div>
      </header>

      {state.kind === 'loading' ? (
        <p className="bp-note" role="status">
          Memuat antrean review...
        </p>
      ) : null}
      {state.kind === 'empty' ? (
        <div className="bp-empty">
          <p className="bp-empty__title">Tidak ada harga yang menunggu review saat ini.</p>
          {/*
            AN EMPTY QUEUE IS NOT A BROKEN ONE, and this room is reached by a
            door that says "Pengajuan" — so a curator who arrives to nothing
            deserves to know that nothing is the ordinary state, and what would
            put a row here.
          */}
          <p className="bp-empty__body">
            Baris muncul di sini setelah seseorang menekan "Usulkan juga ke
            SIMPROK" pada batch impor. Harga yang hanya disimpan untuk ruang
            kerja sendiri tidak melewati antrean ini.
          </p>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <p className="bp-note bp-note--danger" role="alert">
          {state.message}
        </p>
      ) : null}

      {state.kind === 'ready' ? (
        <div className="bp-tablewrap">
          <table className="bp-table">
            <thead>
              <tr>
                <th scope="col">Resource</th>
                <th scope="col" className="bp-th-right">
                  Harga
                </th>
                <th scope="col">Wilayah</th>
                <th scope="col">Keputusan</th>
                <th scope="col">SLA</th>
                <th scope="col">Reviewer</th>
                <th scope="col" className="bp-th-right">
                  Tindakan
                </th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.reviewId}>
                  <td data-label="Resource" className="bp-cell-resource">
                    {resourceLabel(item.resource)}
                  </td>
                  <td data-label="Harga" className="bp-cell-price">
                    {formatPrice(item.currentPrice)}
                  </td>
                  <td data-label="Wilayah" className="bp-cell-region">
                    {regionLabel(item.region)}
                  </td>
                  {/*
                    TWO DIFFERENT FACTS, AND THE ROW USED TO CARRY ONLY ONE.

                    `slaState` is about the CLOCK — how long this has been
                    waiting, and whether it has been resolved at all.
                    `submissionStatus` is the GOVERNANCE verdict: awaiting a
                    decision, verified, or rejected. A curator scanning this list
                    needs the second one to know which rows are still theirs to
                    decide, and the server had been sending it all along while
                    the row printed only the clock.
                  */}
                  <td data-label="Keputusan">{submissionStatusLabel(item.submissionStatus)}</td>
                  <td data-label="SLA" className="bp-cell-muted">
                    {slaStateLabel(item.slaState)}
                  </td>
                  <td data-label="Reviewer" className="bp-cell-source">
                    {reviewerLabel(item.assignedReviewer)}
                  </td>
                  <td data-label="Tindakan" className="bp-cell-action">
                    <button
                      type="button"
                      className="bp-btn bp-btn--link"
                      onClick={() => navigate(`/basic-price/reviews/${item.reviewId}`)}
                      title="Buka detail review"
                    >
                      Buka
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

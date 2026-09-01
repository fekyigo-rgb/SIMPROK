import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import {
  BasicPriceWorkflowError,
  fetchPublicationQueue,
  publishBasicPrice,
  type PublicationQueueItem,
} from '../api/basicPriceWorkflow';
import {
  banner,
  bannerAfterRefetch,
  errorBanner,
  errorMessageFromStatus,
  formatPrice,
  regionLabel,
  resourceLabel,
  successBanner,
  type StatusBanner,
} from '../utils/basicPriceWorkflowDisplay';
import '../styles/basicPrice.css';

type QueueState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; items: PublicationQueueItem[] }
  | { kind: 'error'; message: string };

/**
 * RM-02D2A2 — Basic Price publication queue (BASIC_PRICE_PUBLISH). Lists
 * verified-but-unpublished prices with human-readable identity + exact price
 * string, and publishes one via POST /basic-price-publications/:id/publish.
 * The backend enforces AUTO_PUBLISH=FORBIDDEN and VERIFIER != PUBLISHER, so a
 * publisher who verified the price sees an honest 409 CONFLICT, never a fake
 * success. A success banner is sticky across the refetch.
 *
 * BP-UX-FINAL-01 §18 — THE HANDOFF IS NAMED, NOT CELEBRATED. A published price
 * becomes available in the Basic Price room, so the confirmation carries a link
 * straight there instead of a full-screen success state. Nothing about what
 * publication reaches, or how strongly it may be claimed, has changed.
 */
export function BasicPricePublicationQueuePage() {
  const navigate = useNavigate();
  const [state, setState] = useState<QueueState>({ kind: 'loading' });
  const [status, setStatus] = useState<StatusBanner>(banner('idle', ''));
  const [busyId, setBusyId] = useState<string | null>(null);

  // await-first (no synchronous setState) so the mount effect can call it
  // directly; the initial 'loading' state covers first paint.
  const load = async () => {
    try {
      const items = await fetchPublicationQueue();
      setState(items.length === 0 ? { kind: 'empty' } : { kind: 'ready', items });
      setStatus((prev) => bannerAfterRefetch(prev, banner('idle', '')));
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof BasicPriceWorkflowError
            ? errorMessageFromStatus(error.status)
            : 'Gagal memuat antrean penerbitan.',
      });
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

  const handlePublish = async (item: PublicationQueueItem) => {
    setBusyId(item.basicPriceId);
    setStatus(banner('loading', 'Menerbitkan...'));
    try {
      await publishBasicPrice(item.basicPriceId);
      // The confirmation carries the same promise the header made — available
      // here, not "now in use" — so the publisher is never left to infer either
      // the reach or the strength of it from the word "diterbitkan" alone.
      setStatus(
        successBanner(
          `Harga ${resourceLabel(item.resource)} berhasil diterbitkan dan tersedia untuk digunakan di ruang kerja ini.`,
        ),
      );
      await load();
    } catch (error) {
      setStatus(
        error instanceof BasicPriceWorkflowError
          ? errorBanner(error.status)
          : banner('error', 'Gagal menerbitkan. Coba lagi.'),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bp-room">
      <div className="bp-head__doors" aria-label="Navigasi Antrean Penerbitan">
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
          <div className="bp-head__crumb">SIMPROK / Basic Price / Penerbitan</div>
          <h1 className="bp-head__title">Siap Diterbitkan</h1>
          {/*
            WHAT PENERBITAN ACTUALLY REACHES — said, because the room used to
            leave it to be assumed.

            The heading and the button both speak of publishing, so a publisher
            had every reason to believe they were releasing this price to
            SIMPROK at large. They were not. Publication moves two states on the
            price and touches nothing else — the price keeps the workspace that
            imported it, and the one law every consumer reads (Explorer, AHSP,
            RAB, Cost Kernel) serves it back to that workspace alone. A general
            price would have to belong to no workspace at all, and nothing in
            the product can produce one today.

            So the sentence states the reach in ordinary words. It names no
            field, no scope code and no database concept — the publisher does
            not need the mechanism, only the truth about what their click does.

            AND IT PROMISES AVAILABILITY, NOT USE. An earlier wording said the
            price "menjadi harga resmi yang dipakai" — that publication makes it
            THE price this workspace uses. It does not. Publication decides only
            that a price is lawfully ELIGIBLE; which price a calculation
            actually takes is a separate question the eligibility law
            deliberately refuses to answer, and `resolveAhspResourcePrice`
            returns NEEDS_REVIEW whenever more than one compatible candidate
            survives. Region, effective date, validity and unit compatibility
            all still apply afterwards.
          */}
          <p className="bp-head__sub">
            Harga terverifikasi menunggu penerbitan. Setelah diterbitkan, harga
            ini tersedia untuk digunakan di ruang kerja ini sesuai konteks yang
            berlaku. Penerbit harus orang yang berbeda dari yang memverifikasi.
          </p>
        </div>
        <div className="bp-head__actions">
          <button
            type="button"
            className="bp-btn"
            onClick={reload}
            title="Muat ulang"
            aria-label="Muat ulang antrean"
          >
            <RefreshCw size={14} /> Muat ulang
          </button>
        </div>
      </header>

      {status.kind !== 'idle' ? (
        <div
          className={`bp-note ${status.kind === 'error' ? 'bp-note--danger' : status.kind === 'success' ? 'bp-note--ok' : 'bp-note--info'}`}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.text}
          {/*
            §18 — WHERE IT WENT. A price that has just been published is now in
            the Basic Price room, and the shortest honest confirmation is a door
            to the place it can be seen. No full-screen success state, no
            fireworks: one sentence and one link.
          */}
          {status.kind === 'success' ? (
            <>
              {' '}
              <button
                type="button"
                className="bp-btn bp-btn--link"
                onClick={() => navigate('/basic-price')}
              >
                Lihat di Basic Price →
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {state.kind === 'loading' ? (
        <p className="bp-note" role="status">
          Memuat antrean penerbitan...
        </p>
      ) : null}
      {state.kind === 'empty' ? (
        <div className="bp-empty">
          <p className="bp-empty__title">
            Tidak ada harga terverifikasi yang menunggu penerbitan.
          </p>
          <p className="bp-empty__body">
            Harga sampai di sini setelah diusulkan ke SIMPROK dan diterima oleh
            peninjau.
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
                <th scope="col">Berlaku</th>
                <th scope="col" className="bp-th-right">
                  Tindakan
                </th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.basicPriceId}>
                  <td data-label="Resource" className="bp-cell-resource">
                    {resourceLabel(item.resource)}
                  </td>
                  <td data-label="Harga" className="bp-cell-price">
                    {formatPrice(item.price)}
                  </td>
                  <td data-label="Wilayah" className="bp-cell-region">
                    {regionLabel(item.region)}
                  </td>
                  <td data-label="Berlaku" className="bp-cell-muted">
                    {item.effectiveDate}
                  </td>
                  <td data-label="Tindakan" className="bp-cell-action">
                    <button
                      type="button"
                      className="bp-btn bp-btn--primary bp-btn--sm"
                      disabled={busyId !== null}
                      aria-disabled={busyId !== null}
                      onClick={() => void handlePublish(item)}
                      title="Terbitkan harga ini agar tersedia untuk digunakan di ruang kerja ini"
                    >
                      {busyId === item.basicPriceId ? 'Menerbitkan...' : 'Terbitkan'}
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

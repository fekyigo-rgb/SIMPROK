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

type QueueState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; items: PublicationQueueItem[] }
  | { kind: 'error'; message: string };

/**
 * RM-02D2A2 — Basic Price publication queue (BASIC_PRICE_PUBLISH). Lists
 * verified-but-unpublished prices with human-readable identity + exact price
 * string, and publishes one via POST /basic-price-publications/:id/publish.
 * The backend enforces AUTO_PUBLISH=FORBIDDEN and VERIFIER≠PUBLISHER, so a
 * publisher who verified the price sees an honest 409 CONFLICT, never a fake
 * success. A success banner is sticky across the refetch.
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
    <div className="simprok-rab-workspace">
      <div className="simprok-rab-focus-nav" aria-label="Navigasi Antrean Penerbitan">
        <button onClick={() => navigate('/')} title="Kembali ke Beranda" aria-label="Kembali ke Beranda">
          <ArrowLeft size={17} /> Kembali
        </button>
      </div>

      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Basic Price / Penerbitan</div>
          <h1>Antrean Penerbitan Harga Dasar</h1>
          {/*
            WHAT PENERBITAN ACTUALLY REACHES — said, because the room used to
            leave it to be assumed.

            The heading reads "SIMPROK / Basic Price / Penerbitan" and the
            button reads "Terbitkan Harga", so a publisher had every reason to
            believe they were releasing this price to SIMPROK at large. They
            were not. Publication moves two states on the price and touches
            nothing else — the price keeps the workspace that imported it, and
            the one law every consumer reads (Explorer, AHSP, RAB, Cost Kernel)
            serves it back to that workspace alone. A general SIMPROK-wide
            price would have to belong to no workspace at all, and nothing in
            the product can produce one today.

            So the sentence states the reach in ordinary words. It names no
            field, no scope code and no database concept — the publisher does
            not need the mechanism, only the truth about what their click does.

            AND IT PROMISES AVAILABILITY, NOT USE. An earlier wording of this
            paragraph said the price "menjadi harga resmi yang dipakai" — that
            publication makes it THE price this workspace uses. It does not.
            Publication decides only that a price is lawfully ELIGIBLE; which
            price a calculation actually takes is a separate question the
            eligibility law deliberately refuses to answer, and
            `resolveAhspResourcePrice` returns NEEDS_REVIEW whenever more than
            one compatible candidate survives. Region, effective date, validity
            and unit compatibility all still apply afterwards. "Tersedia untuk
            digunakan ... sesuai konteks yang berlaku" is the whole of what a
            publisher's click can truthfully promise.
          */}
          <p>
            Harga terverifikasi menunggu penerbitan. Setelah diterbitkan, harga
            ini tersedia untuk digunakan di ruang kerja ini sesuai konteks yang
            berlaku. Penerbit harus orang yang berbeda dari yang memverifikasi.
          </p>
        </div>
        <button onClick={reload} title="Muat ulang" aria-label="Muat ulang antrean">
          <RefreshCw size={16} /> Muat ulang
        </button>
      </header>

      {status.kind !== 'idle' ? (
        <p role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p>
      ) : null}

      {state.kind === 'loading' ? <p role="status">Memuat antrean penerbitan...</p> : null}
      {state.kind === 'empty' ? <p>Tidak ada harga terverifikasi yang menunggu penerbitan.</p> : null}
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}

      {state.kind === 'ready' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
          {state.items.map((item) => (
            <section
              key={item.basicPriceId}
              className="simprok-rab-validation-alert simprok-rab-validation-alert--info"
              aria-label={`Penerbitan ${resourceLabel(item.resource)}`}
            >
              <strong>{resourceLabel(item.resource)}</strong>
              <p>
                Wilayah: {regionLabel(item.region)} · Harga: {formatPrice(item.price)} · Berlaku: {item.effectiveDate}
              </p>
              <button
                disabled={busyId !== null}
                onClick={() => void handlePublish(item)}
                title="Terbitkan harga ini agar tersedia untuk digunakan di ruang kerja ini"
              >
                {busyId === item.basicPriceId ? 'Menerbitkan...' : 'Terbitkan Harga'}
              </button>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

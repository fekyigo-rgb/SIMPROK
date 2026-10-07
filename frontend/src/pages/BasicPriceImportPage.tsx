import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileInput } from 'lucide-react';
import {
  ImportRequestError,
  IntakeRefusalError,
  getBasicPriceImportBatch,
  previewBasicPriceImport,
  updateBasicPriceImportBatch,
  type BasicPriceImportMetadata,
  type BasicPriceIntakeSelection,
  type PriceSourceOrigin,
  type PriceSourceType,
} from '../api/basicPriceImport';
import {
  IntakeQuestionPanel,
  intakeQuestionOf,
  intakeRefusalMessage,
  type IntakeAnswerKey,
  type IntakeQuestionModel,
} from '../components/basic-price/IntakeQuestion';
import { kdnMappingQuestionOf } from '../components/basic-price/kdnMappingQuestion';
import { BasicPriceJourneyStepper } from '../components/basic-price/BasicPriceJourneyStepper';
import {
  batchStatusLabel,
  formatBatchProgress,
  metadataGateView,
  metadataSaveExistingBatchId,
  metadataSaveFailureMessage,
  savedMetadataLines,
  effectiveDateCopy,
  reverificationIsOffered,
  REVERIFICATION_NOT_NEEDED_NOTE,
  SOURCE_ORIGIN_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  reimportDecisionView,
  reimportActionPath,
  USED_EXISTING_CONFIRMATION,
  type BasicPriceImportBatchSummary,
  type ReimportDecisionAction,
} from '../utils/basicPriceImportDisplay';
import {
  REVERIFICATION_HELP_TEXT,
  REVERIFICATION_LABEL,
} from '../utils/basicPriceExplorerDisplay';
import { importRequestMessage } from '../utils/basicPriceIntakeErrors';
import { RegionSearchSelect } from '../components/basic-price/RegionSearchSelect';
import type { RegionLookupItem } from '../api/basicPriceWorkflow';
import '../styles/basicPrice.css';

/** Replacing the file is a new reading, never a silent overwrite. */
export const FILE_REPLACE_CONFIRMATION =
  'Memilih berkas lain membuat bacaan baru. Batch yang sedang dibuka tidak ikut pindah. Lanjutkan?';

/**
 * RM-02 Basic Price import — upload -> preview -> confirm metadata -> hand
 * off to the review room (BasicPriceReviewPage). SIMPROK never auto-submits
 * a batch here: this page only ever creates/updates a batch in
 * NEEDS_REVIEW, mirroring the "SIMPROK menghitung, manusia memutuskan"
 * law — the human still resolves every row on the next page.
 *
 * IT ALSO REOPENS AN EXISTING BATCH (`/basic-price/import/:batchId`), and that
 * is not a convenience. Batch metadata was writable here and readable nowhere:
 * once a person left this page the values existed only in the database, so
 * "save, reload, reopen, the values are still there" could not be shown through
 * the product at all — and a batch whose region or source was missing could be
 * discovered only in the review room, which had no way back to fix it.
 *
 * BP-UX-FINAL-01 §12/§13/§14 — WHAT THIS SLICE CHANGED, AND WHAT IT DID NOT.
 *
 * CHANGED: the room now opens by answering the two questions a person arrives
 * with — WHAT DO I DO (choose a file) and WHAT HAPPENS NEXT (SIMPROK reads it,
 * then asks for the context it cannot infer) — and it carries the shared
 * journey stepper, so the batch's position in the wider Basic Price life is
 * visible instead of being something you had to already know. The twelve
 * metadata inputs are grouped into one compact "Konteks Sumber" section rather
 * than a wall of full-width fields.
 *
 * NOT CHANGED: the intake engine, the fingerprint, the re-import semantics, the
 * metadata gate, the requiredness law, the temporal question, or which of the
 * two doors may open. Every verdict on this page is still the server's, read
 * through `metadataGateView` and `reimportDecisionView` exactly as before.
 */
export function BasicPriceImportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Present only on the reopen route. Absent for a fresh upload, which is why
  // this page still opens on an empty file picker by default.
  const { batchId: reopenBatchId } = useParams<{ batchId: string }>();
  const usedExistingFromNav = Boolean(
    (location.state as { usedExisting?: boolean } | null)?.usedExisting,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<BasicPriceImportMetadata>({});
  const [batch, setBatch] = useState<BasicPriceImportBatchSummary | null>(null);
  /**
   * WHICH TEMPORAL QUESTIONS THIS SOURCE ACTUALLY ANSWERS.
   *
   * Read from the server projection, never decided here: requiredness and
   * applicability are source law, and a browser that held its own copy of
   * either is the shadow-path defect this room already exists to prevent. A
   * batch not yet loaded, or a build that has never heard of the code the
   * server sent, both fall to the neutral wording rather than to a blank.
   */
  const temporalCopy = effectiveDateCopy(batch?.temporal?.effectiveDateQuestion);
  const reverificationOffered = reverificationIsOffered(batch?.temporal?.reverification);
  const [region, setRegion] = useState<RegionLookupItem | null>(null);
  const [coveredVillages, setCoveredVillages] = useState<RegionLookupItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Pilih berkas daftar harga (XLSX atau CSV) untuk memulai.');
  // USI-01 — the answers a human has given about THIS file. Empty on the first
  // attempt: SIMPROK asks nothing until the source proves it must.
  const [selection, setSelection] = useState<BasicPriceIntakeSelection>({});
  const [question, setQuestion] = useState<IntakeQuestionModel | null>(null);

  /**
   * HAS THE FORM DIVERGED FROM WHAT SIMPROK ACTUALLY STORED?
   *
   * A browser-only fact the server cannot know, and the reason the review door
   * can re-lock after a save. Every edit sets it; only a SUCCESSFUL save clears
   * it. It is deliberately a flag rather than a form-vs-batch comparison: a
   * comparison would have to know which of the twelve metadata fields count,
   * that list is the server's, and the moment the two drifted the door would
   * quietly open on unsaved work again.
   */
  const [isMetadataDirty, setIsMetadataDirty] = useState(false);
  const [usedExistingNotice, setUsedExistingNotice] = useState(usedExistingFromNav);

  const updateMetadataField = <K extends keyof BasicPriceImportMetadata>(key: K, value: BasicPriceImportMetadata[K]) => {
    setMetadata((current) => ({ ...current, [key]: value }));
    setIsMetadataDirty(true);
  };

  /**
   * REOPEN — load a batch that already exists and show what SIMPROK stored.
   *
   * The form is seeded from the SERVER's values, not remembered ones, so what a
   * person sees after a reload is what is actually on record — including
   * `sourceType`, which is a fact the human stated rather than one the server
   * derives, and so must come back to them exactly as they left it.
   *
   * The region selector needs the region to show, and it arrives only on this
   * read path — so a saved region reads as itself rather than as an empty
   * selector that looks unset.
   */
  useEffect(() => {
    if (!reopenBatchId) return;
    let cancelled = false;
    void (async () => {
      if (!usedExistingFromNav) {
        setStatusMessage('Memuat batch...');
      }
      try {
        const existing = await getBasicPriceImportBatch(reopenBatchId);
        if (cancelled) return;
        setBatch(existing);
        setQuestion(kdnMappingQuestionOf(existing.kdnMapping));
        setMetadata({
          regionId: existing.regionId ?? undefined,
          coveredVillageRegionIds:
            existing.coveredVillageRegions?.map((item) => item.id) ?? undefined,
          effectiveDate: existing.effectiveDate ? existing.effectiveDate.slice(0, 10) : undefined,
          // Read back what was SAVED, so a reopened batch shows the re-verification
          // date a person actually stated rather than an empty box.
          reviewDate: existing.reviewDate ? existing.reviewDate.slice(0, 10) : undefined,
          sourceOrigin: existing.sourceOrigin ?? undefined,
          sourceType: existing.sourceType ?? undefined,
          sourceOrganizationName: existing.sourceOrganizationName ?? undefined,
        });
        setRegion(existing.region ?? null);
        setCoveredVillages(existing.coveredVillageRegions ?? []);
        if (usedExistingFromNav) {
          setUsedExistingNotice(true);
          setStatusMessage(USED_EXISTING_CONFIRMATION);
        } else {
          setStatusMessage(formatBatchProgress(existing));
        }
      } catch (error) {
        if (cancelled) return;
        setStatusMessage(
          error instanceof ImportRequestError
            ? importRequestMessage(error.httpStatus)
            : 'Gagal memuat batch. Muat ulang halaman untuk mencoba lagi.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reopenBatchId, usedExistingFromNav]);

  /**
   * USI-01 — reads a source, and asks at most one question at a time.
   *
   * NOTE WHAT IS NOT SENT: a sheet name. The previous version pinned every
   * upload to one literal sheet name, so any workbook organized differently was
   * rejected before it was ever read. SIMPROK now finds the table by evidence,
   * and only asks when a file genuinely proves more than one reading.
   */
  const readSource = async (
    file: File,
    answers: BasicPriceIntakeSelection,
    /**
     * The context to describe this READ with, passed rather than closed over.
     *
     * A `setMetadata({})` in the same tick has not landed yet, so a caller
     * clearing the previous file's context and reading immediately would still
     * have sent the old one — and these fields are fingerprint inputs, so that
     * is a false provenance claim rather than a stale form. The caller states
     * what it means; nothing here reads state that may be one render behind.
     */
    context: BasicPriceImportMetadata = metadata,
  ) => {
    setIsBusy(true);
    setStatusMessage('SIMPROK sedang membaca berkas...');
    try {
      const result = await previewBasicPriceImport(file, answers, context);
      setBatch(result);
      setQuestion(kdnMappingQuestionOf(result.kdnMapping));
      const nextPath = `/basic-price/import/${result.batchId}`;
      if (location.pathname !== nextPath) {
        navigate(nextPath);
      }
      const decision = reimportDecisionView(result.reimport);
      setStatusMessage(
        decision
          ? decision.title
          : `SIMPROK mengenali daftar harga ini — ${result.totalRows} baris terbaca dari ${file.name}.`,
      );
    } catch (error) {
      setBatch(null);
      if (error instanceof IntakeRefusalError) {
        const next = intakeQuestionOf(error.code, error.details, answers);
        setQuestion(next);
        // A question is not a failure, and is never worded as one.
        setStatusMessage(
          next
            ? 'SIMPROK sudah membaca berkas ini dan menemukan satu hal yang harus Anda putuskan.'
            : intakeRefusalMessage(error.code, error.details),
        );
      } else if (error instanceof ImportRequestError) {
        // NOT A QUESTION ABOUT THE DOCUMENT — and this branch is the whole
        // reason the Owner's door failed the way it did. A denied permission
        // used to arrive as an "intake refusal" and be worded as SIMPROK
        // declining to guess about the workbook. The workbook was never the
        // problem, so it is never blamed: each case names whose limit it is.
        setQuestion(null);
        setStatusMessage(importRequestMessage(error.httpStatus));
      } else {
        setQuestion(null);
        setStatusMessage('Unggahan tidak sampai ke SIMPROK. Periksa koneksi lalu coba lagi.');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileChosen = async (file: File) => {
    if (batch) {
      const proceed = window.confirm(FILE_REPLACE_CONFIRMATION);
      if (!proceed) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }
    setSelectedFile(file);
    // A new file is a new subject: answers given about the previous one must
    // never be carried onto it.
    //
    // METADATA AND REGION BELONG TO THAT RULE TOO, and they were missing from
    // it. `readSource` closes over `metadata` and sends it with the preview,
    // and every one of those fields is a FINGERPRINT input — the fingerprint
    // exists precisely so the same workbook described differently is a
    // different batch. So uploading a second workbook after filling in the
    // first one's region, date and source silently fingerprinted and stored
    // workbook B under workbook A's context: not a stale form, a false
    // provenance claim on real data.
    setSelection({});
    setQuestion(null);
    setMetadata({});
    setRegion(null);
    setCoveredVillages([]);
    setBatch(null);
    setUsedExistingNotice(false);
    await readSource(file, {}, {});
  };

  const handleAnswer = async (key: IntakeAnswerKey, value: string) => {
    if (!selectedFile) return;
    if (key === 'selectedKdnColumn' && value === 'none') {
      setQuestion(null);
      return;
    }
    const isColumn =
      key === 'selectedNameColumn' ||
      key === 'selectedUnitColumn' ||
      key === 'selectedKdnColumn';
    const answers = { ...selection, [key]: isColumn ? Number(value) : value };
    setSelection(answers);
    await readSource(selectedFile, answers);
  };

  const handleSaveMetadata = async () => {
    if (!batch) return;
    setIsBusy(true);
    setStatusMessage('Menyimpan konteks sumber...');
    try {
      const updated = await updateBasicPriceImportBatch(batch.batchId, batch.version, metadata);
      setBatch(updated);
      // The region the SERVER now holds, not the one this form happened to be
      // carrying. They agree today; seeding from the answer is what keeps the
      // selector showing a SAVED region rather than a chosen one.
      setRegion(updated.region ?? null);
      setCoveredVillages(updated.coveredVillageRegions ?? []);
      // ONLY A SUCCESSFUL SAVE CLEARS IT. The catch below deliberately leaves
      // the form dirty, so a failed save cannot open the review door.
      setIsMetadataDirty(false);
      setStatusMessage('Konteks sumber tersimpan.');
    } catch (error) {
      const existingBatchId =
        error instanceof ImportRequestError
          ? metadataSaveExistingBatchId(error.httpStatus, error.detail)
          : null;
      if (existingBatchId) {
        // This exact context is already persisted. Follow the server-named
        // owner through the existing re-import route; its GET must succeed
        // before the page confirms anything. No retry, merge, or local success.
        const path = reimportActionPath('USE_EXISTING', {
          existingBatchId,
          updateBatchId: null,
        });
        if (path) {
          navigate(path, { replace: true, state: { usedExisting: true } });
          return;
        }
      }
      // NAMED, NOT GUESSED. The old line told every failure that the batch
      // "mungkin sudah berubah" — including an expired session and a missing
      // authority, which it is not. This is the save that carries the region, so
      // a person who cannot save must be told what actually stopped them.
      setStatusMessage(
        error instanceof ImportRequestError
          ? metadataSaveFailureMessage(error.httpStatus, error.detail)
          : 'Penyimpanan tidak sampai ke SIMPROK. Periksa koneksi lalu coba lagi. Tidak ada yang tersimpan.',
      );
    } finally {
      setIsBusy(false);
    }
  };

  // WHAT THE TWO DOORS MAY OFFER. The requiredness law is the server's; this
  // combines its verdict with the one fact only the browser holds.
  const metadataGate = metadataGateView(batch, metadata, isMetadataDirty, isBusy);
  const reimportView = reimportDecisionView(batch?.reimport);
  /**
   * A const, so the null check below still holds inside the click handler it
   * guards. An exact replay leaves this null and the card shows one action.
   */
  const reimportSecondary = reimportView?.secondary ?? null;

  const handleReimportAction = (action: ReimportDecisionAction) => {
    const relation = batch?.reimport;
    if (!relation) return;
    const path = reimportActionPath(action, relation);
    if (!path) return;
    if (action === 'USE_EXISTING') {
      // The click itself is the choice. Nothing is written: the server already
      // named the existing batch. The decision card must not remain as if the
      // person still had to decide, and the status must not be overwritten by
      // a progress line that never mentions the choice.
      setUsedExistingNotice(true);
      setStatusMessage(USED_EXISTING_CONFIRMATION);
      setBatch((current) =>
        current ? { ...current, reimport: undefined } : current,
      );
    }
    if (path !== location.pathname) {
      navigate(path, {
        state: action === 'USE_EXISTING' ? { usedExisting: true } : undefined,
      });
    }
  };

  return (
    <div className="bp-room">
      {/*
        BACK TO THE BASIC PRICE ROOM, NOT TO THE DASHBOARD (§19). This used to
        land on `/`, which meant leaving the import flow dropped a person two
        rooms away from where they had been working. The Explorer is the room
        this journey starts and ends in.
      */}
      <div className="bp-head__doors" aria-label="Navigasi Impor Basic Price">
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
          <div className="bp-head__crumb">SIMPROK / Basic Price / Impor</div>
          <h1 className="bp-head__title">Impor / Tambah Harga</h1>
          {/*
            "sebelum diajukan" named no destination, in the one paragraph that
            introduces the whole flow — so the reader met the curation word
            before they met the curation door, and before the far more likely
            outcome, which is keeping the price for this workspace.
          */}
          <p className="bp-head__sub">
            Unggah daftar harga (tenaga kerja, bahan, atau peralatan). SIMPROK
            membaca dan menghitung; setiap baris tetap menunggu keputusan manusia
            sebelum disimpan.
          </p>
        </div>
        <div className="bp-head__actions">
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".xlsx,.csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFileChosen(file);
            }}
          />
          <button
            type="button"
            className="bp-btn bp-btn--primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            aria-disabled={isBusy}
            title="Pilih berkas daftar harga (XLSX atau CSV)"
            aria-label="Pilih berkas daftar harga"
          >
            <FileInput size={14} /> {batch ? 'Pilih Berkas Lain' : 'Pilih Berkas Daftar Harga'}
          </button>
        </div>
      </header>

      {/*
        WHERE THIS BATCH IS IN THE WHOLE JOURNEY (§12). A projection of the
        batch's own fields — see `journeyView`. It states nothing the payload
        does not prove, and it is the same bar the row-review room shows, so
        crossing between the two rooms does not lose the thread.
      */}
      <BasicPriceJourneyStepper batch={batch} />

      <p className="bp-note bp-note--info" aria-live="polite">
        {statusMessage}
      </p>

      {question ? (
        <IntakeQuestionPanel question={question} disabled={isBusy} onAnswer={(key, value) => void handleAnswer(key, value)} />
      ) : null}

      {reimportView ? (
        <section className="bp-note bp-note--attention" aria-label="Impor sebelumnya">
          <strong className="bp-section-title">{reimportView.title}</strong>
          <p>{reimportView.body}</p>
          {reimportView.historyNote ? <p className="bp-muted">{reimportView.historyNote}</p> : null}
          {reimportView.differenceNote ? (
            <details className="bp-details">
              <summary>Lihat perbedaannya</summary>
              <p>{reimportView.differenceNote}</p>
            </details>
          ) : null}
          <div className="bp-rowcard__actions">
            <button
              type="button"
              className="bp-btn bp-btn--primary"
              onClick={() => handleReimportAction(reimportView.primary.action)}
              disabled={isBusy}
              aria-disabled={isBusy}
            >
              {reimportView.primary.label}
            </button>
            {/*
              NO SECOND BUTTON WHEN THERE IS NO SECOND BATCH. An exact replay has
              one existing batch and one truthful thing to do with it, so the card
              offers one action; choosing a different file is already the header
              above. An update names two batches and keeps both.
            */}
            {reimportSecondary ? (
              <button
                type="button"
                className="bp-btn"
                onClick={() => handleReimportAction(reimportSecondary.action)}
                disabled={isBusy}
                aria-disabled={isBusy}
              >
                {reimportSecondary.label}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {batch && !reimportView ? (
        <section className="bp-detail" aria-label="Konteks Sumber Harga">
          <div className="bp-detail__head">
            <div>
              <div className="bp-detail__name">{selectedFile?.name ?? 'Batch impor'}</div>
              <div className="bp-detail__meta">
                {batchStatusLabel(batch.status)} · {formatBatchProgress(batch)}
              </div>
            </div>
          </div>

          <div className="bp-tabpanel">
            {usedExistingNotice ? <p aria-live="polite">{USED_EXISTING_CONFIRMATION}</p> : null}

            {/*
              SIMPROK NEEDS CONTEXT, NOT JUST A NUMBER (§14) — said once, at the
              top of the section that asks for it, instead of being inferred
              from a grid of unexplained boxes.
            */}
            <p className="bp-field__help" style={{ marginBottom: '12px' }}>
              SIMPROK sudah membaca angkanya. Yang belum diketahui adalah dari
              mana harga ini berasal dan kapan berlaku — konteks itu tidak bisa
              ditebak dari isi berkas.
            </p>

            <div className="bp-filters" style={{ border: 'none', padding: 0 }}>
              {/*
                TWO QUESTIONS, BECAUSE THERE ARE TWO FACTS.

                "Jenis Sumber Harga" was briefly deleted from this form on the
                reasoning that an origin implies exactly one type, so asking twice
                was asking a question with one answer. That reasoning was wrong, and
                Owner law says so in as many words
                (BASIC-PRICE-MASTER-DECISION §10):

                    SOURCE_TYPE != SOURCE_ORIGIN

                "Asal Sumber" is WHO the price came from in the world. "Jenis
                Sumber" is WHAT KIND OF STATEMENT the document is. A government
                agency can publish a market survey; a supplier can circulate a
                regulated tariff. Deleting the second question did not simplify the
                form, it made those documents undescribable — and the server then
                filled the gap with a guess.
              */}
              <div className="bp-field">
                <label className="bp-field__label" htmlFor="bp-src-origin">Asal data</label>
                <select
                  id="bp-src-origin"
                  className="bp-select"
                  value={metadata.sourceOrigin ?? ''}
                  onChange={(event) => updateMetadataField('sourceOrigin', (event.target.value || undefined) as PriceSourceOrigin | undefined)}
                >
                  <option value="">— Belum dipilih —</option>
                  {SOURCE_ORIGIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>

              <div className="bp-field">
                <label className="bp-field__label" htmlFor="bp-src-type">Metode perolehan</label>
                <select
                  id="bp-src-type"
                  className="bp-select"
                  value={metadata.sourceType ?? ''}
                  onChange={(event) => updateMetadataField('sourceType', (event.target.value || undefined) as PriceSourceType | undefined)}
                >
                  <option value="">— Belum dipilih —</option>
                  {SOURCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>

              {/*
                WHO PUBLISHED THIS PRICE — the question nothing was asking.

                The batch has carried sourceOrganizationName and sourceVendorName
                since RM-02, and the Basic Price Explorer reads them for its
                SUMBER column — but NO control anywhere ever set either. So every
                imported price told the Owner "Sumber tidak tersedia", not because
                the projection dropped it, but because nobody had ever been asked.
              */}
              <div className="bp-field">
                <label className="bp-field__label" htmlFor="bp-src-org">
                  Nama sumber
                </label>
                <input
                  id="bp-src-org"
                  className="bp-input"
                  type="text"
                  value={metadata.sourceOrganizationName ?? ''}
                  placeholder="mis. Dinas PUPR Kota Ambon"
                  onChange={(event) =>
                    updateMetadataField('sourceOrganizationName', event.target.value || undefined)
                  }
                />
              </div>

              {/*
                THE SAME REQUIRED DAY, ASKED IN THE WORDS THAT ARE TRUE HERE.

                This read "Tanggal Berlaku" for every source that has ever
                existed, and for most of the Owner's data that is a false claim: a
                market survey does not BECOME effective on a day, it was OBSERVED
                on one. Only a regulation genuinely states a start — which is why
                that case keeps precisely that meaning, and may name a day months
                ahead.

                THE SERVER CHOOSES WHICH QUESTION, this file owns the words, and
                nothing about the stored column or its requiredness moved.
              */}
              <div className="bp-field bp-field--date bp-date-help">
                <label className="bp-field__label bp-date-help__trigger" htmlFor="bp-src-date">
                  {temporalCopy.label}
                </label>
                <input
                  id="bp-src-date"
                  className="bp-input"
                  type="date"
                  value={metadata.effectiveDate ?? ''}
                  aria-describedby="simprok-effective-date-help"
                  onChange={(event) => updateMetadataField('effectiveDate', event.target.value || undefined)}
                />
                {/*
                  BP-VISUAL-TRUTH-07 §20/§21 — THE EXPLANATION STAYS; IT STOPS
                  STANDING PERMANENTLY OPEN.

                  This paragraph is the longest text in the form and it sat
                  under a single date box, making one field roughly three times
                  the height of its neighbours and pushing the rest of Konteks
                  Sumber down the page. §20 forbids deleting truthful
                  explanation to make a screen sparse — so it is not deleted, it
                  moves into SIMPROK's existing absolute tooltip pattern. The
                  canonical wording is unchanged and the tooltip stays outside
                  form flow, so it adds no row or field height.

                  ACCESSIBILITY STAYS EXPLICIT. The tooltip remains mounted and
                  the input's `aria-describedby` resolves to it; keyboard focus
                  exposes the same text as hover on the label or input.
                */}
                <span
                  id="simprok-effective-date-help"
                  className="bp-date-help__tooltip"
                  role="tooltip"
                >
                  {temporalCopy.help}
                </span>
              </div>

              {/*
                A SECOND, DIFFERENT DATE FACT — and it gets its own label for
                exactly that reason. "Tanggal Berlaku" above is the source's own
                effective-start fact. This one is advice: when should somebody
                look at this price again. One ambiguous date box carrying both
                meanings is how a hard boundary and a recommendation get
                confused, and only the first is enforced anywhere.

                AND IT IS ONLY WORTH ASKING FOR DATA THAT AGES IN SILENCE. An
                uploaded workbook is a snapshot; a live system-to-system feed
                reports its own freshness, and asking a person to PREDICT when a
                machine-updated price goes stale manufactures precision nobody
                has. The reason is said out loud rather than left as a control
                that quietly vanished.
              */}
              {reverificationOffered ? (
                <div className="bp-field bp-date-help">
                  <label className="bp-field__label bp-date-help__trigger" htmlFor="bp-src-review">
                    {REVERIFICATION_LABEL} (opsional)
                  </label>
                  <input
                    id="bp-src-review"
                    className="bp-input"
                    type="date"
                    value={metadata.reviewDate ?? ''}
                    aria-describedby="simprok-review-date-help"
                    onChange={(event) =>
                      updateMetadataField('reviewDate', event.target.value || undefined)
                    }
                  />
                  <span
                    id="simprok-review-date-help"
                    className="bp-date-help__tooltip"
                    role="tooltip"
                  >
                    {REVERIFICATION_HELP_TEXT.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </span>
                </div>
              ) : (
                <p className="bp-field__help">{REVERIFICATION_NOT_NEEDED_NOTE}</p>
              )}

              <RegionSearchSelect
                selected={region}
                coveredVillages={coveredVillages}
                disabled={isBusy}
                onSelect={(next) => {
                  setRegion(next);
                  updateMetadataField('regionId', next?.id ?? undefined);
                }}
                onCoveredVillagesChange={(next) => {
                  setCoveredVillages(next);
                  updateMetadataField(
                    'coveredVillageRegionIds',
                    next.map((item) => item.id),
                  );
                }}
              />
            </div>

            <div className="bp-pop__section">
              <span className="bp-pop__label">Tercatat di SIMPROK</span>
              <div className="bp-stack bp-stack--tight" aria-label="Yang sudah tersimpan di SIMPROK">
                {savedMetadataLines(batch).map((line) => (
                  <span key={line} className="bp-field__help">{line}</span>
                ))}
              </div>
            </div>

            {/*
              THE DOOR IS THE SERVER'S VERDICT, NOT THIS FORM'S OPINION.
              `metadataGateView` reads the batch's own `reviewGate` and combines
              it with the one fact only the browser knows — whether this form has
              been edited since the last successful save.
            */}
            <p className="bp-field__help" aria-live="polite" style={{ marginTop: '12px' }}>
              {metadataGate.message}
            </p>
            <div className="bp-rowcard__actions">
              <button
                type="button"
                className="bp-btn"
                onClick={() => void handleSaveMetadata()}
                disabled={!metadataGate.saveEnabled}
                aria-disabled={!metadataGate.saveEnabled}
              >
                {isBusy ? 'Menyimpan...' : 'Simpan Konteks Sumber'}
              </button>
              <button
                type="button"
                className="bp-btn bp-btn--primary"
                onClick={() => navigate(`/basic-price/import/${batch.batchId}/review`)}
                disabled={!metadataGate.reviewEnabled}
                aria-disabled={!metadataGate.reviewEnabled}
              >
                Lanjut ke Peninjauan Baris
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

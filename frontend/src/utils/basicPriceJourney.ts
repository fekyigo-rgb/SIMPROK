// BP-UX-FINAL-01 §11/§12 — THE LIFE OF A PRICE, MADE VISIBLE.
//
// The largest UX gap in Basic Price was never a missing feature: every stage of
// intake -> reading -> source context -> row review -> proposal -> curation ->
// publication was already built, routed and permission-gated. What was missing
// was any way for a person standing in one of those rooms to see WHERE THEY
// ARE and WHAT COMES NEXT.
//
// THIS FILE INVENTS NO WORKFLOW. It is a PROJECTION over facts the batch
// endpoint already sends — `status`, `actions.reviewGate`, `needsReviewRows`,
// `submittedRows`, `alreadyPrivateRows`, `actions.simprokProposal` — and it
// persists nothing, requests nothing, and can move no batch between states.
// Every stage's verdict below traces to a named field; where the payload
// cannot prove a stage, the stage says UPCOMING rather than guessing.
//
// AND THE JOURNEY IS NOT ONE LINE, WHICH IS THE PART A SIX-STEP BAR GETS
// WRONG. Canonical law offers TWO lawful outcomes after row review, not one:
//
//   SIMPAN & GUNAKAN  the ordinary path. Finished rows become workspace-private
//                     Basic Prices, usable at once, and they never enter
//                     curation at all. This is what every price in the Owner's
//                     canonical database actually did.
//
//   USULKAN           optional, separate and terminal. It creates PriceSubmissions
//                     for SIMPROK's curators and closes the batch. It is offered
//                     only for the source families SIMPROK routes to community
//                     curation.
//
// Drawing `Usulkan -> Verifikasi -> Diterbitkan` as the inevitable continuation
// of every import would therefore be a fake workflow state — the exact thing
// §12 forbids. So the proposal stage carries `optional: true`, and a batch
// whose source family is not routed to curation says so instead of showing
// three steps it will never take.
import {
  communityCurationPathApplies,
  proposalBlockSentence,
  rowMachineState,
  type BasicPriceImportBatchSummary,
  type BasicPriceImportRowSummary,
} from './basicPriceImportDisplay.ts';

/**
 * What a stage is doing right now.
 *
 * `NOT_OFFERED` is deliberately distinct from `UPCOMING`: "this will happen
 * later" and "this will not happen for this batch" are different truths, and a
 * greyed-out step that means the second while looking like the first is the
 * dishonest door Hukum Pintu rules out.
 */
export type JourneyStageState =
  | 'DONE'
  | 'CURRENT'
  | 'ATTENTION'
  | 'UPCOMING'
  | 'NOT_OFFERED';

export interface JourneyStage {
  key: string;
  label: string;
  state: JourneyStageState;
  /** Shown on hover/description. One short sentence, never a paragraph. */
  hint: string;
  /** True for a stage a lawful batch may skip entirely. */
  optional: boolean;
}

export interface JourneyView {
  stages: JourneyStage[];
  /**
   * The one sentence under the bar, or null when the stages already say
   * everything. Used for the truths a stepper cannot draw — chiefly that
   * curation is optional, and that saved prices are already usable.
   */
  note: string | null;
}

/**
 * The six stages, in the order a person meets them. Keys are stable so a test
 * can pin a stage without depending on its wording.
 */
export const JOURNEY_STAGE_KEYS = [
  'FILE',
  'SOURCE',
  'ROWS',
  'PROPOSE',
  'VERIFY',
  'PUBLISH',
] as const;

/**
 * WHY `Diterbitkan` AND NOT `Published`.
 *
 * §12 names the conceptual stage in English, and §11 requires the visible
 * wording to follow real canonical behaviour. The room that performs this act
 * is `/basic-price/publications`, its heading reads "Antrean Penerbitan Harga
 * Dasar" and its button reads "Terbitkan Harga" — so the person who reaches
 * this stage meets the Indonesian word. Two names for one act is how a user
 * loses the thread.
 */
const STAGE_LABELS: Record<(typeof JOURNEY_STAGE_KEYS)[number], string> = {
  FILE: 'Pilih Berkas',
  SOURCE: 'Lengkapi Sumber',
  ROWS: 'Tinjau Hasil',
  PROPOSE: 'Usulkan',
  VERIFY: 'Verifikasi',
  PUBLISH: 'Diterbitkan',
};

/** The batch states in which no further work is possible on this batch. */
const CLOSED_STATUSES = new Set(['SUBMITTED', 'REJECTED', 'SUPERSEDED']);

/**
 * Project one batch onto the journey.
 *
 * `batch` is null before a file has been read — the entrance state, where only
 * the first stage is live and nothing else has a verdict to report.
 */
export function journeyView(batch: BasicPriceImportBatchSummary | null): JourneyView {
  if (!batch) {
    return {
      stages: [
        stage('FILE', 'CURRENT', 'Pilih berkas daftar harga (XLSX atau CSV).'),
        stage('SOURCE', 'UPCOMING', 'SIMPROK akan menanyakan konteks sumber harga.'),
        stage('ROWS', 'UPCOMING', 'Hasil pembacaan ditinjau baris per baris.'),
        stage('PROPOSE', 'UPCOMING', 'Opsional: usulkan harga ke kurasi SIMPROK.', true),
        stage('VERIFY', 'UPCOMING', 'Kurator SIMPROK memeriksa harga yang diusulkan.'),
        stage('PUBLISH', 'UPCOMING', 'Harga yang lolos kurasi diterbitkan.'),
      ],
      note: null,
    };
  }

  const gate = batch.actions.reviewGate;
  const closed = CLOSED_STATUSES.has(batch.status);
  const proposal = batch.actions.simprokProposal;
  const proposed = batch.submittedRows > 0;
  const kept = batch.alreadyPrivateRows ?? 0;

  // 1. FILE — a batch exists, so a file was read. Nothing else to prove.
  const file = stage('FILE', 'DONE', `${batch.totalRows} baris terbaca dari berkas ini.`);

  // 2. SOURCE — the SERVER's gate verdict, never a form's opinion. Metadata
  // that is present but self-contradictory is ATTENTION, not "belum lengkap":
  // the review gate reports those as two different reason codes and the
  // stepper must not collapse them back into one.
  const source: JourneyStage = gate.reviewAllowed
    ? stage('SOURCE', 'DONE', 'Konteks sumber sudah lengkap dan diterima SIMPROK.')
    : gate.metadataComplete && !gate.metadataCoherent
      ? stage('SOURCE', 'ATTENTION', 'Konteks sumber sudah diisi tetapi belum konsisten.')
      : stage('SOURCE', 'CURRENT', 'Lengkapi konteks sumber sebelum peninjauan baris dibuka.');

  // 3. ROWS — decided rows versus rows still waiting for a human.
  const rows: JourneyStage =
    batch.needsReviewRows === 0
      ? stage('ROWS', 'DONE', 'Semua baris sudah diputuskan.')
      : gate.reviewAllowed
        ? stage('ROWS', 'CURRENT', `${batch.needsReviewRows} baris masih menunggu keputusan Anda.`)
        : stage('ROWS', 'UPCOMING', 'Terbuka setelah konteks sumber lengkap.');

  // 4. PROPOSE — optional, and honest about being unavailable.
  //
  // BP-SHARED-PROPOSAL-01 — `offered === false` is NOT always "never routed".
  // Write-not-ready (e.g. BATCH_NOT_READY_FOR_REVIEW on FIELD_PRICE) means the
  // door exists but cannot be pressed yet. `NOT_OFFERED` / "tidak dirutekan"
  // is reserved for families the server marks as never community-curated.
  const curationApplies = communityCurationPathApplies(proposal, proposed);

  const propose: JourneyStage = proposed
    ? stage('PROPOSE', 'DONE', `${batch.submittedRows} harga sudah diusulkan ke SIMPROK.`, true)
    : proposal.offered
      ? stage('PROPOSE', 'CURRENT', 'Opsional: usulkan batch ini ke kurasi SIMPROK.', true)
      : curationApplies
        ? stage(
            'PROPOSE',
            'CURRENT',
            proposalBlockSentence(proposal.reasonCode) ??
              'Opsional: usulkan batch ini ke kurasi SIMPROK setelah semua baris siap.',
            true,
          )
        : stage('PROPOSE', 'NOT_OFFERED', 'Batch ini tidak dirutekan ke kurasi SIMPROK.', true);

  /*
   * BP-UX-FINAL-01C GAP-F — "LATER" AND "NOT AT ALL" ARE DIFFERENT TRUTHS.
   *
   * `UPCOMING` is a PROMISE: this will happen, further along. For a batch whose
   * source family SIMPROK does not route to community curation, that promise is
   * false three times over — the batch will never be proposed, so it will never
   * be verified, and it will never be published through that ladder. Drawing
   * two greyed steps labelled "belum dimulai" told a person to wait for doors
   * that will not open, and quietly framed the ORDINARY outcome (Simpan &
   * Gunakan) as an unfinished version of the exceptional one.
   *
   * So the whole curation tail collapses to NOT_OFFERED together. It is one
   * fact — this batch does not take that path — and it must be stated once,
   * consistently, rather than at the first step and then forgotten.
   *
   * BP-SHARED-PROPOSAL-01 — curationApplies follows server sourceFamily /
   * reasonCode, not only `offered`. A batch that HAS been proposed keeps its
   * real progress, whatever the flag says afterwards.
   */

  // 5. VERIFY — a real PriceSubmission is genuinely waiting for a curator once
  // rows have been proposed. Before that there is nothing to verify.
  const verify: JourneyStage = proposed
    ? stage('VERIFY', 'CURRENT', 'Menunggu peninjauan kurator SIMPROK.')
    : curationApplies
      ? stage('VERIFY', 'UPCOMING', 'Berlaku hanya untuk harga yang diusulkan ke SIMPROK.')
      : stage('VERIFY', 'NOT_OFFERED', 'Tidak berlaku: batch ini tidak dirutekan ke kurasi SIMPROK.');

  /*
   * 6. PUBLISH — NEVER MARKED DONE FROM HERE, AND THAT IS NOT A LIMITATION
   * WORTH HIDING.
   *
   * Publication is a decision taken about a BasicPrice in another room by
   * another authority; the import batch carries no field that records it, and
   * the browser has no lawful read that would prove it. So this stage is never
   * DONE however far a batch has travelled. Inferring it from `submittedRows`
   * would be inventing a governance verdict out of an intake count — a fake
   * status in the most expensive place to put one.
   */
  const publish: JourneyStage = curationApplies
    ? stage('PUBLISH', 'UPCOMING', 'Keputusan penerbitan diambil di ruang kurasi SIMPROK.')
    : stage('PUBLISH', 'NOT_OFFERED', 'Tidak berlaku: batch ini tidak dirutekan ke kurasi SIMPROK.');

  return {
    stages: [file, source, rows, propose, verify, publish],
    note: journeyNote({
      kept,
      proposed,
      closed,
      proposalOffered: proposal.offered,
      curationApplies,
    }),
  };
}

/**
 * THE SENTENCE A BAR CANNOT DRAW.
 *
 * Chiefly one thing: that prices already saved for this workspace are USABLE
 * NOW and are not waiting on any of the three stages to the right of them.
 * Without it the bar reads as an unfinished journey over work that is, in
 * fact, finished — which is how the ordinary path came to look like a failure
 * to complete the exceptional one.
 */
function journeyNote(facts: {
  kept: number;
  proposed: boolean;
  closed: boolean;
  proposalOffered: boolean;
  curationApplies: boolean;
}): string | null {
  if (facts.kept > 0 && facts.proposed) {
    return `${facts.kept} harga sudah tersimpan dan bisa dipakai sekarang di ruang kerja ini. Usulan ke SIMPROK berjalan terpisah.`;
  }
  if (facts.kept > 0) {
    return `${facts.kept} harga sudah tersimpan dan bisa dipakai sekarang di ruang kerja ini — tanpa menunggu kurasi SIMPROK.`;
  }
  if (facts.closed) {
    return 'Batch ini sudah ditutup. Tidak ada baris baru yang bisa diputuskan di sini.';
  }
  // "Tidak berlaku untuk sumber ini" only when the family is never curated —
  // not when the write is merely blocked (FIELD_PRICE + BATCH_NOT_READY).
  if (!facts.curationApplies) {
    return 'Harga yang selesai ditinjau langsung tersimpan untuk ruang kerja ini. Kurasi SIMPROK tidak berlaku untuk sumber ini.';
  }
  if (!facts.proposalOffered) {
    return 'Menyimpan untuk ruang kerja ini dan mengusulkan ke SIMPROK adalah dua jalur terpisah — usulan menunggu semua baris selesai.';
  }
  return 'Menyimpan untuk ruang kerja ini dan mengusulkan ke SIMPROK adalah dua jalur terpisah — keduanya boleh dilakukan.';
}

function stage(
  key: (typeof JOURNEY_STAGE_KEYS)[number],
  state: JourneyStageState,
  hint: string,
  optional = false,
): JourneyStage {
  return { key, label: STAGE_LABELS[key], state, hint, optional };
}

// ── Row-review counters (§15) ───────────────────────────────────────────────

export interface ReviewCounter {
  key: string;
  label: string;
  value: number;
  tone: 'neutral' | 'ok' | 'attention';
}

/**
 * The counters at the top of the row-review room — EVERY ONE A FIELD THE
 * SERVER SENT.
 *
 * "Belum dikenali" is deliberately absent. The obvious way to produce it is
 * `needsReviewRows - identityPairProvenRows`, and those two sets overlap: a
 * row SIMPROK has proven an identity pair for may already be finished, so the
 * subtraction is arithmetic across two different questions and would print a
 * number nobody can trace. §15 says do not invent counts, so four counted
 * facts are shown and the fifth is not manufactured.
 *
 * `Ditolak` appears only when it is non-zero — a permanent zero beside three
 * live numbers reads as a problem that is not there.
 */
export function reviewCounters(batch: BasicPriceImportBatchSummary): ReviewCounter[] {
  const counters: ReviewCounter[] = [
    { key: 'READ', label: 'Baris terbaca', value: batch.totalRows, tone: 'neutral' },
    {
      key: 'PROVEN',
      label: 'Dikenali otomatis',
      value: batch.identityPairProvenRows,
      tone: 'ok',
    },
    {
      /**
       * BP-VISUAL-TRUTH-07 §16 — ONE TERM, ONE MEANING.
       *
       * This counter is `needsReviewRows`: every row that is not finished. The
       * room below then splits that very number into "N perlu keputusan Anda"
       * and "N belum dikenali" — two genuinely different requests to the
       * reviewer. Naming the PARENT "Perlu keputusan" gave one phrase two sizes
       * on one screen: the Owner read `894 Perlu keputusan` above
       * `222 perlu keputusan Anda · 672 belum dikenali` and had no way to tell
       * which 894 was meant, or where the other 672 had gone.
       *
       * "Belum selesai" is the honest name for the union. It is what these rows
       * actually have in common, it belongs to neither child class, and it
       * hides nothing — the breakdown still names both classes and both counts,
       * unchanged.
       */
      key: 'NEEDS_DECISION',
      label: 'Belum selesai',
      value: batch.needsReviewRows,
      tone: 'attention',
    },
    {
      key: 'DECIDED',
      label: 'Selesai ditinjau',
      value: batch.readyForSubmissionRows,
      tone: 'ok',
    },
  ];
  if (batch.rejectedRows > 0) {
    counters.push({
      key: 'REJECTED',
      label: 'Ditolak',
      value: batch.rejectedRows,
      tone: 'neutral',
    });
  }
  return counters;
}

// ── Row tone (§15) ──────────────────────────────────────────────────────────

/**
 * THE THREE THINGS A ROW CAN BE, AND THE ONE IT MUST NOT BE PAINTED AS.
 *
 * §15's whole point is that MACHINE-PROVEN, HUMAN-DECISION-REQUIRED and
 * TRULY-REJECTED are three different situations, and the review room used to
 * render all of them in the same alert card — so eighty-six rows of ordinary,
 * successfully-read data looked like eighty-six problems.
 *
 * RED IS RESERVED FOR AN ACTUAL REJECTION. A row a human turned down is the
 * only red thing on this page. A row SIMPROK could not identify is UNRESOLVED,
 * which is attention, not failure: nothing went wrong, the file simply did not
 * prove enough and a person has to say. Painting that red says SIMPROK failed
 * at something it was never able to do.
 *
 * The verdict is READ, never computed: `rowMachineState` is the existing shared
 * authority-reading helper, and `savedAsPrivatePrice` and `status` are server
 * facts. Nothing here re-decides whether a row is proven.
 */
export type RowTone = 'proven' | 'attention' | 'rejected' | 'neutral';

export function rowTone(row: BasicPriceImportRowSummary): RowTone {
  if (row.status === 'REJECTED') return 'rejected';
  // Decided, stored, or already proposed — the work on this row is finished,
  // whichever of the two lawful outcomes it took.
  if (row.savedAsPrivatePrice) return 'proven';
  if (row.status === 'READY_FOR_SUBMISSION' || row.status === 'SUBMISSION_CREATED') return 'proven';
  // Still open. Proven by the machine reads as safe-and-waiting; anything else
  // reads as waiting-for-a-person.
  return rowMachineState(row) === 'PROVEN' ? 'proven' : 'attention';
}

export const ROW_TONE_CLASS: Record<RowTone, string> = {
  proven: 'bp-rowcard--proven',
  attention: 'bp-rowcard--attention',
  rejected: 'bp-rowcard--rejected',
  neutral: '',
};

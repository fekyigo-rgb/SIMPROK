/**
 * ACG-01 OWNER BROWSER GAP — FINDING C. What a person is told after pressing an
 * action in the AHSP room or on the Import AHSP door.
 *
 * IDLE → ACTION → PROCESSING → SUCCESS | PARTIAL | FAILURE → VISIBLE NEW STATE.
 *
 * Three rules hold every sentence here:
 *  - SUCCESS is said only for what the server answered 2xx for, and only in the
 *    words of what was actually recorded.
 *  - FAILURE always says that the change was not (or cannot be shown to be)
 *    saved, the reason ONLY when the server sent one this module knows, and
 *    what the reader can do next. A reason is never invented.
 *  - The outcome is shown WHERE the action was pressed, not in a distant banner:
 *    `placeOutcomes` keeps a decided item's receipt at the position the item
 *    occupied, even after the refreshed list no longer contains it.
 *
 * Words only — no endpoint, no state, no decision is made here.
 */

import { USULKAN_MODAL_BODY_2 } from './ahspProposalCopy.ts';

export type OutcomeTone = 'SUCCESS' | 'PENDING' | 'FAILURE' | 'NOTE';

export interface OutcomeLine {
  readonly tone: OutcomeTone;
  readonly text: string;
}

export interface ActionOutcome {
  /** SUCCESS: everything asked was saved. PARTIAL: some was. FAILURE: nothing is known to be saved. */
  readonly kind: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
  readonly lines: readonly OutcomeLine[];
}

/** The refusal as the server sent it. `status` null means no answer arrived at all. */
export interface ApiFailure {
  readonly status: number | null;
  /** The server's own `message` (a code such as OBSERVATION_ALREADY_DECIDED), or null. */
  readonly code: string | null;
}

export const NETWORK_FAILURE: ApiFailure = { status: null, code: null };

/** Read what the server said. An unreadable body is simply no code — never a guessed one. */
export async function readApiFailure(
  response: Pick<Response, 'status' | 'json'>,
): Promise<ApiFailure> {
  try {
    const body: unknown = await response.json();
    const message =
      body !== null && typeof body === 'object' ? (body as { message?: unknown }).message : null;
    return { status: response.status, code: typeof message === 'string' && message !== '' ? message : null };
  } catch {
    return { status: response.status, code: null };
  }
}

export interface FailureExplanation {
  /** Why, in the reader's words — null when the server said nothing this module knows. */
  readonly reason: string | null;
  /** What the reader can do now. Always present. */
  readonly next: string;
}

const RETRY = 'Coba lagi. Bila tetap gagal, muat ulang halaman.';

/**
 * The reason that follows from the HTTP status alone, for when no known code was
 * sent. Each is the category the status actually means — nothing more specific.
 */
export const explainStatus = (failure: ApiFailure, forbiddenReason: string): FailureExplanation => {
  if (failure.status === null) {
    return { reason: 'Sambungan ke server terputus sebelum jawaban diterima.', next: RETRY };
  }
  if (failure.status === 401) {
    return { reason: 'Sesi masuk Anda sudah berakhir.', next: 'Masuk kembali, lalu coba lagi.' };
  }
  if (failure.status === 403) {
    return { reason: forbiddenReason, next: 'Hubungi pengelola workspace bila tindakan ini seharusnya diizinkan.' };
  }
  if (failure.status >= 500) {
    return { reason: 'Terjadi kesalahan di server.', next: 'Coba lagi sebentar lagi.' };
  }
  return { reason: null, next: RETRY };
};

/** Failure lines in the one fixed order: headline, what was (not) saved, why, what next. */
export const failureLines = (
  headline: string,
  savedNote: string,
  explanation: FailureExplanation,
): OutcomeLine[] => [
  { tone: 'FAILURE', text: headline },
  { tone: 'NOTE', text: savedNote },
  ...(explanation.reason ? [{ tone: 'NOTE' as const, text: explanation.reason }] : []),
  { tone: 'NOTE', text: explanation.next },
];

/** What is honestly known about persistence when nothing succeeded. */
export const nothingSavedNote = (failure: ApiFailure): string =>
  failure.status === null
    ? 'Belum dapat dipastikan apakah perubahan tersimpan; daftar dimuat ulang untuk menampilkan keadaan sebenarnya.'
    : 'Tidak ada perubahan yang tersimpan.';

// ---------------------------------------------------------------------------
// OUTCOMES STAY WHERE THEY HAPPENED
// ---------------------------------------------------------------------------

export interface AnchoredOutcome {
  /** The stable key of the item the action was pressed on. */
  readonly key: string;
  /** Its position in the rendered list when pressed. */
  readonly at: number;
  /** The item's title, so a receipt still names what it was about. */
  readonly title: string;
  readonly outcome: ActionOutcome;
}

export type PlacedEntry<T> =
  | { readonly kind: 'ITEM'; readonly item: T; readonly outcome: AnchoredOutcome | null }
  | { readonly kind: 'RECEIPT'; readonly outcome: AnchoredOutcome };

/**
 * Merge the live items with the outcomes of actions pressed on them. An item
 * still present carries its outcome beneath it; an item the refresh removed
 * (because the decision closed it) is replaced by its receipt at the position
 * it was pressed at, so the reader's place on the screen never jumps away.
 */
export function placeOutcomes<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  outcomes: readonly AnchoredOutcome[],
): PlacedEntry<T>[] {
  const live = new Set(items.map(keyOf));
  const entries: PlacedEntry<T>[] = items.map((item) => ({
    kind: 'ITEM',
    item,
    outcome: outcomes.find((outcome) => outcome.key === keyOf(item)) ?? null,
  }));
  const receipts = outcomes
    .filter((outcome) => !live.has(outcome.key))
    .sort((a, b) => a.at - b.at);
  for (const outcome of receipts) {
    entries.splice(Math.min(Math.max(outcome.at, 0), entries.length), 0, { kind: 'RECEIPT', outcome });
  }
  return entries;
}

/** Record an outcome, replacing any earlier one for the same item. */
export const withOutcome = (
  outcomes: readonly AnchoredOutcome[],
  next: AnchoredOutcome,
): AnchoredOutcome[] => [...outcomes.filter((outcome) => outcome.key !== next.key), next];

// ---------------------------------------------------------------------------
// THE AHSP ROOM — bulk "Usulkan ke SIMPROK" and "Hapus"
// ---------------------------------------------------------------------------

/**
 * The ownership policy refuses in English sentences; these are those exact
 * sentences (or their fixed prefixes), said in the reader's language.
 */
const POLICY_REASON: ReadonlyArray<readonly [string, string]> = [
  ['This AHSP has already been proposed and is under review.', 'AHSP ini sudah diusulkan dan sedang ditinjau.'],
  ['This AHSP has already been accepted.', 'AHSP ini sudah diterima.'],
  ['Only a workspace-owned AHSP can be proposed to SIMPROK.', 'Hanya AHSP Saya yang dapat diusulkan ke SIMPROK.'],
  ['SIMPROK_ASSET cannot request deletion.', 'AHSP Pustaka SIMPROK tidak dapat dihapus.'],
  ['APPROVED_COMMUNITY_ASSET cannot request deletion.', 'AHSP yang sudah diterima tidak dapat dihapus.'],
  ['Reason is required to perform', 'Alasan wajib diisi.'],
  ['Deleted AHSP cannot perform', 'AHSP ini sudah dihapus.'],
  ['Archived AHSP cannot perform', 'AHSP ini sudah diarsipkan.'],
];

const AHSP_FORBIDDEN =
  'Tindakan ini tidak diizinkan untuk AHSP tersebut atau untuk workspace aktif Anda.';

export const explainAhspFailure = (failure: ApiFailure): FailureExplanation => {
  const known = POLICY_REASON.find(([sentence]) => failure.code?.startsWith(sentence));
  if (known) return { reason: known[1], next: 'Daftar sudah dimuat ulang dengan keadaan terbaru.' };
  if (failure.status === 404) {
    return { reason: 'AHSP tersebut tidak ditemukan.', next: 'Daftar sudah dimuat ulang dengan keadaan terbaru.' };
  }
  return explainStatus(failure, AHSP_FORBIDDEN);
};

export interface BulkResult {
  /** Rows the server answered 2xx for. */
  readonly succeeded: number;
  /** Rows the server refused, or that never got an answer. */
  readonly failed: number;
  /** Selected rows that were never sent because the action does not apply to them. */
  readonly notApplicable: number;
  /** The first refusal, for its reason. */
  readonly failure: ApiFailure | null;
}

const bulkOutcome = (
  result: BulkResult,
  words: { done: (n: number) => string; notDone: (n: number) => string; doneNote: string | null; notApplicable: (n: number) => string },
): ActionOutcome => {
  const lines: OutcomeLine[] = [];
  if (result.succeeded > 0) {
    lines.push({ tone: 'SUCCESS', text: words.done(result.succeeded) });
    if (words.doneNote) lines.push({ tone: 'NOTE', text: words.doneNote });
  }
  if (result.failed > 0) {
    const failure = result.failure ?? NETWORK_FAILURE;
    lines.push(
      ...failureLines(
        words.notDone(result.failed),
        result.succeeded > 0 ? 'AHSP yang gagal tidak berubah.' : nothingSavedNote(failure),
        explainAhspFailure(failure),
      ),
    );
  }
  if (result.notApplicable > 0) lines.push({ tone: 'NOTE', text: words.notApplicable(result.notApplicable) });
  return {
    kind: result.failed === 0 ? 'SUCCESS' : result.succeeded > 0 ? 'PARTIAL' : 'FAILURE',
    lines,
  };
};

export const describeBulkPropose = (result: BulkResult): ActionOutcome =>
  bulkOutcome(result, {
    done: (n) => `${n} AHSP berhasil diusulkan ke SIMPROK — status usulan: Sedang ditinjau.`,
    // Owner-locked wording, reused verbatim: a proposal is not an acceptance.
    doneNote: USULKAN_MODAL_BODY_2,
    notDone: (n) => `${n} AHSP belum berhasil diusulkan.`,
    notApplicable: (n) => `${n} AHSP terpilih tidak diusulkan karena hanya AHSP Saya yang belum diusulkan yang dapat diusulkan.`,
  });

export const describeBulkDelete = (result: BulkResult): ActionOutcome =>
  bulkOutcome(result, {
    done: (n) => `${n} AHSP berhasil dihapus dari daftar.`,
    doneNote: null,
    notDone: (n) => `${n} AHSP belum berhasil dihapus.`,
    notApplicable: (n) => `${n} AHSP terpilih tidak dihapus.`,
  });

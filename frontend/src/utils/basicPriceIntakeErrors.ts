/**
 * WHAT A FAILED IMPORT RESPONSE ACTUALLY MEANS.
 *
 * Pure, dependency-free, and deliberately NOT inside the API client or the page:
 * both of them need it, and it is the kind of law that must be testable without
 * a browser, a fetch or a React tree.
 *
 * IT EXISTS BECAUSE ITS ABSENCE BROKE THE OWNER'S DOOR. The API client used to
 * treat ANY string `message` on a failed response as a named intake refusal.
 * Nest answers a denied permission with `{"message":"Forbidden resource",…}` —
 * a string — so a 403 was read as an intake code, matched no question and no
 * sentence, and fell through to the page's last-resort line: "Unggahan belum
 * bisa dilanjutkan. SIMPROK menahan diri daripada menebak."
 *
 * A reviewer who simply lacked BASIC_PRICE_IMPORT was therefore told SIMPROK was
 * being careful about their workbook — which SIMPROK had never even opened. That
 * is the worst kind of error message: fluent, calm, and false.
 */

/**
 * The intake boundary's own vocabulary, mirroring
 * `backend/src/universal-intake/intake-errors.ts`.
 *
 * Membership, never shape: a "looks like an UPPER_SNAKE code" test would have
 * admitted the next `Forbidden resource` just as happily. A companion test reads
 * the backend file and fails if the two ever drift.
 */
const INTAKE_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'SOURCE_BYTES_REQUIRED',
  'SOURCE_EXCEEDS_MAX_BYTES',
  'UNSUPPORTED_SOURCE_FORMAT',
  'SOURCE_UNREADABLE',
  'WORKBOOK_HAS_NO_SHEETS',
  'WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND',
  'SOURCE_ROW_LIMIT_EXCEEDED',
  'NO_PRICE_TABLE_DETECTED',
  'SOURCE_TABLE_AMBIGUOUS',
  'SOURCE_STRUCTURE_AMBIGUOUS',
  'REGION_COLUMN_SELECTION_REQUIRED',
  'SECTION_DECLARATION_REQUIRED',
  'COLUMN_ROLE_SELECTION_REQUIRED',
  'REGION_COLUMN_NOT_FOUND',
]);

/** True when a failed response is intake speaking about the DOCUMENT itself. */
export const isIntakeRefusalCode = (code: string): boolean =>
  INTAKE_REFUSAL_CODES.has(code);

/**
 * WHY THE UPLOAD NEVER REACHED INTAKE — said as the fact it actually is.
 *
 * Not one of these blames the document, because not one of them is about the
 * document. A reviewer without a permission needs to be told that; a reviewer
 * whose session expired needs to be told to sign in again. Both used to receive
 * the same sentence about SIMPROK declining to guess.
 *
 * AND NOT ONE OF THEM CLEARS THE DOCUMENT EITHER — which the first repair of
 * this function got wrong in the opposite direction. "Berkasnya tidak
 * bermasalah" and "bukan pada berkas Anda" are verdicts ON THE FILE, and a 401
 * or a 403 is decided by a guard BEFORE a single byte is read: SIMPROK has not
 * looked. A 500 has usually not finished looking. Declaring the file innocent
 * is the same failure as declaring it guilty — a claim with no evidence behind
 * it — and the reviewer who then discovers the workbook really was malformed
 * has been misled by SIMPROK twice.
 *
 * The truthful ceiling is "isi berkas belum diperiksa": SIMPROK says what it
 * did, and stops where its knowledge stops. 413 is the one status here that IS
 * about the file, and it says so plainly, because there SIMPROK measured the
 * bytes itself.
 */
export const importRequestMessage = (httpStatus: number): string => {
  if (httpStatus === 401)
    return 'Sesi Anda sudah berakhir. Masuk kembali lalu ulangi unggahan. Isi berkas belum diperiksa.';
  if (httpStatus === 403)
    return 'Akun Anda belum memiliki kewenangan mengimpor Basic Price di workspace ini. Isi berkas belum diperiksa. Mintalah kewenangan Impor Basic Price kepada pemilik workspace.';
  if (httpStatus === 413)
    return 'Berkas ini melampaui batas ukuran unggahan SIMPROK.';
  if (httpStatus >= 500)
    return 'SIMPROK mengalami kendala saat memproses unggahan ini. Tidak ada fakta yang diterka atau disimpan sebagai fakta.';
  return 'Unggahan tidak dapat diproses. Tidak ada data yang diterka atau disimpan sebagai fakta.';
};

/**
 * OWNER-LOCKED copy for the "Usulkan ke SIMPROK" action. ONE source of truth for
 * the exact wording, shared by the room bulk action and the detail single action
 * and their confirmation dialog. Do NOT paraphrase, shorten, or re-term any of
 * these strings without the Owner's approval — they are locked verbatim.
 *
 * The action itself is UNCHANGED: it still calls the existing
 * POST /ahsp/:id/propose lifecycle (#141). This module only holds words.
 */

/** Hover tooltip on the "Usulkan ke SIMPROK" trigger. */
export const USULKAN_TOOLTIP =
  'Jadikan AHSP Anda lebih bermanfaat. Usulkan ke SIMPROK untuk diverifikasi dan berpeluang menjadi bagian dari AHSP bersama yang lebih terpercaya dan dapat dipertanggungjawabkan.';

/** Confirmation dialog shown before the proposal is actually submitted. */
export const USULKAN_MODAL_TITLE = 'Usulkan AHSP ke SIMPROK?';
export const USULKAN_MODAL_BODY_1 = 'AHSP ini akan dikirim untuk ditinjau oleh pengelola SIMPROK.';
export const USULKAN_MODAL_BODY_2 = 'Pengajuan Anda tidak otomatis membuat AHSP menjadi AHSP resmi SIMPROK.';
export const USULKAN_CANCEL = 'Batal';
export const USULKAN_CONFIRM = 'Ya, Usulkan';

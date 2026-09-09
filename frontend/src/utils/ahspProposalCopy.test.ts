import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USULKAN_CANCEL,
  USULKAN_CONFIRM,
  USULKAN_MODAL_BODY_1,
  USULKAN_MODAL_BODY_2,
  USULKAN_MODAL_TITLE,
  USULKAN_TOOLTIP,
} from "./ahspProposalCopy.ts";

/**
 * OWNER-LOCKED wording for "Usulkan ke SIMPROK". These strings are verbatim and
 * must not drift. If the Owner changes the wording, it changes HERE (one source)
 * — never paraphrased at a call site.
 */

test("the tooltip is the Owner's exact words", () => {
  assert.equal(
    USULKAN_TOOLTIP,
    "Jadikan AHSP Anda lebih bermanfaat. Usulkan ke SIMPROK untuk diverifikasi dan berpeluang menjadi bagian dari AHSP bersama yang lebih terpercaya dan dapat dipertanggungjawabkan.",
  );
});

test("the confirmation modal is the Owner's exact words and buttons", () => {
  assert.equal(USULKAN_MODAL_TITLE, "Usulkan AHSP ke SIMPROK?");
  assert.equal(USULKAN_MODAL_BODY_1, "AHSP ini akan dikirim untuk ditinjau oleh pengelola SIMPROK.");
  assert.equal(USULKAN_MODAL_BODY_2, "Pengajuan Anda tidak otomatis membuat AHSP menjadi AHSP resmi SIMPROK.");
  assert.equal(USULKAN_CANCEL, "Batal");
  assert.equal(USULKAN_CONFIRM, "Ya, Usulkan");
});

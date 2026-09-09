import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * THE AHSP filters draw Bidang/Subkategori/Jenis Pekerjaan from the ONE shared
 * construction taxonomy (constructionTaxonomy.ts), merged with the values
 * actually present in the data so a stored value is never hidden. The room
 * hardcodes no domain vocabulary of its own, and Subkategori is context-aware to
 * the chosen Bidang.
 */

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const codeOnly = (source: string) =>
  source
    .split(CARRIAGE_RETURN)
    .join("")
    .split(NEWLINE)
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join(NEWLINE);

const room = codeOnly(readFileSync("src/pages/AhspRoomPage.tsx", "utf8"));

test("the room draws its vocabulary from the single shared taxonomy module", () => {
  assert.ok(room.includes("from '../constructionTaxonomy'"));
  assert.ok(room.includes("BIDANG"));
  assert.ok(room.includes("JENIS_PEKERJAAN"));
  assert.ok(room.includes("subkategoriForBidang"));
  assert.ok(room.includes("mergeVocabulary"));
  // No second taxonomy hardcoded in the room.
  assert.ok(!room.includes("Bina Marga"));
  assert.ok(!room.includes("Cipta Karya"));
});

test("Subkategori is context-aware, and stale picks reset when Bidang changes", () => {
  assert.ok(room.includes("subkategoriForBidang(bidang)"));
  assert.ok(room.includes("setSubkategori('')"));
});

test("every taxonomy filter merges curated vocabulary with the values in the data", () => {
  assert.ok(room.includes("mergeVocabulary(BIDANG"));
  assert.ok(room.includes("mergeVocabulary(JENIS_PEKERJAAN"));
  assert.ok(room.includes("mergeVocabulary(curatedSub"));
  // The persisted rows remain the AHSP truth; the filter never edits them.
  assert.ok(room.includes("apiFetch('/ahsp')"));
});

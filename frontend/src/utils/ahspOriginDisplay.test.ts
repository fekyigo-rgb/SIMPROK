import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  describeAhspOrigin,
  formatAhspPreferenceTag,
  formatAhspVersionOption,
  isWorkspacePrivateAhsp,
} from "./ahspOriginDisplay.ts";

const base = {
  versionNumber: 2,
  outputUnit: "M1",
  ahsp: { workType: "Pasangan Bata", methodName: "Manual" },
};

test("RM03B-O-01: a workspace own AHSP is named as the user own, not as published", () => {
  assert.equal(describeAhspOrigin("WORKSPACE_PRIVATE"), "AHSP Saya");
  assert.doesNotMatch(describeAhspOrigin("WORKSPACE_PRIVATE"), /[Tt]erbit|[Pp]ublish|[Tt]erverifikasi/);
});

test("RM03B-O-02: a curated AHSP is named as the SIMPROK catalog", () => {
  assert.equal(describeAhspOrigin("SIMPROK_CATALOG"), "Katalog SIMPROK");
});

test("RM03B-O-03: an absent origin degrades to catalog, never to a false ownership claim", () => {
  assert.equal(describeAhspOrigin(undefined), "Katalog SIMPROK");
  assert.equal(isWorkspacePrivateAhsp(undefined), false);
});

test("RM03B-O-04: the picker option names the AHSP, not a version alternative", () => {
  assert.equal(
    formatAhspVersionOption({ ...base, origin: "WORKSPACE_PRIVATE" }),
    "[AHSP Saya] Pasangan Bata — Manual · M1",
  );
  assert.equal(
    formatAhspVersionOption({ ...base, origin: "SIMPROK_CATALOG" }),
    "[Katalog SIMPROK] Pasangan Bata — Manual · M1",
  );
  assert.doesNotMatch(formatAhspVersionOption({ ...base, origin: "SIMPROK_CATALOG" }), /v\d/);
});

test("RI01K: source code is displayed in search result, never synthesized when absent", () => {
  const version = { ...base, ahsp: { ...base.ahsp, code: 'BM.01.007' } };
  assert.match(formatAhspVersionOption(version), /Kode BM\.01\.007/);
  assert.doesNotMatch(formatAhspVersionOption(base), /Kode /);
});

test("RM03B-O-05: only an explicit private origin counts as private", () => {
  assert.equal(isWorkspacePrivateAhsp("WORKSPACE_PRIVATE"), true);
  assert.equal(isWorkspacePrivateAhsp("SIMPROK_CATALOG"), false);
});

test("RM03B-O-06: RAB picker copy names one AHSP, not version alternatives", () => {
  const page = readFileSync("src/pages/RabWorkspacePage.tsx", "utf8");
  const start = page.indexOf('aria-label="Pilihan AHSP kontekstual"');
  assert.ok(start >= 0);
  // Owner 14-Oct: one typeable AHSP control, not a search box plus native select.
  // Keep the existing canonical selection, server-bound search and origin labels.
  const picker = page.slice(start, start + 9000);
  assert.match(picker, /<label htmlFor="simprok-ahsp-version-selector">Pilih AHSP<\/label>/);
  assert.match(picker, /id="simprok-ahsp-version-selector"/);
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /aria-autocomplete="list"/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /role="option"/);
  assert.match(picker, /onKeyDown=/);
  assert.doesNotMatch(picker, /id="simprok-ahsp-search"/);
  assert.doesNotMatch(picker, /<select\s+id="simprok-ahsp-version-selector"/);
  assert.match(page, /eligible-versions\/search\?/);
  assert.match(picker, /formatAhspVersionOption\(version\)/);
  assert.match(picker, /formatAhspPreferenceTag\(version\.preference\.band\)/);
  assert.match(picker, /setSelectedAhspVersionId\(version\.id\)/);
  assert.match(picker, /Tampilkan 25 hasil berikutnya/);
  assert.doesNotMatch(picker, /Pilih Version|Gunakan Version|AHSP Version/);
  assert.match(page, /boqItemId/);
  assert.equal(formatAhspPreferenceTag("PREFERRED_SUBKATEGORI"), "Konteks pilihan");
  assert.equal(formatAhspPreferenceTag("CROSS_CATEGORY_FALLBACK"), "Cadangan kategori lain");
  assert.equal(formatAhspPreferenceTag("INSUFFICIENT_CLASSIFICATION"), "Klasifikasi belum terbukti");
});

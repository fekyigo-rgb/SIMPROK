import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  regionSearchAfterClear,
  regionSearchShouldReloadOnFocus,
} from "./regionSearchRecovery.ts";

const importSelect = readFileSync(
  "src/components/basic-price/RegionSearchSelect.tsx",
  "utf8",
);
const explorerSelect = readFileSync(
  "src/components/basic-price/ExplorerRegionFilterSelect.tsx",
  "utf8",
);
const hierarchySelect = readFileSync(
  "src/components/basic-price/RegionHierarchySelect.tsx",
  "utf8",
);

test("the Explorer keeps one compact Wilayah control and its recovery law", () => {
  assert.match(explorerSelect, /regionSearchAfterClear/);
  assert.match(explorerSelect, /regionSearchShouldReloadOnFocus/);
  assert.match(explorerSelect, />\s*Wilayah\s*</);
  assert.doesNotMatch(explorerSelect, /RegionHierarchySelect/);
  assert.doesNotMatch(explorerSelect, /data-region-level/);
  for (const rejected of [
    /Negara/,
    /Provinsi/,
    /Kabupaten\/Kota/,
    /Kecamatan/,
    /Desa\/Kelurahan/,
  ]) {
    assert.doesNotMatch(explorerSelect, rejected);
  }
});

test("clear and refocus recover the compact Explorer Region search", () => {
  assert.deepEqual(regionSearchAfterClear(), {
    query: "",
    open: true,
    reload: true,
  });
  assert.equal(
    regionSearchShouldReloadOnFocus({ hasSelection: false, panelState: "idle" }),
    true,
  );
  assert.equal(
    regionSearchShouldReloadOnFocus({ hasSelection: false, panelState: "error" }),
    true,
  );
  assert.equal(
    regionSearchShouldReloadOnFocus({ hasSelection: true, panelState: "idle" }),
    false,
  );
});

test("only Import consumes the shared five-level Region hierarchy", () => {
  assert.match(importSelect, /import \{ RegionHierarchySelect \}/);
  assert.match(importSelect, /<RegionHierarchySelect/);
  assert.match(importSelect, /loadRegions=\{searchRegions\}/);
  assert.doesNotMatch(importSelect, /REGION_HIERARCHY_LEVELS/);
});

test("the Import hierarchy reuses the canonical result-set label helper", () => {
  assert.match(hierarchySelect, /import \{[\s\S]*regionOptionLabels/);
  assert.match(hierarchySelect, /regionOptionLabels\(options\[level\]\)/);
  assert.match(hierarchySelect, /optionLabels\.get\(region\.id\) \?\? region\.name/);
  assert.doesNotMatch(hierarchySelect, />\s*\{region\.id\}\s*</);
});

test("the accepted hierarchy has visible recovery without rejected review controls", () => {
  assert.match(hierarchySelect, /hierarchyLevelShouldRecover/);
  assert.match(hierarchySelect, /onFocus=\{\(\) => void recover\(level\)\}/);
  assert.match(hierarchySelect, /Gagal memuat wilayah\./);
  assert.match(hierarchySelect, /Coba lagi/);
  assert.match(hierarchySelect, /Tidak ada wilayah pada tingkat ini\./);
  assert.match(hierarchySelect, /Muat ulang/);
  assert.doesNotMatch(hierarchySelect, /Hapus pilihan wilayah/);
  assert.doesNotMatch(hierarchySelect, /Lengkapi wilayah sampai Kecamatan/);
  assert.doesNotMatch(hierarchySelect, /Wilayah harga:/);
});

test("recovery keeps canonical selection and stale requests cannot win", () => {
  assert.match(hierarchySelect, /preserveSelectedRegionOption/);
  assert.match(hierarchySelect, /requestVersion\.current !== version/);
  assert.doesNotMatch(
    hierarchySelect,
    /catch \{[\s\S]*setOptions\(\(current\) => \(\{ \.\.\.current, \[level\]: \[\] \}\)\)/,
  );
});

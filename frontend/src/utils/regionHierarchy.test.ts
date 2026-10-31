import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  emptyRegionHierarchy,
  hierarchyLevelShouldRecover,
  hierarchyCodesForRegion,
  persistedRegionFromHierarchy,
  persistedRegionFromVillageCoverage,
  preserveSelectedRegionOption,
  requiredRegionHierarchyComplete,
  setRegionHierarchyLevel,
  type RegionHierarchyLevel,
} from "./regionHierarchy.ts";
import type { RegionLookupItem } from "./basicPriceWorkflowDisplay.ts";

const region = (
  id: string,
  code: string,
  name: string,
  administrativeLevel: RegionHierarchyLevel,
): RegionLookupItem => ({ id, code, name, administrativeLevel });

const indonesia = region("country", "ID", "Indonesia", "COUNTRY");
const maluku = region("province", "81", "Maluku", "PROVINCE");
const ambon = region("city", "81.71", "Kota Ambon", "REGENCY_CITY");
const baguala = region("district", "81.71.03", "Baguala", "DISTRICT");
const lateri = region("village", "81.71.03.1018", "Lateri", "VILLAGE");

const completeDistrict = () => ({
  ...emptyRegionHierarchy(),
  COUNTRY: indonesia,
  PROVINCE: maluku,
  REGENCY_CITY: ambon,
  DISTRICT: baguala,
});

test("Country, Province, Regency/City and District are required; Village is optional", () => {
  assert.equal(requiredRegionHierarchyComplete(completeDistrict()), true);
  assert.equal(
    requiredRegionHierarchyComplete({
      ...completeDistrict(),
      DISTRICT: null,
      VILLAGE: lateri,
    }),
    false,
  );
});

test("District persists when Village is omitted and Village persists when selected", () => {
  assert.equal(
    persistedRegionFromHierarchy(completeDistrict())?.id,
    "district",
  );
  assert.equal(
    persistedRegionFromHierarchy({
      ...completeDistrict(),
      VILLAGE: lateri,
    })?.id,
    "village",
  );
});

test("Village checklist keeps scalar law for none/one/many/all", () => {
  const passo = region("village-2", "81.71.03.1019", "Passo", "VILLAGE");
  const negeriLama = region(
    "village-3",
    "81.71.03.1020",
    "Negeri Lama",
    "VILLAGE",
  );
  assert.equal(persistedRegionFromVillageCoverage(baguala, [])?.id, "district");
  assert.equal(
    persistedRegionFromVillageCoverage(baguala, [lateri])?.id,
    "village",
  );
  assert.equal(
    persistedRegionFromVillageCoverage(baguala, [lateri, passo])?.id,
    "district",
  );
  assert.equal(
    persistedRegionFromVillageCoverage(baguala, [lateri, passo, negeriLama])
      ?.id,
    "district",
  );
});

test("changing a higher level clears every descendant", () => {
  const changed = setRegionHierarchyLevel(
    { ...completeDistrict(), VILLAGE: lateri },
    "PROVINCE",
    region("province-2", "82", "Maluku Utara", "PROVINCE"),
  );
  assert.equal(changed.COUNTRY, indonesia);
  assert.equal(changed.PROVINCE?.code, "82");
  assert.equal(changed.REGENCY_CITY, null);
  assert.equal(changed.DISTRICT, null);
  assert.equal(changed.VILLAGE, null);
});

test("idle, empty and failed levels recover only when their parent is ready", () => {
  for (const state of ["idle", "empty", "error"] as const) {
    assert.equal(hierarchyLevelShouldRecover(state, true), true);
    assert.equal(hierarchyLevelShouldRecover(state, false), false);
  }
  assert.equal(hierarchyLevelShouldRecover("loading", true), false);
  assert.equal(hierarchyLevelShouldRecover("ready", true), false);
});

test("a transient empty reload cannot remove the selected canonical option", () => {
  assert.deepEqual(preserveSelectedRegionOption([], baguala), [baguala]);
  assert.deepEqual(preserveSelectedRegionOption([baguala], baguala), [baguala]);
  assert.deepEqual(preserveSelectedRegionOption([], null), []);
});

test("official ancestor codes are derived without exposing or inventing ids", () => {
  assert.deepEqual(hierarchyCodesForRegion(lateri.code), {
    COUNTRY: "ID",
    PROVINCE: "81",
    REGENCY_CITY: "81.71",
    DISTRICT: "81.71.03",
    VILLAGE: "81.71.03.1018",
  });
  assert.deepEqual(hierarchyCodesForRegion("legacy-undotted-code"), {});
});

test("initial hydration cannot collide with an intentional null clear in React StrictMode", () => {
  const source = readFileSync(
    "src/components/basic-price/RegionHierarchySelect.tsx",
    "utf8",
  );
  assert.match(source, /useRef<string \| null \| undefined>\(undefined\)/);
  assert.match(
    source,
    /initialized\.current && selectedId === lastEmittedId\.current/,
  );
  assert.match(source, /version !== requestVersion\.current/);
  assert.match(source, /onFocus=\{\(\) => void recover\(level\)\}/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, />\s*Pilih semua\s*</);
  assert.match(source, /onCoveredVillagesChange/);
});

test("Village multiselect reuses its details dropdown and closes without changing selection", () => {
  const source = readFileSync(
    "src/components/basic-price/RegionHierarchySelect.tsx",
    "utf8",
  );

  assert.match(source, /<details/);
  assert.match(source, /open=\{isVillageOpen\}/);
  assert.match(source, /document\.addEventListener\("pointerdown"/);
  assert.match(source, /!villageDetailsRef\.current\?\.contains\(event\.target\)/);
  assert.match(source, /document\.addEventListener\("keydown"/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /villageSummaryRef\.current\?\.focus\(\)/);
  assert.match(source, />\s*Selesai\s*</);
  assert.match(source, /onChange=\{\(event\) =>\s*toggleVillage/);
  assert.doesNotMatch(source, /updateBasicPriceImportBatch|Simpan Konteks Sumber/);
});

test("city-wide Basic Price can persist the actual Regency/City ID without a District", () => {
  const cityOnly = { ...completeDistrict(), DISTRICT: null };
  assert.equal(requiredRegionHierarchyComplete(cityOnly), false);
  assert.equal(persistedRegionFromHierarchy(cityOnly), null);
  assert.equal(requiredRegionHierarchyComplete(cityOnly, true), true);
  assert.equal(persistedRegionFromHierarchy(cityOnly, true)?.id, "city");
  const provinceOnly = { ...cityOnly, REGENCY_CITY: null };
  assert.equal(requiredRegionHierarchyComplete(provinceOnly, true), false);
  assert.equal(persistedRegionFromHierarchy(provinceOnly, true), null);
});

test("opt-in city-wide scope preserves more-specific District, Village and Village-coverage truth", () => {
  assert.equal(persistedRegionFromHierarchy(completeDistrict(), true)?.id, "district");
  assert.equal(
    persistedRegionFromHierarchy({ ...completeDistrict(), VILLAGE: lateri }, true)?.id,
    "village",
  );
  const cityOnly = { ...completeDistrict(), DISTRICT: null };
  const narrowed = setRegionHierarchyLevel(cityOnly, "DISTRICT", baguala);
  assert.equal(persistedRegionFromHierarchy(narrowed, true)?.id, "district");
  assert.equal(
    persistedRegionFromHierarchy(setRegionHierarchyLevel(narrowed, "DISTRICT", null), true)?.id,
    "city",
  );
  assert.equal(persistedRegionFromVillageCoverage(baguala, [lateri])?.id, "village");
});

test("only Basic Price import opts into city-wide coverage; existing default remains intact", () => {
  const importer = readFileSync("src/components/basic-price/RegionSearchSelect.tsx", "utf8");
  const hierarchy = readFileSync("src/components/basic-price/RegionHierarchySelect.tsx", "utf8");
  const intake = readFileSync("src/pages/BasicPriceImportPage.tsx", "utf8");
  assert.match(importer, /<RegionHierarchySelect[\s\S]*?allowCityScope/);
  assert.match(hierarchy, /allowCityScope = false/);
  assert.match(hierarchy, /persistedRegionFromHierarchy\(nextSelection, allowCityScope\)/);
  assert.match(hierarchy, /required=\{!\(allowCityScope && level === "DISTRICT"\)\}/);
  assert.match(hierarchy, /Harga berlaku untuk seluruh kecamatan dan kelurahan/);
  assert.match(intake, /updateMetadataField\('regionId', next\?\.id \?\? undefined\)/);
});

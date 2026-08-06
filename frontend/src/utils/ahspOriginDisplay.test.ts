import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAhspOrigin,
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

test("RM03B-O-04: the picker option leads with the origin so the two are never confused", () => {
  assert.equal(
    formatAhspVersionOption({ ...base, origin: "WORKSPACE_PRIVATE" }),
    "[AHSP Saya] Pasangan Bata — Manual · v2 · M1",
  );
  assert.equal(
    formatAhspVersionOption({ ...base, origin: "SIMPROK_CATALOG" }),
    "[Katalog SIMPROK] Pasangan Bata — Manual · v2 · M1",
  );
});

test("RM03B-O-05: only an explicit private origin counts as private", () => {
  assert.equal(isWorkspacePrivateAhsp("WORKSPACE_PRIVATE"), true);
  assert.equal(isWorkspacePrivateAhsp("SIMPROK_CATALOG"), false);
});

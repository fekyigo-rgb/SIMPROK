import assert from "node:assert/strict";
import test from "node:test";
import {
  IQL_COPY,
  describeCuratableObservation,
  previewRuledOutLine,
  previewRuledOutNames,
  describeGovernanceFailure,
  describeGovernanceSuccess,
  describeGroupLearning,
  describeResourceDecisionFailure,
  describeResourceDecisionSuccess,
  groupIdenticalObservations,
  learningOutcomeOf,
  observationOccurrenceLine,
  previewCandidateMentions,
  previewCandidateNames,
  looksLikeInternalIdentifier,
} from "./resourceObservationDisplay.ts";

/**
 * The curation surface must speak human, show candidates by NAME, never
 * auto-select, and never leak a code or UUID.
 */

// A — the curator sees candidates by name, with the id kept for the action only.
test("A: candidates are shown by name; the catalogue id rides along for the action, unseen", () => {
  const view = describeCuratableObservation({
    id: "obs-1",
    rawName: "Agregat XYZ Premium",
    rawUnit: "m3",
    resourceType: "MATERIAL",
    candidates: [
      { resourceCatalogId: "6f2b1c4a-9d3e-4a71-b8c2-5e7f0a1d2b3c", name: "Kerikil / Agregat" },
      { resourceCatalogId: "7a1b2c3d-4e5f-4a71-b8c2-5e7f0a1d2b3c", name: "Agregat Kasar" },
    ],
    suggestedUnitDefinitionId: "unit-m3",
  });
  assert.equal(view.title, "Agregat XYZ Premium (m3)");
  assert.deepEqual(view.candidateChoices.map((c) => c.name), ["Kerikil / Agregat", "Agregat Kasar"]);
  // The id is present for curate-existing, but only the NAME is reader-facing.
  assert.equal(view.candidateChoices[0].resourceCatalogId, "6f2b1c4a-9d3e-4a71-b8c2-5e7f0a1d2b3c");
  assert.match(view.candidateLine ?? "", /Kerikil \/ Agregat/);
  assert.doesNotMatch(view.candidateLine ?? "", /6f2b1c4a/);
  assert.equal(looksLikeInternalIdentifier(view.candidateLine ?? ""), false);
  assert.equal(looksLikeInternalIdentifier(view.guidance), false);
  assert.equal(view.canProposeNew, true);
  assert.equal(view.newUnitDefinitionId, "unit-m3");
});

test("candidates are de-duplicated and dropped if they carry no id", () => {
  const view = describeCuratableObservation({
    id: "obs-2",
    rawName: "Semen",
    candidates: [
      { resourceCatalogId: "id-1", name: "Semen Portland" },
      { resourceCatalogId: "id-2", name: "Semen Portland" },
      { resourceCatalogId: "", name: "Bocor" },
    ],
    suggestedUnitDefinitionId: null,
  });
  assert.deepEqual(view.candidateChoices.map((c) => c.name), ["Semen Portland"]);
});

test("a long candidate list is trimmed, never dumped", () => {
  const view = describeCuratableObservation({
    id: "obs-3",
    rawName: "Kayu",
    candidates: ["A", "B", "C", "D", "E", "F"].map((n, i) => ({ resourceCatalogId: "id-" + i, name: n })),
    suggestedUnitDefinitionId: null,
  });
  assert.match(view.candidateLine ?? "", /dan 2 lainnya/);
});

// no candidate → not "does not exist", and new-proposal offered honestly.
test("no candidate reads as not-yet-proven, never as rejected or non-existent", () => {
  const view = describeCuratableObservation({
    id: "obs-4",
    rawName: "Bahan Langka 92311",
    rawUnit: "kg",
    candidates: [],
    suggestedUnitDefinitionId: "unit-kg",
  });
  assert.equal(view.candidateLine, null);
  assert.match(view.guidance, /belum menemukan padanan/);
  assert.doesNotMatch(view.guidance, /tidak ada|tidak ditemukan|ditolak/i);
});

// canProposeNew is false when the Unit Kernel could not prove a unit.
test("proposing new is withheld until a unit is proven", () => {
  const view = describeCuratableObservation({
    id: "obs-5",
    rawName: "Bahan",
    rawUnit: "zzz",
    candidates: [],
    suggestedUnitDefinitionId: null,
  });
  assert.equal(view.canProposeNew, false);
  assert.equal(view.newUnitDefinitionId, null);
});

// Preview candidate names — resolved resources contribute none; names only.
test("preview shows candidate names for unresolved resources only", () => {
  const names = previewCandidateNames([
    { rawName: "Pekerja", group: "LABOR", resolvedResourceCatalogId: "cat-1", identityCandidates: ["Pekerja"] },
    { rawName: "Kawat bendrat", group: "MATERIAL", resolvedResourceCatalogId: null, identityCandidates: ["Kawat benrad", "Kawat BRC"] },
    { rawName: "PC", group: "MATERIAL", resolvedResourceCatalogId: null, identityCandidates: ["Semen Portlan"] },
  ]);
  assert.deepEqual(names, ["Kawat benrad", "Kawat BRC", "Semen Portlan"]);
});

test("the identifier guard actually catches uuids and reason codes", () => {
  assert.equal(looksLikeInternalIdentifier("6f2b1c4a-9d3e-4a71-b8c2-5e7f0a1d2b3c"), true);
  assert.equal(looksLikeInternalIdentifier("RESOURCE_NOT_FOUND"), true);
  assert.equal(looksLikeInternalIdentifier("SIMPROK menemukan padanan"), false);
});

/**
 * ONE QUESTION, ASKED ONCE.
 *
 * A real Bina Marga import puts "Alat Bantu (Ls)" on screen sixty-six times —
 * the same question, once per analysis. Folding it is machine work. What must
 * NOT fold is anything the decision actually depends on, so the tests below
 * spend most of their weight proving what stays apart.
 */

const obs = (over: Record<string, unknown> = {}) => ({
  id: "obs-" + Math.random().toString(36).slice(2),
  rawName: "Alat Bantu",
  rawCode: null,
  rawUnit: "Ls",
  resourceType: "EQUIPMENT",
  candidates: [{ resourceCatalogId: "cat-alat-bantu", name: "Alat Bantu" }],
  suggestedUnitDefinitionId: "unit-ls",
  ...over,
});

test("G1: the same question asked many times becomes ONE group carrying every id", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "a" }),
    obs({ id: "b" }),
    obs({ id: "c" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 3);
  // First-seen order, so the answer is recorded in the order the document asked.
  assert.deepEqual(groups[0].ids, ["a", "b", "c"]);
  assert.equal(groups[0].view.title, "Alat Bantu (Ls)");
});

test("G2: a question asked once is still its own group, and says nothing about counts", () => {
  const groups = groupIdenticalObservations([obs({ id: "only" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 1);
  assert.equal(observationOccurrenceLine(groups[0]), null);
});

test("G3: the repeat is stated honestly, with the real number", () => {
  const groups = groupIdenticalObservations([obs(), obs(), obs(), obs()]);
  const line = observationOccurrenceLine(groups[0]) as string;
  assert.match(line, /4 kali/u);
  assert.match(line, /Satu keputusan berlaku untuk semuanya/u);
  // Never a code or an id.
  assert.equal(looksLikeInternalIdentifier(line), false);
});

// ---------------- what must NEVER fold ----------------

test("G4: DIFFERENT candidate sets are never merged — different evidence is a different question", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "one", candidates: [{ resourceCatalogId: "cat-a", name: "Alat Bantu" }] }),
    obs({
      id: "two",
      candidates: [
        { resourceCatalogId: "cat-a", name: "Alat Bantu" },
        { resourceCatalogId: "cat-b", name: "Alat Bantu Lain" },
      ],
    }),
  ]);
  assert.equal(groups.length, 2);
});

test("G5: a different unit, class, or source code is never merged", () => {
  assert.equal(
    groupIdenticalObservations([obs({ id: "1" }), obs({ id: "2", rawUnit: "Jam" })]).length,
    2,
  );
  assert.equal(
    groupIdenticalObservations([obs({ id: "3" }), obs({ id: "4", resourceType: "MATERIAL" })]).length,
    2,
  );
  assert.equal(
    groupIdenticalObservations([obs({ id: "5" }), obs({ id: "6", rawCode: "E.13.b" })]).length,
    2,
  );
});

test("G6: a different spelling is never merged — the reader is shown what the source wrote", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "x", rawName: "Alat Bantu" }),
    obs({ id: "y", rawName: "alat bantu" }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.view.title), ["Alat Bantu (Ls)", "alat bantu (Ls)"]);
});

test("G7: a different proven unit is never merged, even when the words match exactly", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "p" }),
    obs({ id: "q", suggestedUnitDefinitionId: "unit-something-else" }),
  ]);
  assert.equal(groups.length, 2);
});

// ---------------- human authority is untouched ----------------

test("G8: grouping decides NOTHING — every candidate is still offered, none is selected", () => {
  const groups = groupIdenticalObservations([
    obs({
      candidates: [
        { resourceCatalogId: "cat-a", name: "Sewa Water Tank truck" },
        { resourceCatalogId: "cat-b", name: "Sewa Dump Truck 3 Ton" },
      ],
    }),
    obs({
      candidates: [
        { resourceCatalogId: "cat-a", name: "Sewa Water Tank truck" },
        { resourceCatalogId: "cat-b", name: "Sewa Dump Truck 3 Ton" },
      ],
    }),
  ]);
  assert.equal(groups.length, 1);
  // Both alternatives survive folding; the choice is still the human's.
  assert.deepEqual(groups[0].view.candidateChoices.map((c) => c.name), [
    "Sewa Water Tank truck",
    "Sewa Dump Truck 3 Ton",
  ]);
  // Nothing in the group marks a winner.
  assert.equal(Object.prototype.hasOwnProperty.call(groups[0], "selected"), false);
  // ACG-01 CLOSURE 4: the guidance no longer says "pilih padanan yang paling
  // sesuai" — that asked the reader to judge a list SIMPROK had not judged. It
  // now asks for a CONFIRMATION and still names no winner. TEST_WEAKENING=NO.
  assert.match(groups[0].view.guidance, /membutuhkan konfirmasi Anda/u);
  assert.ok(!/Pilih padanan/u.test(groups[0].view.guidance));
});

test("G9: an unanswerable observation still refuses to offer 'new' — fail-closed survives folding", () => {
  const groups = groupIdenticalObservations([
    obs({ id: "u1", candidates: [], suggestedUnitDefinitionId: null }),
    obs({ id: "u2", candidates: [], suggestedUnitDefinitionId: null }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrences, 2);
  assert.equal(groups[0].view.canProposeNew, false);
  assert.match(groups[0].view.guidance, /belum menemukan padanan/u);
});

test("G10: empty and malformed input yield nothing rather than a fabricated group", () => {
  assert.deepEqual(groupIdenticalObservations([]), []);
  assert.deepEqual(groupIdenticalObservations(null), []);
  assert.deepEqual(groupIdenticalObservations(undefined), []);
  // An observation with no id cannot be acted on, so it is not offered as work.
  assert.deepEqual(groupIdenticalObservations([obs({ id: "" })]), []);
});


// ---------------- ACG-01 CLOSURE 4: evidence strength is honest ----------------

test("C4-1: a nomination whose ONLY evidence is a shared word is shown, never offered", () => {
  const view = describeCuratableObservation(
    obs({
      rawName: "Tanah Biasa",
      resourceType: "MATERIAL",
      candidates: [
        { resourceCatalogId: "cat-klem", name: "Klem biasa", evidence: ["NAME_TOKEN_STEM_SHARED"] },
        { resourceCatalogId: "cat-paku", name: "Paku biasa", evidence: ["NAME_TOKEN_STEM_SHARED"] },
      ],
    }),
  );
  // Not actionable...
  assert.deepEqual(view.candidateChoices, []);
  // ...but not hidden either.
  assert.deepEqual(view.weakPossibilities, ["Klem biasa", "Paku biasa"]);
  assert.match(view.weakPossibilityLine ?? "", /belum cukup kuat untuk dipilih/u);
  assert.match(view.guidance, /Belum ditemukan padanan yang dapat dibuktikan/u);
});

test("C4-2: evidence SIMPROK can name makes a candidate confirmable", () => {
  const view = describeCuratableObservation(
    obs({
      rawName: "Dump Truck",
      resourceType: "EQUIPMENT",
      candidates: [
        { resourceCatalogId: "cat-dt", name: "Dump Truck 3-4 m3", evidence: ["SOURCE_CODE_MATCH"] },
        { resourceCatalogId: "cat-wt", name: "Water Tank Truck", evidence: ["NAME_TOKEN_STEM_SHARED"] },
      ],
    }),
  );
  assert.deepEqual(view.candidateChoices.map((c) => c.name), ["Dump Truck 3-4 m3"]);
  assert.deepEqual(view.weakPossibilities, ["Water Tank Truck"]);
  assert.match(view.guidance, /membutuhkan konfirmasi Anda/u);
});

test("C4-3: a candidate with no evidence list is the kernel's own finding, and stays confirmable", () => {
  const view = describeCuratableObservation(
    obs({ candidates: [{ resourceCatalogId: "cat-a", name: "Semen Portland" }] }),
  );
  assert.deepEqual(view.candidateChoices.map((c) => c.name), ["Semen Portland"]);
  assert.deepEqual(view.weakPossibilities, []);
});

test("C4-4: what the catalogue claims but the source never stated is named, not hidden", () => {
  const view = describeCuratableObservation(
    obs({
      rawName: "Pipa porous",
      candidates: [
        {
          resourceCatalogId: "cat-p",
          name: "Pipa porous 6 inch",
          evidence: ["NAME_TOKEN_CONTAINMENT"],
          specificationUnproved: true,
          unprovedSpecificationFacts: ["6"],
        },
      ],
    }),
  );
  assert.deepEqual(view.candidateChoices[0].unprovedFacts, ["6"]);
});

test("C4-5: SIMPROK states what it understood before it asks anything", () => {
  const understood = describeCuratableObservation(
    obs({ rawName: "Wheel Loader", rawUnit: "Jam", rawCode: "E15", resourceType: "EQUIPMENT" }),
  );
  assert.match(understood.understanding, /peralatan/u);
  assert.match(understood.understanding, /Jam/u);
  assert.match(understood.understanding, /E15/u);
  // No internal vocabulary reaches the reader.
  for (const word of ["EQUIPMENT", "UNRESOLVED", "IQL", "catalog", "kernel"]) {
    assert.ok(!understood.understanding.includes(word), word);
  }

  const blind = describeCuratableObservation(
    obs({ rawName: "?", rawUnit: null, rawCode: null, resourceType: null }),
  );
  assert.match(blind.understanding, /Data sumber belum cukup/u);
});

// ---------------- ACG-01 OWNER BROWSER GAP: FINDING E — candidates ----------------

const verdict = (status: string, reasonCodes: string[], exhausted: boolean) => ({
  status,
  reasonCodes,
  exhausted,
});

test("E1: a row the kernel RULED OUT is shown, and never offered as 'Benar, ini sama dengan'", () => {
  const view = describeCuratableObservation(
    obs({
      rawName: "Besi UNP 80.45.5",
      rawUnit: "Bh",
      resourceType: "MATERIAL",
      candidates: [{ resourceCatalogId: "cat-unp", name: "Besi UNP 100.50.5", evidence: [] }],
      identityVerdict: verdict("UNRESOLVED", ["SPECIFICATION_CONFLICT"], false),
    }),
  );
  assert.deepEqual(view.candidateChoices, []);
  assert.deepEqual(view.ruledOut, ["Besi UNP 100.50.5"]);
  assert.match(view.ruledOutLine ?? "", /tidak memakainya sebagai padanan karena spesifikasi yang dinyatakan bertentangan/u);
  // Not exhausted, so "genuinely new" is shown shut and explained, never promised.
  // ACG-01.1: the reason names the missing STEP, never the resource as refused.
  assert.equal(view.canProposeNew, false);
  assert.match(view.newResourceBlockedLine ?? "", /langkah untuk sumber daya yang padanannya tidak cocok belum tersedia/u);
  assert.match(view.newResourceBlockedLine ?? "", /tetap tersimpan/u);
  assert.doesNotMatch(view.guidance, /sumber daya baru/u);
  assert.equal(looksLikeInternalIdentifier(view.ruledOutLine ?? ""), false);
});

test("E2: a class mismatch is ruled out in the reader's words", () => {
  const view = describeCuratableObservation(
    obs({
      candidates: [{ resourceCatalogId: "cat-air", name: "Alat Bantu", evidence: [] }],
      identityVerdict: verdict("UNRESOLVED", ["RESOURCE_TYPE_MISMATCH"], false),
    }),
  );
  assert.deepEqual(view.candidateChoices, []);
  assert.match(view.ruledOutLine ?? "", /kelas sumber dayanya berbeda/u);
});

test("E3: many candidates are CHOICES with their evidence named — none is called the recommendation", () => {
  const view = describeCuratableObservation(
    obs({
      rawName: "Semen",
      rawUnit: "Kg",
      resourceType: "MATERIAL",
      candidates: [
        { resourceCatalogId: "cat-1", name: "Semen Portland", evidence: ["SOURCE_CODE_MATCH", "NAME_TOKEN_CONTAINMENT"] },
        { resourceCatalogId: "cat-2", name: "Semen Putih", evidence: ["NAME_TOKEN_CONTAINMENT"] },
        { resourceCatalogId: "cat-3", name: "Semen Instan", evidence: ["NAME_TOKEN_CONTAINMENT"] },
      ],
      identityVerdict: verdict("NEEDS_REVIEW", ["MULTIPLE_CANDIDATES_NEEDS_REVIEW"], false),
    }),
  );
  // The kernel's own order is kept; nothing is re-ranked.
  assert.deepEqual(view.candidateChoices.map((c) => c.name), ["Semen Portland", "Semen Putih", "Semen Instan"]);
  assert.equal(
    view.candidateChoices[0].basis,
    "Dasar: kode sumber yang sama pernah tercatat untuk sumber daya ini; kemiripan nama.",
  );
  assert.equal(view.candidateChoices[1].basis, "Dasar: kemiripan nama saja.");
  assert.match(view.guidance, /ada 3 kemungkinan padanan dan SIMPROK tidak memilih sendiri/u);
  assert.match(view.guidance, /biarkan item ini tetap menunggu/u);
  // No score, no percentage, no internal code in anything shown.
  for (const choice of view.candidateChoices) {
    assert.doesNotMatch(choice.basis, /\d+ ?%|skor|score/iu);
    assert.equal(looksLikeInternalIdentifier(choice.basis), false);
  }
});

test("E4: an exact-name nomination says so; an unproved specification cannot carry learning", () => {
  const view = describeCuratableObservation(
    obs({
      rawName: "Besi angker",
      candidates: [
        {
          resourceCatalogId: "cat-a",
          name: "Besi angker diameter 8",
          evidence: ["NAME_TOKEN_CONTAINMENT"],
          specificationUnproved: true,
          unprovedSpecificationFacts: ["8"],
        },
        { resourceCatalogId: "cat-b", name: "Alat Bantu", evidence: [] },
      ],
      identityVerdict: verdict("NEEDS_REVIEW", ["MULTIPLE_CANDIDATES_NEEDS_REVIEW", "SPECIFICATION_UNPROVED"], false),
    }),
  );
  assert.equal(view.candidateChoices[0].canCarryLearning, false);
  assert.equal(view.candidateChoices[1].basis, "Dasar: nama sama dengan entri katalog.");
  assert.equal(view.candidateChoices[1].canCarryLearning, true);
});

test("E5: 'genuinely new' opens only when identity is exhausted AND a unit is proven", () => {
  const open = describeCuratableObservation(
    obs({ candidates: [], identityVerdict: verdict("UNRESOLVED", ["RESOURCE_NOT_FOUND"], true) }),
  );
  assert.equal(open.canProposeNew, true);
  assert.equal(open.newResourceBlockedLine, null);
  assert.match(open.guidance, /Anda dapat menetapkannya sebagai sumber daya baru/u);

  const noUnit = describeCuratableObservation(
    obs({ rawUnit: "zzz", candidates: [], suggestedUnitDefinitionId: null, identityVerdict: verdict("UNRESOLVED", ["RESOURCE_NOT_FOUND"], true) }),
  );
  assert.equal(noUnit.canProposeNew, false);
  assert.match(noUnit.newResourceBlockedLine ?? "", /satuan "zzz" belum dapat dibuktikan/u);

  // A weak nomination still exists, so the admission law refuses — and the page says so.
  const weakOnly = describeCuratableObservation(
    obs({
      candidates: [{ resourceCatalogId: "cat-x", name: "Dump Truck", evidence: ["NAME_TOKEN_STEM_SHARED"] }],
      identityVerdict: verdict("NEEDS_REVIEW", ["STRONG_CANDIDATE_NEEDS_REVIEW"], false),
    }),
  );
  assert.equal(weakOnly.canProposeNew, false);
  // No promise of a new resource — and the resource is said to be accepted, not refused.
  // LEGACY_TEST_CHANGE_REGISTER: OLD_EXPECTATION ended "identitas canonical-nya
  // belum dapat dipastikan". IMPORT ACCEPTANCE BOUNDARY (B7) forbids architecture
  // language on the import surface; the same fact is now said as "identitasnya
  // dalam katalog SIMPROK". The sentence is still pinned exactly. TEST_WEAKENING=NO.
  assert.match(
    weakOnly.guidance,
    /^Belum ditemukan padanan yang dapat dibuktikan\. Sumber daya dari dokumen sudah diterima; identitasnya dalam katalog SIMPROK belum dapat dipastikan\.$/u,
  );
  assert.doesNotMatch(weakOnly.guidance, /canonical/u);
});

test("E6: a proven identity asks only for confirmation, never claims doubt", () => {
  const view = describeCuratableObservation(
    obs({
      candidates: [{ resourceCatalogId: "cat-a", name: "Alat Bantu", evidence: [] }],
      identityVerdict: verdict("RESOLVED", ["EXACT_CANONICAL_MATCH"], false),
    }),
  );
  assert.match(view.guidance, /sudah dapat memastikan padanan/u);
  assert.doesNotMatch(view.guidance, /belum dapat dipastikan/u);
});

test("E7: the group key is the question itself — stable across a refresh, distinct per question", () => {
  const [a] = groupIdenticalObservations([obs({ id: "1" })]);
  const [b] = groupIdenticalObservations([obs({ id: "2" })]);
  const [c] = groupIdenticalObservations([obs({ id: "3", rawUnit: "Jam" })]);
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
});

// ---------------- FINDING D — learning offered, or its absence explained ----------------

const member = (identicalQuestion: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  obs({ identicalQuestion, ...over });

test("D1: learning is offered only when the server issued the context AND a choice can carry it", () => {
  const offered = member({ state: "NONE", rememberable: true, decisionContextToken: "t", notRememberableReason: null });
  const learning = describeGroupLearning([offered], describeCuratableObservation(offered));
  assert.equal(learning.offered, true);
  assert.equal(learning.unavailableLine, null);
});

test("D2: a rememberable question with only WEAK candidates offers no checkbox attached to nothing", () => {
  const weak = member(
    { state: "NONE", rememberable: true, decisionContextToken: "t", notRememberableReason: null },
    { candidates: [{ resourceCatalogId: "cat-x", name: "Dump Truck", evidence: ["NAME_TOKEN_STEM_SHARED"] }] },
  );
  const learning = describeGroupLearning([weak], describeCuratableObservation(weak));
  assert.equal(learning.offered, false);
  assert.equal(learning.unavailableLine, IQL_COPY.notOfferedNoChoice);
});

test("D3: every refusal branch the server names is explained — never silently absent", () => {
  const explain = (reason: string, over: Record<string, unknown> = {}) => {
    const row = member({ state: "NONE", rememberable: false, decisionContextToken: null, notRememberableReason: reason }, over);
    return describeGroupLearning([row], describeCuratableObservation(row)).unavailableLine;
  };
  assert.equal(explain("IDENTITY_PROVEN"), IQL_COPY.notOfferedProven);
  assert.equal(explain("LEARNING_NOT_CONFIGURED"), IQL_COPY.notConfigured);
  assert.equal(
    explain("NOT_DECIDABLE", { identityVerdict: verdict("NEEDS_REVIEW", ["MULTIPLE_CANDIDATES_NEEDS_REVIEW", "SPECIFICATION_UNPROVED"], false) }),
    IQL_COPY.notOfferedUnprovedSpecification,
  );
  assert.equal(
    explain("NOT_DECIDABLE", { identityVerdict: verdict("NEEDS_REVIEW", ["STRONG_CANDIDATE_NEEDS_REVIEW", "REVIEWED_MAPPING_CONFLICT"], false) }),
    IQL_COPY.notOfferedMappingConflict,
  );
  assert.equal(
    explain("NOT_DECIDABLE", { candidates: [], identityVerdict: verdict("UNRESOLVED", ["RESOURCE_NOT_FOUND"], true) }),
    IQL_COPY.notOfferedNoChoice,
  );
});

test("D4: a pending candidate is told by its state line, not twice", () => {
  const pending = member({
    state: "PENDING",
    rememberable: false,
    decisionContextToken: null,
    notRememberableReason: "CANDIDATE_PENDING",
    pendingAnswerName: "Alat Bantu",
  });
  const learning = describeGroupLearning([pending], describeCuratableObservation(pending));
  assert.equal(learning.offered, false);
  assert.equal(learning.stateTone, "PENDING");
  assert.match(learning.stateLine ?? "", /menunggu persetujuan/u);
  assert.equal(learning.unavailableLine, null);
});

// ---------------- FINDING C — what a decision actually did ----------------

test("C1: a TEACH is said as submitted for approval — never as learned, used or effective", () => {
  assert.equal(
    learningOutcomeOf([
      { identicalQuestion: { state: "PENDING", replayed: false } },
      { identicalQuestion: { state: "PENDING", replayed: true } },
    ]),
    "SUBMITTED",
  );
  assert.equal(learningOutcomeOf([{ identicalQuestion: { state: "PENDING", replayed: true } }]), "ALREADY_PENDING");
  assert.equal(learningOutcomeOf([{}]), "UNCONFIRMED");

  const outcome = describeResourceDecisionSuccess({
    kind: "EXISTING",
    title: "Triplex (Lbr)",
    chosenName: "Triplex 9 mm",
    rows: 2,
    learning: "SUBMITTED",
  });
  const texts = outcome.lines.map((line) => line.text);
  assert.equal(outcome.kind, "SUCCESS");
  // CHANGE NOTE (F04 receipt truth): the receipt says what the decision DID —
  // the identity was recorded — and never implies the recipe that uses it is now
  // complete; the occurrences are of one QUESTION, which the page cannot claim
  // all came from one document. TEST_WEAKENING=NO: it now states MORE.
  assert.equal(texts[0], "Pilihan Anda tercatat.");
  assert.ok(texts.includes("Triplex (Lbr) dicatat sama dengan Triplex 9 mm. Berlaku untuk 2 kemunculan pertanyaan yang sama."));
  assert.ok(
    texts.includes(
      "Keputusan ini mencatat identitas sumber daya. Kelengkapan AHSP yang memakainya diperiksa lagi pada daftar import.",
    ),
  );
  // Never "selesai", never "lengkap": this decision does not finish a recipe.
  for (const text of texts) {
    assert.doesNotMatch(text, /AHSP .*(selesai|lengkap)\b/u);
  }
  const learningLine = outcome.lines.find((line) => line.tone === "PENDING");
  assert.match(learningLine?.text ?? "", /diajukan untuk persetujuan/u);
  // The two facts are never blurred into "SIMPROK learned it".
  for (const text of texts) {
    assert.doesNotMatch(text, /berhasil digunakan|sudah dipelajari|berlaku efektif|disetujui dan dapat digunakan/u);
  }
});

test("C2: a new resource is named as recorded new; no learning line when none was asked", () => {
  const outcome = describeResourceDecisionSuccess({
    kind: "NEW",
    title: "Plastizier (Kg)",
    chosenName: null,
    rows: 1,
    learning: null,
  });
  assert.deepEqual(outcome.lines.map((line) => line.text), [
    "Pilihan Anda tercatat.",
    "Plastizier (Kg) dicatat sebagai sumber daya baru.",
    "Keputusan ini mencatat identitas sumber daya. Kelengkapan AHSP yang memakainya diperiksa lagi pada daftar import.",
  ]);
});

test("C2b (IMPORT-SEAM-06): one new resource is ONE admission — the other rows are reported from the refreshed list, never claimed", () => {
  const lines = (otherOccurrences: { total: number; stillWaiting: number | null }) =>
    describeResourceDecisionSuccess({
      kind: "NEW",
      title: "Alat Bantu (Ls)",
      chosenName: null,
      rows: 1,
      learning: null,
      otherOccurrences,
    }).lines.map((line) => line.text);

  // Not "berlaku untuk 66 baris": only one admission was made.
  const allClear = lines({ total: 65, stillWaiting: 0 });
  assert.deepEqual(allClear, [
    "Pilihan Anda tercatat.",
    "Alat Bantu (Ls) dicatat sebagai sumber daya baru.",
    "Keputusan ini mencatat identitas sumber daya. Kelengkapan AHSP yang memakainya diperiksa lagi pada daftar import.",
    "65 kemunculan lain dari item yang sama tidak lagi menunggu tinjauan.",
  ]);
  assert.equal(
    lines({ total: 3, stillWaiting: 1 })[3],
    "2 kemunculan lain dari item yang sama tidak lagi menunggu tinjauan; 1 kemunculan lain masih menunggu tinjauan.",
  );
  assert.equal(lines({ total: 2, stillWaiting: 2 })[3], "2 kemunculan lain masih menunggu tinjauan.");
  // An unreadable refresh is said as unknown — never rounded up to "done".
  assert.match(lines({ total: 4, stillWaiting: null })[3], /belum dapat ditampilkan/u);
  for (const text of [...allClear, ...lines({ total: 4, stillWaiting: null })]) {
    assert.equal(looksLikeInternalIdentifier(text), false);
  }
});

test("C3: a refused decision says nothing was saved, the server's reason, and the next step", () => {
  const outcome = describeResourceDecisionFailure({
    saved: 0,
    total: 1,
    failure: { status: 409, code: "RESOURCE_IDENTITY_NOT_EXHAUSTED" },
    learning: null,
  });
  const texts = outcome.lines.map((line) => line.text);
  assert.equal(outcome.kind, "FAILURE");
  assert.equal(texts[0], "Keputusan belum berhasil disimpan.");
  assert.equal(texts[1], "Tidak ada perubahan yang tersimpan.");
  assert.match(texts[2], /masih menemukan entri katalog/u);
  assert.ok(texts[3].length > 0);
  for (const text of texts) assert.equal(looksLikeInternalIdentifier(text), false);
});

test("C4: a partial save is told exactly — and a learning offer the saved rows made is not hidden", () => {
  const outcome = describeResourceDecisionFailure({
    saved: 1,
    total: 3,
    failure: { status: 409, code: "OBSERVATION_ALREADY_DECIDED" },
    learning: "SUBMITTED",
  });
  const texts = outcome.lines.map((line) => line.text);
  assert.equal(outcome.kind, "PARTIAL");
  assert.equal(texts[0], "Keputusan tersimpan untuk 1 dari 3 baris.");
  assert.equal(texts[1], "2 baris belum tersimpan.");
  assert.ok(outcome.lines.some((line) => line.tone === "PENDING"));
});

test("C5: an unknown refusal gets no invented reason", () => {
  const outcome = describeResourceDecisionFailure({
    saved: 0,
    total: 1,
    failure: { status: 409, code: "A_CODE_THIS_PAGE_DOES_NOT_KNOW" },
    learning: null,
  });
  assert.equal(outcome.lines.length, 3);
});

test("C6: governance outcomes follow the state the server returned — APPROVE is the only 'disetujui'", () => {
  assert.equal(describeGovernanceSuccess("approve", { state: "EFFECTIVE", replayed: false }).lines[0].text, "Pembelajaran disetujui.");
  assert.equal(describeGovernanceSuccess("reject", { state: "REJECTED" }).lines[0].text, "Pengajuan pembelajaran ditolak.");
  assert.equal(describeGovernanceSuccess("revoke", { state: "REVOKED" }).lines[0].text, "Pembelajaran dicabut.");
  // A 2xx that does not report the expected state is not dressed up as it.
  assert.equal(describeGovernanceSuccess("approve", { state: "PENDING" }).lines[0].text, "Tindakan diterima server.");
  const refused = describeGovernanceFailure({ status: 409, code: "TEACHER_CANNOT_APPROVE" });
  assert.match(refused.lines.map((line) => line.text).join(" "), /tidak dapat menyetujui pengajuannya sendiri/u);
});

// ---------------- ACG-01.1 — CANDIDATE REFUSED IS NOT RESOURCE REFUSED ----------------

/** Every reader-facing line a view can show for one observation. */
const viewLines = (view: ReturnType<typeof describeCuratableObservation>) =>
  [
    view.understanding,
    view.candidateLine,
    view.weakPossibilityLine,
    view.ruledOutLine,
    view.guidance,
    view.newResourceBlockedLine,
    ...view.candidateChoices.map((choice) => choice.basis),
  ].filter((line): line is string => typeof line === "string");

/** Words that would say the SOURCE RESOURCE was refused or discarded. */
const RESOURCE_REFUSED = /ditolak|dibuang|tidak diterima|gagal diimpor|tidak sah/iu;

const SHAPES = {
  ruledOut: obs({
    rawName: 'Pipa porous diameter 6"',
    rawUnit: "M'",
    candidates: [{ resourceCatalogId: "cat-4", name: 'Pipa porous diameter 4"', evidence: [] }],
    identityVerdict: verdict("UNRESOLVED", ["SPECIFICATION_CONFLICT"], false),
  }),
  weakOnly: obs({
    rawName: "Water Tank Truck",
    rawUnit: "Jam",
    candidates: [{ resourceCatalogId: "cat-dt", name: "Dump Truck", evidence: ["NAME_TOKEN_STEM_SHARED"] }],
    identityVerdict: verdict("NEEDS_REVIEW", ["STRONG_CANDIDATE_NEEDS_REVIEW"], false),
  }),
  noneFound: obs({
    rawName: "Plastizier",
    rawUnit: "Kg",
    candidates: [],
    identityVerdict: verdict("UNRESOLVED", ["RESOURCE_NOT_FOUND"], true),
  }),
  nominated: obs({
    rawName: "Triplex",
    rawUnit: "Lbr",
    candidates: [{ resourceCatalogId: "cat-t", name: "Triplex Meranti", evidence: ["NAME_TOKEN_CONTAINMENT"] }],
    identityVerdict: verdict("NEEDS_REVIEW", ["STRONG_CANDIDATE_NEEDS_REVIEW"], false),
  }),
  proven: obs({
    rawName: "Concrete Mixer",
    rawUnit: "Jam",
    candidates: [{ resourceCatalogId: "cat-cm", name: "Concrete Mixer", evidence: [] }],
    identityVerdict: verdict("RESOLVED", ["EXACT_CANONICAL_MATCH"], false),
  }),
};

test("R1: no verdict shape ever says the source resource was refused — only candidates are", () => {
  for (const [shape, observation] of Object.entries(SHAPES)) {
    for (const line of viewLines(describeCuratableObservation(observation))) {
      assert.doesNotMatch(line, RESOURCE_REFUSED, `${shape}: ${line}`);
      assert.equal(looksLikeInternalIdentifier(line), false, `${shape}: ${line}`);
    }
  }
});

test("R2: where no identity can be proved, the resource is said to be ACCEPTED and its identity UNRESOLVED", () => {
  for (const shape of ["ruledOut", "weakOnly", "noneFound"] as const) {
    const view = describeCuratableObservation(SHAPES[shape]);
    // LEGACY_TEST_CHANGE_REGISTER: "identitas canonical-nya" → "identitasnya dalam katalog SIMPROK" (B7, no architecture language). TEST_WEAKENING=NO.
    assert.match(view.guidance, /Sumber daya dari dokumen sudah diterima; identitasnya dalam katalog SIMPROK belum dapat dipastikan\./u, shape);
  }
  // Where a confirmation or a proof exists, the page asks for that instead.
  assert.doesNotMatch(describeCuratableObservation(SHAPES.nominated).guidance, /sudah diterima/u);
  assert.doesNotMatch(describeCuratableObservation(SHAPES.proven).guidance, /sudah diterima/u);
});

test("R3: the shut new-resource door names the true reason for each verdict shape — and adds no action", () => {
  const blocked = (shape: keyof typeof SHAPES) => describeCuratableObservation(SHAPES[shape]).newResourceBlockedLine ?? "";
  assert.match(blocked("ruledOut"), /langkah untuk sumber daya yang padanannya tidak cocok belum tersedia/u);
  assert.match(blocked("ruledOut"), /tetap tersimpan dan dinilai ulang setiap kali daftar ini dibuka/u);
  assert.match(blocked("weakOnly"), /belum terbukti maupun tersingkirkan/u);
  assert.match(blocked("weakOnly"), /tetap tersimpan/u);
  assert.match(blocked("nominated"), /menunggu konfirmasi/u);
  assert.match(blocked("proven"), /Tidak perlu ditetapkan sebagai sumber daya baru/u);
  // Exhausted with a proven unit: the lawful door is open, nothing is shut.
  assert.equal(describeCuratableObservation(SHAPES.noneFound).newResourceBlockedLine, null);
  assert.equal(describeCuratableObservation(SHAPES.noneFound).canProposeNew, true);
  // No shape turns a refused row, or a weak one, into something to click.
  assert.deepEqual(describeCuratableObservation(SHAPES.ruledOut).candidateChoices, []);
  assert.deepEqual(describeCuratableObservation(SHAPES.weakOnly).candidateChoices, []);
});

test("R4: the import preview never lists a ruled-out row as a possible match", () => {
  const resources = [
    { rawName: "Semen", resolvedResourceCatalogId: null, identityCandidates: ["Semen Portland"] },
    {
      rawName: 'Pipa porous diameter 6"',
      resolvedResourceCatalogId: null,
      identityCandidates: ['Pipa porous diameter 4"', "Besi angker diameter 8"],
      identityCandidatesRuledOut: true,
    },
  ];
  assert.deepEqual(previewCandidateNames(resources), ["Semen Portland"]);
  assert.deepEqual(previewRuledOutNames(resources), ['Pipa porous diameter 4"', "Besi angker diameter 8"]);
  const line = previewRuledOutLine(previewRuledOutNames(resources)) ?? "";
  assert.match(line, /^SIMPROK tidak menggunakan Pipa porous diameter 4", Besi angker diameter 8 sebagai padanan karena buktinya tidak cocok/u);
  assert.ok(line.endsWith("Komponennya tetap dibaca; simpan untuk meninjaunya di bawah."));
  assert.doesNotMatch(line, RESOURCE_REFUSED);
  assert.equal(previewRuledOutLine([]), null);
});

// R6 — A PREVIEW HAS STORED NOTHING, AND MAY NOT SAY IT HAS.
test("R6: the preview's ruled-out sentence claims no storage before the save", () => {
  const line =
    previewRuledOutLine(
      previewRuledOutNames([
        {
          rawName: 'Pipa porous diameter 6"',
          resolvedResourceCatalogId: null,
          identityCandidates: ['Pipa porous diameter 4"'],
          identityCandidatesRuledOut: true,
        },
      ]),
    ) ?? "";
  // No claim that anything is, or has been, stored: reading is not saving.
  assert.doesNotMatch(line, /disimpan|tersimpan|sudah diterima/u);
  // It says what did happen to the component — it was read — and points at the
  // one act that stores it, in the same words the nominated line uses.
  assert.match(line, /Komponennya tetap dibaca/u);
  assert.match(line, /simpan untuk meninjaunya di bawah/u);
  // It still speaks of the CANDIDATE, never of the resource being refused.
  assert.match(line, /^SIMPROK tidak menggunakan /u);
});

// R7 — ATTRIBUTE FIRST, DEDUPE ONLY WHAT IS SEMANTICALLY IDENTICAL.
test("R7: one catalogue name is never said unqualified as both possible and ruled out", () => {
  const resources = [
    // Two components of ONE work item, one catalogue row, two honest meanings.
    { rawName: "Besi beton", resolvedResourceCatalogId: null, identityCandidates: ["Besi beton D10"] },
    {
      rawName: "Besi beton D13",
      resolvedResourceCatalogId: null,
      identityCandidates: ["Besi beton D10"],
      identityCandidatesRuledOut: true,
    },
  ];
  const possible = previewCandidateNames(resources);
  const ruledOut = previewRuledOutNames(resources);
  // NOTHING IS DROPPED — both facts survive, each attributed to its component.
  assert.deepEqual(possible, ["Besi beton D10 (untuk Besi beton)"]);
  assert.deepEqual(ruledOut, ["Besi beton D10 (untuk Besi beton D13)"]);
  // THE INVARIANT: no label, and no bare name, is on both sides at once.
  assert.deepEqual(possible.filter((name) => ruledOut.includes(name)), []);
  assert.ok(!possible.includes("Besi beton D10"));
  assert.ok(!ruledOut.includes("Besi beton D10"));
  // The rendered sentences therefore cannot contradict each other.
  const line = previewRuledOutLine(ruledOut) ?? "";
  assert.ok(line.includes("Besi beton D10 (untuk Besi beton D13)"));

  // An uncontested name stays plain — attribution is not noise for its own sake.
  const plain = [
    { rawName: "Semen", resolvedResourceCatalogId: null, identityCandidates: ["Semen Portland"] },
    {
      rawName: 'Pipa porous diameter 6"',
      resolvedResourceCatalogId: null,
      identityCandidates: ['Pipa porous diameter 4"'],
      identityCandidatesRuledOut: true,
    },
  ];
  assert.deepEqual(previewCandidateNames(plain), ["Semen Portland"]);
  assert.deepEqual(previewRuledOutNames(plain), ['Pipa porous diameter 4"']);

  // Semantically identical mentions merge; different components do not.
  assert.deepEqual(
    previewCandidateMentions([
      { rawName: "Semen", resolvedResourceCatalogId: null, identityCandidates: ["Semen Portland", "Semen Portland"] },
      { rawName: "PC", resolvedResourceCatalogId: null, identityCandidates: ["Semen Portland"] },
    ]),
    [
      { name: "Semen Portland", component: "Semen", ruledOut: false },
      { name: "Semen Portland", component: "PC", ruledOut: false },
    ],
  );
});

test("R5: a direct attempt the kernel refuses is reported as a refused CANDIDATE, with nothing saved", () => {
  for (const code of ["IDENTITY_CANDIDATE_RULED_OUT", "IDENTITY_PROVEN_OTHERWISE"]) {
    const outcome = describeResourceDecisionFailure({ saved: 0, total: 1, failure: { status: 409, code }, learning: null });
    const texts = outcome.lines.map((l) => l.text);
    assert.equal(outcome.kind, "FAILURE", code);
    assert.equal(texts[1], "Tidak ada perubahan yang tersimpan.", code);
    assert.match(texts[2], /Sumber daya dari dokumen tetap tersimpan\./u, code);
    for (const text of texts) {
      assert.doesNotMatch(text, RESOURCE_REFUSED, code);
      assert.equal(looksLikeInternalIdentifier(text), false, code);
    }
  }
});

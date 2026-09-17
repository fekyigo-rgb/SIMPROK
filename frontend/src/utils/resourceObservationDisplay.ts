/**
 * Human-facing view-model for the shared observed-resource curation surface.
 *
 * SIMPROK preserves a resource it saw but could not prove, shows the candidates
 * it found, and asks a person to decide — existing resource or genuinely new.
 * This module only chooses the words and shapes the options; it never decides
 * identity, never auto-selects a candidate, and never lets an internal code,
 * reason string, or UUID reach the reader.
 */

import {
  explainStatus,
  failureLines,
  nothingSavedNote,
  type ActionOutcome,
  type ApiFailure,
  type FailureExplanation,
  type OutcomeLine,
} from './ahspActionFeedback.ts';

/**
 * One candidate the identity authority nominated, described the way the kernel
 * described it. `evidence` is WHY it was nominated — the kernel's own reason
 * codes, never a score computed here.
 */
export interface ObservationCandidateWire {
  resourceCatalogId: string;
  name: string;
  code?: string | null;
  type?: string | null;
  baseUnit?: string | null;
  evidence?: readonly string[] | null;
  /** The candidate claims something the source never stated. */
  specificationUnproved?: boolean | null;
  /** Exactly which claims are unsupported — a diameter, a grade, a finish. */
  unprovedSpecificationFacts?: readonly string[] | null;
}

/**
 * EVIDENCE STRENGTH, READ FROM THE KERNEL'S OWN REASONS.
 *
 * CONFIRMABLE — SIMPROK has seen this exact fact bound to this catalogue row
 *   before, or a person already decided it: a code it has recorded, a reviewed
 *   mapping, a previous sighting of the same name, or the source name fully
 *   containing the candidate's words.
 *
 * WEAK — the ONLY reason is that the two names happen to share one long word.
 *   "Tanah Biasa" and "Klem biasa" share "biasa"; "Dump Truck" and "Water Tank
 *   Truck" share "truck". That is a reason to look, never a reason to choose,
 *   so it is shown and is deliberately NOT actionable.
 */
const CONFIRMABLE_EVIDENCE = [
  'SOURCE_CODE_MATCH',
  'REVIEWED_MAPPING_CODE_MATCH',
  'REVIEWED_MAPPING_NAME_MATCH',
  'SOURCE_SIGHTING_NAME_MATCH',
  'NAME_TOKEN_CONTAINMENT',
];

export const isConfirmableCandidate = (
  candidate: ObservationCandidateWire,
): boolean => {
  const evidence = candidate.evidence ?? [];
  // No evidence list at all means the kernel handed this row over as its own
  // single finding (an exact or representation-tie candidate), not as a token
  // guess — those are confirmable. An EMPTY list is the same fact.
  if (evidence.length === 0) return true;
  return evidence.some((kind) => CONFIRMABLE_EVIDENCE.includes(kind));
};

/** An open observation, enriched by GET /resource-observations for curation. */
export interface CuratableObservationWire {
  id: string;
  rawName: string;
  rawCode?: string | null;
  rawUnit?: string | null;
  resourceType?: string | null;
  origin?: string | null;
  status?: string | null;
  candidates?: readonly ObservationCandidateWire[] | null;
  /** ACG-01 — the kernel's verdict the candidate list belongs to. */
  identityVerdict?: IdentityVerdictWire | null;
  suggestedUnitDefinitionId?: string | null;
  /** IQL-01 — the state of this row's EXACT question, attached by the backend. */
  identicalQuestion?: IdenticalQuestionWire | null;
}

/**
 * ACG-01 OWNER BROWSER GAP — the verdict a candidate list belongs to, carried by
 * the server exactly as the identity kernel returned it.
 *
 * Under UNRESOLVED the kernel lists rows it RULED OUT (a stated specification
 * conflict, a class mismatch) so a person can see them; under NEEDS_REVIEW or
 * RESOLVED it lists what it nominated or proved. `exhausted` is the admission
 * law's own predicate: only then may an item be recorded as genuinely new.
 */
export interface IdentityVerdictWire {
  status?: string | null;
  reasonCodes?: readonly string[] | null;
  exhausted?: boolean | null;
}

/**
 * IQL-01 — what the backend says about one open row's exact question. The
 * signed context rides along for the action only; account ids never arrive.
 */
export interface IdenticalQuestionWire {
  questionKey?: string | null;
  state?: string | null;
  rememberable?: boolean | null;
  /** ACG-01 — why learning is not offered for this row, named by the server's own branch. */
  notRememberableReason?: string | null;
  decisionContextToken?: string | null;
  pendingAnswerName?: string | null;
  pendingAuthoredByYou?: boolean | null;
}

export interface ObservationCandidateChoice {
  resourceCatalogId: string;
  name: string;
  /** What the catalogue row claims that the source never stated, if anything. */
  unprovedFacts: readonly string[];
  /** WHY the kernel nominated it, in the reader's words — its own evidence, never a score. */
  basis: string;
  /**
   * Whether this answer may ALSO be offered as learning. The server refuses to
   * learn an answer whose specification the source never stated.
   */
  canCarryLearning: boolean;
}

export interface ObservationView {
  id: string;
  /** rawName, with the unit as written appended — what the reader recognises. */
  title: string;
  /**
   * Candidates a person may actually act on. A row nominated only because it
   * shares a word with the source name never appears here.
   */
  candidateChoices: ObservationCandidateChoice[];
  /**
   * Nominations too weak to act on, kept VISIBLE so SIMPROK never hides what it
   * looked at — but never offered as an answer.
   */
  weakPossibilities: string[];
  /** One human sentence naming the actionable candidates, or null when none. */
  candidateLine: string | null;
  /** One sentence for the weak ones, or null when there are none. */
  weakPossibilityLine: string | null;
  /**
   * Rows the kernel examined and RULED OUT, kept visible so SIMPROK is seen to
   * have looked — and never offered, because the kernel refused them.
   */
  ruledOut: string[];
  ruledOutLine: string | null;
  /** What SIMPROK understood about the row, before any identity question. */
  understanding: string;
  /**
   * True only when "genuinely new" can actually be recorded: the Unit Kernel
   * proved a unit AND identity is exhausted — the same law curate-new enforces.
   */
  canProposeNew: boolean;
  newUnitDefinitionId: string | null;
  /** When it cannot, why — so the door is shown shut and explained, never a refusal waiting to happen. */
  newResourceBlockedLine: string | null;
  /** What the curator should do, in plain language. */
  guidance: string;
}

/** The source's own class, in the reader's words. Never an internal enum. */
const CLASS_WORD: Record<string, string> = {
  LABOR: 'tenaga kerja',
  MATERIAL: 'bahan',
  EQUIPMENT: 'peralatan',
};

const trimmedName = (name: string): string => name.trim();

/** At most four names, then an honest count of the rest — never a dump. */
const nameList = (names: readonly string[]): string => {
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ', dan ' + rest + ' lainnya' : '');
};

/**
 * The kernel's evidence kinds that record a FACT SIMPROK already holds — a code
 * or a spelling bound to this catalogue row before, or a person's mapping — in
 * the order the kernel itself ranks them. Said, never scored.
 */
const RECORDED_EVIDENCE_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['SOURCE_CODE_MATCH', 'kode sumber yang sama pernah tercatat untuk sumber daya ini'],
  ['REVIEWED_MAPPING_CODE_MATCH', 'kode ini pernah dipetakan manusia ke sumber daya ini'],
  ['REVIEWED_MAPPING_NAME_MATCH', 'nama ini pernah dipetakan manusia ke sumber daya ini'],
  ['SOURCE_SIGHTING_NAME_MATCH', 'nama ini pernah terlihat pada dokumen sumber untuk sumber daya ini'],
];

const basisOf = (candidate: ObservationCandidateWire): string => {
  const evidence = candidate.evidence ?? [];
  // No evidence list is the kernel's own finding: an exact name match.
  if (evidence.length === 0) return 'Dasar: nama sama dengan entri katalog.';
  const recorded = RECORDED_EVIDENCE_WORDS.filter(([kind]) => evidence.includes(kind)).map(
    ([, words]) => words,
  );
  const byName = evidence.includes('NAME_TOKEN_CONTAINMENT');
  if (recorded.length === 0) return 'Dasar: kemiripan nama saja.';
  return 'Dasar: ' + [...recorded, ...(byName ? ['kemiripan nama'] : [])].join('; ') + '.';
};

/** Why the kernel ruled rows out, for the reasons it can state. */
const RULED_OUT_WORDS: Readonly<Record<string, string>> = {
  SPECIFICATION_CONFLICT: 'spesifikasi yang dinyatakan bertentangan dengan sumber',
  RESOURCE_TYPE_MISMATCH: 'kelas sumber dayanya berbeda dengan sumber',
};

/**
 * Shape one observation for the curator. Candidates keep their catalogue id (so
 * "this is an existing resource" carries the id the mint safety needs) but the
 * reader is only ever shown the name.
 */
export const describeCuratableObservation = (
  observation: CuratableObservationWire,
): ObservationView => {
  const verdict = observation.identityVerdict ?? null;
  // Under UNRESOLVED every listed row is one the kernel REFUSED. Offering it as
  // "Benar, ini sama dengan…" would let a person bind what the kernel ruled out.
  const listIsRuledOut = verdict?.status === 'UNRESOLVED';
  const seen = new Set<string>();
  const candidateChoices: ObservationCandidateChoice[] = [];
  const weakPossibilities: string[] = [];
  const ruledOut: string[] = [];
  for (const candidate of observation.candidates ?? []) {
    const name = trimmedName(candidate?.name ?? '');
    if (name === '' || !candidate?.resourceCatalogId) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    if (listIsRuledOut) {
      ruledOut.push(name);
    } else if (isConfirmableCandidate(candidate)) {
      const unprovedFacts = candidate.unprovedSpecificationFacts ?? [];
      candidateChoices.push({
        resourceCatalogId: candidate.resourceCatalogId,
        name,
        unprovedFacts,
        basis: basisOf(candidate),
        canCarryLearning: candidate.specificationUnproved !== true && unprovedFacts.length === 0,
      });
    } else {
      weakPossibilities.push(name);
    }
  }

  const names = candidateChoices.map((c) => c.name);
  const candidateLine =
    names.length > 0 ? 'SIMPROK menemukan kemungkinan padanan: ' + nameList(names) + '.' : null;

  // SHOWN, NEVER OFFERED. Hiding these would make SIMPROK look like it had not
  // looked; offering them would make a shared word look like an answer.
  const weakPossibilityLine =
    weakPossibilities.length > 0
      ? 'Beberapa kemungkinan ditemukan, tetapi belum cukup kuat untuk dipilih: ' +
        nameList(weakPossibilities) +
        '.'
      : null;

  const ruledOutBecause = (verdict?.reasonCodes ?? [])
    .map((code) => RULED_OUT_WORDS[code])
    .filter((words): words is string => Boolean(words));
  const ruledOutLine =
    ruledOut.length > 0
      ? 'SIMPROK memeriksa ' +
        nameList(ruledOut) +
        ', tetapi tidak memakainya sebagai padanan' +
        (ruledOutBecause.length > 0 ? ' karena ' + ruledOutBecause.join(' dan ') : '') +
        '.'
      : null;

  const unit = (observation.rawUnit ?? '').trim();
  const classWord = CLASS_WORD[(observation.resourceType ?? '').trim().toUpperCase()] ?? null;

  // WHAT SIMPROK UNDERSTOOD, said before anything is asked of the reader. A row
  // can be fully understood — its class, its unit, its code — and still not be
  // identified, and saying so is the difference between a system that explains
  // itself and one that hands over a list.
  const knownFacts: string[] = [];
  if (classWord) knownFacts.push('jenis ' + classWord);
  if (unit !== '') knownFacts.push('satuan ' + unit);
  const code = (observation.rawCode ?? '').trim();
  if (code !== '') knownFacts.push('kode sumber ' + code);
  const understanding =
    knownFacts.length > 0
      ? 'SIMPROK memahami item ini sebagai ' + knownFacts.join(', ') + '.'
      : 'Data sumber belum cukup untuk memastikan jenis item ini.';

  // "GENUINELY NEW" IS A DOOR ONLY WHEN IT OPENS. Curate-new admits an item only
  // when identity is exhausted and a unit is proven; offering it otherwise sent
  // the reader into a refusal. An older server that does not send the verdict
  // keeps the previous behaviour rather than a guessed one.
  const unitProven = Boolean(observation.suggestedUnitDefinitionId);
  const exhausted = typeof verdict?.exhausted === 'boolean' ? verdict.exhausted : true;
  const canProposeNew = unitProven && exhausted;
  // ACG-01.1 — WHY IT IS SHUT, said from the verdict's own facts. When every row
  // SIMPROK found was ruled out, or only too-weak possibilities remain, the
  // admission law does not yet define a next step: that is said as what it is —
  // a step not yet available — never as the resource being refused. The
  // resource stays stored, and the list re-asks the kernel every time it loads.
  const STILL_STORED = ' Sumber daya ini tetap tersimpan dan dinilai ulang setiap kali daftar ini dibuka.';
  const notExhaustedLine =
    verdict?.status === 'RESOLVED'
      ? 'Tidak perlu ditetapkan sebagai sumber daya baru: SIMPROK sudah memastikan identitasnya.'
      : candidateChoices.length > 0
        ? 'Belum dapat ditetapkan sebagai sumber daya baru selama masih ada padanan yang menunggu konfirmasi.'
        : weakPossibilities.length > 0
          ? 'Belum dapat ditetapkan sebagai sumber daya baru: masih ada kemungkinan padanan yang belum terbukti maupun tersingkirkan.' + STILL_STORED
          : ruledOut.length > 0
            ? 'Belum dapat ditetapkan sebagai sumber daya baru: langkah untuk sumber daya yang padanannya tidak cocok belum tersedia.' + STILL_STORED
            : 'Belum dapat ditetapkan sebagai sumber daya baru: SIMPROK masih menemukan entri katalog yang berkaitan dengan item ini.';
  const newResourceBlockedLine = canProposeNew
    ? null
    : !exhausted
      ? notExhaustedLine
      : unit === ''
        ? 'Belum dapat ditetapkan sebagai sumber daya baru: sumber tidak menyatakan satuannya.'
        : 'Belum dapat ditetapkan sebagai sumber daya baru: satuan "' + unit + '" belum dapat dibuktikan.';
  const newSentence = canProposeNew ? ' Anda dapat menetapkannya sebagai sumber daya baru.' : '';
  // UNKNOWN IDENTITY IS NOT A REFUSED RESOURCE. Said wherever no identity could
  // be proved, because that is exactly where "SIMPROK belum tahu" could be
  // misread as "SIMPROK menolak".
  // IMPORT ACCEPTANCE BOUNDARY (B7): said in the reader's words — never "canonical".
  const ACCEPTED = ' Sumber daya dari dokumen sudah diterima; identitasnya dalam katalog SIMPROK belum dapat dipastikan.';

  // THE HUMAN IS NOT THE MATCHER. The old wording ("pilih padanan yang paling
  // sesuai") asked the reader to judge a list SIMPROK had not judged. Each
  // sentence below states what SIMPROK could and could not prove, and asks for
  // a decision only where one is genuinely required — and it never promises a
  // door the server would refuse.
  const guidance =
    verdict?.status === 'RESOLVED' && names.length > 0
      ? 'SIMPROK sudah dapat memastikan padanan item ini. Konfirmasi untuk menutup item ini.'
      : names.length > 1
        ? 'SIMPROK membutuhkan konfirmasi Anda: ada ' +
          names.length +
          ' kemungkinan padanan dan SIMPROK tidak memilih sendiri di antaranya. Konfirmasi hanya yang Anda yakini sama; bila tidak ada yang tepat, ' +
          (canProposeNew ? 'tetapkan sebagai sumber daya baru.' : 'biarkan item ini tetap menunggu.')
        : names.length === 1
          ? 'SIMPROK membutuhkan konfirmasi Anda: item ini cocok dengan data yang sudah ada, tetapi kecocokannya belum dapat dipastikan sendiri oleh SIMPROK.'
          : weakPossibilities.length > 0 || ruledOut.length > 0
            ? 'Belum ditemukan padanan yang dapat dibuktikan.' + ACCEPTED + newSentence
            : 'SIMPROK belum menemukan padanan yang dapat dipastikan.' + ACCEPTED + newSentence;

  const title =
    unit !== '' ? observation.rawName + ' (' + unit + ')' : observation.rawName;

  return {
    id: observation.id,
    title,
    candidateChoices,
    weakPossibilities,
    candidateLine,
    weakPossibilityLine,
    ruledOut,
    ruledOutLine,
    understanding,
    canProposeNew,
    newUnitDefinitionId: observation.suggestedUnitDefinitionId ?? null,
    newResourceBlockedLine,
    guidance,
  };
};

/**
 * Collision-proof separator for the grouping key, the same character and the
 * same reason as the import page's own decision key: a real space would let two
 * different field combinations flatten to one string, and the null character
 * never appears in source text.
 */
const QUESTION_FIELD_SEPARATOR = '\u0000';

/** One question, and every observation that asked it. */
export interface ObservationGroup {
  /**
   * The question's own identity — every input its decision depends on. Stable
   * across a refresh, so the outcome of acting on it can stay where it happened.
   */
  key: string;
  /** The question itself, shaped exactly as a lone observation would be. */
  view: ObservationView;
  /**
   * Every observation posing this identical question, in first-seen order. The
   * curator answers once; the answer is recorded against each of these, so each
   * keeps its own decision row, its own actor and its own provenance.
   */
  ids: string[];
  /** How many times it was asked. 1 means a lone observation. */
  occurrences: number;
}

/**
 * AUTOMATION BEFORE HUMAN INTERVENTION — the law this page already applies to
 * identical AHSP items, applied to the resources beneath them.
 *
 * One official document quotes "Alat Bantu (Ls)" once per analysis, so a real
 * import can put the SAME question on screen sixty-six times. Answering it
 * sixty-six times is not sixty-six judgments; it is one judgment and sixty-five
 * repetitions, and repetition is machine work. The rows are folded into one
 * question with an honest count.
 *
 * WHAT MAY BE FOLDED IS DELIBERATELY NARROW. Two observations join a group only
 * when EVERY input the decision depends on is identical: the raw name exactly as
 * written, the source code, the unit as written, the resource class, the unit the
 * Unit authority proved, and the exact candidate set the identity authority
 * nominated. Anything less would merge two questions that are not the same
 * question — and a differing candidate set means SIMPROK found different
 * evidence, which is precisely when a human must look twice.
 *
 * The raw name is compared as written rather than case-folded: the reader is
 * shown one spelling, and it must be the spelling the source actually used.
 *
 * NOTHING IS DECIDED HERE. No candidate is selected, no group is answered on the
 * reader's behalf, and a lone observation is still its own group of one.
 */
export const groupIdenticalObservations = (
  observations: readonly CuratableObservationWire[] | null | undefined,
): ObservationGroup[] => {
  const groups: ObservationGroup[] = [];
  const byQuestion = new Map<string, ObservationGroup>();

  for (const observation of observations ?? []) {
    if (!observation?.id) continue;
    const view = describeCuratableObservation(observation);
    // The null character never appears in source text, so no combination of
    // fields can collide with a different combination.
    const question = [
      (observation.rawName ?? '').trim(),
      (observation.rawCode ?? '').trim(),
      (observation.rawUnit ?? '').trim(),
      (observation.resourceType ?? '').trim(),
      observation.suggestedUnitDefinitionId ?? '',
      view.candidateChoices.map((c) => c.resourceCatalogId).join(QUESTION_FIELD_SEPARATOR),
    ].join(QUESTION_FIELD_SEPARATOR);

    const existing = byQuestion.get(question);
    if (existing) {
      existing.ids.push(observation.id);
      existing.occurrences += 1;
      continue;
    }
    const group: ObservationGroup = { key: question, view, ids: [observation.id], occurrences: 1 };
    byQuestion.set(question, group);
    groups.push(group);
  }

  return groups;
};

/**
 * How the count is said out loud, or null for a question asked once — where a
 * count would be noise rather than information.
 */
export const observationOccurrenceLine = (group: ObservationGroup): string | null =>
  group.occurrences > 1
    ? // The occurrences are of the same QUESTION. Whether they all came from one
      // document is not a fact this list carries, so it is not claimed here.
      'Ditemukan ' + group.occurrences + ' kali. Satu keputusan berlaku untuk semuanya.'
    : null;

/** Wire shape of a preview work item's resource (from GET /ahsp/document/preview). */
export interface PreviewResourceWire {
  rawName?: string | null;
  group?: string | null;
  resolvedResourceCatalogId?: string | null;
  identityCandidates?: readonly string[] | null;
  /** ACG-01.1 — the names above were RULED OUT by the kernel, not nominated. */
  identityCandidatesRuledOut?: boolean | null;
}

/**
 * ACG-01.1 R3 — ONE MENTION IS ONE NAME, SAID BY ONE COMPONENT, ON ONE SIDE.
 *
 * A work item holds several components, and one catalogue row can honestly mean
 * different things to two of them: nominated for "Besi beton", ruled out for
 * "Besi beton D13". Pooling names per item printed BOTH sentences about one
 * bare name, which reads as a contradiction and names no component.
 *
 * So: ATTRIBUTE FIRST, DEDUPE ONLY WHAT IS SEMANTICALLY IDENTICAL — the same
 * name, for the same component, on the same side. Nothing is dropped, nothing
 * is ranked, nothing is re-matched.
 */
export interface PreviewCandidateMention {
  /** The catalogue row's name, as SIMPROK returned it. */
  readonly name: string;
  /** The source component it was said about, as the document wrote it. */
  readonly component: string | null;
  /** True: SIMPROK ruled this row out for that component. False: nominated. */
  readonly ruledOut: boolean;
}

export const previewCandidateMentions = (
  resources: readonly PreviewResourceWire[] | null | undefined,
): PreviewCandidateMention[] => {
  const mentions: PreviewCandidateMention[] = [];
  for (const resource of resources ?? []) {
    if (resource?.resolvedResourceCatalogId) continue;
    const ruledOut = resource?.identityCandidatesRuledOut === true;
    const raw = String(resource?.rawName ?? '').trim();
    const component = raw === '' ? null : raw;
    for (const candidate of resource?.identityCandidates ?? []) {
      const name = String(candidate).trim();
      if (name === '') continue;
      const already = mentions.some(
        (mention) =>
          mention.name === name &&
          mention.component === component &&
          mention.ruledOut === ruledOut,
      );
      if (!already) mentions.push({ name, component, ruledOut });
    }
  }
  return mentions;
};

/** Said only when a contested name has no component to be attributed to. */
const UNNAMED_COMPONENT = 'komponen tanpa nama';

/**
 * A name CLAIMED BY BOTH SIDES of one work item is never said unqualified: it
 * carries the component it was said about, so the two sentences read as the two
 * different facts they are. A name only one side claims is said plainly.
 */
const previewSideLabels = (
  resources: readonly PreviewResourceWire[] | null | undefined,
  ruledOut: boolean,
): string[] => {
  const mentions = previewCandidateMentions(resources);
  const contested = new Set(
    mentions
      .filter((mention) =>
        mentions.some(
          (other) => other.name === mention.name && other.ruledOut !== mention.ruledOut,
        ),
      )
      .map((mention) => mention.name),
  );
  const labels: string[] = [];
  for (const mention of mentions) {
    if (mention.ruledOut !== ruledOut) continue;
    const label = contested.has(mention.name)
      ? mention.name + ' (untuk ' + (mention.component ?? UNNAMED_COMPONENT) + ')'
      : mention.name;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
};

/**
 * The candidate NAMES to show under an unresolved work item in the import
 * preview — the names SIMPROK found for resources it could not yet prove. A
 * resolved resource contributes none. Names only; de-duplicated; never a code.
 * ACG-01.1: a name the kernel RULED OUT is never listed as a possible match.
 */
export const previewCandidateNames = (
  resources: readonly PreviewResourceWire[] | null | undefined,
): string[] => previewSideLabels(resources, false);

/** ACG-01.1 — the names SIMPROK examined for this item and did NOT use as a match. */
export const previewRuledOutNames = (
  resources: readonly PreviewResourceWire[] | null | undefined,
): string[] => previewSideLabels(resources, true);

/**
 * The preview sentence for ruled-out names, or null when there are none.
 *
 * It speaks of the CANDIDATE only — the component itself is not refused — and
 * it claims nothing about storage, because a preview stores nothing: reading a
 * document and saving it are two different acts, and only the save button below
 * performs the second. So this sentence points at that button in the same words
 * the nominated line uses, instead of describing a save that has not happened.
 */
export const previewRuledOutLine = (names: readonly string[]): string | null =>
  names.length > 0
    ? 'SIMPROK tidak menggunakan ' +
      nameList(names) +
      ' sebagai padanan karena buktinya tidak cocok dengan sumber. Komponennya tetap dibaca; simpan untuk meninjaunya di bawah.'
    : null;

/**
 * A defensive guard used by tests: reader-facing copy must never leak a UUID or
 * a SCREAMING_SNAKE reason code.
 */
export const looksLikeInternalIdentifier = (text: string): boolean =>
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(text) || /[A-Z]{4,}_[A-Z]/.test(text);

// ---------------------------------------------------------------------------
// IQL-01 — GOVERNED EXACT-QUESTION LEARNING, AS THE READER SEES IT.
//
// Three different facts that must never blur into one another: a row was
// decided; that decision was OFFERED as learning; the learning was APPROVED and
// may be reused. SIMPROK never learns by itself — a person offers, another
// person approves.
// ---------------------------------------------------------------------------

export const IQL_COPY = {
  rowDecided: 'Keputusan baris ini sudah dibuat.',
  pending:
    'Keputusan ini sedang diajukan sebagai pembelajaran — menunggu persetujuan.',
  effective: 'Pembelajaran ini sudah disetujui dan dapat digunakan kembali.',
  remember:
    'Ajukan juga sebagai pembelajaran untuk pertanyaan yang persis sama (perlu persetujuan orang lain yang berwenang)',
  inapplicable:
    'Pembelajaran sebelumnya untuk pertanyaan ini tidak berlaku lagi karena kandidat atau aturannya berubah.',
  rejected: 'Pengajuan pembelajaran sebelumnya untuk pertanyaan ini ditolak.',
  revoked: 'Pembelajaran sebelumnya untuk pertanyaan ini sudah dicabut.',
  // ACG-01 — why the offer is absent, so its absence is never a puzzle.
  notOfferedProven:
    'Tidak perlu diajukan sebagai pembelajaran: SIMPROK sudah dapat memastikan padanan item ini sendiri.',
  notOfferedNoChoice:
    'Tidak dapat diajukan sebagai pembelajaran: belum ada padanan yang dapat dikonfirmasi untuk item ini.',
  notOfferedUnprovedSpecification:
    'Tidak dapat diajukan sebagai pembelajaran: padanan yang ditemukan menyatakan hal yang belum disebut sumber.',
  notOfferedMappingConflict:
    'Tidak dapat diajukan sebagai pembelajaran: keputusan sebelumnya untuk nama ini menunjuk sumber daya yang berbeda-beda.',
  notOfferedOther:
    'Tidak dapat diajukan sebagai pembelajaran untuk pertanyaan ini; keputusan Anda tetap berlaku untuk item ini saja.',
  notConfigured: 'Pengajuan pembelajaran belum diaktifkan di workspace ini.',
} as const;

/** The line under an open question naming its exact-question learning state, or null. */
export const identicalQuestionLine = (
  wire: IdenticalQuestionWire | null | undefined,
): string | null => {
  switch (wire?.state) {
    case 'PENDING': {
      const name = (wire.pendingAnswerName ?? '').trim();
      return name !== '' ? IQL_COPY.pending + ' Usulan: ' + name + '.' : IQL_COPY.pending;
    }
    case 'INAPPLICABLE':
      return IQL_COPY.inapplicable;
    case 'REJECTED':
      return IQL_COPY.rejected;
    case 'REVOKED':
      return IQL_COPY.revoked;
    default:
      return null;
  }
};

/**
 * Whether one grouped decision may also be offered as learning: EVERY row must
 * carry its own signed context. Otherwise the offer is simply not shown — the
 * row decision itself is always available.
 */
export const groupCanRemember = (
  members: ReadonlyArray<CuratableObservationWire | undefined>,
): boolean =>
  members.length > 0 &&
  members.every(
    (member) =>
      member?.identicalQuestion?.rememberable === true &&
      typeof member.identicalQuestion.decisionContextToken === 'string' &&
      member.identicalQuestion.decisionContextToken.length > 0,
  );

export interface GroupLearningView {
  /**
   * Show the offer. The server must have issued every row's context AND at
   * least one answer on screen must be one learning can ride on — an offer with
   * no such answer would be a checkbox attached to nothing.
   */
  offered: boolean;
  /** The question's learning state, when it has one (pending, rejected, revoked, inapplicable). */
  stateLine: string | null;
  stateTone: 'PENDING' | 'MUTED' | null;
  /** Why no offer is shown, in plain words, whenever the reader would otherwise be left guessing. */
  unavailableLine: string | null;
}

/**
 * ACG-01 OWNER BROWSER GAP — FINDING D. Learning is offered, or its absence is
 * explained, from the server's own facts: its `rememberable` answer, the branch
 * it named for refusing, and the kernel's verdict. Eligibility is NEVER decided
 * here — the server decides; this only says what it decided.
 */
export const describeGroupLearning = (
  members: ReadonlyArray<CuratableObservationWire | undefined>,
  view: ObservationView,
): GroupLearningView => {
  const first = members[0] ?? null;
  const stateLine = identicalQuestionLine(first?.identicalQuestion);
  const stateTone = stateLine
    ? first?.identicalQuestion?.state === 'PENDING'
      ? 'PENDING'
      : 'MUTED'
    : null;
  const learnable = view.candidateChoices.some((choice) => choice.canCarryLearning);
  const offered = groupCanRemember(members) && learnable;
  if (offered) return { offered, stateLine, stateTone, unavailableLine: null };

  const reason =
    members
      .map((member) => member?.identicalQuestion?.notRememberableReason)
      .find((value): value is string => typeof value === 'string' && value !== '') ?? null;
  const reasonCodes = first?.identityVerdict?.reasonCodes ?? [];
  const unavailableLine =
    reason === 'CANDIDATE_PENDING' || reason === 'NO_ACTOR'
      ? null // the pending line already says it; an unknown reader is never shown the list
      : reason === 'IDENTITY_PROVEN'
        ? IQL_COPY.notOfferedProven
        : reason === 'LEARNING_NOT_CONFIGURED'
          ? IQL_COPY.notConfigured
          : view.candidateChoices.length === 0
            ? IQL_COPY.notOfferedNoChoice
            : !learnable || reasonCodes.includes('SPECIFICATION_UNPROVED')
              ? IQL_COPY.notOfferedUnprovedSpecification
              : reasonCodes.includes('REVIEWED_MAPPING_CONFLICT')
                ? IQL_COPY.notOfferedMappingConflict
                : reason === 'NOT_DECIDABLE'
                  ? IQL_COPY.notOfferedOther
                  : null;
  return { offered, stateLine, stateTone, unavailableLine };
};

// ---------------------------------------------------------------------------
// ACG-01 OWNER BROWSER GAP — FINDING C: WHAT A DECISION ACTUALLY DID.
//
// A resource decision and a learning offer are TWO facts and are said as two:
// "the row is decided" is never worded as "SIMPROK learned it". TEACH is a
// candidate awaiting another person; only APPROVE makes it effective.
// ---------------------------------------------------------------------------

/** What the server answered about the learning offer that rode on a decision. */
export type LearningOutcome = 'SUBMITTED' | 'ALREADY_PENDING' | 'ALREADY_APPROVED' | 'UNCONFIRMED';

/** Read the TEACH results the server returned for every row of one grouped decision. */
export const learningOutcomeOf = (
  results: ReadonlyArray<{ identicalQuestion?: { state?: string | null; replayed?: boolean | null } | null } | null>,
): LearningOutcome => {
  const answers = results.map((result) => result?.identicalQuestion ?? null);
  if (answers.some((answer) => answer?.state === 'PENDING' && answer.replayed === false)) return 'SUBMITTED';
  if (answers.length > 0 && answers.every((answer) => answer?.state === 'PENDING')) return 'ALREADY_PENDING';
  if (answers.some((answer) => answer?.state === 'EFFECTIVE')) return 'ALREADY_APPROVED';
  return 'UNCONFIRMED';
};

const LEARNING_LINE: Readonly<Record<LearningOutcome, OutcomeLine>> = {
  SUBMITTED: {
    tone: 'PENDING',
    text: 'Pembelajaran diajukan untuk persetujuan orang lain yang berwenang. Belum dipakai untuk pertanyaan lain sebelum disetujui.',
  },
  ALREADY_PENDING: {
    tone: 'PENDING',
    text: 'Pengajuan pembelajaran yang sama sudah ada dan masih menunggu persetujuan.',
  },
  ALREADY_APPROVED: {
    tone: 'SUCCESS',
    text: 'Jawaban yang sama sudah disetujui sebelumnya sebagai pembelajaran.',
  },
  UNCONFIRMED: {
    tone: 'NOTE',
    text: 'Server tidak mengembalikan status pengajuan pembelajaran; periksa daftar pembelajaran di bawah.',
  },
};

export interface ResourceDecisionInput {
  kind: 'EXISTING' | 'NEW';
  /** The item as the reader saw it, e.g. "Semen (Kg)". */
  title: string;
  /** EXISTING: the confirmed catalogue name. */
  chosenName: string | null;
}

/**
 * IMPORT-SEAM-06 — the rows of one question the decision was NOT sent for. A new
 * resource is admitted once, never once per row (a second admission of the same
 * identity is refused), so the other rows are not written by the page: what the
 * refreshed list says about them is reported, and nothing more. `stillWaiting` is
 * null when the list could not be read again.
 */
export interface OtherOccurrences {
  total: number;
  stillWaiting: number | null;
}

const otherOccurrencesLine = (others: OtherOccurrences | null | undefined): string | null => {
  if (!others || others.total <= 0) return null;
  if (others.stillWaiting === null) {
    return 'Daftar tinjauan belum dapat dimuat ulang, jadi keadaan ' + others.total + ' kemunculan lain dari item yang sama belum dapat ditampilkan.';
  }
  const noLongerWaiting = others.total - others.stillWaiting;
  if (others.stillWaiting === 0) {
    return others.total + ' kemunculan lain dari item yang sama tidak lagi menunggu tinjauan.';
  }
  return (
    (noLongerWaiting > 0 ? noLongerWaiting + ' kemunculan lain dari item yang sama tidak lagi menunggu tinjauan; ' : '') +
    others.stillWaiting + ' kemunculan lain masih menunggu tinjauan.'
  );
};

export const describeResourceDecisionSuccess = (
  input: ResourceDecisionInput & {
    rows: number;
    learning: LearningOutcome | null;
    otherOccurrences?: OtherOccurrences | null;
  },
): ActionOutcome => {
  const scope = input.rows > 1 ? ' Berlaku untuk ' + input.rows + ' kemunculan pertanyaan yang sama.' : '';
  const detail =
    input.kind === 'EXISTING'
      ? input.title + ' dicatat sama dengan ' + (input.chosenName ?? 'padanan yang dipilih') + '.' + scope
      : input.title + ' dicatat sebagai sumber daya baru.' + scope;
  const others = otherOccurrencesLine(input.otherOccurrences);
  return {
    kind: 'SUCCESS',
    lines: [
      { tone: 'SUCCESS', text: 'Pilihan Anda tercatat.' },
      { tone: 'NOTE', text: detail },
      // WHAT THIS DECISION IS, AND WHAT IT IS NOT. It records the identity of a
      // resource SIMPROK observed; whether the AHSP that uses it is complete is a
      // question the import asks again of the recipe itself, and is not answered
      // by closing this question.
      {
        tone: 'NOTE' as const,
        text: 'Keputusan ini mencatat identitas sumber daya. Kelengkapan AHSP yang memakainya diperiksa lagi pada daftar import.',
      },
      ...(others ? [{ tone: 'NOTE' as const, text: others }] : []),
      ...(input.learning ? [LEARNING_LINE[input.learning]] : []),
    ],
  };
};

/** The resource-decision refusals the server can send, in the reader's words. */
const DECISION_FAILURE: Readonly<Record<string, FailureExplanation>> = (() => {
  const reloaded = 'Daftar sudah dimuat ulang dengan keadaan terbaru.';
  const stale: FailureExplanation = {
    reason: 'Kandidat untuk pertanyaan ini berubah sejak halaman dimuat.',
    next: 'Daftar sudah dimuat ulang — periksa kembali lalu putuskan lagi.',
  };
  const notLearnable: FailureExplanation = {
    reason: 'Jawaban ini tidak dapat diajukan sebagai pembelajaran.',
    next: 'Putuskan tanpa mencentang pengajuan pembelajaran.',
  };
  return {
    OBSERVATION_ALREADY_DECIDED: { reason: 'Item ini sudah diputuskan sebelumnya, mungkin oleh orang lain.', next: reloaded },
    OBSERVATION_NOT_FOUND: { reason: 'Item ini tidak lagi ada dalam antrean tinjauan.', next: reloaded },
    SELECTED_RESOURCE_NOT_VISIBLE: { reason: 'Sumber daya yang dipilih tidak lagi tersedia di katalog workspace ini.', next: reloaded },
    // ACG-01.1 — the kernel refused the CHOSEN ROW; the source resource is untouched.
    IDENTITY_CANDIDATE_RULED_OUT: {
      reason: 'SIMPROK tidak menggunakan sumber daya itu sebagai padanan karena buktinya tidak cocok dengan sumber. Sumber daya dari dokumen tetap tersimpan.',
      next: reloaded,
    },
    IDENTITY_PROVEN_OTHERWISE: {
      reason: 'SIMPROK sudah memastikan identitas item ini sebagai sumber daya lain. Sumber daya dari dokumen tetap tersimpan.',
      next: reloaded,
    },
    RESOURCE_IDENTITY_NOT_EXHAUSTED: {
      reason: 'SIMPROK masih menemukan entri katalog yang berkaitan dengan item ini, sehingga item ini belum boleh dicatat sebagai sumber daya baru.',
      next: 'Konfirmasi salah satu padanan bila memang sama; bila tidak, item ini tetap menunggu.',
    },
    RESOURCE_PROVENANCE_ALREADY_BOUND: { reason: 'Baris sumber ini sudah terikat ke sumber daya lain.', next: reloaded },
    OBSERVATION_PROVENANCE_INCOMPLETE: {
      reason: 'Asal-usul item ini di dokumen sumber tidak lengkap, sehingga tidak dapat dicatat sebagai sumber daya baru.',
      next: 'Item ini tetap tersimpan untuk ditinjau.',
    },
    UNIT_UNKNOWN_OR_INACTIVE: { reason: 'Satuan yang diusulkan tidak dikenal atau tidak aktif.', next: 'Item ini tetap tersimpan untuk ditinjau.' },
    UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY: { reason: 'Satuan item ini belum dapat dibuktikan oleh SIMPROK.', next: 'Item ini tetap tersimpan untuk ditinjau.' },
    DECISION_CONTEXT_STALE: stale,
    DECISION_GENERATION_STALE: stale,
    QUESTION_PROVENANCE_MISMATCH: stale,
    DECISION_CONTEXT_TOKEN_INVALID: { reason: 'Konteks keputusan untuk pertanyaan ini sudah tidak berlaku.', next: 'Muat ulang halaman lalu putuskan lagi.' },
    DECISION_CONTEXT_TOKEN_REQUIRED: { reason: 'Konteks keputusan tidak ikut terkirim.', next: 'Muat ulang halaman lalu putuskan lagi.' },
    CANDIDATE_PENDING: {
      reason: 'Sudah ada pengajuan pembelajaran lain untuk pertanyaan ini yang menunggu persetujuan.',
      next: 'Putuskan tanpa mencentang pengajuan pembelajaran, atau tunggu pengajuan itu diputuskan.',
    },
    USE_SUPERSEDE: { reason: 'Pertanyaan ini sudah memiliki pembelajaran yang disetujui dengan jawaban lain.', next: reloaded },
    CANDIDATE_NOT_LEGITIMATE_FOR_LEARNING: notLearnable,
    NOT_IDENTICAL_QUESTION_DECIDABLE: notLearnable,
    NOT_HUMAN_DECIDABLE_IDENTITY_ALREADY_PROVEN: {
      reason: 'SIMPROK sudah dapat memastikan identitas item ini sendiri.',
      next: 'Putuskan tanpa mencentang pengajuan pembelajaran.',
    },
    TEACHER_CANNOT_APPROVE: {
      reason: 'Pengaju pembelajaran tidak dapat menyetujui pengajuannya sendiri.',
      next: 'Persetujuan harus datang dari orang lain yang berwenang.',
    },
    NO_PENDING_CANDIDATE: { reason: 'Tidak ada pengajuan yang sedang menunggu persetujuan untuk pertanyaan ini.', next: reloaded },
    NO_EFFECTIVE_ANSWER: { reason: 'Tidak ada pembelajaran yang sedang berlaku untuk pertanyaan ini.', next: reloaded },
    REASON_REQUIRED: { reason: 'Alasan wajib diisi untuk tindakan ini.', next: 'Tuliskan alasannya lalu coba lagi.' },
    QUESTION_NOT_FOUND: { reason: 'Pertanyaan pembelajaran ini tidak ditemukan.', next: reloaded },
  };
})();

const DECISION_FORBIDDEN = 'Workspace aktif Anda tidak memiliki kewenangan untuk keputusan ini.';

export const explainDecisionFailure = (failure: ApiFailure): FailureExplanation =>
  (failure.code ? DECISION_FAILURE[failure.code] : undefined) ?? explainStatus(failure, DECISION_FORBIDDEN);

export const describeResourceDecisionFailure = (input: {
  saved: number;
  total: number;
  failure: ApiFailure;
  /** What the rows that WERE saved answered about learning, when it was requested. */
  learning: LearningOutcome | null;
}): ActionOutcome => {
  const explanation = explainDecisionFailure(input.failure);
  if (input.saved === 0) {
    return {
      kind: 'FAILURE',
      lines: failureLines('Keputusan belum berhasil disimpan.', nothingSavedNote(input.failure), explanation),
    };
  }
  // The rows that were saved stay saved — and so does a learning offer they carried.
  return {
    kind: 'PARTIAL',
    lines: [
      ...failureLines(
        'Keputusan tersimpan untuk ' + input.saved + ' dari ' + input.total + ' baris.',
        input.total - input.saved + ' baris belum tersimpan.',
        explanation,
      ),
      ...(input.learning ? [LEARNING_LINE[input.learning]] : []),
    ],
  };
};

/** Refusing to reject or revoke without a reason — nothing was sent. */
export const REASON_MISSING_OUTCOME: ActionOutcome = {
  kind: 'FAILURE',
  lines: [
    { tone: 'FAILURE', text: 'Tuliskan alasannya terlebih dahulu.' },
    { tone: 'NOTE', text: 'Alasan wajib untuk menolak atau mencabut pembelajaran. Belum ada yang dikirim.' },
  ],
};

/** A governance act on one exact question, as the server recorded it. */
export const describeGovernanceSuccess = (
  action: 'approve' | 'reject' | 'revoke',
  result: { state?: string | null; replayed?: boolean | null } | null,
): ActionOutcome => {
  const replayNote: OutcomeLine[] =
    result?.replayed === true ? [{ tone: 'NOTE', text: 'Tindakan yang sama sudah tercatat sebelumnya.' }] : [];
  if (action === 'approve' && result?.state === 'EFFECTIVE') {
    return {
      kind: 'SUCCESS',
      lines: [
        { tone: 'SUCCESS', text: 'Pembelajaran disetujui.' },
        { tone: 'NOTE', text: 'SIMPROK kini memakai jawaban ini hanya untuk pertanyaan yang persis sama.' },
        ...replayNote,
      ],
    };
  }
  if (action === 'reject' && result?.state === 'REJECTED') {
    return {
      kind: 'SUCCESS',
      lines: [
        { tone: 'SUCCESS', text: 'Pengajuan pembelajaran ditolak.' },
        { tone: 'NOTE', text: 'SIMPROK tidak mengingat apa pun dari pengajuan ini.' },
        ...replayNote,
      ],
    };
  }
  if (action === 'revoke' && result?.state === 'REVOKED') {
    return {
      kind: 'SUCCESS',
      lines: [
        { tone: 'SUCCESS', text: 'Pembelajaran dicabut.' },
        { tone: 'NOTE', text: 'SIMPROK tidak lagi memakai jawaban ini. Riwayatnya tetap tersimpan.' },
        ...replayNote,
      ],
    };
  }
  // A 2xx whose state is not the one this act produces is reported as exactly that.
  return {
    kind: 'SUCCESS',
    lines: [
      { tone: 'SUCCESS', text: 'Tindakan diterima server.' },
      { tone: 'NOTE', text: 'Status pembelajaran terbaru ditampilkan pada daftar.' },
    ],
  };
};

export const describeGovernanceFailure = (failure: ApiFailure): ActionOutcome => ({
  kind: 'FAILURE',
  lines: failureLines(
    'Keputusan pembelajaran belum berhasil disimpan.',
    nothingSavedNote(failure),
    explainDecisionFailure(failure),
  ),
});

/** One governed exact question, from GET /resource-observations/questions. */
export interface GovernedQuestionWire {
  questionKey: string;
  rawName: string;
  rawCode?: string | null;
  rawUnit?: string | null;
  state?: string | null;
  answer?: { resourceCatalogId: string; name: string } | null;
  authoredByYou?: boolean | null;
  canApprove?: boolean | null;
  canReject?: boolean | null;
  canRevoke?: boolean | null;
  decisionContextToken?: string | null;
}

export type GovernedQuestionTone = 'PENDING' | 'EFFECTIVE' | 'MUTED';

export interface GovernedQuestionView {
  questionKey: string;
  /** The exact question as the source wrote it — code included, because it is part of the question. */
  title: string;
  answerLine: string | null;
  stateLabel: string;
  tone: GovernedQuestionTone;
  guidance: string;
  canApprove: boolean;
  canReject: boolean;
  canRevoke: boolean;
  token: string | null;
}

/** Only these states belong on the governance list; history stays on the server. */
export const isGovernedQuestionShown = (wire: GovernedQuestionWire): boolean =>
  wire.state === 'PENDING' || wire.state === 'EFFECTIVE' || wire.state === 'INAPPLICABLE';

export const describeGovernedQuestion = (wire: GovernedQuestionWire): GovernedQuestionView => {
  const unit = (wire.rawUnit ?? '').trim();
  const code = (wire.rawCode ?? '').trim();
  const title =
    wire.rawName + (unit !== '' ? ' (' + unit + ')' : '') + (code !== '' ? ' · kode ' + code : '');
  const answerName = (wire.answer?.name ?? '').trim();
  const token =
    typeof wire.decisionContextToken === 'string' && wire.decisionContextToken.length > 0
      ? wire.decisionContextToken
      : null;
  const pending = wire.state === 'PENDING';
  const effective = wire.state === 'EFFECTIVE';
  const guidance = pending
    ? wire.authoredByYou
      ? 'Anda yang mengajukan pembelajaran ini, jadi persetujuannya harus datang dari orang lain yang berwenang.'
      : 'Periksa usulan ini: setujui bila benar, atau tolak dengan alasan.'
    : effective
      ? IQL_COPY.effective
      : IQL_COPY.inapplicable;
  return {
    questionKey: wire.questionKey,
    title,
    answerLine: answerName !== '' ? 'Padanan: ' + answerName : null,
    stateLabel: pending
      ? 'Menunggu persetujuan'
      : effective
        ? 'Disetujui — dapat digunakan kembali'
        : 'Tidak berlaku lagi',
    tone: pending ? 'PENDING' : effective ? 'EFFECTIVE' : 'MUTED',
    guidance,
    // A door is shown only when the server both allows it AND issued the context for it.
    canApprove: token !== null && wire.canApprove === true && wire.authoredByYou !== true,
    canReject: token !== null && wire.canReject === true,
    canRevoke: token !== null && wire.canRevoke === true,
    token,
  };
};

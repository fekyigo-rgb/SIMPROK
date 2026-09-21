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
  /** What the nomination rests on, as the identity kernel stated it. */
  identityBasis?: string | null;
  /** The server's own answer: may a person confirm this row as the resource? */
  confirmable?: boolean | null;
  /** The candidate claims something the source never stated. */
  specificationUnproved?: boolean | null;
  /** Exactly which claims are unsupported — a diameter, a grade, a finish. */
  unprovedSpecificationFacts?: readonly string[] | null;
}

/**
 * EVIDENCE STRENGTH IS THE SERVER'S ANSWER, NOT THIS PAGE'S.
 *
 * The identity kernel states what each nomination rests on and the server sends
 * `confirmable`: an exact name or a RECORDED FACT (a source code seen for this
 * row, a sighting, a reviewed mapping). A nomination resting on name similarity
 * alone — "Tripleks" contained in "Paku tripleks", "Semen" sharing a stem with
 * "Serat semen gel" — is a reason to look, never an answer: shown, not offered.
 *
 * An older server that does not send `confirmable` is read FAIL-CLOSED by the
 * same rule: only recorded-fact evidence (or no evidence list, the kernel's own
 * exact-name finding) is confirmable. Name tokens alone never are.
 */
const RECORDED_FACT_EVIDENCE = [
  'SOURCE_CODE_MATCH',
  'REVIEWED_MAPPING_CODE_MATCH',
  'REVIEWED_MAPPING_NAME_MATCH',
  'SOURCE_SIGHTING_NAME_MATCH',
];

export const isConfirmableCandidate = (
  candidate: ObservationCandidateWire,
): boolean => {
  if (typeof candidate.confirmable === 'boolean') return candidate.confirmable;
  const evidence = candidate.evidence ?? [];
  if (evidence.length === 0) return true;
  return evidence.some((kind) => RECORDED_FACT_EVIDENCE.includes(kind));
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
  /**
   * C2 — WHICH WORK THIS COMPONENT CAME FROM, as the journal recorded it.
   *
   * The backend has attached this to every curation row and the screen dropped
   * it, so a person was asked to settle what a component IS with no sight of the
   * work item that quoted it — the one fact that makes a bare "Pekerja" or
   * "Stamper" answerable at all.
   */
  workContext?: WorkContextWire | null;
}

/**
 * C2 — the journal's answer about one source row, carried exactly as the server
 * gave it. THREE outcomes, kept apart on purpose:
 *
 *   FOUND      one work item quotes this row; the source's own words are here.
 *   AMBIGUOUS  more than one work item quotes it. Lawful, and not the screen's
 *              to resolve — so it says so instead of showing one of them.
 *   ABSENT     the row cannot be joined to a work item at all.
 *
 * Folding AMBIGUOUS or ABSENT into "no context" would let the screen imply a
 * certainty the server never claimed.
 */
export interface WorkContextWire {
  kind?: string | null;
  importJobId?: string | null;
  lineNumber?: number | null;
  workType?: string | null;
  methodName?: string | null;
  sheetName?: string | null;
  quotedByLines?: number | null;
}

/**
 * What the screen may say about where a component came from. `line` is for the
 * eye at the decision point; `detail` carries the locator for someone checking
 * the document itself.
 */
export interface WorkContextView {
  kind: 'FOUND' | 'AMBIGUOUS' | 'ABSENT';
  line: string;
  detail: string | null;
}

/**
 * C2 — the one place the wire's context becomes words.
 *
 * The source's own wording is shown and never paraphrased, and where the source
 * said nothing, nothing is invented. An AMBIGUOUS row is told plainly that more
 * than one work item quotes it, with the count, because that is a real thing a
 * person may need to look up — it is never dressed up as an answer.
 */
export const describeWorkContext = (
  context: WorkContextWire | null | undefined,
): WorkContextView => {
  const kind = context?.kind ?? 'ABSENT';
  if (kind === 'FOUND') {
    const workType = trimmedName(context?.workType ?? '');
    const methodName = trimmedName(context?.methodName ?? '');
    const named = [workType, methodName].filter((part) => part !== '').join(' — ');
    const sheet = trimmedName(context?.sheetName ?? '');
    const lineNumber =
      typeof context?.lineNumber === 'number' ? context.lineNumber : null;
    const detail = [
      sheet === '' ? null : `lembar ${sheet}`,
      lineNumber === null ? null : `baris jurnal ${lineNumber}`,
    ]
      .filter((part): part is string => part !== null)
      .join(', ');
    return {
      kind: 'FOUND',
      // The journal joined it, but the document named the work in no words we
      // can show: say that, rather than printing an empty dash.
      line:
        named === ''
          ? 'Dikutip oleh satu pekerjaan dalam dokumen ini.'
          : `Dari pekerjaan: ${named}`,
      detail: detail === '' ? null : detail,
    };
  }
  if (kind === 'AMBIGUOUS') {
    const count =
      typeof context?.quotedByLines === 'number' ? context.quotedByLines : null;
    return {
      kind: 'AMBIGUOUS',
      line:
        count === null
          ? 'Lebih dari satu pekerjaan mengutip baris sumber ini.'
          : `Dikutip oleh ${count} pekerjaan berbeda dalam dokumen ini.`,
      detail: 'SIMPROK tidak memilih salah satunya.',
    };
  }
  return {
    kind: 'ABSENT',
    line: 'Pekerjaan asalnya belum dapat ditelusuri dari catatan impor.',
    detail: null,
  };
};

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
  /**
   * Branch (c): every listed nomination rests on name similarity or was ruled
   * out, so a person who refuses EXACTLY these may record the item as new. The
   * server re-proves it under its admission lock.
   */
  admissibleAfterExamination?: boolean | null;
  /** The candidate context this list was shown under; sent back with a refusal. */
  candidateContextDigest?: string | null;
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
  /**
   * When "new" is lawful only because a person refuses the nominations shown
   * (branch c): exactly which rows are being refused, their names for the
   * button, and the candidate context the refusal is made under. Null when the
   * machine exhausted identity by itself, or when "new" is not available.
   */
  newResourceRefusal: { candidateIds: string[]; names: string[]; candidateContextDigest: string } | null;
  /** The label of the "new resource" action, which names what is being refused. */
  newResourceActionLabel: string;
  /** When it cannot, why — so the door is shown shut and explained, never a refusal waiting to happen. */
  newResourceBlockedLine: string | null;
  /** What the curator should do, in plain language. */
  guidance: string;
  /**
   * C2 — the work item this component was quoted by, for the eye at the moment
   * of deciding. Always present, because "we cannot tell" is also an answer the
   * person is entitled to see.
   */
  workContext: WorkContextView;
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
  // ONE ENTRY PER CATALOGUE ROW, never per spelling. Two rows can share a name
  // and still be two resources (a different unit, a different code); folding
  // them by name would silently drop one identity from the reader's choice.
  const usable = (observation.candidates ?? []).filter(
    (candidate) => trimmedName(candidate?.name ?? '') !== '' && Boolean(candidate?.resourceCatalogId),
  );
  const nameCount = new Map<string, number>();
  for (const candidate of usable) {
    const name = trimmedName(candidate.name);
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  // When a name is shared, the facts that tell the rows apart are said with it.
  const labelOf = (candidate: ObservationCandidateWire): string => {
    const name = trimmedName(candidate.name);
    if ((nameCount.get(name) ?? 0) < 2) return name;
    const facts = [
      (candidate.code ?? '').trim() !== '' ? 'kode ' + (candidate.code ?? '').trim() : null,
      (candidate.baseUnit ?? '').trim() !== '' ? 'satuan ' + (candidate.baseUnit ?? '').trim() : null,
    ].filter((fact): fact is string => fact !== null);
    return facts.length > 0 ? name + ' (' + facts.join(', ') + ')' : name;
  };
  const seen = new Set<string>();
  const candidateChoices: ObservationCandidateChoice[] = [];
  const weakPossibilities: string[] = [];
  const ruledOut: string[] = [];
  for (const candidate of usable) {
    if (seen.has(candidate.resourceCatalogId)) continue;
    seen.add(candidate.resourceCatalogId);
    const name = labelOf(candidate);
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
  // Branch (c), from the server's own predicate — never re-derived here. It needs
  // the candidate context to send back, and something to refuse.
  const digest = typeof verdict?.candidateContextDigest === 'string' ? verdict.candidateContextDigest : '';
  const refusable = usable.filter((candidate, index) => usable.findIndex((c) => c.resourceCatalogId === candidate.resourceCatalogId) === index);
  const admissibleAfterExamination =
    !exhausted &&
    verdict?.admissibleAfterExamination === true &&
    digest !== '' &&
    refusable.length > 0 &&
    candidateChoices.length === 0;
  const canProposeNew = unitProven && (exhausted || admissibleAfterExamination);
  const newResourceRefusal =
    canProposeNew && admissibleAfterExamination
      ? {
          candidateIds: refusable.map((candidate) => candidate.resourceCatalogId),
          names: refusable.map(labelOf),
          candidateContextDigest: digest,
        }
      : null;
  const newResourceActionLabel = newResourceRefusal
    ? 'Bukan ' + nameList(newResourceRefusal.names) + ' — tetapkan sebagai sumber daya baru'
    : 'Tetapkan sebagai sumber daya baru';
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
    : !exhausted && !admissibleAfterExamination
      ? notExhaustedLine
      : unit === ''
        ? 'Belum dapat ditetapkan sebagai sumber daya baru: sumber tidak menyatakan satuannya.'
        : 'Belum dapat ditetapkan sebagai sumber daya baru: satuan "' + unit + '" belum dapat dibuktikan.';
  const newSentence = !canProposeNew
    ? ''
    : newResourceRefusal
      ? ' Bila tidak ada yang sama dengan item ini, Anda dapat menetapkannya sebagai sumber daya baru.'
      : ' Anda dapat menetapkannya sebagai sumber daya baru.';
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
  // THE MACHINE MUST SAY WHAT IT KNOWS. When the identity was withheld because
  // the SAME source document already records that catalogue row under a
  // different code of its own, the reader is told so. Without this the row reads
  // exactly like an ordinary strong candidate and one click confirms past a fact
  // SIMPROK is holding — the machine refusing for a reason it never states.
  const codeDisagreesWithinDocument = (verdict?.reasonCodes ?? []).includes(
    'SOURCE_CODE_DISAGREES_WITHIN_DOCUMENT',
  );

  const guidance =
    verdict?.status === 'RESOLVED' && names.length > 0
      ? 'SIMPROK sudah dapat memastikan padanan item ini. Konfirmasi untuk menutup item ini.'
      : codeDisagreesWithinDocument && names.length > 0
        ? 'SIMPROK membutuhkan keputusan Anda: namanya sama persis dengan ' +
          nameList(names) +
          ', tetapi dokumen sumber yang sama mencatat data itu dengan kode yang berbeda. ' +
          'Dokumen itu sendiri membedakan keduanya, sehingga SIMPROK tidak menetapkannya sendiri. ' +
          'Konfirmasi hanya bila Anda yakin keduanya memang sumber daya yang sama.'
      : names.length > 1
        ? 'SIMPROK membutuhkan konfirmasi Anda: ada ' +
          names.length +
          ' kemungkinan padanan dan SIMPROK tidak memilih sendiri di antaranya. Konfirmasi hanya yang Anda yakini sama; bila tidak ada yang tepat, ' +
          (canProposeNew ? 'tetapkan sebagai sumber daya baru.' : 'biarkan item ini tetap menunggu.')
        : names.length === 1
          ? 'SIMPROK membutuhkan konfirmasi Anda: item ini cocok dengan data yang sudah ada, tetapi kecocokannya belum dapat dipastikan sendiri oleh SIMPROK.'
          : weakPossibilities.length > 0
            ? // WHY IT IS NOT A CHOICE, said plainly: resemblance of names is all
              // SIMPROK found, and resemblance is not identity.
              'SIMPROK hanya menemukan kemiripan nama (' +
              nameList(weakPossibilities) +
              '), yang tidak cukup untuk memastikan identitas.' +
              ACCEPTED +
              newSentence
            : ruledOut.length > 0
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
    newResourceRefusal,
    newResourceActionLabel,
    newResourceBlockedLine,
    guidance,
    // C2 — carried to the screen beside the actions, not summarised away.
    workContext: describeWorkContext(observation.workContext),
  };
};

/**
 * Collision-proof separator for the grouping key, the same character and the
 * same reason as the import page's own decision key: a real space would let two
 * different field combinations flatten to one string, and the null character
 * never appears in source text.
 */
const QUESTION_FIELD_SEPARATOR = '\u0000';

/**
 * C2 — ONE HONEST SENTENCE FOR A WHOLE GROUP'S CONTEXT.
 *
 * A folded question can be asked by members quoted from many different work
 * items. Exactly one thing may be shown as "the" context: when every member
 * points at the SAME work item. Otherwise the reader is told how many distinct
 * work items are involved and how many occurrences could not be traced — never
 * one member's context standing in for all the rest.
 *
 * Counted by distinct work item, not by occurrence: sixty-six members all quoted
 * by one work item are one context, not sixty-six.
 */
const summariseWorkContexts = (
  members: ReadonlyArray<WorkContextWire | null>,
): WorkContextView => {
  const found = new Map<string, WorkContextWire>();
  let untraceable = 0;
  let ambiguous = 0;
  for (const member of members) {
    const kind = member?.kind ?? 'ABSENT';
    if (kind === 'FOUND' && member) {
      found.set(`${member.importJobId ?? ''}#${member.lineNumber ?? ''}`, member);
    } else if (kind === 'AMBIGUOUS') {
      ambiguous += 1;
    } else {
      untraceable += 1;
    }
  }
  if (found.size === 1 && untraceable === 0 && ambiguous === 0) {
    return describeWorkContext([...found.values()][0]);
  }
  if (found.size === 0 && ambiguous === 0) {
    return describeWorkContext(null);
  }
  const parts = [
    found.size > 0 ? `${found.size} pekerjaan berbeda dalam dokumen ini` : null,
    ambiguous > 0 ? `${ambiguous} kemunculan dikutip lebih dari satu pekerjaan` : null,
    untraceable > 0 ? `${untraceable} kemunculan belum dapat ditelusuri` : null,
  ].filter((part): part is string => part !== null);
  return {
    kind: 'AMBIGUOUS',
    line: `Pertanyaan ini muncul pada ${parts.join('; ')}.`,
    detail: 'SIMPROK tidak memilih salah satunya.',
  };
};

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
  /** question key → every member's context, so the group can describe them all. */
  const contexts = new Map<string, Array<WorkContextWire | null>>();

  for (const observation of observations ?? []) {
    if (!observation?.id) continue;
    const view = describeCuratableObservation(observation);
    // THE DECISION SCOPE, NOT A LOOK-ALIKE. One click answers every member, so
    // members must share every fact the answer depends on, exactly as the server
    // holds them:
    //   - the EXACT question: the server's own IQL key when sent (byte-exact —
    //     no trim, null is not ""), else the raw fields serialized exactly;
    //   - the WHOLE candidate context (the server's digest, else every candidate
    //     id with what it rests on) — not only the rows offered as choices, and
    //     independent of the order they were listed in;
    //   - the verdict and its eligibility (exhausted, branch c), and the proven unit.
    const exactQuestion =
      typeof observation.identicalQuestion?.questionKey === 'string' && observation.identicalQuestion.questionKey !== ''
        ? 'K' + observation.identicalQuestion.questionKey
        : 'R' + JSON.stringify([
            observation.rawName ?? null,
            observation.rawCode ?? null,
            observation.rawUnit ?? null,
            observation.resourceType ?? null,
          ]);
    const verdictWire = observation.identityVerdict ?? null;
    const candidateContext =
      typeof verdictWire?.candidateContextDigest === 'string' && verdictWire.candidateContextDigest !== ''
        ? 'D' + verdictWire.candidateContextDigest
        : 'C' + JSON.stringify(
            (observation.candidates ?? [])
              .map((c) => [c?.resourceCatalogId ?? '', c?.identityBasis ?? null, (c?.evidence ?? []).slice().sort()])
              .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
          );
    const question = [
      exactQuestion,
      candidateContext,
      JSON.stringify([
        verdictWire?.status ?? null,
        (verdictWire?.reasonCodes ?? []).slice().sort(),
        verdictWire?.exhausted ?? null,
        verdictWire?.admissibleAfterExamination ?? null,
      ]),
      observation.suggestedUnitDefinitionId ?? '',
      view.candidateChoices.map((c) => c.resourceCatalogId).sort().join(','),
    ].join(QUESTION_FIELD_SEPARATOR);

    const existing = byQuestion.get(question);
    if (existing) {
      existing.ids.push(observation.id);
      existing.occurrences += 1;
      contexts.get(question)?.push(observation.workContext ?? null);
      continue;
    }
    const group: ObservationGroup = { key: question, view, ids: [observation.id], occurrences: 1 };
    byQuestion.set(question, group);
    contexts.set(question, [observation.workContext ?? null]);
    groups.push(group);
  }

  /**
   * C2 — GROUPING MUST NOT HIDE A DIFFERENCE IN CONTEXT.
   *
   * Members are folded because every input the DECISION depends on is identical;
   * where the component was quoted from is not one of those inputs, so it may
   * well differ between them. The group's view is built from the first member,
   * so showing its context unchanged would tell the reader "this came from work
   * item X" when sixty-five other members came from elsewhere.
   *
   * The fold is still right — one judgment, not sixty-six — so the answer is to
   * describe the members TOGETHER, honestly, instead of splitting the question
   * into sixty-six or quietly showing one member's context for all of them.
   */
  for (const group of groups) {
    group.view = {
      ...group.view,
      workContext: summariseWorkContexts(contexts.get(group.key) ?? []),
    };
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
    IDENTITY_CANDIDATE_NAME_SIMILARITY_ONLY: {
      reason: 'Sumber daya itu hanya mirip namanya dengan item ini; kemiripan nama tidak cukup untuk memastikan identitas. Sumber daya dari dokumen tetap tersimpan.',
      next: reloaded,
    },
    IDENTITY_CANDIDATE_NOT_NOMINATED: {
      reason: 'SIMPROK tidak menemukan bukti yang menghubungkan sumber daya itu dengan item ini. Sumber daya dari dokumen tetap tersimpan.',
      next: reloaded,
    },
    EXAMINATION_INCOMPLETE: {
      reason: 'Daftar kandidat yang ditolak tidak terkirim lengkap.',
      next: 'Muat ulang halaman lalu putuskan lagi.',
    },
    EXAMINATION_INVALID: {
      reason: 'Daftar kandidat yang ditolak tidak dapat dibaca.',
      next: 'Muat ulang halaman lalu putuskan lagi.',
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
    // The chosen canonical unit IS known — it simply cannot be reached from the
    // unit the source document itself stated, so nothing proves they mean the
    // same measure. Said plainly, because "unknown unit" would be wrong here.
    UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE: {
      reason: 'Satuan yang dipilih belum terbukti sepadan dengan satuan yang tertulis di dokumen sumber.',
      next: 'Item ini tetap tersimpan untuk ditinjau.',
    },
    // The measures ARE relatable — but by a factor, and SIMPROK will not apply
    // an arithmetic nobody asked for at the moment a resource's canonical
    // measure is fixed. Said as a conversion, never as "unknown".
    UNIT_SELECTION_REQUIRES_PRICE_CONVERSION: {
      reason:
        'Satuan yang dipilih berbeda dari satuan sumber dan hanya dapat disetarakan melalui konversi, sehingga tidak dapat ditetapkan sebagai satuan bakunya.',
      next: 'Pilih satuan yang sama dengan dokumen sumber, atau biarkan item ini tetap menunggu.',
    },
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
    // The refusal is the RULE having changed, not a missing right and not a
    // stale screen. Without its own words the generic fallback would accuse the
    // reader of an authority failure that never happened, and reloading — its
    // advice — would change nothing.
    CANDIDATE_POLICY_SUPERSEDED: {
      reason: 'Pengajuan ini dibuat ketika aturan penetapan identitas masih berbeda, sehingga menyetujuinya tidak akan berlaku.',
      next: 'Tolak pengajuan ini, lalu ajukan kembali bila memang masih layak diajarkan.',
    },
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
  /**
   * Why APPROVE is shut, when the reason is one the reader cannot otherwise
   * see. The SERVER decides this; the view only says it.
   */
  approvalBlockedReason?: string | null;
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
  // A PENDING taught under a rule no longer in force can never become
  // effective, so the server does not offer APPROVE for it. Saying so — and
  // naming the way out — is the difference between a door shown shut and a door
  // that silently vanished.
  const policySuperseded = wire.approvalBlockedReason === 'CANDIDATE_POLICY_SUPERSEDED';
  const guidance = pending
    ? policySuperseded
      ? 'Usulan pembelajaran ini diajukan ketika aturan penetapan identitas masih berbeda, sehingga menyetujuinya tidak akan berlaku. Tolak usulan ini, lalu ajukan ulang bila memang masih layak diajarkan.'
      : wire.authoredByYou
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
      ? policySuperseded
        ? 'Menunggu — aturannya sudah berubah'
        : 'Menunggu persetujuan'
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

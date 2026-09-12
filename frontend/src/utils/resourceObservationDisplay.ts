/**
 * Human-facing view-model for the shared observed-resource curation surface.
 *
 * SIMPROK preserves a resource it saw but could not prove, shows the candidates
 * it found, and asks a person to decide — existing resource or genuinely new.
 * This module only chooses the words and shapes the options; it never decides
 * identity, never auto-selects a candidate, and never lets an internal code,
 * reason string, or UUID reach the reader.
 */

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
  suggestedUnitDefinitionId?: string | null;
  /** IQL-01 — the state of this row's EXACT question, attached by the backend. */
  identicalQuestion?: IdenticalQuestionWire | null;
}

/**
 * IQL-01 — what the backend says about one open row's exact question. The
 * signed context rides along for the action only; account ids never arrive.
 */
export interface IdenticalQuestionWire {
  questionKey?: string | null;
  state?: string | null;
  rememberable?: boolean | null;
  decisionContextToken?: string | null;
  pendingAnswerName?: string | null;
  pendingAuthoredByYou?: boolean | null;
}

export interface ObservationCandidateChoice {
  resourceCatalogId: string;
  name: string;
  /** What the catalogue row claims that the source never stated, if anything. */
  unprovedFacts: readonly string[];
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
  /** What SIMPROK understood about the row, before any identity question. */
  understanding: string;
  /** True when the Unit Kernel proved a unit, so "genuinely new" can be offered. */
  canProposeNew: boolean;
  newUnitDefinitionId: string | null;
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

/**
 * Shape one observation for the curator. Candidates keep their catalogue id (so
 * "this is an existing resource" carries the id the mint safety needs) but the
 * reader is only ever shown the name.
 */
export const describeCuratableObservation = (
  observation: CuratableObservationWire,
): ObservationView => {
  const seen = new Set<string>();
  const candidateChoices: ObservationCandidateChoice[] = [];
  const weakPossibilities: string[] = [];
  for (const candidate of observation.candidates ?? []) {
    const name = trimmedName(candidate?.name ?? '');
    if (name === '' || !candidate?.resourceCatalogId) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    if (isConfirmableCandidate(candidate)) {
      candidateChoices.push({
        resourceCatalogId: candidate.resourceCatalogId,
        name,
        unprovedFacts: candidate.unprovedSpecificationFacts ?? [],
      });
    } else {
      weakPossibilities.push(name);
    }
  }

  const names = candidateChoices.map((c) => c.name);
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  const candidateLine =
    names.length > 0
      ? 'SIMPROK menemukan kemungkinan padanan: ' +
        shown.join(', ') +
        (rest > 0 ? ', dan ' + rest + ' lainnya' : '') +
        '.'
      : null;

  // SHOWN, NEVER OFFERED. Hiding these would make SIMPROK look like it had not
  // looked; offering them would make a shared word look like an answer.
  const weakShown = weakPossibilities.slice(0, 4);
  const weakRest = weakPossibilities.length - weakShown.length;
  const weakPossibilityLine =
    weakPossibilities.length > 0
      ? 'Beberapa kemungkinan ditemukan, tetapi belum cukup kuat untuk dipilih: ' +
        weakShown.join(', ') +
        (weakRest > 0 ? ', dan ' + weakRest + ' lainnya' : '') +
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

  // THE HUMAN IS NOT THE MATCHER. The old wording ("pilih padanan yang paling
  // sesuai") asked the reader to judge a list SIMPROK had not judged. Each
  // sentence below states what SIMPROK could and could not prove, and asks for
  // a decision only where one is genuinely required.
  const guidance =
    names.length > 0
      ? 'SIMPROK membutuhkan konfirmasi Anda: item ini cocok dengan data yang sudah ada, tetapi kecocokannya belum dapat dipastikan sendiri oleh SIMPROK.'
      : weakPossibilities.length > 0
        ? 'Belum ditemukan padanan yang dapat dibuktikan. Anda dapat mengusulkan item ini sebagai sumber daya baru untuk ditinjau.'
        : 'SIMPROK belum menemukan padanan yang dapat dipastikan. Anda dapat mengusulkan sumber daya ini sebagai sumber daya baru untuk ditinjau.';

  const title =
    unit !== '' ? observation.rawName + ' (' + unit + ')' : observation.rawName;

  return {
    id: observation.id,
    title,
    candidateChoices,
    weakPossibilities,
    candidateLine,
    weakPossibilityLine,
    understanding,
    canProposeNew: Boolean(observation.suggestedUnitDefinitionId),
    newUnitDefinitionId: observation.suggestedUnitDefinitionId ?? null,
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
    const group: ObservationGroup = { view, ids: [observation.id], occurrences: 1 };
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
    ? 'Ditemukan ' + group.occurrences + ' kali dalam dokumen. Satu keputusan berlaku untuk semuanya.'
    : null;

/** Wire shape of a preview work item's resource (from GET /ahsp/document/preview). */
export interface PreviewResourceWire {
  rawName?: string | null;
  group?: string | null;
  resolvedResourceCatalogId?: string | null;
  identityCandidates?: readonly string[] | null;
}

/**
 * The candidate NAMES to show under an unresolved work item in the import
 * preview — the names SIMPROK found for resources it could not yet prove. A
 * resolved resource contributes none. Names only; de-duplicated; never a code.
 */
export const previewCandidateNames = (
  resources: readonly PreviewResourceWire[] | null | undefined,
): string[] => {
  const names: string[] = [];
  for (const resource of resources ?? []) {
    if (resource?.resolvedResourceCatalogId) continue;
    for (const candidate of resource?.identityCandidates ?? []) {
      const name = String(candidate).trim();
      if (name !== '' && !names.includes(name)) names.push(name);
    }
  }
  return names;
};

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

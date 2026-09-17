/**
 * IMPORT AHSP — RECEIVED, READY TO USE, AND STILL BEING COMPLETED ARE THREE TRUTHS.
 *
 * An import is complete when every work item SIMPROK recognised in the document
 * is kept: that is "diterima". Whether an item can be USED is a separate truth,
 * "siap digunakan", said only when every fact it needs is proved. Everything else
 * is "masih dilengkapi": kept, and waiting for a component's identity, a fact the
 * document does not state, or a person's decision. Waiting for a fact is not a
 * failure — and a write that did fail is never dressed up as waiting.
 *
 * Every number here is the server's own count. Nothing is resolved, matched,
 * forecast or decided in this module, and no internal code reaches the reader.
 */

import {
  explainStatus,
  failureLines,
  type ActionOutcome,
  type ApiFailure,
  type FailureExplanation,
  type OutcomeLine,
} from './ahspActionFeedback.ts';
import { SOURCE_FACT_REASONS, explainAhspItemReasons, explainWaitingItemReasons } from './ahspDocumentUserCopy.ts';
import { describeSameness, type AhspIdentityMatchWire, type SamenessView } from './ahspSamenessDisplay.ts';

export type AhspItemAdmission = 'PROVEN' | 'IDENTITY_PENDING' | 'HELD';

/** The server's admission for one understood work item. Anything unrecognised stays held — never promoted. */
export const admissionOf = (item: { admission?: string | null }): AhspItemAdmission =>
  item.admission === 'PROVEN' || item.admission === 'IDENTITY_PENDING' ? item.admission : 'HELD';

/** What one previewed item says after its name, for an item whose only open question is a component's identity. */
export const IDENTITY_PENDING_ITEM_LINE = 'masih dilengkapi identitas komponennya';

const whole = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * What SIMPROK understood, BEFORE anything is kept. Counted from the server's own
 * admission of each item — never a forecast of what saving will do.
 */
export const previewIntakeLine = (items: ReadonlyArray<{ admission?: string | null }>): string => {
  if (items.length === 0) return 'Tidak ada pekerjaan yang dapat dikenali dari dokumen ini.';
  const counts = { PROVEN: 0, IDENTITY_PENDING: 0, HELD: 0 };
  for (const item of items) counts[admissionOf(item)] += 1;
  return (
    items.length + ' pekerjaan dikenali. ' +
    counts.PROVEN + ' lengkap dan terbukti. ' +
    counts.IDENTITY_PENDING + ' lengkap, tetapi identitas sebagian komponennya masih dilengkapi. ' +
    counts.HELD + ' masih menunggu fakta atau keputusan. ' +
    'Saat disimpan, semua pekerjaan yang dikenali diterima SIMPROK.'
  );
};

/** One evaluation of a document, or of an import's waiting items, as the server counted it. */
export interface IntakeSummaryWire {
  evaluated?: number | null;
  ready?: number | null;
  identityPending?: number | null;
  alreadyPresent?: number | null;
  /** Lines an earlier evaluation already settled: this request did nothing to them. */
  alreadyProcessed?: number | null;
  held?: number | null;
  failed?: number | null;
}

export interface IntakeFigure {
  readonly label: string;
  readonly value: number;
}

export interface IntakeResultView {
  readonly headline: string;
  /** Diterima · Siap digunakan · Masih dilengkapi — and a failed write only when there was one. */
  readonly figures: readonly IntakeFigure[];
  /** The plain sentence behind every figure that is not zero. */
  readonly details: readonly string[];
}

/** What a saved document now is in SIMPROK. */
export const describeImportIntake = (summary: IntakeSummaryWire): IntakeResultView => {
  const evaluated = whole(summary.evaluated);
  const ready = whole(summary.ready);
  const identityPending = whole(summary.identityPending);
  const alreadyPresent = whole(summary.alreadyPresent);
  const alreadyProcessed = whole(summary.alreadyProcessed);
  const held = whole(summary.held);
  const failed = whole(summary.failed);
  return {
    headline:
      evaluated === 0
        ? 'Tidak ada pekerjaan yang dapat dikenali dari dokumen ini.'
        : 'Import selesai. ' + evaluated + ' pekerjaan yang dikenali sudah diterima SIMPROK.',
    figures: [
      { label: 'Diterima', value: evaluated },
      { label: 'Siap digunakan', value: ready },
      { label: 'Masih dilengkapi', value: identityPending + held },
      ...(failed > 0 ? [{ label: 'Belum berhasil ditulis', value: failed }] : []),
    ],
    details: [
      ...(alreadyPresent > 0
        ? [alreadyPresent + ' pekerjaan sudah ada di SIMPROK, jadi tidak disimpan dua kali.']
        : []),
      // A document sent again decides nothing a second time: what was recorded stands.
      ...(alreadyProcessed > 0
        ? [
            alreadyProcessed +
              ' pekerjaan sudah pernah diproses pada import ini, jadi hasil sebelumnya dipertahankan.',
          ]
        : []),
      ...(identityPending > 0
        ? [
            identityPending +
              ' pekerjaan sudah disimpan sebagai AHSP, tetapi identitas sebagian komponennya masih dilengkapi. Harganya belum dapat dihitung sampai identitas itu pasti.',
          ]
        : []),
      ...(held > 0
        ? [
            held +
              ' pekerjaan belum dijadikan AHSP karena masih menunggu fakta dari dokumen atau keputusan. Datanya tetap tersimpan dan dapat diperiksa ulang tanpa mengunggah ulang.',
          ]
        : []),
      ...(failed > 0
        ? [
            failed +
              ' pekerjaan belum berhasil ditulis karena gangguan saat menyimpan. Datanya tetap tersimpan; periksa ulang untuk mencoba lagi.',
          ]
        : []),
    ],
  };
};

// ---------------------------------------------------------------------------
// CONTINUATION — an earlier import, checked again without its file
// ---------------------------------------------------------------------------

/** One recent import as GET /ahsp/document/jobs returns it. */
export interface ImportJobWire {
  importJobId?: string | null;
  sourceFileName?: string | null;
  createdAt?: string | null;
  counts?: { received?: number | null; represented?: number | null; waiting?: number | null } | null;
  /** What the import still needs, asked of today's authorities by the server. */
  completion?: {
    /** Saved lines whose recipe the consuming resolver can use and identify today. */
    complete?: number | null;
    /** Saved lines whose recipe still has a component the resolver cannot identify. */
    awaitingIdentity?: number | null;
    /** Saved lines pointing to no recipe that may be used (none, retired, or with an unproved unit). */
    recipeNotUsable?: number | null;
    /** Saved lines whose own document states another output unit than the one saved. */
    writtenUnitQuestions?: ReadonlyArray<{
      lineNumber?: number | null;
      statedOutputUnits?: readonly string[] | null;
      /** True only when the Unit Kernel proved the statements name different units. */
      provenDifferent?: boolean | null;
    } | null> | null;
    /** Open questions in the curation queue: a count of what is asked, never of what is identified. */
    identityQuestions?: { questions?: number | null; uses?: number | null } | null;
  } | null;
  waiting?: ReadonlyArray<{
    lineNumber?: number | null;
    status?: string | null;
    reasonCodes?: readonly string[] | null;
    workType?: string | null;
    methodName?: string | null;
    /** Today's sameness verdict, sent only for a line held for a possible twin. */
    identityVerdict?: string | null;
    identityMatches?: readonly AhspIdentityMatchWire[] | null;
    /** The unit spellings this line still waits for today, as the document spells them. */
    unknownUnits?: ReadonlyArray<{ spelling?: string | null; uses?: number | null } | null> | null;
    /** Every unit this line waited for is known today: the next check evaluates it with them. */
    unitsKnownNow?: boolean | null;
    /** What each of the document's conflicting output-unit statements says. */
    statedOutputUnits?: readonly string[] | null;
    /** The line was kept before work titles were read, and its kept title states more. */
    readingUpdated?: boolean | null;
  } | null> | null;
}

// ---------------------------------------------------------------------------
// AHSP COMPLETION — what an import still needs, said once per question
// ---------------------------------------------------------------------------

/**
 * The kind of need a row names. RECHECK names something that changed and is worth
 * checking again, DECISION a choice only the reader can make; UNIT, IDENTITY, SOURCE
 * and OTHER wait honestly for a fact or an authority; FAILED is a write to try again.
 * No row promises what a check will do — the server decides that.
 */
export type AttentionTone = 'RECHECK' | 'DECISION' | 'UNIT' | 'IDENTITY' | 'SOURCE' | 'OTHER' | 'FAILED';

/** One need, said once for every work item that has it. */
export interface AttentionRowView {
  readonly key: string;
  readonly tone: AttentionTone;
  readonly title: string;
  readonly detail: string;
}

/** What changed since a waiting line was settled — each a reason to check it again, none a promise. */
type RecheckCause = 'UNITS_KNOWN' | 'READING_UPDATED' | 'SAMENESS_SETTLED';

const RECHECK_CAUSE_COPY: Readonly<Record<RecheckCause, string>> = {
  UNITS_KNOWN: 'satuan yang ditunggu kini dikenali',
  READING_UPDATED: 'judul pekerjaannya kini ikut dibaca',
  SAMENESS_SETTLED: 'perbandingan dengan AHSP yang ada sudah berubah',
};

/** What one waiting work item needs, in the terms the rows are grouped by. */
interface AttentionItem {
  readonly failed: boolean;
  readonly decision: boolean;
  /** Empty unless something changed that is worth checking again. */
  readonly recheckCauses: readonly RecheckCause[];
  readonly reasonCodes: readonly string[];
  readonly unknownUnits: ReadonlyArray<{ readonly spelling: string; readonly uses: number }>;
  readonly statedOutputUnits: readonly string[];
}

/** What the server says about the lines already saved as AHSP — a saved import's own truth, never a preview's. */
interface SavedLinesTruth {
  readonly awaitingIdentity: number;
  readonly recipeNotUsable: number;
  readonly unitQuestions: ReadonlyArray<{ readonly statedOutputUnits: readonly string[]; readonly provenDifferent: boolean }>;
}

const NOTHING_SAVED: SavedLinesTruth = { awaitingIdentity: 0, recipeNotUsable: 0, unitQuestions: [] };

type AttentionCategory = 'FAILED' | 'DECISION' | 'RECHECK' | 'SOURCE' | 'UNIT' | 'OTHER';

const sourceFactOf = (codes: readonly string[]): string | null =>
  SOURCE_FACT_REASONS.find((code) => codes.includes(code)) ?? null;

/**
 * Each item is counted ONCE, by what it waits for first: a failed write, the
 * reader's decision, a change worth checking again, the document itself, a unit
 * spelling, or anything else. The rows below may still name one item twice — a
 * spelling it uses and a fact its document omits are two different needs.
 */
const categoryOf = (item: AttentionItem): AttentionCategory =>
  item.failed
    ? 'FAILED'
    : item.decision
      ? 'DECISION'
      : item.recheckCauses.length > 0
        ? 'RECHECK'
        : sourceFactOf(item.reasonCodes) !== null
          ? 'SOURCE'
          : item.unknownUnits.length > 0 || item.reasonCodes.includes('UNIT_UNRESOLVED')
            ? 'UNIT'
            : 'OTHER';

const withoutFinalStop = (text: string): string => text.replace(/\.$/u, '');

/** A count as an Indonesian reader writes it: 1.100, never 1100. */
const count = (value: number): string => new Intl.NumberFormat('id-ID').format(value);

const unitList = (units: readonly string[]): string =>
  units.length <= 1 ? units.join('') : units.slice(0, -1).join(', ') + ' dan ' + units[units.length - 1];

type AttentionCounts = Readonly<Record<AttentionCategory, number>>;

/**
 * The needs of a set of waiting items, one row per question: one per unit
 * spelling however often it is used, one for every identity question however
 * often it occurs, one per missing or conflicting document fact.
 */
const describeAttention = (
  items: readonly AttentionItem[],
  identity: { readonly questions: number; readonly uses: number },
  context: { readonly canCurate: boolean },
  saved: SavedLinesTruth = NOTHING_SAVED,
): { rows: AttentionRowView[]; counts: AttentionCounts } => {
  const counts: Record<AttentionCategory, number> = { FAILED: 0, DECISION: 0, RECHECK: 0, SOURCE: 0, UNIT: 0, OTHER: 0 };
  for (const item of items) counts[categoryOf(item)] += 1;
  const rows: AttentionRowView[] = [];

  if (counts.RECHECK > 0) {
    // Worth checking again, never "ready": a unit now known may not be the only fact
    // an item lacks, and only the check itself says what it moves.
    const causes = (Object.keys(RECHECK_CAUSE_COPY) as RecheckCause[]).filter((cause) =>
      items.some((item) => categoryOf(item) === 'RECHECK' && item.recheckCauses.includes(cause)),
    );
    rows.push({
      key: 'recheck',
      tone: 'RECHECK',
      title: 'Layak diperiksa ulang',
      detail:
        count(counts.RECHECK) + ' pekerjaan: ada perubahan yang layak diperiksa kembali (' +
        causes.map((cause) => RECHECK_CAUSE_COPY[cause]).join('; ') +
        '). Hasilnya ditentukan saat pemeriksaan ulang.',
    });
  }
  if (counts.DECISION > 0) {
    rows.push({
      key: 'decision',
      tone: 'DECISION',
      title: 'Kemungkinan sama dengan AHSP yang sudah ada',
      detail: count(counts.DECISION) + ' pekerjaan menunggu keputusan Anda.',
    });
  }

  const spellings = new Map<string, { uses: number; items: number }>();
  for (const item of items) {
    if (item.failed || item.recheckCauses.length > 0) continue;
    for (const unit of item.unknownUnits) {
      const entry = spellings.get(unit.spelling) ?? { uses: 0, items: 0 };
      entry.uses += unit.uses;
      entry.items += 1;
      spellings.set(unit.spelling, entry);
    }
  }
  for (const [spelling, entry] of [...spellings].sort((a, b) => b[1].uses - a[1].uses || a[0].localeCompare(b[0]))) {
    rows.push({
      key: 'unit:' + spelling,
      tone: 'UNIT',
      title: "Satuan '" + spelling + "' belum dikenali SIMPROK",
      detail: 'Dipakai ' + count(entry.uses) + ' kali dalam ' + count(entry.items) + ' pekerjaan.',
    });
  }

  if (identity.questions > 0) {
    // Grouping spares the reader answering one question per occurrence; it never
    // makes one answer serve different questions.
    rows.push({
      key: 'identity',
      tone: 'IDENTITY',
      title: 'Identitas sumber daya belum pasti',
      detail:
        'Ada ' + count(identity.questions) + ' pertanyaan berbeda dari ' + count(identity.uses) + ' kemunculan. ' +
        'Pertanyaan yang sama dikelompokkan agar tidak perlu dijawab per kemunculan. ' +
        (context.canCurate
          ? 'Tinjau di bagian Sumber daya untuk ditinjau.'
          : 'Diputuskan oleh pemegang kewenangan identitas sumber daya.'),
    });
  } else if (saved.awaitingIdentity > 0) {
    // No question left open is not an identity: a question closed by a decision that
    // taught nothing, or a component never observed, still leaves the recipe unproved.
    rows.push({
      key: 'identity:unproved',
      tone: 'IDENTITY',
      title: 'Identitas sumber daya belum terbukti',
      detail:
        count(saved.awaitingIdentity) + ' AHSP tersimpan masih memakai nama sumber daya dari dokumen, dan tidak ada pertanyaan terbuka untuk dijawab. ' +
        'Keputusan tinjauan saja belum membuktikan identitasnya.',
    });
  }

  const bySource = new Map<string, { items: number; statements: string[] }>();
  for (const item of items) {
    if (categoryOf(item) !== 'SOURCE') continue;
    const code = sourceFactOf(item.reasonCodes) as string;
    const entry = bySource.get(code) ?? { items: 0, statements: [] };
    entry.items += 1;
    const said = unitList(item.statedOutputUnits);
    if (code === 'SOURCE_UNIT_CONFLICT' && item.statedOutputUnits.length > 1 && !entry.statements.includes(said)) {
      entry.statements.push(said);
    }
    bySource.set(code, entry);
  }
  for (const code of SOURCE_FACT_REASONS) {
    const entry = bySource.get(code);
    if (!entry) continue;
    if (code === 'SOURCE_UNIT_CONFLICT') {
      rows.push({
        key: 'source:' + code,
        tone: 'SOURCE',
        title: 'Dokumen menyatakan satuan hasil yang berbeda',
        detail:
          count(entry.items) + ' pekerjaan' +
          (entry.statements.length > 0 ? ' (' + entry.statements.slice(0, 3).join('; ') + ')' : '') +
          '. SIMPROK tidak memilih salah satunya.',
      });
    } else {
      // The same sentence the item itself carries in the detail, never a second wording.
      rows.push({
        key: 'source:' + code,
        tone: 'SOURCE',
        title: withoutFinalStop(explainAhspItemReasons([code])),
        detail: count(entry.items) + ' pekerjaan.' + (code === 'MISSING_OUTPUT_UNIT' ? ' SIMPROK tidak menebaknya.' : ''),
      });
    }
  }

  // A saved AHSP whose own document states another output unit: said, never corrected here.
  for (const proven of [true, false]) {
    const questions = saved.unitQuestions.filter((question) => question.provenDifferent === proven);
    if (questions.length === 0) continue;
    const statements = [
      ...new Set(questions.filter((question) => question.statedOutputUnits.length > 1).map((question) => unitList(question.statedOutputUnits))),
    ];
    rows.push({
      key: proven ? 'saved-unit:different' : 'saved-unit:unproven',
      tone: 'SOURCE',
      title: proven
        ? 'AHSP tersimpan, tetapi dokumennya menyatakan satuan hasil yang berbeda'
        : 'AHSP tersimpan, tetapi kesamaan satuan hasil dalam dokumennya belum dapat dipastikan',
      detail:
        count(questions.length) + ' pekerjaan' +
        (statements.length > 0 ? ' (' + statements.slice(0, 3).join('; ') + ')' : '') +
        '. Tidak dihitung lengkap; SIMPROK tidak mengubah AHSP yang sudah tersimpan.',
    });
  }
  if (saved.recipeNotUsable > 0) {
    rows.push({
      key: 'saved-recipe',
      tone: 'OTHER',
      title: 'AHSP yang mewakili pekerjaan belum dapat dipakai',
      detail:
        count(saved.recipeNotUsable) + ' pekerjaan sudah terwakili AHSP, tetapi resepnya belum lengkap atau tidak lagi berlaku. Tidak dihitung lengkap.',
    });
  }

  const others = new Map<string, number>();
  for (const item of items) {
    if (categoryOf(item) !== 'OTHER') continue;
    const said = withoutFinalStop(explainWaitingItemReasons(item.reasonCodes));
    others.set(said, (others.get(said) ?? 0) + 1);
  }
  for (const [said, items] of others) {
    rows.push({ key: 'other:' + said, tone: 'OTHER', title: said, detail: count(items) + ' pekerjaan.' });
  }

  if (counts.FAILED > 0) {
    rows.push({
      key: 'failed',
      tone: 'FAILED',
      title: 'Penyimpanan sebelumnya belum berhasil',
      detail: count(counts.FAILED) + ' pekerjaan akan dicoba lagi saat diperiksa ulang.',
    });
  }
  return { rows, counts };
};

/** A resource or work item of a previewed document, in the fields its needs are read from. */
export interface PreviewAttentionItemWire {
  admission?: string | null;
  reasonCodes?: readonly string[] | null;
  identityVerdict?: string | null;
  outputUnitRaw?: { raw?: string | null } | null;
  resolvedOutputUnit?: string | null;
  outputUnitStatements?: ReadonlyArray<{ raw?: string | null } | null> | null;
  resources?: ReadonlyArray<{
    group?: string | null;
    rawName?: string | null;
    rawCode?: string | null;
    rawUnit?: string | null;
    reasonCodes?: readonly string[] | null;
    resolvedResourceCatalogId?: string | null;
  } | null> | null;
}

const IDENTITY_OPEN_REASONS = ['RESOURCE_UNRESOLVED', 'RESOURCE_CANDIDATES_FOUND'];

/**
 * What a document being read will still need once it is saved — from the
 * understanding the server returned, grouped exactly as a saved import is. Unit
 * spellings are grouped as the document spells them; identity questions by the
 * exact question (class, name, code and unit, byte for byte). Nothing is
 * resolved here: which spelling is unknown and which identity is unproved is
 * what the server already said about each resource.
 */
export const describePreviewAttention = (
  workItems: ReadonlyArray<PreviewAttentionItemWire | null> | null | undefined,
  options: { readonly canCurate: boolean },
): AttentionRowView[] => {
  const items: AttentionItem[] = [];
  const questions = new Map<string, number>();
  for (const item of workItems ?? []) {
    if (!item) continue;
    const codes = item.reasonCodes ?? [];
    const resources = (item.resources ?? []).filter(
      (resource): resource is NonNullable<typeof resource> => resource !== null,
    );
    for (const resource of resources) {
      if (!resource.rawName || !resource.group || resource.resolvedResourceCatalogId) continue;
      if (!(resource.reasonCodes ?? []).some((code) => IDENTITY_OPEN_REASONS.includes(code))) continue;
      const key = JSON.stringify([resource.group, resource.rawName, resource.rawCode ?? null, resource.rawUnit ?? null]);
      questions.set(key, (questions.get(key) ?? 0) + 1);
    }
    const admission = admissionOf(item);
    const decision = admission !== 'HELD' && item.identityVerdict === 'POSSIBLY_IDENTICAL';
    if (admission !== 'HELD' && !decision) continue;
    const spellings = new Map<string, number>();
    const unknown = (raw: string | null | undefined) => {
      const spelling = (raw ?? '').trim();
      if (spelling !== '') spellings.set(spelling, (spellings.get(spelling) ?? 0) + 1);
    };
    if (codes.includes('UNIT_UNRESOLVED') && item.outputUnitRaw?.raw && !item.resolvedOutputUnit) unknown(item.outputUnitRaw.raw);
    for (const resource of resources) {
      if ((resource.reasonCodes ?? []).includes('UNIT_UNRESOLVED')) unknown(resource.rawUnit);
    }
    items.push({
      failed: false,
      decision,
      recheckCauses: [],
      reasonCodes: codes,
      unknownUnits: [...spellings].map(([spelling, uses]) => ({ spelling, uses })),
      statedOutputUnits: codes.includes('SOURCE_UNIT_CONFLICT')
        ? (item.outputUnitStatements ?? []).flatMap((statement) => (statement?.raw ? [statement.raw] : []))
        : [],
    });
  }
  const uses = [...questions.values()].reduce((sum, count) => sum + count, 0);
  return describeAttention(items, { questions: questions.size, uses }, { canCurate: options.canCurate }).rows;
};

export interface ImportWaitingItemView {
  readonly key: string;
  readonly title: string;
  readonly reason: string;
  /** The comparison the preview shows for a possible twin — present only when a decision is open. */
  readonly sameness: SamenessView | null;
  /** The source names a decision is sent for; present exactly when `sameness` is. */
  readonly decisionFor: { readonly workType: string; readonly methodName: string } | null;
}

export interface ImportJobView {
  /** The import's own id — stable across a refresh, so an outcome stays where it happened. */
  readonly key: string;
  readonly title: string;
  readonly receivedLine: string;
  readonly waitingLine: string;
  /**
   * EVERY line still waiting, in document order — never a cut list. What is shown
   * first is a display choice (`waitingShown`); what EXISTS is all of this, and
   * the reader can reach all of it without the file.
   */
  readonly waitingItems: readonly ImportWaitingItemView[];
  /** How many ordinary waiting lines the detail shows before the reader asks for the rest. */
  readonly waitingShown: number;
  /** Said when more items wait than are shown first — never silently cut. */
  readonly moreWaitingLine: string | null;
  /** Said when an item here waits for the reader's own decision. */
  readonly decisionLine: string | null;
  /** The import's state in one paragraph: received, complete, and what each other item waits for. */
  readonly summaryLine: string;
  /** What the import still needs — one row per question, never one per work item. */
  readonly attention: readonly AttentionRowView[];
  /** Whether a re-check has anything to evaluate: a line is still waiting. */
  readonly canRecheck: boolean;
  /**
   * Whether something changed that is worth checking again — a unit now known, a
   * reading updated, a settled comparison, or a write to retry. Never a promise
   * that the check moves anything: the server decides, and the check stays offered
   * either way.
   */
  readonly recheckWarranted: boolean;
}

const WAITING_SHOWN = 5;

export const IMPORT_DECISION_LINE = 'Keputusan yang Anda pilih dijalankan saat pemeriksaan ulang.';

const importDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
};

type ImportWaitingLineWire = NonNullable<NonNullable<ImportJobWire['waiting']>[number]>;

/**
 * A waiting line's open sameness decision, shaped by the SAME module the preview
 * uses. Only a possible twin asks the reader: an exact twin and a distinct item
 * are settled by the re-check itself.
 */
const waitingDecisionOf = (line: ImportWaitingLineWire): Pick<ImportWaitingItemView, 'sameness' | 'decisionFor'> => {
  const none = { sameness: null, decisionFor: null };
  if (line.status === 'FAILED' || line.identityVerdict !== 'POSSIBLY_IDENTICAL') return none;
  if (!line.workType || !line.methodName) return none;
  const sameness = describeSameness({ identityVerdict: line.identityVerdict, identityMatches: line.identityMatches ?? [] });
  return sameness ? { sameness, decisionFor: { workType: line.workType, methodName: line.methodName } } : none;
};

/** What a waiting line needs, from the facts the server asked of today's authorities. */
const storedAttentionItem = (line: ImportWaitingLineWire, decision: boolean): AttentionItem => {
  const codes = line.reasonCodes ?? [];
  const failed = line.status === 'FAILED';
  const settledSameness =
    codes.includes('IDENTITY_POSSIBLE_MATCH') &&
    typeof line.identityVerdict === 'string' &&
    line.identityVerdict !== 'POSSIBLY_IDENTICAL';
  const recheckCauses: RecheckCause[] = failed
    ? []
    : [
        ...(line.unitsKnownNow === true && sourceFactOf(codes) === null ? ['UNITS_KNOWN' as const] : []),
        // The settled reasons were read without the title; they are no longer the whole story.
        ...(line.readingUpdated === true ? ['READING_UPDATED' as const] : []),
        ...(settledSameness ? ['SAMENESS_SETTLED' as const] : []),
      ];
  return {
    failed,
    decision,
    recheckCauses,
    reasonCodes: codes,
    unknownUnits: (line.unknownUnits ?? []).flatMap((unit) =>
      unit?.spelling && whole(unit.uses) > 0 ? [{ spelling: unit.spelling, uses: whole(unit.uses) }] : [],
    ),
    statedOutputUnits: (line.statedOutputUnits ?? []).filter((unit) => typeof unit === 'string' && unit !== ''),
  };
};

/**
 * The imports that still hold work items SIMPROK could not keep as AHSP yet, or
 * whose saved AHSPs are not complete for the AHSP stage: a component the consuming
 * resolver cannot identify, a recipe that cannot be used, or a document that states
 * another output unit than the one saved. An import with nothing left is complete
 * and is not listed: there is nothing to do there. A line waiting for the reader's
 * decision is always listed — a cut list must never hide a choice only the reader
 * can make.
 */
export const describeWaitingImports = (
  jobs: ReadonlyArray<ImportJobWire | null> | null | undefined,
  options: { readonly canCurate?: boolean } = {},
): ImportJobView[] =>
  (jobs ?? []).flatMap((job) => {
    const key = job?.importJobId ?? '';
    const waiting = (job?.waiting ?? []).filter((line): line is ImportWaitingLineWire => line !== null);
    const received = whole(job?.counts?.received);
    const represented = whole(job?.counts?.represented);
    const awaitingIdentity = Math.min(whole(job?.completion?.awaitingIdentity), represented);
    const recipeNotUsable = Math.min(whole(job?.completion?.recipeNotUsable), represented);
    const unitQuestions = (job?.completion?.writtenUnitQuestions ?? []).flatMap((question) =>
      question
        ? [
            {
              statedOutputUnits: (question.statedOutputUnits ?? []).filter((unit) => typeof unit === 'string' && unit !== ''),
              provenDifferent: question.provenDifferent === true,
            },
          ]
        : [],
    );
    const savedNotComplete = awaitingIdentity + recipeNotUsable + unitQuestions.length;
    if (key === '' || (waiting.length === 0 && savedNotComplete === 0)) return [];
    const complete =
      typeof job?.completion?.complete === 'number'
        ? Math.min(whole(job.completion.complete), represented)
        : Math.max(represented - savedNotComplete, 0);
    const date = importDate(job?.createdAt);
    const items = waiting.map((line, index) => ({
      key: String(line.lineNumber ?? 'w' + index),
      title: (line.workType ?? '—') + ' — ' + (line.methodName ?? '—'),
      reason:
        line.status === 'FAILED'
          ? 'Penyimpanan sebelumnya belum berhasil; akan dicoba lagi saat diperiksa ulang.'
          : explainWaitingItemReasons(line.reasonCodes ?? []),
      ...waitingDecisionOf(line),
    }));
    const others = items.filter((item) => item.sameness === null);
    const attention = describeAttention(
      waiting.map((line, index) => storedAttentionItem(line, items[index].sameness !== null)),
      {
        questions: whole(job?.completion?.identityQuestions?.questions),
        uses: whole(job?.completion?.identityQuestions?.uses),
      },
      { canCurate: options.canCurate === true },
      { awaitingIdentity, recipeNotUsable, unitQuestions },
    );
    const { counts } = attention;
    const said = (value: number, words: string) => (value > 0 ? count(value) + ' ' + words : null);
    return [
      {
        key,
        title: (job?.sourceFileName ?? '').trim() || 'Dokumen tanpa nama',
        receivedLine:
          (date ? 'Diimpor ' + date + '. ' : '') +
          received + ' pekerjaan diterima; ' + represented + ' sudah menjadi AHSP di SIMPROK.',
        waitingLine: waiting.length + ' pekerjaan masih menunggu fakta atau keputusan.',
        waitingItems: items,
        waitingShown: WAITING_SHOWN,
        moreWaitingLine:
          others.length > WAITING_SHOWN ? 'dan ' + (others.length - WAITING_SHOWN) + ' pekerjaan lainnya.' : null,
        decisionLine: items.length > others.length ? IMPORT_DECISION_LINE : null,
        summaryLine: [
          count(received) + ' pekerjaan diterima.',
          complete > 0 ? count(complete) + ' telah lengkap untuk tahap AHSP.' : 'Belum ada yang lengkap untuk tahap AHSP.',
          said(awaitingIdentity, 'masih menunggu identitas sumber daya.'),
          said(unitQuestions.length, 'tersimpan dengan satuan hasil yang dipertanyakan dokumennya.'),
          said(recipeNotUsable, 'terwakili AHSP yang belum dapat dipakai.'),
          said(counts.UNIT, 'menunggu satuan yang belum dikenali.'),
          said(counts.SOURCE, 'menunggu fakta dari dokumen.'),
          said(counts.DECISION, 'menunggu keputusan Anda.'),
          said(counts.RECHECK, 'layak diperiksa ulang.'),
          said(counts.OTHER, 'masih menunggu hal lain.'),
          said(counts.FAILED, 'belum berhasil disimpan.'),
        ]
          .filter((part): part is string => part !== null)
          .join(' '),
        attention: attention.rows,
        canRecheck: waiting.length > 0,
        recheckWarranted: counts.RECHECK + counts.FAILED > 0,
      },
    ];
  });

/** What checking an import again actually did, from the server's own count. */
export const describeImportRecheck = (summary: IntakeSummaryWire | null | undefined): ActionOutcome => {
  if (!summary) {
    return {
      kind: 'SUCCESS',
      lines: [
        { tone: 'SUCCESS', text: 'Pemeriksaan ulang diterima server.' },
        { tone: 'NOTE', text: 'Daftar dimuat ulang untuk menampilkan keadaan terbaru.' },
      ],
    };
  }
  const written = whole(summary.ready) + whole(summary.identityPending);
  const identityPending = whole(summary.identityPending);
  // A check that found everything already settled is not "nothing could be saved".
  const alreadyPresent = whole(summary.alreadyPresent);
  const alreadyProcessed = whole(summary.alreadyProcessed);
  const held = whole(summary.held);
  const failed = whole(summary.failed);
  const lines: OutcomeLine[] = [
    failed > 0
      ? { tone: 'FAILURE', text: 'Pemeriksaan ulang selesai, tetapi sebagian pekerjaan belum berhasil ditulis.' }
      : { tone: 'SUCCESS', text: 'Pemeriksaan ulang selesai tanpa mengunggah ulang dokumen.' },
    {
      tone: 'NOTE',
      text:
        written > 0
          ? written + ' pekerjaan kini disimpan sebagai AHSP' +
            (identityPending > 0 ? '; ' + identityPending + ' di antaranya masih dilengkapi identitas komponennya.' : '.')
          : whole(summary.alreadyProcessed) > 0 && whole(summary.evaluated) === whole(summary.alreadyProcessed)
            ? 'Tidak ada yang perlu dikerjakan lagi pada pemeriksaan ini.'
            : 'Belum ada pekerjaan yang dapat disimpan sebagai AHSP dengan data saat ini.',
    },
    // Said as what the item now uses, never as a discovery: a reader who chose
    // "Gunakan yang sudah ada" already knew the AHSP was there.
    ...(alreadyPresent > 0
      ? [{ tone: 'NOTE' as const, text: alreadyPresent + ' pekerjaan menggunakan AHSP yang sudah ada.' }]
      : []),
    // Never "baru disimpan": this evaluation did nothing to these lines.
    ...(alreadyProcessed > 0
      ? [
          {
            tone: 'NOTE' as const,
            text:
              alreadyProcessed +
              ' pekerjaan sudah pernah diproses; hasil sebelumnya dipertahankan.',
          },
        ]
      : []),
    ...(held > 0 ? [{ tone: 'NOTE' as const, text: held + ' pekerjaan masih menunggu fakta atau keputusan.' }] : []),
    ...(failed > 0
      ? [{ tone: 'NOTE' as const, text: failed + ' pekerjaan belum berhasil ditulis karena gangguan; datanya tetap tersimpan untuk diperiksa ulang.' }]
      : []),
  ];
  return { kind: failed === 0 ? 'SUCCESS' : written + alreadyPresent > 0 ? 'PARTIAL' : 'FAILURE', lines };
};

const RECHECK_FAILURE: Readonly<Record<string, FailureExplanation>> = {
  AHSP_IMPORT_JOB_NOT_FOUND: {
    reason: 'Data import ini tidak ditemukan di workspace aktif.',
    next: 'Daftar sudah dimuat ulang dengan keadaan terbaru.',
  },
  AHSP_IMPORT_KNOWLEDGE_CONTRACT_CHANGED: {
    reason: 'Cara SIMPROK memahami dokumen AHSP sudah diperbarui sejak dokumen ini diimpor, jadi hasil pemahaman lamanya tidak dipakai begitu saja.',
    next: 'Unggah dan pahami ulang dokumen ini.',
  },
};

/** A refused or unanswered check. Refusals the server names happen before anything is written. */
export const describeImportRecheckFailure = (failure: ApiFailure): ActionOutcome => ({
  kind: 'FAILURE',
  lines: failureLines(
    'Pemeriksaan ulang belum berhasil.',
    failure.status === null || failure.status >= 500
      ? 'Belum dapat dipastikan apakah sebagian pekerjaan sudah tersimpan; daftar dimuat ulang untuk menampilkan keadaan sebenarnya.'
      : 'Tidak ada perubahan yang tersimpan.',
    (failure.code ? RECHECK_FAILURE[failure.code] : undefined) ??
      explainStatus(failure, 'Workspace aktif Anda tidak memiliki kewenangan untuk mengimpor AHSP.'),
  ),
});

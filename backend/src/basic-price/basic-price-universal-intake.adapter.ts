import { Prisma } from '@prisma/client';
import { INTAKE_ERRORS, IntakeError } from '../universal-intake/intake-errors';
import { ReaderRegistry } from '../universal-intake/readers/reader-registry';
import {
  SourceCell,
  SourceLocatorDialect,
  SourceRow,
  SourceTable,
  NO_SOURCE_COLUMN_LOCATOR,
  formatLocator,
  textAt,
} from '../universal-intake/readers/source-table';
import {
  CELL_SHAPE_DIAGNOSTICS,
  SPREADSHEET_VALUE_TYPE,
} from '../universal-intake/readers/xlsx.reader';
import { SourceEnvelope } from '../universal-intake/source-envelope';
import {
  BasicPriceSection,
  DetectedStructure,
  PriceTableStructure,
  RegionScopeChoice,
  TableDetection,
  detectSourceStructures,
  sectionOfMarkerText,
} from '../universal-intake/structure/structure-detector';
import {
  PriceLiteralReading,
  interpretPriceLiteral,
} from '../universal-intake/structure/price-literal';
import { resourceFamilyOfCategoryText } from '../universal-intake/structure/header-vocabulary';
import {
  interpretKdnColumns,
  type KdnColumnDecision,
} from '../universal-intake/structure/kdn-column';
import {
  readKdnCell,
  type KdnCellEvidence,
} from '../universal-intake/structure/kdn-evidence';

/**
 * USI-01 §6 — THE BASIC PRICE DOMAIN ADAPTER.
 *
 * This is where a shape becomes MEANING, and it is the last place in the
 * pipeline that touches a source at all. Everything after it — resolution,
 * submission, review, verification, publication — is the existing Basic Price
 * trust lifecycle, unchanged and unbypassed. Nothing here writes a BasicPrice,
 * and nothing here can.
 *
 * The adapter is format-blind by construction: it consumes a `SourceTable`
 * and a `DetectedStructure`, so a reader added tomorrow reaches it without
 * this file changing.
 */

/**
 * PARSER CONTRACTS, ONE PER STRUCTURE.
 *
 * `RM02_BASIC_PRICE_01_V1` is FROZEN. It is a Basic Price import fingerprint
 * input, so changing its value would orphan every batch ever imported under
 * it — an exact replay would stop finding its own batch (test I6). A new
 * structure therefore gets a NEW contract name; it never renames an old one.
 */
export const BASIC_PRICE_PARSER_CONTRACT_VERSION = 'RM02_BASIC_PRICE_01_V1';
export const BASIC_PRICE_SEMANTIC_HEADER_CONTRACT_VERSION =
  'USI01_BASIC_PRICE_SEMANTIC_HEADER_V1';
export const BASIC_PRICE_REGIONAL_MATRIX_CONTRACT_VERSION =
  'USI01_BASIC_PRICE_REGIONAL_MATRIX_V1';

const CONTRACT_BY_STRUCTURE: Record<PriceTableStructure, string> = {
  SECTIONED_PRICE_LIST: BASIC_PRICE_PARSER_CONTRACT_VERSION,
  SEMANTIC_HEADER_TABLE: BASIC_PRICE_SEMANTIC_HEADER_CONTRACT_VERSION,
  REGIONAL_MATRIX: BASIC_PRICE_REGIONAL_MATRIX_CONTRACT_VERSION,
};

/** Bounded raw-context capture (§14/§15) — LAW 2 without an unbounded blob. */
export const MAX_RAW_CONTEXT_ENTRIES = 32;
export const MAX_RAW_CONTEXT_VALUE_LENGTH = 512;

export type BasicPriceImportKnowledgeSection = BasicPriceSection;

/**
 * WHERE A ROW'S SECTION CAME FROM.
 *
 * `sourceSection` is load-bearing far downstream: the resolution service uses
 * it as the ResourceType context for Unit Kernel lookup and for
 * ResourceCatalog type matching. A source that does not declare its sections
 * therefore cannot have one inferred — SIMPROK would be guessing whether a row
 * is labour, material or equipment, which §18 forbids outright. A HUMAN states
 * it for the batch instead, and the row records that this is what happened.
 */
export type SectionProvenance =
  | 'SOURCE_ROW_CATEGORY'
  | 'SOURCE_SECTION_TITLE'
  | 'UPLOADER_DECLARED';

export const SECTION_DECLARED_BY_UPLOADER_REASON =
  'SECTION_DECLARED_BY_UPLOADER';

/**
 * USI-01R LAW 2.8 — the source said one thing and the human said another.
 *
 * The SOURCE wins, because it knows its own rows while the uploader is
 * declaring for all of them at once. But it never wins SILENTLY: the row is
 * flagged so a reviewer sees exactly where the two disagreed.
 */
export const SOURCE_CATEGORY_CONFLICT_REASON = 'SOURCE_CATEGORY_CONFLICT';

/** The source stated a category SIMPROK has no safe mapping for (CAT-07). */
export const SOURCE_CATEGORY_UNRECOGNIZED_REASON =
  'SOURCE_CATEGORY_UNRECOGNIZED';
/** The unit text came from a preparer's SIMPROK-unit suggestion, not the source's own unit column. */
export const UNIT_FROM_SIMPROK_CANDIDATE_REASON =
  'UNIT_TEXT_FROM_SIMPROK_UNIT_CANDIDATE';

/**
 * USI-01R3 LAW G — WHAT A PHYSICAL SOURCE ROW *IS*, DECIDED ONCE.
 *
 * A row's KIND is a property of the document, not of the jurisdiction a human
 * happens to be importing. Choosing Sirimau over Baguala changes which price
 * column is read; it must never change whether a row was a resource at all.
 *
 * USI-01R2 got this wrong: it tested the SELECTED region's price cell when
 * deciding whether to skip a row, so a resource priced in Sirimau and blank in
 * Baguala silently vanished from the Baguala import — 894 candidates against
 * 893, and a real resource erased by the accident of which region was chosen.
 *
 *   RESOURCE_ROW        the document treats this as a priceable item.
 *   STRUCTURAL_HEADING  a section title the source AFFIRMATIVELY proves
 *                       (LAW G.1). Never merely "nothing else fit".
 *   ROW_KIND_AMBIGUOUS  the evidence genuinely does not decide. KEPT and
 *                       flagged, never dropped (LAW H).
 *   NON_DATA            no resource name at all — not a row about anything.
 */
export type SourceRowKind =
  | 'RESOURCE_ROW'
  | 'STRUCTURAL_HEADING'
  | 'NO_COMMERCIAL_EVIDENCE'
  | 'ROW_KIND_AMBIGUOUS'
  | 'NON_DATA';

export const ROW_KIND_AMBIGUOUS_REASON = 'ROW_KIND_AMBIGUOUS';

/**
 * USI-01R3B §11 — THE NUMERIC CANDIDATE WAS DERIVED FROM SOURCE TEXT.
 *
 * A spreadsheet that stores "153.000,00" as a STRING is not a spreadsheet that
 * stores the NUMBER 153000. The two are different source facts, and a reviewer
 * must be able to tell which one they are looking at — so a price SIMPROK read
 * out of text says so, and the cell keeps its own truthful type either way.
 *
 * This is PROVENANCE, NOT A COMPLAINT. It is a warning rather than an error
 * because nothing is wrong: the literal had exactly one meaning and SIMPROK
 * read it. It carries no claim that the price is correct, verified, trusted or
 * publishable, and it bypasses no step of the existing resolution lifecycle.
 */
export const PRICE_NORMALIZED_FROM_TEXT_REASON = 'PRICE_NORMALIZED_FROM_TEXT';

/**
 * USI-01R3A LAW G.1 — A HEADING MUST BE PROVEN, NOT INFERRED FROM ABSENCE.
 *
 * USI-01R3 ended its classification with "no unit, no price, no number, so it
 * is a section title". That last step is NEGATIVE INFERENCE: it converts the
 * absence of resource evidence into the presence of structural evidence, and
 * the row is then DELETED on the strength of it. A name-only row is equally
 * consistent with an incomplete resource, a damaged OCR extraction, or a real
 * item whose commercial fields were simply left blank — and SIMPROK exists to
 * reduce uncertainty, never to manufacture it.
 *
 * So STRUCTURAL_HEADING now requires an AFFIRMATIVE signal whose meaning is
 * "this row is a section/title row". Exactly one such signal exists in the
 * current source model, and it was not invented for this law:
 *
 *   SOURCE_SECTION_TITLE_GRAMMAR — the source spells a section title in the
 *   controlled grammar SIMPROK already owns (`SECTION_MARKERS`). That grammar
 *   is what makes a workbook a SECTIONED_PRICE_LIST in the first place and has
 *   been Owner-accepted since RM-02; applying the same authority here is
 *   consistency, not a new inference channel.
 *
 * WHAT IS DELIBERATELY NOT EVIDENCE: capitalization, text length, bold, the
 * absence of a unit, the absence of a price, the absence of a row number,
 * similarity to a neighbouring row, majority voting, the filename, the sheet
 * name, or the row's position. Every one of those is presentation or
 * statistics wearing the costume of proof.
 */
export type HeadingEvidence = 'SOURCE_SECTION_TITLE_GRAMMAR';

/**
 * The affirmative structural evidence a row's own name text carries, or null
 * when the source proves nothing about it. Single authority: nothing else
 * decides what a heading looks like.
 */
export function affirmativeHeadingEvidence(
  nameText: string,
): HeadingEvidence | null {
  return sectionOfMarkerText(nameText) === null
    ? null
    : 'SOURCE_SECTION_TITLE_GRAMMAR';
}

/**
 * Classifies a physical row from REGION-INDEPENDENT evidence only.
 *
 * Note what is NOT consulted: the selected jurisdiction. Price evidence is
 * looked for across EVERY detected jurisdiction, so a row priced anywhere is a
 * resource row everywhere.
 */
export function classifyPhysicalRow(input: {
  hasName: boolean;
  hasUnitEvidence: boolean;
  /** True if ANY detected jurisdiction column holds something for this row. */
  hasPriceEvidenceInAnyJurisdiction: boolean;
  /** True if the source's own numbering column counts this row as an item. */
  hasRowNumberEvidence: boolean;
  /** AFFIRMATIVE structural evidence, or null when the source states none. */
  headingEvidence: HeadingEvidence | null;
}): SourceRowKind {
  if (!input.hasName) return 'NON_DATA';

  const resourceProven =
    input.hasUnitEvidence || input.hasPriceEvidenceInAnyJurisdiction;
  // A row the document NUMBERED is a row the document counts as an item. That
  // contradicts "title" without proving "resource", so it cancels a heading
  // claim rather than establishing one.
  const headingProven =
    input.headingEvidence !== null && !input.hasRowNumberEvidence;

  // TWO PROOFS POINTING OPPOSITE WAYS DO NOT DECIDE. Choosing a winner between
  // a stated section title and a stated price would be preference, not
  // evidence, so the row is kept and the disagreement stays visible.
  if (resourceProven && headingProven) return 'ROW_KIND_AMBIGUOUS';
  if (resourceProven) return 'RESOURCE_ROW';
  if (headingProven) return 'STRUCTURAL_HEADING';

  // NOTHING COMMERCIAL, AND THE DOCUMENT NEVER COUNTED IT AS AN ITEM.
  //
  // No unit, no price under ANY jurisdiction, and no number in the source's own
  // numbering column. A Basic Price row is an OBSERVATION OF A PRICE, and there
  // is no price here to observe — under any region, not merely the selected
  // one. That is a conclusion the evidence supports: not "this is a title",
  // which nothing proved, but "this is not a priced resource row", which the
  // absence of every commercial field does prove.
  //
  // WHY THIS IS NOT ROW_KIND_AMBIGUOUS. It used to be, and the real Ambon
  // workbook shows what that costs: 41 category banners — BATU, SEMEN, KACA,
  // BAHAN SANITAIR, PERALATAN TUKANG — were emitted as resource candidates and
  // then wore the section the human had been forced to declare, producing rows
  // like "[Upah] — BATU" with unit "-". Those are not ambiguous rows a reviewer
  // could settle; they are questions about nothing, and 41 of them buried the
  // real exceptions.
  //
  // WHY IT IS NOT A WORD LIST. Not one banner is recognised by its text. The
  // test is purely structural and the workbook itself validates it: of the 41
  // such rows, the document numbered NONE, and of every row the document DID
  // number, none lacked a price. A vocabulary would also have to be wrong here
  // by construction — several banners are OCR wreckage ("eAHAN TALANG",
  // "acsesonis rim rvc") that no dictionary can contain.
  //
  // WHY IT IS STILL NOT SILENT. The caller counts these into
  // `excludedNonDataRows` and the count is reported, so the batch still
  // accounts for every physical row it read. Raw bytes are untouched.
  //
  // A NUMBERED row with no commercial fields keeps falling through below: the
  // source called it an item, which contradicts "not a row" without proving
  // "resource", so it stays visible and flagged (LAW H).
  if (
    !input.hasUnitEvidence &&
    !input.hasPriceEvidenceInAnyJurisdiction &&
    !input.hasRowNumberEvidence
  ) {
    return 'NO_COMMERCIAL_EVIDENCE';
  }

  // Nothing proved anything — a numbered row with no commercial fields. It
  // survives, and says why.
  return 'ROW_KIND_AMBIGUOUS';
}

export interface BasicPriceImportKnowledgeRow {
  /**
   * NULL when the source stated a category SIMPROK cannot safely map. Guessing
   * would file a bulldozer as a material; the row stays evidence until a human
   * settles it (LAW 2.9).
   */
  sourceSection: BasicPriceImportKnowledgeSection | null;
  /** Which authority decided `sourceSection`. Null exactly when it is null. */
  sourceSectionProvenance: SectionProvenance | null;
  /** LAW 2.2 — the source's own category words, mapped or not. */
  rawSourceCategoryCode: string | null;
  rawSourceCategoryName: string | null;
  sourceRowNumber: number;
  sourceCodeCellAddress: string;
  sourceNameCellAddress: string;
  sourceUnitCellAddress: string;
  sourcePriceCellAddress: string;
  /** Null when this batch has no established KDN column. */
  sourceKdnCellAddress: string | null;
  sourceKdnHeaderText: string | null;

  rawResourceCodeText: string | null;
  rawResourceNameText: string;
  rawUnitText: string | null;

  /**
   * Null for any source without typed cells. §12 forbids fabricating a
   * spreadsheet cell type for a CSV field, and null is the only honest answer.
   */
  rawPriceCellType: number | null;
  rawPriceNumericRoundTripString: string | null;
  rawPriceTextValue: string | null;
  rawPriceFormulaText: string | null;
  rawPriceCachedResultRoundTripString: string | null;
  rawPriceFormulaError: string | null;
  rawPriceNumberFormat: string | null;
  rawPriceDisplayText: string | null;

  /**
   * LAW 2 — every source column this domain has no dedicated field for, kept
   * verbatim under the source's own header text. This is what stops a
   * normalized value from silently replacing raw source truth.
   */
  rawSourceContext: Record<string, string> | null;

  // Never canonical until a human resolves/submits the row. Null when no
  // evidence exists to round at all, and null whenever the evidence was
  // ambiguous rather than absent — the two are told apart by reasonCodes.
  proposedCanonicalPrice: string | null;
  canonicalRoundingMode: string | null;

  proposedCanonicalKdn: string | null;
  rawKdnTextValue: string | null;
  rawKdnNumericRoundTripString: string | null;
  rawKdnDisplayText: string | null;
  kdnReasonCode: string | null;

  warnings: string[];
  errors: string[];
}

/**
 * WHICH HUMAN ANSWERS THIS READING ACTUALLY DEPENDED ON.
 *
 * THE SAME BYTES READ WITH A DIFFERENT LAWFUL INTERPRETATION ARE NOT THE SAME
 * IMPORT TRUTH. The Owner's real workbook proved it: read with the name column
 * answered as the unit column it yielded 934 poisoned rows, and read honestly
 * it yielded 894 truthful ones. Identical file, identical region, identical
 * everything a fingerprint looked at — so the corrected import could only ever
 * find the poisoned batch again.
 *
 * WHAT BELONGS HERE IS THE READING, NEVER THE REQUEST. Only facts the parse
 * DEPENDED ON are recorded, and a field is null when the DOCUMENT decided it.
 * A workbook that states its own column headers admits exactly one lawful
 * reading of those columns, so a `selectedNameColumn` sent alongside it changed
 * nothing and must not fork identity — otherwise a stray parameter would mint
 * duplicate batches for one truth, which is the opposite failure.
 *
 * NULL THEREFORE MEANS "THE SOURCE ANSWERED THIS", never "unknown". A reading
 * that depended on no human answer at all carries no interpretation, which is
 * exactly why every pre-existing fingerprint stays byte-identical.
 */
export interface BasicPriceIntakeInterpretation {
  /**
   * The columns this reading actually read names and units from — recorded only
   * where the document carried no column headers and a person named them.
   */
  resourceNameColumn: number | null;
  sourceUnitColumn: number | null;
  /**
   * The resource family a person supplied — recorded only where the document
   * declared none of its own. When the source states categories the source
   * wins, so a declaration alongside it decided nothing and is not recorded.
   */
  declaredSection: BasicPriceSection | null;
  /**
   * Recorded only when a human confirmed an ambiguous/conflict KDN heading.
   * A CLEAR heading is the document deciding — null, so a stray
   * `selectedKdnColumn` cannot fork identity for one proven reading.
   */
  kdnColumn: number | null;
}

export interface BasicPriceImportKnowledgeObject {
  parserContractVersion: string;
  readerId: string;
  readerContractVersion: string;
  locatorDialect: SourceLocatorDialect;
  structure: PriceTableStructure;
  sourceSha256: string;
  fileName: string;
  /** The selected TABLE's own name: a worksheet name, or a flat file's name. */
  sheetName: string;
  totalSourceRows: number;
  /**
   * How this reading decided resource families overall. Per-row provenance is
   * on each row; this is the summary a human sees first.
   */
  sectionProvenance: SectionProvenance;
  /** Verbatim source label of the jurisdiction this reading was scoped to. */
  regionScopeLabel: string | null;
  regionScopeKind: 'COLUMN' | 'ROW_VALUE' | null;
  /**
   * BP-REGION-TRUTH-07S — the source's OWN word proving that the scope above is
   * a PLACE, or null when the source proved no such thing.
   *
   * Verbatim evidence ("KECAMATAN", "WILAYAH"), carried outward unchanged. It
   * is never compared to a canonical Region, never mapped to one, and asserts
   * nothing about whether the two agree — only that the question of agreement
   * is a real one for this source. See `regionScope.geographicEvidence` in the
   * structure detector for why the shape alone cannot answer it.
   */
  regionScopeGeographicEvidence: string | null;
  detectionEvidence: string[];
  /** Rows the source AFFIRMATIVELY proved to be section titles (LAW G.1). */
  excludedNonDataRows: number;
  /** Null when this reading depended on no human answer — see the type above. */
  interpretation: BasicPriceIntakeInterpretation | null;
  /**
   * BP-KDN-01 — optional KDN column decision for this reading. ABSENT and
   * ESTABLISHED (document-decided) never fork identity. NEEDS_REVIEW does
   * not fail-stop the price workflow.
   */
  kdnMapping: KdnColumnDecision;
  rows: BasicPriceImportKnowledgeRow[];
}

export interface BasicPriceIntakeSelection {
  /** Which table to read. The legacy `selectedSheet` parameter maps here. */
  selectedTable?: string | null;
  selectedStructure?: PriceTableStructure | null;
  /** Verbatim jurisdiction label, for sources covering more than one. */
  selectedRegionLabel?: string | null;
  /** A human's section declaration, for sources that declare none themselves. */
  declaredSection?: BasicPriceSection | null;
  /**
   * USI-01R2 §10 — which column holds the resource name / the unit, for a
   * source whose shape is proven but whose columns carry no header. Required
   * only when the detector says so; never a way to override a stated header.
   */
  selectedNameColumn?: number | null;
  selectedUnitColumn?: number | null;
  /**
   * BP-KDN-01 — which ambiguous/conflict KDN-like column a human confirmed.
   * Ignored when the document already proved a CLEAR heading. Never required
   * for a lawful price import.
   */
  selectedKdnColumn?: number | null;
}

interface PriceEvidence {
  cellType: number | null;
  numericRoundTripString: string | null;
  textValue: string | null;
  formulaText: string | null;
  cachedResultRoundTripString: string | null;
  formulaError: string | null;
  numberFormat: string | null;
  displayText: string | null;
  proposedCanonicalPrice: string | null;
  canonicalRoundingMode: string | null;
  /** Provenance a reviewer needs: HOW this reading was arrived at (R3B §11). */
  warnings: string[];
  errors: string[];
}

/**
 * Native spreadsheet price evidence, classified exactly as the RM-02 adapter
 * classified it. The mapping from format-level shape observation to domain
 * error lives HERE and not in the reader, because "this formula cached no
 * result" is a fact while "this is not a usable price" is a judgement (LAW 4).
 */
function spreadsheetPriceEvidence(cell: SourceCell | null): PriceEvidence {
  const native = cell?.native ?? null;
  const cellType = native?.cellType ?? SPREADSHEET_VALUE_TYPE.NULL;
  const diagnostics = native?.shapeDiagnostics ?? [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // USI-01R3B §5 — CELL TYPE IS EVIDENCE, NOT MEANING.
  //
  // "Stored as text" and "cannot be read as a price" are two different claims,
  // and USI-01R3A collapsed them: a cell holding "153.000,00" was refused
  // purely because Excel had stored it as a string, even though the existing
  // literal authority reads it with one unambiguous meaning. That pushed
  // machine-solvable cleaning back onto the user for no truth gained.
  //
  // The distinction that matters is NORMALIZATION versus CORRECTION.
  // Normalization changes REPRESENTATION only — "153.000,00" and 153000.00 are
  // the same quantity, and the source's meaning is untouched. Correction would
  // change MEANING by inference — reading "T73.000,00" as 173000 is a guess
  // about what the document was supposed to say, and SIMPROK never makes it.
  //
  // So the literal is interpreted, and ONLY a deterministic reading is taken.
  const nativeCanonical =
    native?.numericRoundTripString ??
    native?.cachedResultRoundTripString ??
    null;
  const textShaped =
    cellType === SPREADSHEET_VALUE_TYPE.STRING ||
    cellType === SPREADSHEET_VALUE_TYPE.SHARED_STRING ||
    cellType === SPREADSHEET_VALUE_TYPE.RICH_TEXT;
  // NATIVE NUMBERS ARE NEVER RE-READ FROM TEXT. A workbook's own binary number
  // is already unambiguous; interpreting its display text on top of that could
  // only ever disagree with it.
  const literal =
    textShaped && nativeCanonical === null && (cell?.text ?? null) !== null
      ? interpretPriceLiteral(cell!.text)
      : null;
  const normalizedFromText =
    literal !== null && literal.outcome === 'NUMERIC'
      ? literal.canonicalSourceString
      : null;

  switch (cellType) {
    case SPREADSHEET_VALUE_TYPE.NUMBER:
      break;
    case SPREADSHEET_VALUE_TYPE.STRING:
    case SPREADSHEET_VALUE_TYPE.SHARED_STRING:
      // Only when the text could NOT be read. A readable literal is not a
      // defect to report.
      if (normalizedFromText === null)
        errors.push('PRICE_CELL_IS_TEXT_NOT_NUMBER');
      break;
    case SPREADSHEET_VALUE_TYPE.FORMULA: {
      // Emission order is preserved: a formula can be both an unrecognized
      // shape AND missing its cached result, and both are reported.
      for (const diagnostic of diagnostics) {
        if (diagnostic === CELL_SHAPE_DIAGNOSTICS.FORMULA_SHAPE_UNRECOGNIZED)
          errors.push('UNRECOGNIZED_FORMULA_SHAPE');
        else if (diagnostic === CELL_SHAPE_DIAGNOSTICS.NO_CACHED_RESULT)
          errors.push('FORMULA_NO_CACHED_RESULT');
        else if (diagnostic === CELL_SHAPE_DIAGNOSTICS.CACHED_RESULT_IS_TEXT)
          errors.push('FORMULA_RESULT_IS_TEXT_NOT_NUMBER');
        else if (diagnostic === CELL_SHAPE_DIAGNOSTICS.FORMULA_RESULT_IS_ERROR)
          errors.push('FORMULA_ERROR');
        else if (
          diagnostic === CELL_SHAPE_DIAGNOSTICS.CACHED_RESULT_SHAPE_UNRECOGNIZED
        )
          errors.push('UNRECOGNIZED_FORMULA_RESULT_SHAPE');
      }
      break;
    }
    case SPREADSHEET_VALUE_TYPE.ERROR:
      errors.push('PRICE_CELL_IS_ERROR');
      break;
    case SPREADSHEET_VALUE_TYPE.DATE:
      errors.push('PRICE_CELL_IS_DATE');
      break;
    case SPREADSHEET_VALUE_TYPE.BOOLEAN:
      errors.push('PRICE_CELL_IS_BOOLEAN');
      break;
    case SPREADSHEET_VALUE_TYPE.RICH_TEXT:
      if (normalizedFromText === null) errors.push('PRICE_CELL_IS_RICH_TEXT');
      break;
    case SPREADSHEET_VALUE_TYPE.HYPERLINK:
      errors.push('PRICE_CELL_IS_HYPERLINK');
      break;
    case SPREADSHEET_VALUE_TYPE.NULL:
    case SPREADSHEET_VALUE_TYPE.MERGE:
      errors.push('PRICE_CELL_EMPTY');
      break;
    default:
      errors.push('UNRECOGNIZED_CELL_SHAPE');
  }

  // AMBIGUOUS EARNS ITS OWN CODE; NOT_NUMERIC DOES NOT.
  //
  // "PRICE_CELL_IS_TEXT_NOT_NUMBER" already states everything
  // PRICE_TEXT_NOT_NUMERIC would add, so repeating it would be noise. But
  // "numeric-shaped and genuinely undecidable" — "125.000", which is 125000 in
  // Jakarta and 125.0 in New York — is a DIFFERENT fact needing a DIFFERENT
  // human action, and the shape error cannot say it. R3B §16 requires the two
  // to be countable apart, so the undecidable case is named.
  if (literal !== null && literal.outcome === 'AMBIGUOUS' && literal.reason) {
    errors.push(literal.reason);
  }

  // The DERIVED reading is recorded as provenance, never as a defect: the
  // separator roles the literal proved, in the same vocabulary the delimited
  // sources already use.
  if (normalizedFromText !== null) {
    warnings.push(PRICE_NORMALIZED_FROM_TEXT_REASON);
    warnings.push(...separatorProvenance(literal!));
  }

  // NATIVE FIRST, ALWAYS. A text reading is only ever consulted where the
  // workbook offered no number of its own, so RM-02's numeric behaviour and the
  // cached-formula-result behaviour are both bit-for-bit unchanged.
  const canonicalSourceString = nativeCanonical ?? normalizedFromText;

  // LAW 2.2 — RICH TEXT IS STILL TEXT.
  //
  // The real Ambon workbook stores much of its OCR damage ("T73.000,00",
  // "314.ooo,oo") in rich-text cells, whose runs ExcelJS exposes only through
  // the cell's display text. Reading only `textValue` discarded those
  // characters entirely, leaving a refused row that could not say WHAT it
  // refused. The fallback applies ONLY when the cell carries no numeric
  // evidence at all, so a numeric price cell is completely unaffected and the
  // RM-02 behaviour is unchanged.
  //
  // R3B §10 — NORMALIZATION NEVER REPLACES SOURCE EVIDENCE. This is computed
  // from the cell alone and is deliberately independent of whether a numeric
  // candidate was derived above: the raw text a normalized cell carries is
  // exactly the raw text a refused cell would have carried.
  const textValue =
    native?.textValue ??
    (nativeCanonical !== null ? null : (cell?.rawText ?? null));

  return {
    cellType,
    numericRoundTripString: native?.numericRoundTripString ?? null,
    textValue,
    formulaText: native?.formulaText ?? null,
    cachedResultRoundTripString: native?.cachedResultRoundTripString ?? null,
    formulaError: native?.formulaError ?? null,
    numberFormat: native?.numberFormat ?? null,
    displayText: cell?.text ?? null,
    ...roundCanonical(canonicalSourceString),
    warnings,
    errors,
  };
}

/**
 * Text price evidence, for sources with no typed cells at all.
 *
 * Note what is NOT here: no cell type, no number format, no formula, no cached
 * result. Those are spreadsheet facts, this source has none of them, and every
 * one of those fields therefore stays null (§12 / §18 — no fabricated
 * spreadsheet evidence for a non-spreadsheet source).
 */
function textPriceEvidence(cell: SourceCell | null): PriceEvidence {
  const rawText = cell?.rawText ?? null;
  const displayText = cell?.text ?? null;
  const errors: string[] = [];

  if (displayText === null) {
    errors.push('PRICE_CELL_EMPTY');
    return {
      cellType: null,
      numericRoundTripString: null,
      textValue: rawText,
      formulaText: null,
      cachedResultRoundTripString: null,
      formulaError: null,
      numberFormat: null,
      displayText: null,
      proposedCanonicalPrice: null,
      canonicalRoundingMode: null,
      warnings: [],
      errors,
    };
  }

  const reading = interpretPriceLiteral(displayText);
  const canonical =
    reading.outcome === 'NUMERIC'
      ? roundCanonical(reading.canonicalSourceString)
      : { proposedCanonicalPrice: null, canonicalRoundingMode: null };

  if (reading.outcome !== 'NUMERIC' && reading.reason)
    errors.push(reading.reason);

  return {
    cellType: null,
    numericRoundTripString: null,
    // The source's own characters, untouched. This is the price as it exists
    // in the world; `proposedCanonicalPrice` is only SIMPROK's reading of it.
    textValue: rawText,
    formulaText: null,
    cachedResultRoundTripString: null,
    formulaError: null,
    numberFormat: null,
    displayText,
    ...canonical,
    warnings: [],
    errors,
  };
}

function roundCanonical(canonicalSourceString: string | null): {
  proposedCanonicalPrice: string | null;
  canonicalRoundingMode: string | null;
} {
  if (canonicalSourceString === null) {
    return { proposedCanonicalPrice: null, canonicalRoundingMode: null };
  }
  const decimal = new Prisma.Decimal(canonicalSourceString).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  return {
    proposedCanonicalPrice: decimal.toFixed(2),
    canonicalRoundingMode: 'ROUND_HALF_UP',
  };
}

/**
 * Separator-role provenance, emitted as a warning so a text reading is
 * auditable.
 *
 * ONLY for cells with no native evidence. A spreadsheet's numeric cell was
 * never interpreted from text at all — its value came from the workbook's own
 * binary number — so claiming "the dot was read as a decimal separator" about
 * it would describe a decision that never happened.
 */
function separatorProvenance(reading: PriceLiteralReading): string[] {
  if (reading.outcome !== 'NUMERIC') return [];
  if (reading.decimalSeparator === null && reading.groupingSeparator === null)
    return [];
  const parts: string[] = [];
  if (reading.decimalSeparator)
    parts.push(
      `PRICE_TEXT_DECIMAL_SEPARATOR_${reading.decimalSeparator === '.' ? 'DOT' : 'COMMA'}`,
    );
  if (reading.groupingSeparator)
    parts.push(
      `PRICE_TEXT_GROUPING_SEPARATOR_${reading.groupingSeparator === '.' ? 'DOT' : 'COMMA'}`,
    );
  return parts;
}

/**
 * The same provenance for a source with NO typed cells, where every price is
 * read from text by definition.
 *
 * The `native` guard stays: a spreadsheet cell's separator provenance is
 * emitted by `spreadsheetPriceEvidence` itself, and only for the cells it
 * actually interpreted. Emitting it here too would double-report it.
 */
function separatorWarnings(cell: SourceCell | null): string[] {
  if (cell?.native) return [];
  const text = cell?.text ?? null;
  if (text === null) return [];
  return separatorProvenance(interpretPriceLiteral(text));
}

function captureRawContext(
  table: SourceTable,
  row: SourceRow,
  headerByColumn: Map<number, string>,
  consumedColumns: Set<number>,
): Record<string, string> | null {
  const context: Record<string, string> = {};
  let entries = 0;
  for (
    let columnNumber = 1;
    columnNumber <= table.columnCount;
    columnNumber += 1
  ) {
    if (consumedColumns.has(columnNumber)) continue;
    if (entries >= MAX_RAW_CONTEXT_ENTRIES) break;
    const cell = row.cells[columnNumber - 1] ?? null;
    const value = cell?.rawText ?? null;
    if (value === null || value.trim() === '') continue;
    const key =
      headerByColumn.get(columnNumber) ??
      formatLocator(table.locatorDialect, row.number, columnNumber);
    context[key] = value.slice(0, MAX_RAW_CONTEXT_VALUE_LENGTH);
    entries += 1;
  }
  return entries === 0 ? null : context;
}

interface ResolvedRowSection {
  section: BasicPriceSection | null;
  provenance: SectionProvenance | null;
  warnings: string[];
  errors: string[];
}

/**
 * USI-01R LAW 2.8 — THE RESOURCE-FAMILY PRECEDENCE LADDER.
 *
 * 1. an explicit category the ROW itself carries;
 * 2. a section title the SOURCE declared above the row;
 * 3. a human's blanket declaration for the batch;
 * 4. nothing — and nothing is left as nothing.
 *
 * The order is not a preference. The source knows its own rows one at a time,
 * while the uploader is declaring for hundreds at once from a single dropdown;
 * letting the dropdown win is precisely how a workbook whose rows say ALAT ends
 * up filing bulldozers as building materials.
 */
function resolveRowSection(input: {
  rawCategoryName: string | null;
  rawCategoryCode: string | null;
  declaredSection: BasicPriceSection | null;
}): ResolvedRowSection {
  const warnings: string[] = [];
  const errors: string[] = [];
  const hasCategoryText = Boolean(
    input.rawCategoryName ?? input.rawCategoryCode,
  );

  if (hasCategoryText) {
    // Only the NAME is read for meaning. A bare code letter is one document's
    // private shorthand, never a universal law (see header-vocabulary.ts).
    const family = resourceFamilyOfCategoryText(input.rawCategoryName);
    if (family) {
      if (input.declaredSection && input.declaredSection !== family) {
        // The source wins — but loudly. A reviewer must be able to find every
        // row where the document and the human disagreed.
        warnings.push(SOURCE_CATEGORY_CONFLICT_REASON);
      }
      return {
        section: family,
        provenance: 'SOURCE_ROW_CATEGORY',
        warnings,
        errors,
      };
    }

    // The source stated a category and SIMPROK does not know it. Falling back
    // to the human's blanket answer here would let an unknown category be
    // silently absorbed into MATERIAL, which is the exact failure GAP B exists
    // to stop. The row stays unresolved, with its raw words retained.
    errors.push(SOURCE_CATEGORY_UNRECOGNIZED_REASON);
    return { section: null, provenance: null, warnings, errors };
  }

  if (input.declaredSection) {
    warnings.push(SECTION_DECLARED_BY_UPLOADER_REASON);
    return {
      section: input.declaredSection,
      provenance: 'UPLOADER_DECLARED',
      warnings,
      errors,
    };
  }

  return { section: null, provenance: null, warnings, errors };
}

export interface ResolvedStructureSelection {
  table: SourceTable;
  structure: DetectedStructure;
  regionChoice: RegionScopeChoice | null;
}

/**
 * Chooses the ONE table + structure this intake will read, or refuses with a
 * precise diagnostic. Never a first-sheet fallback; never a filename rule.
 */
export function resolveStructureSelection(
  tables: SourceTable[],
  detections: TableDetection[],
  selection: BasicPriceIntakeSelection,
): ResolvedStructureSelection {
  let candidateTables = tables;
  if (selection.selectedTable) {
    candidateTables = tables.filter(
      (table) => table.name === selection.selectedTable,
    );
    if (candidateTables.length === 0) {
      throw new IntakeError(
        INTAKE_ERRORS.WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND,
        {
          requestedTable: selection.selectedTable,
          availableTables: tables.map((table) => table.name),
        },
      );
    }
  }

  const withCandidates = candidateTables
    .map((table) => ({
      table,
      detection: detections.find(
        (detection) => detection.tableName === table.name,
      )!,
    }))
    .filter(({ detection }) => detection.candidates.length > 0);

  if (withCandidates.length === 0) {
    throw new IntakeError(INTAKE_ERRORS.NO_PRICE_TABLE_DETECTED, {
      examinedTables: candidateTables.map((table) => table.name),
      rejections: Object.fromEntries(
        candidateTables.map((table) => [
          table.name,
          detections.find((detection) => detection.tableName === table.name)
            ?.rejections ?? [],
        ]),
      ),
    });
  }

  if (withCandidates.length > 1) {
    throw new IntakeError(INTAKE_ERRORS.SOURCE_TABLE_AMBIGUOUS, {
      tables: withCandidates.map(({ table, detection }) => ({
        tableName: table.name,
        structures: detection.candidates.map(
          (candidate) => candidate.structure,
        ),
      })),
    });
  }

  const { table, detection } = withCandidates[0];
  let candidates = detection.candidates;
  if (selection.selectedStructure) {
    candidates = candidates.filter(
      (candidate) => candidate.structure === selection.selectedStructure,
    );
    if (candidates.length === 0) {
      throw new IntakeError(INTAKE_ERRORS.SOURCE_STRUCTURE_AMBIGUOUS, {
        tableName: table.name,
        requestedStructure: selection.selectedStructure,
        availableStructures: detection.candidates.map((c) => c.structure),
      });
    }
  }
  if (candidates.length > 1) {
    throw new IntakeError(INTAKE_ERRORS.SOURCE_STRUCTURE_AMBIGUOUS, {
      tableName: table.name,
      availableStructures: candidates.map((candidate) => candidate.structure),
    });
  }

  const structure = candidates[0];
  let regionChoice: RegionScopeChoice | null = null;
  if (structure.regionScope.required || selection.selectedRegionLabel) {
    if (!selection.selectedRegionLabel) {
      throw new IntakeError(INTAKE_ERRORS.REGION_COLUMN_SELECTION_REQUIRED, {
        tableName: table.name,
        structure: structure.structure,
        kind: structure.regionScope.kind,
        choices: structure.regionScope.choices.map((choice) => choice.label),
      });
    }
    regionChoice =
      structure.regionScope.choices.find(
        (choice) => choice.label === selection.selectedRegionLabel,
      ) ?? null;
    if (!regionChoice) {
      throw new IntakeError(INTAKE_ERRORS.REGION_COLUMN_NOT_FOUND, {
        tableName: table.name,
        requestedLabel: selection.selectedRegionLabel,
        choices: structure.regionScope.choices.map((choice) => choice.label),
      });
    }
  } else if (structure.regionScope.choices.length === 1) {
    regionChoice = structure.regionScope.choices[0];
  }

  return { table, structure, regionChoice };
}

/**
 * USI-01 — the one Basic Price intake adapter.
 *
 * `parse` is deliberately the ONLY public entry point, and it takes a
 * `SourceEnvelope`. There is no "parse these bytes" overload, because a
 * connector that could hand over bare bytes would be a connector whose
 * transport provenance could go unrecorded.
 */
/** Strongest resource-family authority actually exercised in a reading. */
/** Strongest resource-family authority actually exercised in a reading. */
function summarizeSectionProvenance(
  rows: BasicPriceImportKnowledgeRow[],
): SectionProvenance {
  if (rows.some((row) => row.sourceSectionProvenance === 'SOURCE_ROW_CATEGORY'))
    return 'SOURCE_ROW_CATEGORY';
  if (
    rows.some((row) => row.sourceSectionProvenance === 'SOURCE_SECTION_TITLE')
  )
    return 'SOURCE_SECTION_TITLE';
  return 'UPLOADER_DECLARED';
}

/**
 * Headers the KDN interpreter may read. Structure detection already named
 * them for semantic/matrix tables. A sectioned workbook stores `columns: []`
 * because its family is proven by section titles, so the NO-header row is
 * read here as an overlay — meaning, not column number.
 */
function kdnHeaderColumns(
  table: SourceTable,
  structure: DetectedStructure,
): Array<{ columnNumber: number; headerText: string }> {
  if (structure.columns.length > 0) {
    return structure.columns.map((column) => ({
      columnNumber: column.columnNumber,
      headerText: column.headerText,
    }));
  }
  const headerRow = table.rows.find((row) => {
    const marker = textAt(row, 2);
    return marker !== null && /^NO$/i.test(marker);
  });
  if (!headerRow) return [];
  const columns: Array<{ columnNumber: number; headerText: string }> = [];
  for (
    let columnNumber = 1;
    columnNumber <= table.columnCount;
    columnNumber += 1
  ) {
    const headerText = textAt(headerRow, columnNumber);
    if (headerText) columns.push({ columnNumber, headerText });
  }
  return columns;
}

function kdnColumnOf(decision: KdnColumnDecision): number | null {
  return decision.status === 'ESTABLISHED'
    ? decision.column.columnNumber
    : null;
}

function mergeKdnInterpretation(
  existing: BasicPriceIntakeInterpretation | null,
  decision: KdnColumnDecision,
): BasicPriceIntakeInterpretation | null {
  const kdnColumn =
    decision.status === 'ESTABLISHED' && decision.humanConfirmed
      ? decision.column.columnNumber
      : null;
  if (existing === null && kdnColumn === null) return null;
  if (existing === null) {
    return {
      resourceNameColumn: null,
      sourceUnitColumn: null,
      declaredSection: null,
      kdnColumn,
    };
  }
  return { ...existing, kdnColumn };
}

function emptyKdnFields(): Pick<
  BasicPriceImportKnowledgeRow,
  | 'sourceKdnCellAddress'
  | 'sourceKdnHeaderText'
  | 'proposedCanonicalKdn'
  | 'rawKdnTextValue'
  | 'rawKdnNumericRoundTripString'
  | 'rawKdnDisplayText'
  | 'kdnReasonCode'
> {
  return {
    sourceKdnCellAddress: null,
    sourceKdnHeaderText: null,
    proposedCanonicalKdn: null,
    rawKdnTextValue: null,
    rawKdnNumericRoundTripString: null,
    rawKdnDisplayText: null,
    kdnReasonCode: null,
  };
}

function kdnFieldsForRow(input: {
  table: SourceTable;
  row: SourceRow;
  decision: KdnColumnDecision;
  locate: (columnNumber: number | null) => string;
}): Pick<
  BasicPriceImportKnowledgeRow,
  | 'sourceKdnCellAddress'
  | 'sourceKdnHeaderText'
  | 'proposedCanonicalKdn'
  | 'rawKdnTextValue'
  | 'rawKdnNumericRoundTripString'
  | 'rawKdnDisplayText'
  | 'kdnReasonCode'
> {
  if (input.decision.status !== 'ESTABLISHED') {
    return emptyKdnFields();
  }
  const columnNumber = input.decision.column.columnNumber;
  const evidence: KdnCellEvidence = readKdnCell(
    input.row.cells[columnNumber - 1] ?? null,
  );
  return {
    sourceKdnCellAddress: input.locate(columnNumber),
    sourceKdnHeaderText: input.decision.column.headerText,
    proposedCanonicalKdn: evidence.proposedCanonicalKdn,
    rawKdnTextValue: evidence.rawKdnTextValue,
    rawKdnNumericRoundTripString: evidence.rawKdnNumericRoundTripString,
    rawKdnDisplayText: evidence.rawKdnDisplayText,
    kdnReasonCode: evidence.kdnReasonCode,
  };
}

export class BasicPriceUniversalIntakeAdapter {
  constructor(
    private readonly readers: ReaderRegistry = ReaderRegistry.default(),
  ) {}

  async parse(
    envelope: SourceEnvelope,
    selection: BasicPriceIntakeSelection = {},
  ): Promise<BasicPriceImportKnowledgeObject> {
    const read = await this.readers.read(envelope);
    const detections = detectSourceStructures(read.tables);
    const { table, structure, regionChoice } = resolveStructureSelection(
      read.tables,
      detections,
      selection,
    );

    const kdnMapping = interpretKdnColumns(
      kdnHeaderColumns(table, structure),
      selection.selectedKdnColumn,
    );

    const rows =
      structure.structure === 'SECTIONED_PRICE_LIST'
        ? this.readSectioned(table, structure, kdnMapping)
        : this.readHeaderTable(
            table,
            structure,
            regionChoice,
            selection,
            kdnMapping,
          );

    return {
      parserContractVersion: CONTRACT_BY_STRUCTURE[structure.structure],
      readerId: read.readerId,
      readerContractVersion: read.readerContractVersion,
      locatorDialect: table.locatorDialect,
      structure: structure.structure,
      sourceSha256: envelope.contentDigestSha256,
      fileName: envelope.fileName,
      sheetName: table.name,
      totalSourceRows: rows.totalSourceRows,
      // The dominant authority across this reading. Per-row provenance is on
      // each row; a mixed reading reports the strongest evidence it actually
      // used rather than flattening to the weakest.
      sectionProvenance: summarizeSectionProvenance(rows.rows),
      regionScopeLabel: regionChoice?.label ?? null,
      regionScopeKind: regionChoice?.kind ?? null,
      // Read from the STRUCTURE, not from the choice: the banner proves the
      // whole axis is geographic, and it does so whether or not this particular
      // reading ended up scoped to one of its columns.
      regionScopeGeographicEvidence: structure.regionScope.geographicEvidence,
      detectionEvidence: structure.evidence,
      excludedNonDataRows: rows.excludedNonDataRows,
      interpretation: rows.interpretation,
      kdnMapping,
      rows: rows.rows,
    };
  }

  /**
   * The sectioned price list, read exactly as RM-02 read it. Its behaviour is
   * already Owner-accepted, and the regression suite that proved it runs
   * against this method unchanged (test X1).
   */
  private readSectioned(
    table: SourceTable,
    structure: DetectedStructure,
    kdnMapping: KdnColumnDecision,
  ): {
    rows: BasicPriceImportKnowledgeRow[];
    totalSourceRows: number;
    /** Rows the source PROVED to be section titles (LAW G.1), never guessed. */
    excludedNonDataRows: number;
    /**
     * Null for name/unit/section — those stay document-decided on this shape.
     * The only lawful non-null case is a human-confirmed ambiguous/conflict
     * KDN heading, which must fork identity the same way a header-table
     * confirmation does.
     */
    interpretation: BasicPriceIntakeInterpretation | null;
  } {
    const nameColumn = structure.roleColumns.RESOURCE_NAME!;
    const codeColumn = structure.roleColumns.RESOURCE_CODE!;
    const unitColumn = structure.roleColumns.SOURCE_UNIT!;
    const priceColumn = structure.roleColumns.PRICE!;
    const scanLimit = Math.min(table.columnCount, 7);

    const rows: BasicPriceImportKnowledgeRow[] = [];
    let currentSection: BasicPriceSection | null = null;
    let totalSourceRows = 0;

    for (const row of table.rows) {
      let anyText: string | undefined;
      for (let column = 1; column <= scanLimit; column += 1) {
        const text = textAt(row, column);
        if (text !== null) {
          anyText = text;
          break;
        }
      }
      if (anyText === undefined) continue; // fully blank spacer row

      const marker = sectionOfMarkerText(anyText);
      if (marker) {
        currentSection = marker;
        continue; // section-title row, not a data row
      }

      const columnB = textAt(row, 2);
      if (columnB && /^NO$/i.test(columnB)) continue; // column-header row
      if (!currentSection) continue; // content before the first recognized section

      totalSourceRows += 1;
      const name = textAt(row, nameColumn);
      if (!name) continue; // no resolvable resource name — not a real data row

      const code = textAt(row, codeColumn);
      const unit = textAt(row, unitColumn);
      const evidence = spreadsheetPriceEvidence(
        row.cells[priceColumn - 1] ?? null,
      );

      const warnings: string[] = [...evidence.warnings];
      const errors: string[] = [...evidence.errors];
      if (!unit) errors.push('UNIT_REQUIRED');
      if (!code) warnings.push('RESOURCE_CODE_MISSING');

      rows.push(
        this.buildRow({
          table,
          row,
          section: currentSection,
          // The RM-02 workbook family declares its own sections with full-row
          // titles, so this is source evidence — never a human's fallback.
          sectionProvenance: 'SOURCE_SECTION_TITLE',
          columns: { nameColumn, codeColumn, unitColumn, priceColumn },
          code,
          name,
          unit,
          evidence,
          warnings,
          errors,
          rawSourceContext: null,
          kdnMapping,
        }),
      );
    }

    return {
      rows,
      totalSourceRows,
      excludedNonDataRows: 0,
      interpretation: mergeKdnInterpretation(null, kdnMapping),
    };
  }

  /**
   * The header-driven shapes: a SIMPROK-ready semantic table, and a regional
   * matrix scoped to exactly one jurisdiction.
   *
   * ONE SOURCE ROW BECOMES AT MOST ONE CANDIDATE HERE. A matrix row stating
   * three jurisdictions' prices contributes ONE price — the selected column's
   * — and the other two survive only as raw context. The same artifact scoped
   * to a different jurisdiction is a different, independently fingerprinted
   * batch, which is how the same source legitimately supports several regions
   * without any fact being duplicated (§8).
   */
  private readHeaderTable(
    table: SourceTable,
    structure: DetectedStructure,
    regionChoice: RegionScopeChoice | null,
    selection: BasicPriceIntakeSelection,
    kdnMapping: KdnColumnDecision,
  ): {
    rows: BasicPriceImportKnowledgeRow[];
    totalSourceRows: number;
    /** Rows the source PROVED to be section titles (LAW G.1), never guessed. */
    excludedNonDataRows: number;
    interpretation: BasicPriceIntakeInterpretation | null;
  } {
    const declaredSection = selection.declaredSection ?? null;
    const categoryNameColumn = structure.roleColumns.CATEGORY_NAME ?? null;
    const categoryCodeColumn = structure.roleColumns.CATEGORY_CODE ?? null;
    const sourceStatesCategory =
      categoryNameColumn !== null || categoryCodeColumn !== null;

    // USI-01R LAW 2.8 — DO NOT ASK A HUMAN WHAT THE SOURCE ALREADY SAID.
    //
    // The question is only owed when the document is genuinely silent about its
    // rows' resource families. A workbook carrying a per-row category column
    // answers it far better than a single dropdown ever could, so asking anyway
    // would be both redundant and dangerous: whatever the human picked would
    // then be sitting next to contradicting row evidence.
    if (!declaredSection && !sourceStatesCategory) {
      throw new IntakeError(INTAKE_ERRORS.SECTION_DECLARATION_REQUIRED, {
        tableName: table.name,
        structure: structure.structure,
        acceptedSections: ['LABOR', 'MATERIAL', 'EQUIPMENT'],
      });
    }

    // USI-01R2 §10 — a source whose columns carry no header needs a human to
    // name them ONCE. SIMPROK offers the candidates with real sample values
    // rather than picking the "most name-like" column by statistics.
    if (structure.columnRoles.required) {
      const nameChosen = selection.selectedNameColumn ?? null;
      const unitChosen = selection.selectedUnitColumn ?? null;
      const valid = (column: number | null, pool: { columnNumber: number }[]) =>
        column !== null && pool.some((c) => c.columnNumber === column);
      const nameValid = valid(nameChosen, structure.columnRoles.nameCandidates);

      // ONE COLUMN CANNOT HOLD TWO ROLES.
      //
      // Pool membership used to be the only thing asked here, and a column is
      // legitimately in BOTH pools: the name question prunes what the document
      // disproves, and the unit question keeps the full list because no
      // structural fact can disprove a unit column. So one column could be
      // named for both roles — and the Owner's real Ambon import did exactly
      // that. Every row's unit cell address became its own name cell address
      // and every row carried its resource name as its unit.
      //
      // THE CONSEQUENCES WERE NOT LOCAL, which is why this belongs at intake.
      // `classifyPhysicalRow` reads `hasUnitEvidence` from the unit column, so
      // 40 category banners looked commercial and entered the review room; the
      // Unit authority was then asked whether a resource name is a unit of
      // measure, truthfully answered no for all 934 rows, and not one identity
      // pair could close. One contradictory answer became 934 review problems.
      //
      // It is caught HERE and not in a browser because this is the truth
      // boundary: a supplier bridge, an API caller and a replay must all meet
      // the same refusal. And it is a REFUSAL, never a repair — SIMPROK does
      // not silently move the unit role to another column, because which
      // column holds the unit remains the one question only a reader of the
      // document can answer.
      const rolesCollide = nameChosen !== null && nameChosen === unitChosen;

      if (
        !nameValid ||
        !valid(unitChosen, structure.columnRoles.unitCandidates) ||
        rolesCollide
      ) {
        // ASK AGAIN WITHOUT THE IMPOSSIBLE OPTION. Once a column is named for
        // the resource name, offering it again under "which column holds the
        // unit" invites the very click that produced the batch above.
        //
        // AND THE REMOVAL IS UNCONDITIONAL. An earlier form of this fell back
        // to the unpruned list whenever pruning emptied it — which put the
        // named column back on screen in the ONE case where it was the only
        // thing left, i.e. exactly the case most likely to be clicked. That is
        // not fail-open, it is fail-open into the defect: the option would be
        // refused by the guard above the moment it was chosen, so drawing it
        // could only ever waste a person's click and teach them to distrust
        // the question.
        //
        // AN EMPTY LIST IS THE HONEST ANSWER HERE, and it is not a dead end
        // that had to be invented: a source with exactly one non-jurisdiction
        // text column states NO unit column, and `IntakeQuestionPanel` already
        // says so plainly when a question carries no options. Fail-open still
        // governs where proof is genuinely insufficient — see `nameValid`
        // below, which prunes nothing until a valid name column exists.
        throw new IntakeError(INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED, {
          tableName: table.name,
          structure: structure.structure,
          nameCandidates: structure.columnRoles.nameCandidates,
          unitCandidates: nameValid
            ? structure.columnRoles.unitCandidates.filter(
                (candidate) => candidate.columnNumber !== nameChosen,
              )
            : structure.columnRoles.unitCandidates,
        });
      }
    }

    const nameColumn =
      structure.roleColumns.RESOURCE_NAME ?? selection.selectedNameColumn!;
    const codeColumn = structure.roleColumns.RESOURCE_CODE ?? null;
    // A source that states only its SIMPROK unit candidate has still stated a
    // unit, and that text is the only unit evidence the row has. It is used —
    // and flagged, because a preparer's suggestion is not the same evidence as
    // the source document's own unit wording.
    const unitColumn =
      structure.roleColumns.SOURCE_UNIT ??
      (structure.columnRoles.required ? selection.selectedUnitColumn! : null);
    const unitFallbackColumn =
      unitColumn === null
        ? (structure.roleColumns.SIMPROK_UNIT_CANDIDATE ?? null)
        : null;
    const effectiveUnitColumn = unitColumn ?? unitFallbackColumn;
    const priceColumn =
      structure.structure === 'REGIONAL_MATRIX'
        ? regionChoice!.columnNumber
        : structure.roleColumns.PRICE!;
    const regionLabelColumn =
      structure.regionScope.kind === 'ROW_VALUE'
        ? (regionChoice?.columnNumber ?? null)
        : null;

    const headerByColumn = new Map<number, string>(
      structure.columns.map((column) => [
        column.columnNumber,
        column.headerText,
      ]),
    );
    const consumedColumns = new Set<number>(
      [
        nameColumn,
        codeColumn,
        effectiveUnitColumn,
        priceColumn,
        // Category columns have dedicated raw fields, so they are not repeated
        // into rawSourceContext.
        categoryNameColumn,
        categoryCodeColumn,
        kdnColumnOf(kdnMapping),
      ].filter(
        (column): column is number => column !== null && column !== undefined,
      ),
    );

    // EVERY jurisdiction the source offers — not just the selected one. This is
    // what makes row classification region-independent (LAW G).
    const priceEvidenceColumns =
      structure.regionScope.kind === 'COLUMN' &&
      structure.regionScope.choices.length > 0
        ? structure.regionScope.choices.map((choice) => choice.columnNumber)
        : [priceColumn];
    const rowNumberColumn = structure.roleColumns.ROW_NUMBER ?? null;

    const dataRows = table.rows.filter(
      (row) =>
        structure.headerRowNumber === null ||
        row.number > structure.headerRowNumber,
    );

    const rows: BasicPriceImportKnowledgeRow[] = [];
    let totalSourceRows = 0;
    let excludedNonDataRows = 0;

    for (const row of dataRows) {
      const name = textAt(row, nameColumn);
      if (!name) continue; // no resolvable resource name — not a real data row

      // LAW G — CLASSIFY THE PHYSICAL ROW, NOT THE SELECTED REGION'S CELL.
      const hasUnitEvidence =
        effectiveUnitColumn !== null &&
        textAt(row, effectiveUnitColumn) !== null;
      const hasPriceEvidenceInAnyJurisdiction = priceEvidenceColumns.some(
        (column) => (row.cells[column - 1] ?? null) !== null,
      );
      const rowKind = classifyPhysicalRow({
        hasName: true,
        hasUnitEvidence,
        hasPriceEvidenceInAnyJurisdiction,
        hasRowNumberEvidence:
          rowNumberColumn !== null && textAt(row, rowNumberColumn) !== null,
        // LAW G.1 — the row must PROVE it is a title. Absence proves nothing.
        headingEvidence: affirmativeHeadingEvidence(name),
      });
      // Neither kind is a price observation, so neither becomes a Basic Price
      // candidate — one because the source proved it is a title, the other
      // because the source gave it no commercial field at all. Both are
      // COUNTED, so the batch still accounts for every physical row it read.
      if (
        rowKind === 'STRUCTURAL_HEADING' ||
        rowKind === 'NO_COMMERCIAL_EVIDENCE'
      ) {
        excludedNonDataRows += 1;
        continue;
      }

      totalSourceRows += 1;

      if (regionLabelColumn !== null) {
        const label = textAt(row, regionLabelColumn);
        // Out-of-scope jurisdictions are simply not part of THIS batch. They
        // are not rejected, not flagged, and not silently merged — another
        // batch may take them.
        if (label !== regionChoice!.label) continue;
      }

      const code = codeColumn === null ? null : textAt(row, codeColumn);
      const unit =
        effectiveUnitColumn === null ? null : textAt(row, effectiveUnitColumn);
      const priceCell = row.cells[priceColumn - 1] ?? null;
      const evidence =
        table.locatorDialect === 'EXCEL_A1'
          ? spreadsheetPriceEvidence(priceCell)
          : textPriceEvidence(priceCell);

      const rawSourceCategoryName =
        categoryNameColumn === null ? null : textAt(row, categoryNameColumn);
      const rawSourceCategoryCode =
        categoryCodeColumn === null ? null : textAt(row, categoryCodeColumn);
      const resolvedSection = resolveRowSection({
        rawCategoryName: rawSourceCategoryName,
        rawCategoryCode: rawSourceCategoryCode,
        declaredSection,
      });

      const warnings: string[] = [
        ...separatorWarnings(priceCell),
        ...evidence.warnings,
        ...resolvedSection.warnings,
      ];
      // LAW H — an undecidable row stays visible, and says why.
      if (rowKind === 'ROW_KIND_AMBIGUOUS')
        warnings.push(ROW_KIND_AMBIGUOUS_REASON);
      const errors: string[] = [...evidence.errors, ...resolvedSection.errors];
      if (!unit) errors.push('UNIT_REQUIRED');
      // A UNIT OF MEASURE IS NEVER A BARE PRICE LITERAL.
      //
      // The real Ambon workbook changes column layout mid-file: from row 793 it
      // shifts one column left, so the cell the human named as the unit column
      // starts holding a PRICE. 132 rows then arrive with `rawUnitText` values
      // like "1470000" — and, worse, the cell read as this jurisdiction's price
      // is actually the NEXT jurisdiction's.
      //
      // SIMPROK cannot re-derive the layout here; the detector owns that, and
      // it proved one layout from the header. What it CAN do is refuse to
      // pretend a number is a unit. This is the same authority the detector
      // already applies to jurisdiction columns one file over — "A JURISDICTION
      // IS NAMED, NOT NUMBERED" — asked of the unit cell instead.
      //
      // AN ERROR, NOT A WARNING, and deliberately so: the row already fails
      // closed downstream when the Unit Kernel cannot resolve "1470000" as an
      // alias, but it fails with UNKNOWN_UNIT_ALIAS, which sends a reviewer to
      // look for a missing unit spelling that does not exist. Naming the real
      // cause here is the difference between 132 undiagnosable rows and 132
      // rows that say what is wrong with the document.
      if (unit && interpretPriceLiteral(unit).outcome !== 'NOT_NUMERIC') {
        errors.push('SOURCE_UNIT_CELL_HOLDS_PRICE_LITERAL');
      }
      if (!code) warnings.push('RESOURCE_CODE_MISSING');
      if (unitFallbackColumn !== null)
        warnings.push(UNIT_FROM_SIMPROK_CANDIDATE_REASON);

      rows.push(
        this.buildRow({
          table,
          row,
          section: resolvedSection.section,
          sectionProvenance: resolvedSection.provenance,
          rawSourceCategoryCode,
          rawSourceCategoryName,
          columns: {
            nameColumn,
            codeColumn,
            unitColumn: effectiveUnitColumn,
            priceColumn,
          },
          code,
          name,
          unit,
          evidence,
          warnings,
          errors,
          rawSourceContext: captureRawContext(
            table,
            row,
            headerByColumn,
            consumedColumns,
          ),
          kdnMapping,
        }),
      );
    }

    // WHAT A PERSON DECIDED, SEPARATED FROM WHAT THE DOCUMENT DECIDED.
    //
    // `columnRoles.required` is the detector's own statement that this source
    // carries no column headers, so the pair below is a human's answer rather
    // than a stated fact — and the EFFECTIVE columns are recorded, not the raw
    // parameters, because those are what these rows were actually read from.
    //
    // The section is recorded only where the document declared none. Where it
    // states categories the source wins outright (`resolveRowSection`), so a
    // declaration sent alongside it changed no row's family and recording it
    // would fork identity for two readings that are the same reading.
    const humanNamedTheColumns = structure.columnRoles.required;
    const humanDeclaredTheSection =
      !sourceStatesCategory && declaredSection !== null;
    const baseInterpretation =
      humanNamedTheColumns || humanDeclaredTheSection
        ? {
            resourceNameColumn: humanNamedTheColumns ? nameColumn : null,
            sourceUnitColumn: humanNamedTheColumns ? effectiveUnitColumn : null,
            declaredSection: humanDeclaredTheSection ? declaredSection : null,
            kdnColumn: null as number | null,
          }
        : null;
    const interpretation = mergeKdnInterpretation(
      baseInterpretation,
      kdnMapping,
    );

    return { rows, totalSourceRows, excludedNonDataRows, interpretation };
  }

  private buildRow(input: {
    table: SourceTable;
    row: SourceRow;
    section: BasicPriceSection | null;
    sectionProvenance: SectionProvenance | null;
    rawSourceCategoryCode?: string | null;
    rawSourceCategoryName?: string | null;
    columns: {
      nameColumn: number;
      /** Null means the SOURCE HAS NO SUCH COLUMN — not that a cell was empty. */
      codeColumn: number | null;
      unitColumn: number | null;
      priceColumn: number;
    };
    code: string | null;
    name: string;
    unit: string | null;
    evidence: PriceEvidence;
    warnings: string[];
    errors: string[];
    rawSourceContext: Record<string, string> | null;
    kdnMapping: KdnColumnDecision;
  }): BasicPriceImportKnowledgeRow {
    const { table, row, columns, evidence } = input;
    const locate = (columnNumber: number | null) =>
      columnNumber === null
        ? NO_SOURCE_COLUMN_LOCATOR
        : formatLocator(table.locatorDialect, row.number, columnNumber);

    return {
      sourceSection: input.section,
      sourceSectionProvenance: input.sectionProvenance,
      rawSourceCategoryCode: input.rawSourceCategoryCode ?? null,
      rawSourceCategoryName: input.rawSourceCategoryName ?? null,
      sourceRowNumber: row.number,
      sourceCodeCellAddress: locate(columns.codeColumn),
      sourceNameCellAddress: locate(columns.nameColumn),
      sourceUnitCellAddress: locate(columns.unitColumn),
      sourcePriceCellAddress: locate(columns.priceColumn),
      rawResourceCodeText: input.code,
      rawResourceNameText: input.name,
      rawUnitText: input.unit,
      rawPriceCellType: evidence.cellType,
      rawPriceNumericRoundTripString: evidence.numericRoundTripString,
      rawPriceTextValue: evidence.textValue,
      rawPriceFormulaText: evidence.formulaText,
      rawPriceCachedResultRoundTripString: evidence.cachedResultRoundTripString,
      rawPriceFormulaError: evidence.formulaError,
      rawPriceNumberFormat: evidence.numberFormat,
      rawPriceDisplayText: evidence.displayText,
      rawSourceContext: input.rawSourceContext,
      proposedCanonicalPrice: evidence.proposedCanonicalPrice,
      canonicalRoundingMode: evidence.canonicalRoundingMode,
      ...kdnFieldsForRow({
        table,
        row,
        decision: input.kdnMapping,
        locate,
      }),
      warnings: input.warnings,
      errors: input.errors,
    };
  }
}

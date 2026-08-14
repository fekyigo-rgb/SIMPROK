import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatExactMoney,
  formatExactQuantity,
  formatExactVolume,
} from "./rabPersistedDraftDisplay.ts";

/**
 * RAB-TRUTH-CLOSEOUT-01 PART B — numeric presentation truth.
 *
 * Money is money whoever typed it, volume always reads as a measurement, and
 * formatting never touches the value that was persisted.
 */

test("volume always reads with at least two decimals", () => {
  assert.equal(formatExactVolume("1"), "1,00");
  assert.equal(formatExactVolume("24"), "24,00");
  assert.equal(formatExactVolume("96.5"), "96,50");
  assert.equal(formatExactVolume("42.75"), "42,75");
});

test("volume keeps meaningful precision beyond two decimals", () => {
  assert.equal(formatExactVolume("0.000001"), "0,000001");
  assert.equal(formatExactVolume("659.123456"), "659,123456");
  // Indonesian grouping on the integer part.
  assert.equal(formatExactVolume("1234567.5"), "1.234.567,50");
});

test("volume fails closed rather than inventing a number", () => {
  assert.equal(formatExactVolume(null), "—");
  assert.equal(formatExactVolume("not-a-number"), "Nilai tidak valid");
  assert.notEqual(formatExactVolume(null), "0,00");
});

/**
 * Coefficients are NOT volumes. Padding them would restate the analysis, so
 * the quantity formatter they share is deliberately left alone.
 */
test("coefficient presentation is untouched by the volume rule", () => {
  assert.equal(formatExactQuantity("1"), "1");
  assert.equal(formatExactQuantity("0.0486"), "0,0486");
});

test("money is Rp, Indonesian grouping, exactly two decimals", () => {
  assert.equal(formatExactMoney("3000000"), "Rp 3.000.000,00");
  assert.equal(formatExactMoney("72615.92"), "Rp 72.615,92");
  assert.equal(formatExactMoney("909853.69"), "Rp 909.853,69");
  assert.equal(formatExactMoney("7007436.41"), "Rp 7.007.436,41");
});

/**
 * The defect this closes: the workspace had a SECOND money formatter that
 * rounded to whole rupiah, so a hand-typed price rendered as `Rp 3.000.000`
 * beside a kernel price rendered as `Rp 72.615,92` — the manual row looked
 * like a lesser kind of number.
 */
test("the workspace holds no second money formatter", () => {
  const page = readFileSync("src/pages/RabWorkspacePage.tsx", "utf8");
  assert.match(
    page,
    /const formatRupiah = \([\s\S]{0,120}formatExactMoney\(/,
    "the workspace money formatter must delegate to the one authority",
  );
  assert.doesNotMatch(page, /Math\.round\(value\)\.toLocaleString/, "the rounding formatter is back");
});

/**
 * RAB-TRUTH-CLOSEOUT-01G GAP-A — a typed price must LOOK like money.
 *
 * "Rp" is an adornment beside the field, never a character inside its value:
 * the input still holds digits only, so nothing shaped like "Rp 3.000.000,00"
 * can reach the payload.
 */
test("the manual price field carries a visible Rp that is not part of its value", () => {
  const page = readFileSync("src/pages/RabWorkspacePage.tsx", "utf8");
  // The editable price cell in the row, anchored on the cell itself.
  const cellStart = page.indexOf('<span className="simprok-rab-price-cell">');
  assert.notEqual(cellStart, -1, "the price cell is missing");
  const cell = page.slice(cellStart, page.indexOf("simprok-rab-amount-column", cellStart));

  assert.match(cell, /simprok-rab-price-cell__currency/, "the Rp adornment is missing");
  assert.match(cell, />\s*Rp\s*</, "the adornment must actually read Rp");
  // The adornment is a SIBLING of the input, never inside its value.
  assert.doesNotMatch(cell, /value=\{['"`]Rp/);
  assert.doesNotMatch(page, /parseDraftNumber\(['"`]Rp/);
  // The field still shows the same canonical number as the rest of the table.
  assert.match(cell, /numericFieldValue\(/);
  // Screen readers already get "Harga satuan" from the field itself.
  assert.match(cell, /aria-hidden="true"/);
});

/**
 * The persistence half of the same law: what leaves the page is the parsed
 * NUMBER the user's typing produced, never the string the table displays.
 */
test("the saved payload carries a number, never a formatted currency string", () => {
  const page = readFileSync("src/pages/RabWorkspacePage.tsx", "utf8");
  assert.match(
    page,
    /unitPrice: row\.manualUnitPrice \? \(unitPrices\[row\.id\] \?\? row\.unitPrice\) : undefined/,
    "the payload must send the numeric state, not a display string",
  );
  assert.doesNotMatch(page, /unitPrice: formatRupiah|unitPrice: formatDraftNumber|unitPrice: numericFieldValue/);
});

test("the Rp adornment is styled, not typed into the number", () => {
  const css = readFileSync("src/index.css", "utf8");
  assert.match(css, /\.simprok-rab-price-cell__currency\s*\{/);
  // One line: adornment then number, so the pair reads as a single amount.
  assert.match(
    css,
    /\.simprok-rab-draft-table \.simprok-rab-price-cell\s*\{[^}]*flex-direction:\s*row/,
  );
});

/** Presentation is presentation: nothing here is what gets persisted. */
test("formatting never becomes the stored value", () => {
  const page = readFileSync("src/pages/RabWorkspacePage.tsx", "utf8");
  // The save payload sends parsed numbers, never a formatted string.
  assert.doesNotMatch(page, /unitPrice: formatRupiah|quantity: formatDraftNumber/);
  assert.match(page, /parseDraftNumber\(event\.target\.value\)/);
});

/**
 * Alignment is a column law, and it must be stated where a later generic
 * `th, td { text-align: left }` cannot outrank it — the exact trap that made
 * every number read from the left on the first attempt.
 */
test("numbers read from the right, NO reads from the left", () => {
  const css = readFileSync("src/index.css", "utf8");
  const winning = css.slice(css.indexOf('.simprok-rab-table th.simprok-rab-col-no'));
  assert.match(
    winning,
    /\.simprok-rab-table td\.simprok-rab-col-no[\s\S]{0,120}text-align:\s*left/,
    "NO must read from the left, at table-class specificity",
  );
  for (const numeric of ["volume", "harga", "jumlah"]) {
    assert.match(
      winning,
      new RegExp(`\\.simprok-rab-table td\\.simprok-rab-col-${numeric}`),
      `${numeric} must be aligned at table-class specificity`,
    );
  }
  assert.match(winning, /text-align:\s*right/);
});

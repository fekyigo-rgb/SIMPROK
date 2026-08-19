import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * RAB AT PHONE WIDTH — the seam that made the RAB unusable below ~640px, and
 * the guard that keeps it repaired.
 *
 * THE DEFECT THIS LOCKS OUT. `.simprok-rab-table` carries a hard floor of
 * 1204px and Ruang Hidup's canvas one of 1180px. At 390px the scroll window is
 * ~354px, so measured in the browser the row's business cells sat at Volume
 * x=524, Satuan 620, Harga Satuan 702, Jumlah 866 and the Rincian Harga door
 * at 1062 — every value the row exists to carry, and its door to AHSP, painted
 * past the right edge behind horizontal scroll nobody discovers. The rows were
 * present and unreachable, which for the Owner is the same thing.
 *
 * WHY THE ASSERTIONS ARE ON THE STYLESHEET. There is no DOM test harness in
 * this repo and adding one would be a dependency nobody asked for — the same
 * reasoning ownerUiLaw.test.ts and rabChromeVisibility.test.ts already record.
 * The live behaviour is proven in the browser at 390/430/600/768/1024/1440 and
 * in narrow landscape; what belongs here is the part a future edit could
 * silently undo. Two things could: deleting the phone block, and "fixing"
 * overflow by hiding business columns instead of stacking them.
 */

const css = readFileSync("src/index.css", "utf8");

/** The phone block, isolated so no assertion can be satisfied by desktop CSS. */
const phoneBlock = (() => {
  const start = css.indexOf("@media (max-width: 640px)");
  assert.notEqual(
    start,
    -1,
    "the phone-width RAB block is gone — below 640px the RAB table returns to a 1204px spreadsheet and its business cells leave the screen",
  );
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error("the phone-width RAB block is not closed");
})();

/**
 * THE BREAKPOINT IS THE PRODUCT'S OWN. RabWorkspacePage already reads
 * `(max-width: 640px)` to decide that a phone gets the full-screen inspection
 * surface. The stacked table has to turn over at exactly that width, or the
 * product acquires a second, invisible idea of what a phone is.
 */
test("the phone breakpoint is the one the workspace already uses, not a second one", () => {
  const page = readFileSync("src/pages/RabWorkspacePage.tsx", "utf8");
  assert.match(
    page,
    /matchMedia\('\(max-width: 640px\)'\)/,
    "RabWorkspacePage no longer reads (max-width: 640px) — the CSS breakpoint and the isMobileViewport breakpoint have drifted apart",
  );
});

/**
 * NOTHING IS HIDDEN TO MAKE THE ROW FIT. This is the forbidden repair: let the
 * columns keep their desktop geometry, hide the ones that will not fit, and
 * call the absence of overflow a pass. Every column that carries a business
 * fact must still be laid out at phone width.
 */
test("no business column is hidden to make the row fit", () => {
  for (const column of [
    "simprok-rab-col-no",
    "simprok-rab-col-kode",
    "simprok-rab-col-uraian",
    "simprok-rab-col-volume",
    "simprok-rab-col-satuan",
    "simprok-rab-col-harga",
    "simprok-rab-col-jumlah",
    "simprok-rab-col-asal",
    "simprok-rab-col-aksi",
  ]) {
    const hidden = new RegExp(
      `\\.${column}[^{}]*\\{[^{}]*display:\\s*none`,
      "s",
    );
    assert.equal(
      hidden.test(phoneBlock),
      false,
      `${column} is display:none at phone width — that hides a business fact instead of stacking it, and the Owner can no longer read it at all`,
    );
  }
});

/**
 * THE HEADER MOVES ONTO THE ROW. Stacking removes the one row that said what
 * each value meant, so every stacked value has to carry its own name. A number
 * with no label is not a fact the Owner can act on.
 */
test("every stacked value carries its column name as text", () => {
  for (const [column, label] of [
    ["simprok-rab-col-no", "No"],
    ["simprok-rab-col-kode", "Kode AHSP"],
    ["simprok-rab-col-uraian", "Uraian Pekerjaan"],
    ["simprok-rab-col-volume", "Volume"],
    ["simprok-rab-col-satuan", "Satuan"],
    ["simprok-rab-col-harga", "Harga Satuan"],
    ["simprok-rab-col-jumlah", "Jumlah"],
    ["simprok-rab-col-asal", "Asal Harga"],
  ]) {
    assert.match(
      phoneBlock,
      new RegExp(`\\.${column}::before\\s*\\{\\s*content:\\s*"${label}"`),
      `${column} loses its label when the table stacks — the value is left to be guessed at by position, and at phone width there are no positions left`,
    );
  }
  assert.match(
    phoneBlock,
    /thead\s*\{\s*display:\s*none/,
    "the header row is still laid out at phone width — stacked, its nine labels read as orphan words above a list that no longer has columns",
  );
});

/**
 * THE HORIZONTAL PRISON IS RELEASED. The stacked list only reaches the screen
 * if the floors that forced the spreadsheet width stand down.
 */
test("the table floor and its scroll frames stand down at phone width", () => {
  assert.match(
    phoneBlock,
    /\.simprok-rab-table[^{]*\{[^}]*min-width:\s*0/s,
    "the 1204px table floor survives at phone width, so the row's business cells are still painted past the right edge",
  );
  assert.match(
    phoneBlock,
    /\.simprok-rab-canvas__zoom\s*\{[^}]*min-width:\s*0\s*!important/s,
    "Ruang Hidup's 1180px canvas floor survives at phone width, so the viewer still scrolls sideways past its own money columns",
  );
});

/**
 * THE DOOR TO AHSP, AND A THUMB THAT CAN REACH IT. Rincian Harga was 700px off
 * the right edge of a phone. It has to be on the line and big enough to hit —
 * 44px is the size below which a control stops being reliably tappable.
 */
test("the Rincian Harga door is on the line and thumb-sized", () => {
  assert.match(
    phoneBlock,
    /\.simprok-rab-row-actions\s*\{[^}]*flex:\s*1 1 auto/s,
    "the action wrapper no longer fills the line, so Rincian Harga shrinks back to a desktop-sized target on a phone",
  );
  assert.match(
    phoneBlock,
    /\.simprok-rab-row-actions > button\s*\{[^}]*min-height:\s*44px/s,
    "the row's action buttons are below a reliable touch target at phone width",
  );
});

/**
 * NO HOVER-ONLY CONTROL ON A DEVICE WITH NO HOVER. The structural cluster is
 * revealed by :hover on a desktop. A phone never fires it, so on a phone the
 * controls have to be simply present.
 */
test("the structural controls do not depend on hover at phone width", () => {
  assert.match(
    phoneBlock,
    /\.simprok-rab-row-structure\s*\{[^}]*opacity:\s*1/s,
    "the structural cluster is still hover-revealed at phone width, where hover never happens",
  );
  assert.match(
    phoneBlock,
    /\.simprok-rab-row-structure\s*\{[^}]*pointer-events:\s*auto/s,
    "the structural cluster is still pointer-events:none at phone width, so a tap passes straight through it",
  );
});

/**
 * PRESENTATION ONLY. The whole repair lives in the stylesheet. If a future edit
 * needs a second component tree, a second query or a second store to make a
 * phone work, that is a second RAB and it must be argued for, not smuggled in
 * behind a responsive ticket.
 */
test("the phone repair reaches for no second RAB", () => {
  for (const forbidden of [
    "MobileRab",
    "RabMobile",
    "useMobileRab",
    "mobileRabRows",
  ]) {
    assert.equal(
      css.includes(forbidden),
      false,
      `${forbidden} suggests a second mobile RAB surface — presentation may adapt, product truth may not`,
    );
  }
});

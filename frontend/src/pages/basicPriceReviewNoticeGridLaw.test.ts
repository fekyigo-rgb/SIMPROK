import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const review = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
const css = readFileSync('src/styles/basicPrice.css', 'utf8');

test('BP205-VIS-01 a live row acknowledgement stays inside the full-width card header', () => {
  const head = review.indexOf('<div className="bp-rowcard__head">');
  const actions = review.indexOf('<div className="bp-rowcard__summary-actions">', head);
  const notice = review.indexOf('rowNotice?.rowId === row.id', actions);
  const noticeText = review.indexOf('{rowNotice.text}', notice);
  const endHead = review.indexOf('              </div>\n              {expanded ? (', noticeText);
  const firstCardColumn = review.indexOf('<div className="bp-rowcard__column bp-rowcard__source">', endHead);
  assert.ok(head >= 0 && actions > head && notice > actions);
  assert.ok(noticeText > notice && endHead > noticeText && firstCardColumn > endHead,
    'notices must be children of the heading flex line, not CSS-grid siblings');
  assert.match(review.slice(notice, noticeText), /bp-note bp-note--info bp-rowcard__notice/);
  assert.match(review.slice(notice, noticeText), /role="status" aria-live="polite"/);
});

test('BP205-VIS-02 the notice cannot create a third implicit grid column', () => {
  assert.match(css, /\.bp-rowcard\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*35fr\)\s+minmax\(0,\s*65fr\)/);
  assert.match(css, /\.bp-rowcard__head\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.bp-rowcard__head\s*>\s*\.bp-rowcard__notice\s*\{[^}]*flex:\s*0\s+0\s+100%/);
  assert.match(css, /\.bp-rowcard__head\s*>\s*\.bp-rowcard__notice\s*\{[^}]*overflow-wrap:\s*break-word/);
  assert.ok(!review.includes('<p className="bp-note bp-note--info" role="status" aria-live="polite">'),
    'old grid-sibling notice must not be reintroduced');
});

test('BP205-VIS-03 separate desktop decision picker and mobile stacking remain intact', () => {
  assert.match(css, /\.bp-rowcard__actions\s*\{[^}]*grid-column:\s*2/);
  assert.match(css, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.bp-rowcard\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(review, /className="bp-rowcard__actions bp-rowcard__resolution"/);
  assert.match(review, /bp-rowcard__lookup bp-rowcard__lookup--contextual/);
});

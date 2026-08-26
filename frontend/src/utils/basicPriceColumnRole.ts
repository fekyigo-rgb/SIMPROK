/**
 * ONE COLUMN CANNOT HOLD TWO ROLES.
 *
 * When a workbook gives its columns no titles, SIMPROK asks — once — which
 * column holds the resource name and which holds the unit. The Owner's real
 * 934-row Ambon import was created by answering the SAME column to both
 * questions, and the consequences were not local: every row then carried its
 * own resource name as its unit, 40 category banners acquired "unit evidence"
 * and entered the review room as resources, and the Unit authority truthfully
 * refused to accept a resource name as a unit of measure for all 934 rows, so
 * not one identity pair could close.
 *
 * The backend refuses that pair at the intake boundary — that is where the
 * truth is kept, and an API caller or a replay meets the same refusal. This
 * function is the SECOND layer and it is UX rather than truth: a button that
 * cannot lead anywhere should not be drawn at all.
 *
 * It lives here, as a plain function, so it can be proven by a test that RUNS
 * it rather than by a test that reads the component's source text.
 */

/**
 * The unit-column options a person may actually choose from, given what they
 * have already answered about this same file.
 *
 * THE REMOVAL IS UNCONDITIONAL, and that is the correction that matters. An
 * earlier form fell back to the unpruned list whenever filtering emptied it,
 * which put the already-named column back on screen in the ONE case where it
 * was the only thing left — exactly the case most likely to be clicked. The
 * backend refuses that pair, so the button could only ever waste a click and
 * teach a person to distrust the question.
 *
 * AN EMPTY LIST IS THE HONEST ANSWER, not a hole. A source with a single
 * non-jurisdiction text column states no unit column at all, and
 * `IntakeQuestionPanel` already says plainly that SIMPROK cannot assemble
 * options for a question. Fail-open still governs the case below, where no
 * name column has been answered and there is genuinely nothing to filter by.
 */
export function unitColumnOptions<T extends { columnNumber: number }>(
  offered: readonly T[],
  answeredNameColumn: number | undefined,
): readonly T[] {
  // Nothing has been named yet, so there is nothing to filter by. Narrowing
  // the list against an answer nobody has given would hide a real option.
  if (answeredNameColumn === undefined) return offered;

  return offered.filter(
    (candidate) => candidate.columnNumber !== answeredNameColumn,
  );
}

import { AhspImportService, ahspSourceRowKey } from './ahsp-import.service';

/**
 * GAP C2 — THE LOCATOR JOIN, READ AT LAST.
 *
 * The `AHSPResource` schema comment states the contract: an observation and the
 * AHSP line it came from carry the SAME locator — workspace, source digest,
 * sheet, row, raw name and class — so no pointer column is needed. Nothing in
 * the repository performed that read, so an observation could never say which
 * work item quoted it, and the parent context sat unread in the import journal.
 *
 * These prove the read, and prove what it refuses. The shapes are the live ones:
 * "AHSP BINA MARGA.xlsx", "Timbunan Porus" at Sheet1 row 41.
 */
describe('AHSP import journal — which work item quoted this source row', () => {
  const WORKSPACE = 'ws-1';
  const DIGEST = 'A'.repeat(64);
  const PARSER = 'USI01_XLSX_V1';

  const locator = (rowNumber: number, raw: string, sheetName = 'Sheet1') => ({
    sheetName,
    locator: `C${rowNumber}`,
    rowNumber,
    raw,
  });

  const workItem = (over: Record<string, unknown> = {}) => ({
    status: 'READY',
    reasonCodes: [],
    workType: locator(3, 'Timbunan pilihan'),
    methodName: locator(4, 'Manual'),
    outputUnitRaw: locator(5, 'M3'),
    resolvedOutputUnit: 'M3',
    regulationReference: null,
    effectiveDate: null,
    sheetName: 'Sheet1',
    resources: [
      {
        status: 'READY',
        reasonCodes: [],
        group: 'MATERIAL',
        rawName: 'Timbunan Porus',
        rawCode: 'M44',
        rawUnit: 'M3',
        coefficient: 1.2,
        nameEvidence: locator(41, 'Timbunan Porus'),
        codeEvidence: locator(41, 'M44'),
        unitEvidence: locator(41, 'M3'),
        coefficientEvidence: locator(41, '1.2'),
        resolvedResourceCatalogId: null,
        resolvedBaseUnit: null,
      },
    ],
    ...over,
  });

  /** The observation as `observed_resources` stores it. */
  const observedRow = (over: Record<string, unknown> = {}) => ({
    sourceSha256: DIGEST,
    parserContractVersion: PARSER,
    sheetName: 'Sheet1',
    sourceRowNumber: 41,
    rawName: 'Timbunan Porus',
    resourceType: 'MATERIAL',
    ...over,
  });

  const build = (
    jobs: unknown[],
    lines: unknown[],
  ): { service: AhspImportService; prisma: any } => {
    const prisma: any = {
      aHSPImportJob: { findMany: jest.fn().mockResolvedValue(jobs) },
      aHSPImportLine: { findMany: jest.fn().mockResolvedValue(lines) },
    };
    return {
      service: new AhspImportService(prisma, { logAction: jest.fn() } as never),
      prisma,
    };
  };

  const JOB = { id: 'job-1', sourceSha256: DIGEST, parserContractVersion: PARSER };
  const LINE = { importJobId: 'job-1', lineNumber: 7, rawData: workItem() };

  const answerFor = async (
    jobs: unknown[],
    lines: unknown[],
    row = observedRow(),
  ) => {
    const { service } = build(jobs, lines);
    const map = await service.workContextForSourceRows(WORKSPACE, [row as never]);
    return map.get(ahspSourceRowKey(row as never));
  };

  it('THE JOIN: an observed row is answered with the work item that quoted it, in the source’s own words', async () => {
    expect(await answerFor([JOB], [LINE])).toEqual({
      kind: 'FOUND',
      importJobId: 'job-1',
      lineNumber: 7,
      workType: 'Timbunan pilihan',
      methodName: 'Manual',
      sheetName: 'Sheet1',
    });
  });

  it('a hex digest written in another case is the same document', async () => {
    expect(
      await answerFor([{ ...JOB, sourceSha256: DIGEST.toLowerCase() }], [LINE]),
    ).toMatchObject({ kind: 'FOUND' });
  });

  it('AMBIGUOUS when two work items quote the same source row — never the first of them', async () => {
    const second = { importJobId: 'job-1', lineNumber: 9, rawData: workItem() };
    expect(await answerFor([JOB], [LINE, second])).toEqual({
      kind: 'AMBIGUOUS',
      quotedByLines: 2,
    });
  });

  /**
   * C2 — AMBIGUOUS MEANS TWO WORK ITEMS, NOT TWO MENTIONS.
   *
   * This counted REFERENCES. One work item that lists the same component twice —
   * which real documents do: the same Stamper on two lines of one recipe — made
   * two matches, and the row was reported "quoted by 2 lines" when exactly ONE
   * line quoted it. The person was told SIMPROK could not tell which work item
   * this was, about a row that has only one.
   */
  it('C2: ONE work item quoting the same row twice is ONE context, not an ambiguity', async () => {
    const twice = workItem({
      resources: [workItem().resources[0], workItem().resources[0]],
    });
    expect(
      await answerFor([JOB], [{ importJobId: 'job-1', lineNumber: 7, rawData: twice }]),
    ).toEqual({
      kind: 'FOUND',
      importJobId: 'job-1',
      lineNumber: 7,
      workType: 'Timbunan pilihan',
      methodName: 'Manual',
      sheetName: 'Sheet1',
    });
  });

  it('C2: two DIFFERENT work items quoting it is still an ambiguity, counted by work item', async () => {
    const twiceInEach = workItem({
      resources: [workItem().resources[0], workItem().resources[0]],
    });
    expect(
      await answerFor([JOB], [
        { importJobId: 'job-1', lineNumber: 7, rawData: twiceInEach },
        { importJobId: 'job-1', lineNumber: 9, rawData: twiceInEach },
      ]),
    ).toEqual({ kind: 'AMBIGUOUS', quotedByLines: 2 });
  });

  /**
   * C2 — ASK ABOUT THE DOCUMENTS IN HAND.
   *
   * The read used to load every import job in the workspace and sift them in
   * memory, so explaining one row cost the whole workspace's import history.
   * Both hex spellings are offered because an IN list is case-sensitive and a
   * digest is a number: narrowing to one spelling would answer NOTHING for rows
   * stored in the other, which reads exactly like "no such document".
   */
  it('C2: the job query is narrowed to the documents asked about, in both hex spellings', async () => {
    const { service, prisma } = build([JOB], [LINE]);
    await service.workContextForSourceRows(WORKSPACE, [observedRow() as never]);
    const where = prisma.aHSPImportJob.findMany.mock.calls[0][0].where;
    expect(where.workspaceId).toBe(WORKSPACE);
    expect(new Set(where.sourceSha256.in)).toEqual(
      new Set([DIGEST.toLowerCase(), DIGEST.toUpperCase()]),
    );
  });

  it.each([
    ['a different sheet', { sheetName: 'Sheet2' }],
    ['a different row', { sourceRowNumber: 42 }],
    ['a different raw name', { rawName: 'Timbunan porus' }],
    ['a different class', { resourceType: 'EQUIPMENT' }],
    ['a different document', { sourceSha256: 'B'.repeat(64) }],
    ['a different parser contract', { parserContractVersion: 'USI01_XLSX_V2' }],
  ])('ABSENT for %s — a pairing is never made on the name alone', async (_label, over) => {
    expect(await answerFor([JOB], [LINE], observedRow(over))).toEqual({ kind: 'ABSENT' });
  });

  it.each([
    ['no digest', { sourceSha256: null }],
    ['no sheet', { sheetName: null }],
    ['no row number', { sourceRowNumber: null }],
  ])('ABSENT when provenance cannot name the document and the place (%s)', async (_l, over) => {
    expect(await answerFor([JOB], [LINE], observedRow(over))).toEqual({ kind: 'ABSENT' });
  });

  it('ABSENT for the rows that predate the journal — nothing is reconstructed', async () => {
    // This is the honest answer for the 826 observations already in Permanent:
    // their documents left no journal row to join to.
    expect(await answerFor([], [])).toEqual({ kind: 'ABSENT' });
  });

  it('every read is scoped to the workspace, on the job AND on the line', async () => {
    const { service, prisma } = build([JOB], [LINE]);
    await service.workContextForSourceRows(WORKSPACE, [observedRow() as never]);
    expect(prisma.aHSPImportJob.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceId: WORKSPACE,
    });
    expect(prisma.aHSPImportLine.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceId: WORKSPACE,
    });
  });

  it('asks nothing of the database when there is nothing to ask about', async () => {
    const { service, prisma } = build([JOB], [LINE]);
    expect((await service.workContextForSourceRows(WORKSPACE, [])).size).toBe(0);
    expect(prisma.aHSPImportJob.findMany).not.toHaveBeenCalled();
  });

  it('answers several rows independently, each to its own work item', async () => {
    const otherItem = workItem({
      workType: locator(60, 'Pasangan batu'),
      methodName: locator(61, 'Manual'),
      resources: [
        {
          ...workItem().resources[0],
          rawName: 'Pasir',
          rawCode: 'M10b',
          nameEvidence: locator(88, 'Pasir'),
        },
      ],
    });
    const { service } = build(
      [JOB],
      [LINE, { importJobId: 'job-1', lineNumber: 8, rawData: otherItem }],
    );
    const pasir = observedRow({ rawName: 'Pasir', sourceRowNumber: 88 });
    const map = await service.workContextForSourceRows(WORKSPACE, [
      observedRow() as never,
      pasir as never,
    ]);
    expect(map.get(ahspSourceRowKey(observedRow() as never))).toMatchObject({
      workType: 'Timbunan pilihan',
    });
    expect(map.get(ahspSourceRowKey(pasir as never))).toMatchObject({
      workType: 'Pasangan batu',
      lineNumber: 8,
    });
  });

  it('never offers the work item’s OUTPUT unit as anything about the component', async () => {
    const found = await answerFor([JOB], [LINE]);
    expect(Object.keys(found as object)).not.toContain('outputUnit');
    expect(JSON.stringify(found)).not.toContain('M3');
  });
});

import { ResourceType } from '@prisma/client';
import { buildAhspAnalisaXlsx } from '../document/ahsp-analisa-xlsx.fixture';
import { UNIT_RESOLUTION_STATUS } from '../../unit-kernel/unit-kernel.contracts';
import { candidateContextDigest } from '../../resource-catalog/ghx-candidate-context';
import { GhxDecisionContextTokenService } from '../../resource-catalog/ghx-decision-context-token.service';
import {
  IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
  identicalQuestionKey,
} from '../../resource-catalog/identical-question-key';
import type { ResourceIdentityResolution } from '../../resource-catalog/resource-identity-resolution.kernel';
import {
  ResourceIdentityEvidence,
  ResourceIdentityResolutionService,
} from '../../resource-catalog/resource-identity-resolution.service';
import {
  ObserveResourceInput,
  ResourceObservationService,
} from '../../resource-catalog/resource-observation.service';
import { AhspResourceResolutionOrchestrator } from '../../project-ahsp/ahsp-resource-resolution.orchestrator';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';
import { RealityNormalizationEngine } from './reality-normalization.engine';
import { inMemoryImportJournal } from '../../../test/fixtures/ahsp-import-journal.fixture';

/**
 * CLOSEOUT P1-A — "COMPLETE" IS A PROOF, NEVER AN EMPTY QUEUE.
 *
 * The completion view runs here against the REAL identity authority
 * (ResourceIdentityResolutionService and its kernel, with GHX and IQL memory) and
 * the REAL curation-queue projection (ResourceObservationService.openQuestionsBySource),
 * over a read-only in-memory world, with the resolver that CONSUMES a recipe
 * (AhspResourceResolutionOrchestrator) as the oracle. Doubles stand only where no
 * identity is decided: the journal (in memory), the writers, and a Unit Kernel
 * that knows every spelling.
 *
 * A — open questions (the queue), B — whether the recipe's facts and identities
 * are complete for the AHSP stage, C — whether a project can price it. A never
 * proves B; B never claims C (no Basic Price exists anywhere in this world).
 */

type Dependencies = ConstructorParameters<
  typeof AhspDocumentCanonicalizationService
>;
type Group = 'MATERIAL' | 'EQUIPMENT';
type Component = { name: string; code: string; unit: string; group?: Group };
type CatalogRow = {
  id: string;
  workspaceId: string | null;
  code: string | null;
  name: string;
  type: ResourceType;
  baseUnit: string;
  status: 'ACTIVE';
  specifications: null;
};
type Question = {
  workspaceId: string;
  resourceType: string;
  rawName: string;
  rawCode: string | null;
  rawUnit: string | null;
};
type LedgerEvent = {
  workspaceId: string;
  id: string;
  questionKey: string;
  generation: number;
  action: 'APPROVE' | 'REVOKE';
  selectedResourceCatalogId: null;
  candidateContextDigest: null;
  resolutionPolicyVersion: null;
  decidedByAccountId: string;
  decidedAt: Date;
  previousDecision: {
    id: string;
    generation: number;
    action: 'TEACH';
    selectedResourceCatalogId: string;
    candidateContextDigest: string;
    resolutionPolicyVersion: string;
    decidedByAccountId: string;
    reason: string | null;
    originObservation: Question;
  };
};
type ObservedRow = Question & {
  sourceSha256: string | null;
  status: 'OBSERVED' | 'RESOLVED_EXISTING';
};
type StoredVersion = {
  id: string;
  versionNumber: number;
  outputUnit: string;
  ahsp: { id: string };
  resources: Array<{
    id: string;
    resourceId: string;
    resourceType: string;
    coefficient: number;
    baseUnit: string;
    rawName: string | null;
    rawCode: string | null;
    rawUnit: string | null;
  }>;
};
type Sighting = { workspaceId: string } & Record<string, unknown>;

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '44444444-4444-4444-8444-444444444444';
const catalog = (
  id: string,
  name: string,
  type: ResourceType,
  baseUnit: string,
): CatalogRow => ({
  id,
  workspaceId: null,
  code: null,
  name,
  type,
  baseUnit,
  status: 'ACTIVE',
  specifications: null,
});
const PEKERJA = catalog(
  'c0000000-0000-4000-8000-000000000001',
  'Pekerja',
  'LABOR',
  'OH',
);
const MANDOR = catalog(
  'c0000000-0000-4000-8000-000000000002',
  'Mandor',
  'LABOR',
  'OH',
);
const KERIKIL = catalog(
  'c0000000-0000-4000-8000-000000000003',
  'Kerikil / Agregat',
  'MATERIAL',
  'M3',
);
const SEMEN = catalog(
  'c0000000-0000-4000-8000-000000000004',
  'Semen Portland',
  'MATERIAL',
  'Kg',
);

/** The component no machine level proves: its only candidate is "Kerikil / Agregat". */
const AGREGAT: Component = { name: 'Agregat kasar', code: 'M03', unit: 'M3' };
const questionOf = (workspaceId: string, component: Component): Question => ({
  workspaceId,
  resourceType: component.group ?? 'MATERIAL',
  rawName: component.name,
  rawCode: component.code,
  rawUnit: component.unit,
});
/** The candidate context the answer is given under — the one the kernel shows for AGREGAT. */
const DIGEST = candidateContextDigest([
  {
    resourceCatalogId: KERIKIL.id,
    name: KERIKIL.name,
    type: KERIKIL.type,
    baseUnit: KERIKIL.baseUnit,
    specifications: null,
  },
]);

/**
 * One analysis: its own work item code, the fixture's two labour rows, and the
 * given components under "Bahan" (rows 14–17) or "Peralatan" (rows 19–20).
 */
const analysis = (workType: string, components: readonly Component[]) =>
  buildAhspAnalisaXlsx((sheet) => {
    sheet.getCell('A5').value = workType;
    sheet.getCell('A15').value = null;
    sheet.getCell('B15').value = null;
    sheet.getCell('A18').value = 'C';
    sheet.getCell('B18').value = 'Peralatan';
    const place = (rows: readonly number[], group: Group) =>
      components
        .filter((component) => (component.group ?? 'MATERIAL') === group)
        .forEach((component, index) => {
          const row = rows[index];
          sheet.getCell(`A${row}`).value = index + 1;
          sheet.getCell(`B${row}`).value = component.name;
          sheet.getCell(`E${row}`).value = component.code;
          sheet.getCell(`F${row}`).value = component.unit;
          sheet.getCell(`G${row}`).value = 1.2;
        });
    place([14, 15, 16, 17], 'MATERIAL');
    place([19, 20], 'EQUIPMENT');
  });

/** Everything SIMPROK "holds" in this spec, read through the delegates the services query. */
function world() {
  const catalogs: CatalogRow[] = [];
  const sightings: Sighting[] = [];
  const ledger: LedgerEvent[] = [];
  const observed: ObservedRow[] = [];
  const versions = new Map<string, StoredVersion>();
  const writes: string[] = [];
  const client = {
    resourceCatalog: {
      findMany: ({
        where,
      }: {
        where: { OR: Array<{ workspaceId: string | null }> };
      }) =>
        Promise.resolve(
          catalogs.filter((row) =>
            where.OR.some((scope) => scope.workspaceId === row.workspaceId),
          ),
        ),
    },
    resourceSourceIdentity: {
      findMany: ({ where }: { where: { workspaceId: string } }) =>
        Promise.resolve(
          sightings.filter((row) => row.workspaceId === where.workspaceId),
        ),
      createMany: ({ data }: { data: Sighting[] }) => {
        writes.push('resourceSourceIdentity.createMany');
        sightings.push(...data);
        return Promise.resolve({ count: data.length });
      },
    },
    basicPriceImportRowResourceMapping: { findMany: () => Promise.resolve([]) },
    ahspResourceIdentityDecision: { findMany: () => Promise.resolve([]) },
    resourceIdentityQuestionDecision: {
      // Newest event per exact question, strict workspace equality — the preload's own shape.
      findMany: ({
        where,
      }: {
        where: { workspaceId: string; questionKey: { in: string[] } };
      }) => {
        const latest = new Map<string, LedgerEvent>();
        for (const event of ledger) {
          if (
            event.workspaceId !== where.workspaceId ||
            !where.questionKey.in.includes(event.questionKey)
          ) {
            continue;
          }
          const known = latest.get(event.questionKey);
          if (!known || event.generation > known.generation) {
            latest.set(event.questionKey, event);
          }
        }
        return Promise.resolve([...latest.values()]);
      },
    },
    observedResource: {
      findMany: ({
        where,
      }: {
        where: {
          workspaceId: string;
          status: string;
          sourceSha256: { in: string[] };
        };
      }) =>
        Promise.resolve(
          observed.filter(
            (row) =>
              row.workspaceId === where.workspaceId &&
              row.status === where.status &&
              row.sourceSha256 !== null &&
              where.sourceSha256.in.includes(row.sourceSha256),
          ),
        ),
    },
    aHSPVersion: {
      // Every stored version is lawful here; the eligibility law is proven on the database (e2e).
      findMany: ({
        where,
      }: {
        where: {
          AND: [{ id?: { in: string[] }; ahspId?: { in: string[] } }, unknown];
        };
      }) => {
        const [scope] = where.AND;
        return Promise.resolve(
          [...versions.values()].filter((version) =>
            scope.id
              ? scope.id.in.includes(version.id)
              : (scope.ahspId?.in ?? []).includes(version.ahsp.id),
          ),
        );
      },
    },
    basicPrice: {
      findMany: () => Promise.resolve([]),
      findFirst: () => Promise.resolve(null),
    },
    $transaction: <T>(callback: (tx: unknown) => Promise<T>): Promise<T> =>
      callback(client),
  };
  return { catalogs, sightings, ledger, observed, versions, writes, client };
}

describe('CLOSEOUT P1-A — complete for the AHSP stage is proven by the consumer, never by an empty queue', () => {
  let w: ReturnType<typeof world>;
  let journal: ReturnType<typeof inMemoryImportJournal>;
  let service: AhspDocumentCanonicalizationService;
  let identity: ResourceIdentityResolutionService;
  let orchestrator: AhspResourceResolutionOrchestrator;
  let keepObservations: boolean;
  const units = {
    resolve: jest.fn((raw: string) =>
      Promise.resolve({
        status: UNIT_RESOLUTION_STATUS.RESOLVED,
        sourceUnitDefinition: { id: `unit-${raw.toLowerCase()}` },
      }),
    ),
    resolveCanonicalUnitIdentities: jest.fn(() =>
      Promise.reject(
        new Error('no representation tie is expected in these fixtures'),
      ),
    ),
  };
  const ahspService = {
    create: jest.fn(),
    loadIdentitySurface: jest.fn(() => Promise.resolve([])),
  };
  const versionService = { createVersion: jest.fn() };
  const observeMany = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    w = world();
    keepObservations = true;
    journal = inMemoryImportJournal();
    identity = new ResourceIdentityResolutionService(
      null as never,
      units as never,
    );
    const queue = new ResourceObservationService(
      w.client as never,
      {} as never,
      units as never,
      identity,
      new GhxDecisionContextTokenService(),
    );
    // What the import asks to observe becomes the queue's OBSERVED rows — unless
    // a test needs a component that was never observed at all.
    observeMany.mockImplementation(
      (inputs: readonly ObserveResourceInput[]) => {
        if (keepObservations) {
          w.observed.push(
            ...inputs.map((input) => ({
              workspaceId: input.workspaceId,
              resourceType: input.resourceType,
              rawName: input.rawName,
              rawCode: input.rawCode ?? null,
              rawUnit: input.rawUnit ?? null,
              sourceSha256: input.provenance?.sourceSha256 ?? null,
              status: 'OBSERVED' as const,
            })),
          );
        }
        return Promise.resolve({ persisted: inputs.length });
      },
    );
    let parents = 0;
    ahspService.create.mockImplementation(() =>
      Promise.resolve({ id: `ahsp-${++parents}` }),
    );
    versionService.createVersion.mockImplementation(
      (
        ahspId: string,
        dto: {
          outputUnit: string;
          resources: Array<Omit<StoredVersion['resources'][number], 'id'>>;
        },
      ) => {
        const id = `ver-${w.versions.size + 1}`;
        w.versions.set(id, {
          id,
          versionNumber: 1,
          outputUnit: dto.outputUnit,
          ahsp: { id: ahspId },
          resources: dto.resources.map((resource, index) => ({
            id: `${id}-resource-${index + 1}`,
            resourceId: resource.resourceId,
            resourceType: resource.resourceType,
            coefficient: resource.coefficient,
            baseUnit: resource.baseUnit,
            rawName: resource.rawName,
            rawCode: resource.rawCode,
            rawUnit: resource.rawUnit,
          })),
        });
        return Promise.resolve({ id });
      },
    );
    service = new AhspDocumentCanonicalizationService(
      ...([
        ahspService,
        versionService,
        units,
        identity,
        w.client,
        {
          observeMany,
          openQuestionsBySource: (
            workspaceId: string,
            sourceSha256s: readonly string[],
          ) => queue.openQuestionsBySource(workspaceId, sourceSha256s),
        },
        new RealityNormalizationEngine(),
        { logAction: jest.fn(() => Promise.resolve()) },
        journal,
      ] as unknown as Dependencies),
    );
    orchestrator = new AhspResourceResolutionOrchestrator(
      { usableWhere: () => ({}) } as never,
      units as never,
      identity,
    );
  });

  const commit = async (
    workspaceId: string,
    workType: string,
    components: readonly Component[],
  ) =>
    service.commit(
      service.sealUpload({
        bytes: await analysis(workType, components),
        fileName: `${workType}.xlsx`,
        mediaType: null,
        workspaceId,
        organizationId: '22222222-2222-4222-8222-222222222222',
        actorAccountId: '33333333-3333-4333-8333-333333333333',
      }),
      'user-1',
    );
  const completionOf = async (workspaceId: string, importJobId: string) => {
    const job = (await service.listImportJobs(workspaceId)).items.find(
      (candidate) => candidate.importJobId === importJobId,
    );
    if (!job)
      throw new Error(`job ${importJobId} is not listed in ${workspaceId}`);
    return job.completion;
  };
  /** Per resource of the version: does the resolver that CONSUMES it identify it? */
  const consumerIdentifies = async (workspaceId: string, versionId: string) => {
    const version = w.versions.get(versionId);
    if (!version) throw new Error(`no version ${versionId}`);
    const loadEvidence = jest.spyOn(identity, 'loadEvidence');
    const resolve = jest.spyOn(identity, 'resolve');
    try {
      await orchestrator.resolveVersionResources(w.client, {
        workspaceId,
        projectId: 'project-1',
        referenceRegionId: 'region-1',
        asOf: new Date('2026-09-15T00:00:00.000Z'),
        version,
      });
      const evidence = (await loadEvidence.mock.results[0]
        .value) as ResourceIdentityEvidence;
      const verdicts = await Promise.all(
        resolve.mock.results.map(
          (result) => result.value as Promise<ResourceIdentityResolution>,
        ),
      );
      return verdicts.map(
        (verdict) =>
          verdict.status === 'RESOLVED' &&
          evidence.catalogCandidates.some(
            (candidate) => candidate.id === verdict.resolvedResourceCatalogId,
          ),
      );
    } finally {
      loadEvidence.mockRestore();
      resolve.mockRestore();
    }
  };
  const approve = (question: Question, generation = 2): LedgerEvent => ({
    workspaceId: question.workspaceId,
    id: `approve-${generation}-${question.workspaceId}`,
    questionKey: identicalQuestionKey(question),
    generation,
    action: 'APPROVE',
    selectedResourceCatalogId: null,
    candidateContextDigest: null,
    resolutionPolicyVersion: null,
    decidedByAccountId: 'acct-second-holder',
    decidedAt: new Date('2026-09-15T09:00:00.000Z'),
    previousDecision: {
      id: `teach-1-${question.workspaceId}`,
      generation: generation - 1,
      action: 'TEACH',
      selectedResourceCatalogId: KERIKIL.id,
      candidateContextDigest: DIGEST,
      resolutionPolicyVersion: IQL01_IDENTICAL_QUESTION_POLICY_VERSION,
      decidedByAccountId: 'acct-curator',
      reason: null,
      originObservation: question,
    },
  });
  const revoke = (question: Question, generation = 3): LedgerEvent => ({
    ...approve(question, generation - 1),
    id: `revoke-${generation}-${question.workspaceId}`,
    generation,
    action: 'REVOKE',
  });
  /** Everything a GET could possibly write, counted. */
  const writesSoFar = () => ({
    world: [...w.writes],
    settled: journal.settleLine.mock.calls.length,
    parents: ahspService.create.mock.calls.length,
    versions: w.versions.size,
    observed: observeMany.mock.calls.length,
    queue: w.observed.map((row) => row.status),
    ledger: w.ledger.length,
  });

  it('(3) a recipe whose every component the identity authority proves by itself is complete — no human decision, no question', async () => {
    w.catalogs.push(PEKERJA, MANDOR, SEMEN);
    const result = await commit(WS_A, 'P1A.3', [
      { name: 'Semen Portland', code: 'M01', unit: 'Kg' },
    ]);
    expect(result.summary).toMatchObject({ ready: 1, identityPending: 0 });
    expect(await completionOf(WS_A, result.importJobId)).toEqual({
      complete: 1,
      awaitingIdentity: 0,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 0, uses: 0 },
    });
    expect(await consumerIdentifies(WS_A, result.written[0].versionId)).toEqual(
      [true, true, true],
    );
    expect(w.observed).toEqual([]);
    expect(w.ledger).toEqual([]);
  });

  it('(1) a question closed by a curation that taught nothing leaves the queue — the recipe keeps the source wording, the consumer cannot identify it, and it is not complete', async () => {
    w.catalogs.push(PEKERJA, MANDOR, KERIKIL);
    const result = await commit(WS_A, 'P1A.1', [AGREGAT]);
    expect(result.written).toEqual([
      expect.objectContaining({
        admission: 'IDENTITY_PENDING',
        identityPendingResources: 1,
      }),
    ]);
    const { versionId } = result.written[0];
    expect(
      w.versions
        .get(versionId)
        ?.resources.map((resource) => resource.resourceId),
    ).toEqual([PEKERJA.id, MANDOR.id, 'Agregat kasar']);
    expect(await completionOf(WS_A, result.importJobId)).toMatchObject({
      complete: 0,
      awaitingIdentity: 1,
      identityQuestions: { questions: 1, uses: 1 },
    });

    // curateExisting WITHOUT "remember for identical questions" records the choice
    // on the observation only — RESOLVED_EXISTING (the real flow is proven against
    // the database in the acceptance e2e, SCENARIO 14): the row stops being
    // OBSERVED, so the question leaves the queue. Nothing else changes.
    const writesBefore = writesSoFar();
    for (const row of w.observed) row.status = 'RESOLVED_EXISTING';
    const closed = await completionOf(WS_A, result.importJobId);
    expect(closed.identityQuestions).toEqual({ questions: 0, uses: 0 });
    expect(closed).toMatchObject({ complete: 0, awaitingIdentity: 1 });
    expect(await consumerIdentifies(WS_A, versionId)).toEqual([
      true,
      true,
      false,
    ]);
    expect(writesSoFar()).toEqual({
      ...writesBefore,
      queue: ['RESOLVED_EXISTING'],
    });
  });

  it('(2) a component that was never observed is not a proof either — no visible question, still not complete', async () => {
    w.catalogs.push(PEKERJA, MANDOR, KERIKIL);
    keepObservations = false;
    const result = await commit(WS_A, 'P1A.2', [AGREGAT]);
    expect(result.summary).toMatchObject({ identityPending: 1 });
    expect(w.observed).toEqual([]);
    expect(await completionOf(WS_A, result.importJobId)).toEqual({
      complete: 0,
      awaitingIdentity: 1,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 0, uses: 0 },
    });
    expect(await consumerIdentifies(WS_A, result.written[0].versionId)).toEqual(
      [true, true, false],
    );
  });

  it('(4) an APPROVED exact-question answer completes the recipe while it is effective; once REVOKED it is incomplete again — and no read writes anything', async () => {
    w.catalogs.push(PEKERJA, MANDOR, KERIKIL);
    const result = await commit(WS_A, 'P1A.4', [AGREGAT]);
    const { versionId } = result.written[0];
    const question = questionOf(WS_A, AGREGAT);
    const writesBefore = writesSoFar();
    expect(await completionOf(WS_A, result.importJobId)).toMatchObject({
      complete: 0,
      awaitingIdentity: 1,
      identityQuestions: { questions: 1, uses: 1 },
    });

    w.ledger.push(approve(question));
    expect(await completionOf(WS_A, result.importJobId)).toEqual({
      complete: 1,
      awaitingIdentity: 0,
      recipeNotUsable: 0,
      writtenUnitQuestions: [],
      // The queue's own projection: the kernel proves the question today, so it is not asked.
      identityQuestions: { questions: 0, uses: 0 },
    });
    expect(await consumerIdentifies(WS_A, versionId)).toEqual([
      true,
      true,
      true,
    ]);

    w.ledger.push(revoke(question));
    expect(await completionOf(WS_A, result.importJobId)).toMatchObject({
      complete: 0,
      awaitingIdentity: 1,
      identityQuestions: { questions: 1, uses: 1 },
    });
    expect(await consumerIdentifies(WS_A, versionId)).toEqual([
      true,
      true,
      false,
    ]);

    // The recipe still holds the source's wording: nothing was rewritten by any read.
    expect(w.versions.get(versionId)?.resources[2].resourceId).toBe(
      'Agregat kasar',
    );
    expect(writesSoFar()).toEqual({ ...writesBefore, ledger: 2 });
  });

  it('(5) two documents asking the same question are both answered by one answer — and another workspace asking it is not', async () => {
    w.catalogs.push(PEKERJA, MANDOR, KERIKIL);
    const first = await commit(WS_A, 'P1A.5a', [AGREGAT]);
    const second = await commit(WS_A, 'P1A.5b', [AGREGAT]);
    const elsewhere = await commit(WS_B, 'P1A.5c', [AGREGAT]);
    w.ledger.push(approve(questionOf(WS_A, AGREGAT)));

    for (const job of [first, second]) {
      expect(await completionOf(WS_A, job.importJobId)).toMatchObject({
        complete: 1,
        awaitingIdentity: 0,
        identityQuestions: { questions: 0, uses: 0 },
      });
    }
    expect(await completionOf(WS_B, elsewhere.importJobId)).toMatchObject({
      complete: 0,
      awaitingIdentity: 1,
      identityQuestions: { questions: 1, uses: 1 },
    });
    expect(
      await consumerIdentifies(WS_B, elsewhere.written[0].versionId),
    ).toEqual([true, true, false]);
    // A workspace never lists another workspace's import.
    expect(
      (await service.listImportJobs(WS_A)).items.map((job) => job.importJobId),
    ).not.toContain(elsewhere.importJobId);
  });

  it.each<[string, Partial<Component>]>([
    ['another code', { code: 'M04' }],
    ['another name', { name: 'Agregat halus' }],
    ['another unit', { unit: 'Kg' }],
    ['another class', { group: 'EQUIPMENT' }],
  ])(
    '(5) an answer to one exact question never closes a near-miss with %s — in the queue or in the recipe',
    async (_label, change) => {
      w.catalogs.push(PEKERJA, MANDOR, KERIKIL);
      const answered = await commit(WS_A, 'P1A.5d', [AGREGAT]);
      const nearMiss = await commit(WS_A, 'P1A.5e', [
        { ...AGREGAT, ...change },
      ]);
      expect(nearMiss.summary).toMatchObject({ identityPending: 1 });
      w.ledger.push(approve(questionOf(WS_A, AGREGAT)));

      expect(await completionOf(WS_A, answered.importJobId)).toMatchObject({
        complete: 1,
        identityQuestions: { questions: 0, uses: 0 },
      });
      expect(await completionOf(WS_A, nearMiss.importJobId)).toMatchObject({
        complete: 0,
        awaitingIdentity: 1,
        identityQuestions: { questions: 1, uses: 1 },
      });
      expect(
        await consumerIdentifies(WS_A, nearMiss.written[0].versionId),
      ).toEqual([true, true, false]);
    },
  );

  it('(6) an AHSP line pointing to no lawful recipe is not complete, whatever the queue says', async () => {
    w.catalogs.push(PEKERJA, MANDOR, SEMEN);
    const result = await commit(WS_A, 'P1A.6', [
      { name: 'Semen Portland', code: 'M01', unit: 'Kg' },
    ]);
    // The version the line points to is no longer offered under the eligibility law.
    w.versions.clear();
    expect(await completionOf(WS_A, result.importJobId)).toEqual({
      complete: 0,
      awaitingIdentity: 0,
      recipeNotUsable: 1,
      writtenUnitQuestions: [],
      identityQuestions: { questions: 0, uses: 0 },
    });
  });

  it('CONSUMER EQUIVALENCE: the completion view asks the identity authority exactly what the consuming resolver asks — same evidence scope, same subjects, same facts', async () => {
    w.catalogs.push(PEKERJA, MANDOR, KERIKIL, SEMEN);
    const result = await commit(WS_A, 'P1A.EQ', [
      AGREGAT,
      { name: 'Semen Portland', code: 'M01', unit: 'Kg' },
    ]);
    const version = w.versions.get(result.written[0].versionId);
    if (!version) throw new Error('no version written');
    const loadEvidence = jest.spyOn(identity, 'loadEvidence');
    const resolve = jest.spyOn(identity, 'resolve');
    // Only the recipe questions: those carry the version's GHX subjects.
    const asked = () => ({
      evidence: loadEvidence.mock.calls
        .filter(([, , subjects]) => subjects !== undefined)
        .map(([, workspaceId, subjects, options]) => [
          workspaceId,
          subjects,
          options,
        ]),
      questions: resolve.mock.calls
        .filter(([evidence]) => evidence.ghxSubject !== undefined)
        .map(([evidence, reference]) => [evidence.ghxSubject, reference]),
    });

    await service.listImportJobs(WS_A);
    const completionAsked = asked();
    loadEvidence.mockClear();
    resolve.mockClear();
    await orchestrator.resolveVersionResources(w.client, {
      workspaceId: WS_A,
      projectId: 'project-1',
      referenceRegionId: 'region-1',
      asOf: new Date('2026-09-15T00:00:00.000Z'),
      version,
    });
    const consumerAsked = asked();
    loadEvidence.mockRestore();
    resolve.mockRestore();

    expect(completionAsked.questions).toHaveLength(version.resources.length);
    expect(completionAsked).toEqual(consumerAsked);
  });
});

import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { GhxDecisionContextTokenService } from './ghx-decision-context-token.service';
import { ResourceAdmissionService } from './resource-admission.service';
import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';
import { ResourceObservationService } from './resource-observation.service';

/**
 * AHSP IMPORT ACCEPTANCE BOUNDARY — THE IDENTITY LAW THIS SLICE MUST NOT MOVE.
 *
 * Everything below runs through the REAL Resource Identity service, the REAL
 * kernel, the REAL admission authority and the REAL observation lifecycle. Only
 * storage is in memory. D-2 is on HOLD, so the ruled-out anchors are permanent:
 * import acceptance is solved by preserving source truth, never by loosening
 * who may mint.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const PIPE_4 = '0b6f4b8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

type CatalogRow = {
  id: string;
  workspaceId: string;
  code: string | null;
  name: string;
  type: string;
  baseUnit: string;
  status: string;
  specifications: unknown;
};

type ObservationRow = {
  id: string;
  workspaceId: string;
  status: string;
  rawName: string;
  rawCode: string | null;
  rawUnit: string | null;
  resourceType: string;
  sourceSha256: string;
  sourceFileName: string;
  parserContractVersion: string;
  sheetName: string;
  sourceRowNumber: number;
  sourceNameCellAddress: string;
  sourceCodeCellAddress: string | null;
  sourceUnitCellAddress: string | null;
  [field: string]: unknown;
};

type Where = { id?: string; workspaceId?: string; status?: string };

function inMemoryWorkspace(
  catalog: CatalogRow[],
  observations: ObservationRow[],
) {
  let minted = 0;
  const client = {
    resourceCatalog: {
      findMany: jest.fn(() =>
        Promise.resolve(catalog.map((row) => ({ ...row }))),
      ),
      findFirst: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          catalog.find(
            (row) => row.id === where.id && row.status === 'ACTIVE',
          ) ?? null,
        ),
      ),
      create: jest.fn(({ data }: { data: Partial<CatalogRow> }) => {
        minted += 1;
        const row: CatalogRow = {
          id: `00000000-0000-4000-8000-${String(minted).padStart(12, '0')}`,
          workspaceId: WS,
          name: '',
          type: 'MATERIAL',
          baseUnit: '',
          status: 'ACTIVE',
          specifications: null,
          code: null,
          ...data,
        };
        catalog.push(row);
        return Promise.resolve(row);
      }),
    },
    resourceSourceIdentity: {
      findMany: jest.fn(() => Promise.resolve([])),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `rsi-${minted}`, ...data }),
      ),
    },
    basicPriceImportRowResourceMapping: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    observedResource: {
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          observations.filter(
            (row) =>
              row.workspaceId === where.workspaceId &&
              row.status === where.status,
          ),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(
          observations.find(
            (row) =>
              row.id === where.id && row.workspaceId === where.workspaceId,
          ) ?? null,
        ),
      ),
      update: jest.fn(
        ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
          const row = observations.find(
            (candidate) => candidate.id === where.id,
          );
          if (!row) return Promise.reject(new Error('OBSERVATION_NOT_FOUND'));
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
    },
    unitDefinition: {
      findFirst: jest.fn(() =>
        Promise.resolve({ id: 'unit-m', code: 'M', isActive: true }),
      ),
    },
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    $transaction: (fn: (tx: unknown) => unknown): unknown => fn(client),
  };
  return client;
}

type InMemoryWorkspace = ReturnType<typeof inMemoryWorkspace>;
const asPrisma = (client: InMemoryWorkspace) =>
  client as unknown as PrismaService;

const unitKernel = {
  resolve: jest.fn(() =>
    Promise.resolve({
      status: 'RESOLVED',
      sourceUnitDefinition: { id: 'unit-m', code: 'M' },
      // A RESOLVED proof from the real kernel always states its price operation:
      // IDENTITY when the two spellings are the same canonical unit. Admission now
      // requires that, so the fixture states what the kernel would actually return.
      priceOperation: 'IDENTITY',
      quantityFactor: '1',
    }),
  ),
  resolveCanonicalUnitIdentities: jest.fn(() => Promise.resolve([])),
} as unknown as UnitKernelService;

function observation(
  id: string,
  rawName: string,
  rowNumber: number,
): ObservationRow {
  return {
    id,
    workspaceId: WS,
    status: 'OBSERVED',
    rawName,
    rawCode: null,
    rawUnit: "M'",
    resourceType: 'MATERIAL',
    sourceSha256: 'a'.repeat(64),
    sourceFileName: 'bina-marga.xlsx',
    parserContractVersion: 'XLSX_EXCELJS_V1',
    sheetName: 'Sheet1',
    sourceRowNumber: rowNumber,
    sourceNameCellAddress: `C${rowNumber}`,
    sourceCodeCellAddress: null,
    sourceUnitCellAddress: `E${rowNumber}`,
  };
}

function services(client: InMemoryWorkspace) {
  const identity = new ResourceIdentityResolutionService(
    asPrisma(client),
    unitKernel,
  );
  const admission = new ResourceAdmissionService(identity);
  const lifecycle = new ResourceObservationService(
    asPrisma(client),
    admission,
    unitKernel,
    identity,
    new GhxDecisionContextTokenService(),
  );
  return { identity, admission, lifecycle };
}

describe('Import acceptance — identity law that stays locked', () => {
  const pipe4: CatalogRow = {
    id: PIPE_4,
    workspaceId: WS,
    code: 'M25a',
    name: 'Pipa porous diameter 4"',
    type: 'MATERIAL',
    baseUnit: "M'",
    status: 'ACTIVE',
    specifications: null,
  };

  it('B0-5 / B9: a 6" source can NEVER be bound to the 4" row — the existing choice is refused by the real kernel', async () => {
    const rows = [observation('obs-6', 'Pipa porous diameter 6"', 2455)];
    const client = inMemoryWorkspace([{ ...pipe4 }], rows);
    const { lifecycle } = services(client);

    await expect(
      lifecycle.curateExisting({
        workspaceId: WS,
        observationId: 'obs-6',
        selectedResourceCatalogId: PIPE_4,
        actorAccountId: 'acct-1',
      }),
    ).rejects.toThrow(new ConflictException('IDENTITY_CANDIDATE_RULED_OUT'));
    expect(rows[0].status).toBe('OBSERVED');
    expect(rows[0].resolvedResourceCatalogId).toBeUndefined();
  });

  it('B0-6 / B9: a ruled-out-only 6" is still NOT mintable as new — current admission law is unchanged (D-2 HOLD)', async () => {
    const catalog = [{ ...pipe4 }];
    const rows = [observation('obs-6', 'Pipa porous diameter 6"', 2455)];
    const client = inMemoryWorkspace(catalog, rows);
    const { identity, lifecycle } = services(client);

    const evidence = await identity.loadEvidence(asPrisma(client), WS);
    const verdict = await identity.resolve(evidence, {
      rawName: 'Pipa porous diameter 6"',
      rawCode: null,
      rawUnit: "M'",
      resourceType: 'MATERIAL',
    });
    expect(verdict.status).toBe('UNRESOLVED');
    expect(verdict.reasonCodes).toEqual(['SPECIFICATION_CONFLICT']);
    expect(ResourceAdmissionService.isIdentityExhausted(verdict)).toBe(false);

    await expect(
      lifecycle.curateNew({
        workspaceId: WS,
        observationId: 'obs-6',
        unitDefinitionId: 'unit-m',
        actorAccountId: 'acct-1',
      }),
    ).rejects.toThrow(new ConflictException('RESOURCE_IDENTITY_NOT_EXHAUSTED'));
    expect(catalog).toHaveLength(1);
    expect(rows[0].status).toBe('OBSERVED');
  });

  it('B6: once one admission proves a repeated question, its twins leave the curation list — unwritten, still OBSERVED', async () => {
    const catalog: CatalogRow[] = [];
    const rows = [
      observation('obs-a', 'Alat Bantu', 27),
      observation('obs-b', 'Alat Bantu', 71),
    ];
    const client = inMemoryWorkspace(catalog, rows);
    const { lifecycle } = services(client);

    // Before: one question, asked twice, genuinely new.
    const before = await lifecycle.listOpenForCuration(WS);
    expect(before.map((row) => row.id).sort()).toEqual(['obs-a', 'obs-b']);
    expect(before.every((row) => row.identityVerdict.exhausted)).toBe(true);

    // ONE human decision.
    await lifecycle.curateNew({
      workspaceId: WS,
      observationId: 'obs-a',
      unitDefinitionId: 'unit-m',
      actorAccountId: 'acct-1',
    });

    // The machine now proves the twin by exact name: it is not asked again...
    expect(await lifecycle.listOpenForCuration(WS)).toEqual([]);
    // ...and nothing was written on the human's behalf: OBSERVED means "seen".
    expect(rows[1]).toMatchObject({ status: 'OBSERVED' });
    expect(rows[1].decidedByAccountId).toBeUndefined();
    expect(rows[1].resolvedResourceCatalogId).toBeUndefined();
    expect(client.observedResource.update).toHaveBeenCalledTimes(1);

    // A change in catalogue truth brings the question straight back.
    catalog[0].status = 'RETIRED';
    expect(
      (await lifecycle.listOpenForCuration(WS)).map((row) => row.id),
    ).toEqual(['obs-b']);
  });

  it('B0-7 (law kept, D-2 HOLD): admitting row by row — the second admission is refused because the first already exists', async () => {
    const catalog: CatalogRow[] = [];
    const rows = [
      observation('obs-a', 'Alat Bantu', 27),
      observation('obs-b', 'Alat Bantu', 71),
    ];
    const client = inMemoryWorkspace(catalog, rows);
    const { lifecycle } = services(client);

    await lifecycle.curateNew({
      workspaceId: WS,
      observationId: 'obs-a',
      unitDefinitionId: 'unit-m',
      actorAccountId: 'acct-1',
    });
    expect(catalog).toHaveLength(1);

    await expect(
      lifecycle.curateNew({
        workspaceId: WS,
        observationId: 'obs-b',
        unitDefinitionId: 'unit-m',
        actorAccountId: 'acct-1',
      }),
    ).rejects.toThrow(new ConflictException('RESOURCE_IDENTITY_NOT_EXHAUSTED'));
    expect(catalog).toHaveLength(1);
  });

  it('B10: generic "Kerikil / Agregat" is never proven as a specific row, and silence is never a conflict', async () => {
    const catalog: CatalogRow[] = [
      {
        ...pipe4,
        id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        code: 'M03',
        name: 'Kerikil 2-3 cm',
        baseUnit: 'M3',
      },
      {
        ...pipe4,
        id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
        code: 'M04',
        name: 'Agregat Kasar',
        baseUnit: 'M3',
      },
    ];
    const client = inMemoryWorkspace(catalog, []);
    const { identity } = services(client);
    const evidence = await identity.loadEvidence(asPrisma(client), WS);
    const verdict = await identity.resolve(evidence, {
      rawName: 'Kerikil / Agregat',
      rawCode: null,
      rawUnit: 'M3',
      resourceType: 'MATERIAL',
    });
    expect(verdict.status).not.toBe('RESOLVED');
    expect(verdict.resolvedResourceCatalogId).toBeNull();
    expect(verdict.reasonCodes).not.toContain('SPECIFICATION_CONFLICT');
    const sized = verdict.candidates.find(
      (candidate) => candidate.name === 'Kerikil 2-3 cm',
    );
    if (sized) {
      // The size is the catalogue's claim, not the source's — named, never adopted.
      expect(sized.specificationUnproved).toBe(true);
    }
  });
});

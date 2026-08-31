import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, ResourceType } from '@prisma/client';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { BasicPriceRowResolutionProposalService } from './basic-price-row-resolution-proposal.service';

describe('BasicPriceRowResolutionService', () => {
  let service: BasicPriceRowResolutionService;
  let tx: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    basicPriceImportRow: {
      findFirst: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    basicPriceImportBatch: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    resourceCatalog: { findFirst: jest.Mock; findMany: jest.Mock };
    unitDefinition: { findFirst: jest.Mock };
    basicPriceImportRowResourceMapping: { create: jest.Mock; findMany: jest.Mock };
    basicPriceSourceEquivalence: { findUnique: jest.Mock };
    resourceSourceIdentity: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };
  let unitKernel: { resolve: jest.Mock };

  /**
   * Evidence the REAL ResourceIdentityResolutionService loads. These tests use
   * the genuine authority — not a stub of it — so "admission is forbidden when
   * SIMPROK already knows this resource" is proved by the same kernel the
   * Golden Thread runs, and can never drift from it.
   */
  let identityCatalogRows: Array<Record<string, unknown>> = [];
  let identitySightingRows: Array<Record<string, unknown>> = [];
  let identityMappingRows: Array<Record<string, unknown>> = [];

  const WORKSPACE_ID = 'ws-01';
  const BATCH_ID = 'batch-01';
  const ROW_ID = 'row-01';
  const REVIEWER_ID = 'reviewer-01';

  const baseBatch = {
    id: BATCH_ID,
    workspaceId: WORKSPACE_ID,
    sourceSha256: 'batch-sha',
    selectedSheetName: 'HARGA SATUAN UPAH DAN BAHAN',
    parserContractVersion: 'RM02_BASIC_PRICE_01_V1',
    // The uploader IS the reviewer in these tests — resolveRow/rejectRow are
    // user-owned import boundary actions, so the caller (REVIEWER_ID) must
    // be the batch's uploadedByAccountId for the happy-path tests below.
    uploadedByAccountId: REVIEWER_ID,
  };

  const baseRow = {
    id: ROW_ID,
    batchId: BATCH_ID,
    version: 0,
    status: 'NEEDS_REVIEW',
    proposedCanonicalPrice: { toString: () => '100.00' },
    resourceCatalogId: null,
    unitDefinitionId: null,
    sourceSection: 'MATERIAL',
    sourceSectionProvenance: null as string | null,
    sourceRowNumber: 33,
    rawResourceCodeText: null,
    rawResourceNameText: 'Semen Portland',
    rawUnitText: 'Zak',
  };

  // Default: no normalized-name candidate matches anything (MANUAL_SEARCH), no equivalence record (fail-closed provenance).
  let candidateRows: Array<{
    resourceCatalogId: string;
    code: string | null;
    name: string;
    type: string;
    baseUnit: string;
  }> = [];

  beforeEach(async () => {
    candidateRows = [];
    identityCatalogRows = [];
    identitySightingRows = [];
    identityMappingRows = [];
    tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(async () => 1),
      basicPriceImportRow: {
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      basicPriceImportBatch: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      resourceCatalog: {
        findFirst: jest.fn(),
        findMany: jest.fn(async () => identityCatalogRows),
      },
      unitDefinition: { findFirst: jest.fn() },
      basicPriceImportRowResourceMapping: {
        create: jest.fn(),
        findMany: jest.fn(async () => identityMappingRows),
      },
      basicPriceSourceEquivalence: { findUnique: jest.fn() },
      resourceSourceIdentity: {
        findFirst: jest.fn(),
        findMany: jest.fn(async () => identitySightingRows),
      },
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(tx),
      ),
    };
    // Default: the unit authority CAN represent the chosen canonical unit, AND
    // the chosen unit is the source document's own unit (identity — no price
    // arithmetic implied). Test 10 flips the first; the TRUSTED UNIT CONTEXT
    // blocks flip the second. The shape mirrors UnitResolutionResult, including
    // `priceOperation` and the echoed spellings, because the service now reads
    // those fields — a fixture omitting them would let a regression pass.
    unitKernel = {
      resolve: jest.fn((rawSourceUnit: string, rawTargetUnit: string) =>
        Promise.resolve({
          status: 'RESOLVED',
          rawSourceUnit,
          rawTargetUnit,
          priceOperation: 'IDENTITY',
          policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1',
          reasonCodes: ['EXACT_UNIT_ALIAS_EQUIVALENCE', 'EXACT_UNIT_IDENTITY'],
          explanation:
            'Kedua alias menunjuk identitas unit canonical yang sama.',
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPriceRowResolutionService,
        { provide: PrismaService, useValue: prisma },
        // The REAL identity authority over mocked evidence — never a stub of
        // the decision itself.
        ResourceIdentityResolutionService,
        { provide: UnitKernelService, useValue: unitKernel },
        // THE SEAM ONTO THE CANONICAL AUTHORITIES — the ONE place this suite
        // says what the machine offered the reviewer.
        //
        // The audit fields used to be computed from `findMappingCandidates`, a
        // second matcher testing exact normalized-name equality, and these
        // tests seeded it through the raw-SQL branch above. They now seed the
        // CANONICAL proposal instead — the same verdict the review room
        // renders — because an audit trail must describe the screen a human
        // actually saw. `candidateRows` keeps its meaning: 'what SIMPROK put in
        // front of them'. Only who says it has changed.
        {
          provide: BasicPriceRowResolutionProposalService,
          useValue: {
            proposeForRows: jest.fn((_ws: string, rows: { id: string }[]) => {
              const byRow = new Map<string, unknown>();
              for (const row of rows) {
                byRow.set(row.id, {
                  rowId: row.id,
                  resource: {
                    status: 'NEEDS_REVIEW',
                    resourceCatalogId: null,
                    candidates: candidateRows,
                  },
                });
              }
              return Promise.resolve(byRow);
            }),
          },
        },
      ],
    }).compile();

    service = module.get<BasicPriceRowResolutionService>(
      BasicPriceRowResolutionService,
    );

    // Default happy-path stubs; individual tests override as needed.
    tx.$queryRaw.mockImplementation(
      (query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches'))
          return Promise.resolve([baseBatch]);
        if (sql.includes('basic_price_import_rows'))
          return Promise.resolve([baseRow]);
        if (sql.includes('resource_catalogs'))
          return Promise.resolve(candidateRows);
        return Promise.resolve([]);
      },
    );
    tx.resourceCatalog.findFirst.mockResolvedValue({
      id: 'resource-01',
      type: 'MATERIAL',
    });
    // The unit's `code` is load-bearing now: it is the target spelling the
    // Unit Kernel is asked to prove the row's raw source unit against.
    tx.unitDefinition.findFirst.mockResolvedValue({
      id: 'unit-01',
      code: 'ZAK',
    });
    tx.basicPriceImportRow.findFirst.mockResolvedValue(null); // no collision by default
    tx.basicPriceImportRow.count.mockResolvedValue(0); // no other NEEDS_REVIEW rows -> batch can advance
    tx.basicPriceImportBatch.findUniqueOrThrow.mockResolvedValue({
      id: BATCH_ID,
      status: 'NEEDS_REVIEW',
    });
    tx.basicPriceImportRow.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        ...baseRow,
        ...data,
      }),
    );
    tx.basicPriceSourceEquivalence.findUnique.mockResolvedValue(null); // fail-closed default: no equivalence record
  });

  it('throws NotFound when the batch does not belong to the caller workspace', async () => {
    tx.$queryRaw.mockImplementation(
      (query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches'))
          return Promise.resolve([
            { ...baseBatch, workspaceId: 'other-workspace' },
          ]);
        return Promise.resolve([baseRow]);
      },
    );
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'r',
        unitDefinitionId: 'u',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a stale version (optimistic concurrency, test matrix I06)', async () => {
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 99,
        resourceCatalogId: 'r',
        unitDefinitionId: 'u',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
  });

  it('rejects resolving a row that is not NEEDS_REVIEW (already resolved/rejected/submitted)', async () => {
    tx.$queryRaw.mockImplementation(
      (query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches'))
          return Promise.resolve([baseBatch]);
        return Promise.resolve([{ ...baseRow, status: 'SUBMISSION_CREATED' }]);
      },
    );
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'r',
        unitDefinitionId: 'u',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves cleanly to READY_FOR_SUBMISSION when the resource/unit exist and no collision is found', async () => {
    const result = await service.resolveRow(
      WORKSPACE_ID,
      BATCH_ID,
      ROW_ID,
      REVIEWER_ID,
      {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      },
    );

    expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceCatalogId: 'resource-01',
          unitDefinitionId: 'unit-01',
          collisionType: 'NONE',
          resolutionStatus: 'RESOLVED',
          status: 'READY_FOR_SUBMISSION',
          resolvedByAccountId: REVIEWER_ID,
          version: { increment: 1 },
        }),
      }),
    );
    expect(result.status).toBe('READY_FOR_SUBMISSION');
    expect(tx.resourceCatalog.findFirst).toHaveBeenCalledWith({
      where: { id: 'resource-01', workspaceId: WORKSPACE_ID, status: 'ACTIVE' },
    });
    expect(tx.unitDefinition.findFirst).toHaveBeenCalledWith({
      where: { id: 'unit-01', isActive: true },
    });
  });

  it('a same-identity, same-value collision with another row in the batch stays NEEDS_REVIEW, never auto-submits', async () => {
    tx.basicPriceImportRow.findFirst.mockResolvedValue({
      id: 'other-row',
      proposedCanonicalPrice: { toString: () => '100.00' },
    });

    const result = await service.resolveRow(
      WORKSPACE_ID,
      BATCH_ID,
      ROW_ID,
      REVIEWER_ID,
      {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      },
    );

    expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collisionType: 'SAME_IDENTITY_SAME_VALUE',
          collisionOfRowId: 'other-row',
          status: 'NEEDS_REVIEW',
        }),
      }),
    );
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('a same-identity, different-value collision is flagged distinctly and also stays NEEDS_REVIEW', async () => {
    tx.basicPriceImportRow.findFirst.mockResolvedValue({
      id: 'other-row',
      proposedCanonicalPrice: { toString: () => '999.00' },
    });

    const result = await service.resolveRow(
      WORKSPACE_ID,
      BATCH_ID,
      ROW_ID,
      REVIEWER_ID,
      {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      },
    );

    expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collisionType: 'SAME_IDENTITY_DIFFERENT_VALUE',
        }),
      }),
    );
    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('rejects resolving to an unknown resourceCatalogId (fail closed, never a fabricated identity)', async () => {
    tx.resourceCatalog.findFirst.mockResolvedValue(null);
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'ghost',
        unitDefinitionId: 'unit-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
  });

  it('rejects resolving to an unknown unitDefinitionId', async () => {
    tx.unitDefinition.findFirst.mockResolvedValue(null);
    await expect(
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'ghost',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['cross-workspace', 'global', 'inactive'])(
    'rejects a %s resource without writing the row',
    async () => {
      tx.resourceCatalog.findFirst.mockResolvedValue(null);
      await expect(
        service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
          version: 0,
          resourceCatalogId: 'resource-blocked',
          unitDefinitionId: 'unit-01',
        }),
      ).rejects.toThrow('RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE');
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
    },
  );

  it.each(['inactive', 'unknown'])(
    'rejects an %s unit without writing the row',
    async () => {
      tx.unitDefinition.findFirst.mockResolvedValue(null);
      await expect(
        service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
          version: 0,
          resourceCatalogId: 'resource-01',
          unitDefinitionId: 'unit-blocked',
        }),
      ).rejects.toThrow('UNIT_UNKNOWN_OR_INACTIVE');
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
    },
  );

  it('reject() requires a version match and records the reason', async () => {
    const result = await service.rejectRow(
      WORKSPACE_ID,
      BATCH_ID,
      ROW_ID,
      REVIEWER_ID,
      { version: 0, reason: 'wrong resource, superseded by row 12' },
    );
    expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          reasonCodes: {
            push: 'REJECTED:wrong resource, superseded by row 12',
          },
        }),
      }),
    );
    expect(result.status).toBe('REJECTED');
  });

  it('reject() fails closed on a stale version', async () => {
    await expect(
      service.rejectRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 7,
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('USER-OWNED IMPORT BOUNDARY (ownership enforcement)', () => {
    it("resolveRow: a same-workspace account that did not upload this batch is denied (404), never resolving on someone else's behalf", async () => {
      await expect(
        service.resolveRow(
          WORKSPACE_ID,
          BATCH_ID,
          ROW_ID,
          'another-account-in-same-workspace',
          {
            version: 0,
            resourceCatalogId: 'resource-01',
            unitDefinitionId: 'unit-01',
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
    });

    it('rejectRow: a same-workspace account that did not upload this batch is denied (404)', async () => {
      await expect(
        service.rejectRow(
          WORKSPACE_ID,
          BATCH_ID,
          ROW_ID,
          'another-account-in-same-workspace',
          { version: 0, reason: 'x' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
    });
  });

  it('advances the batch to READY_FOR_REVIEW only when zero rows remain NEEDS_REVIEW', async () => {
    tx.basicPriceImportRow.count.mockResolvedValue(0);
    await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
      version: 0,
      resourceCatalogId: 'resource-01',
      unitDefinitionId: 'unit-01',
    });
    expect(tx.basicPriceImportBatch.update).toHaveBeenCalledWith({
      where: { id: BATCH_ID },
      data: { status: 'READY_FOR_REVIEW' },
    });
  });

  it('leaves the batch at NEEDS_REVIEW while any row is still pending', async () => {
    tx.basicPriceImportRow.count.mockResolvedValue(2);
    await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
      version: 0,
      resourceCatalogId: 'resource-01',
      unitDefinitionId: 'unit-01',
    });
    expect(tx.basicPriceImportBatch.update).not.toHaveBeenCalled();
  });

  // RM-02D1 — resource identity mapping decision audit trail.
  describe('mapping decision audit trail (RM-02D1)', () => {
    it('records reviewer, timestamp, reason, and MANUAL_SEARCH when no normalized-name candidate matches', async () => {
      candidateRows = [];
      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
        reason: 'picked via free-text search, no auto suggestion existed',
      });

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        {
          data: {
            workspaceId: WORKSPACE_ID,
            rowId: ROW_ID,
            resourceCatalogId: 'resource-01',
            unitDefinitionId: 'unit-01',
            reviewerAccountId: REVIEWER_ID,
            reason: 'picked via free-text search, no auto suggestion existed',
            suggestionSource: 'MANUAL_SEARCH',
            candidateCountAtDecision: 0,
          },
        },
      );
    });

    it('stores null reason when none is given, never fabricating a justification', async () => {
      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      });
      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: null }),
        }),
      );
    });

    it('positive: an unambiguous single normalized-name candidate that the human confirms is recorded as NORMALIZED_NAME_SINGLE_CANDIDATE — never auto-applied without the resolve call', async () => {
      candidateRows = [
        {
          resourceCatalogId: 'resource-01',
          code: null,
          name: 'Semen Portland',
          type: 'MATERIAL',
          baseUnit: 'Zak',
        },
      ];

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      });

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            suggestionSource: 'NORMALIZED_NAME_SINGLE_CANDIDATE',
            candidateCountAtDecision: 1,
          }),
        }),
      );
    });

    it('negative: two candidates share the normalized name (ambiguous) — resolving to one of them is recorded as NORMALIZED_NAME_MULTIPLE_CANDIDATES, and the row still requires an explicit human pick (no candidate is auto-applied)', async () => {
      candidateRows = [
        {
          resourceCatalogId: 'resource-01',
          code: null,
          name: 'Semen Portland',
          type: 'MATERIAL',
          baseUnit: 'Zak',
        },
        {
          resourceCatalogId: 'resource-02',
          code: null,
          name: 'Semen Portland',
          type: 'MATERIAL',
          baseUnit: 'Zak',
        },
      ];

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      });

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            suggestionSource: 'NORMALIZED_NAME_MULTIPLE_CANDIDATES',
            candidateCountAtDecision: 2,
          }),
        }),
      );
      // resolveRow always required an explicit resourceCatalogId from the
      // caller (dto.resourceCatalogId) — ambiguity never chose one on its
      // own. There is no code path anywhere in this service that picks a
      // resourceCatalogId out of `candidates` itself.
    });

    it('records a mapping decision even when the resolve attempt collides and the row stays NEEDS_REVIEW (decision history is independent of row-current-state)', async () => {
      tx.basicPriceImportRow.findFirst.mockResolvedValue({
        id: 'other-row',
        proposedCanonicalPrice: { toString: () => '999.00' },
      });

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      });

      expect(
        tx.basicPriceImportRowResourceMapping.create,
      ).toHaveBeenCalledTimes(1);
    });
  });

  // RM-02D1-REMEDIATION-V3.1 — SOURCE_ROW_PROVENANCE priority + PROVENANCE_NAME_CONFLICT.
  describe('SOURCE_ROW_PROVENANCE / PROVENANCE_NAME_CONFLICT', () => {
    it('fail-closed: zero equivalence record for this batch source hash means provenance never triggers, even if resolving to the exact name-matched candidate', async () => {
      candidateRows = [
        {
          resourceCatalogId: 'resource-01',
          code: null,
          name: 'Semen Portland',
          type: 'MATERIAL',
          baseUnit: 'Zak',
        },
      ];
      tx.basicPriceSourceEquivalence.findUnique.mockResolvedValue(null);

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      });

      expect(tx.resourceSourceIdentity.findFirst).not.toHaveBeenCalled();
      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            suggestionSource: 'NORMALIZED_NAME_SINGLE_CANDIDATE',
          }),
        }),
      );
    });

    it('positive: an authorized equivalence record plus a matching provenance identity takes priority over normalized-name matching, and is recorded as SOURCE_ROW_PROVENANCE', async () => {
      candidateRows = []; // no normalized-name signal at all — provenance alone still wins
      tx.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
        canonicalSourceSha256: 'canonical-sha',
      });
      tx.resourceSourceIdentity.findFirst.mockResolvedValue({
        resourceCatalogId: 'resource-provenanced',
      });
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-provenanced',
        type: 'MATERIAL',
      });

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-provenanced',
        unitDefinitionId: 'unit-01',
      });

      expect(tx.basicPriceSourceEquivalence.findUnique).toHaveBeenCalledWith({
        where: {
          workspaceId_batchSourceSha256: {
            workspaceId: WORKSPACE_ID,
            batchSourceSha256: baseBatch.sourceSha256,
          },
        },
      });
      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            suggestionSource: 'SOURCE_ROW_PROVENANCE',
            candidateCountAtDecision: 1,
          }),
        }),
      );
    });

    it('positive: provenance still wins priority even when normalized-name also finds the SAME candidate (agreement, not a conflict)', async () => {
      candidateRows = [
        {
          resourceCatalogId: 'resource-agree',
          code: null,
          name: 'Semen Portland',
          type: 'MATERIAL',
          baseUnit: 'Zak',
        },
      ];
      tx.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
        canonicalSourceSha256: 'canonical-sha',
      });
      tx.resourceSourceIdentity.findFirst.mockResolvedValue({
        resourceCatalogId: 'resource-agree',
      });
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-agree',
        type: 'MATERIAL',
      });

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-agree',
        unitDefinitionId: 'unit-01',
      });

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // Distinct-signal count dedups agreement to 1, not 2.
          data: expect.objectContaining({
            suggestionSource: 'SOURCE_ROW_PROVENANCE',
            candidateCountAtDecision: 1,
          }),
        }),
      );
    });

    it('conflict: provenance points to one ResourceCatalog while normalized-name points to a different one — recorded as PROVENANCE_NAME_CONFLICT regardless of which side the reviewer picks, never silently reconciled', async () => {
      candidateRows = [
        {
          resourceCatalogId: 'resource-NAME',
          code: null,
          name: 'Semen Portland',
          type: 'MATERIAL',
          baseUnit: 'Zak',
        },
      ];
      tx.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
        canonicalSourceSha256: 'canonical-sha',
      });
      tx.resourceSourceIdentity.findFirst.mockResolvedValue({
        resourceCatalogId: 'resource-PROVENANCE',
      });
      tx.resourceCatalog.findFirst.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, type: 'MATERIAL' }),
      );

      // Reviewer sides with the provenance candidate here.
      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-PROVENANCE',
        unitDefinitionId: 'unit-01',
      });

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            suggestionSource: 'PROVENANCE_NAME_CONFLICT',
            resourceCatalogId: 'resource-PROVENANCE',
            candidateCountAtDecision: 2, // both distinct signals counted
          }),
        }),
      );
    });

    it('conflict: recorded as PROVENANCE_NAME_CONFLICT even when the reviewer sides with the normalized-name candidate instead of provenance', async () => {
      candidateRows = [
        {
          resourceCatalogId: 'resource-NAME',
          code: null,
          name: 'Semen Portland',
          type: 'MATERIAL',
          baseUnit: 'Zak',
        },
      ];
      tx.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
        canonicalSourceSha256: 'canonical-sha',
      });
      tx.resourceSourceIdentity.findFirst.mockResolvedValue({
        resourceCatalogId: 'resource-PROVENANCE',
      });
      tx.resourceCatalog.findFirst.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, type: 'MATERIAL' }),
      );

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-NAME',
        unitDefinitionId: 'unit-01',
      });

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            suggestionSource: 'PROVENANCE_NAME_CONFLICT',
            resourceCatalogId: 'resource-NAME',
          }),
        }),
      );
    });

    it('never auto-resolves from provenance alone — resolveRow still requires an explicit resourceCatalogId, and rejects if it does not match any known ACTIVE resource', async () => {
      tx.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
        canonicalSourceSha256: 'canonical-sha',
      });
      tx.resourceSourceIdentity.findFirst.mockResolvedValue({
        resourceCatalogId: 'resource-provenanced',
      });
      tx.resourceCatalog.findFirst.mockResolvedValue(null); // caller's chosen id is unknown/inactive, regardless of provenance existing

      await expect(
        service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
          version: 0,
          resourceCatalogId: 'ghost-id',
          unitDefinitionId: 'unit-01',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
      expect(
        tx.basicPriceImportRowResourceMapping.create,
      ).not.toHaveBeenCalled();
    });

    // RM-02D1-REMEDIATION-V3.2.1 (Blocker 1) — honest audit: a provenance
    // candidate merely EXISTING must never be recorded as SOURCE_ROW_PROVENANCE
    // unless the reviewer's own chosen resourceCatalogId actually equals it.
    it('honest audit: provenance candidate A exists, reviewer instead picks a different same-typed resource B with zero name candidates — recorded as MANUAL_SEARCH, never SOURCE_ROW_PROVENANCE', async () => {
      candidateRows = []; // normalizedNameCandidates = []
      tx.basicPriceSourceEquivalence.findUnique.mockResolvedValue({
        canonicalSourceSha256: 'canonical-sha',
      });
      tx.resourceSourceIdentity.findFirst.mockResolvedValue({
        resourceCatalogId: 'resource-A',
      }); // provenanceCandidate = A
      tx.resourceCatalog.findFirst.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, type: 'MATERIAL' }),
      ); // A and B share row.sourceSection's type

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-B', // reviewer picks B, not A
        unitDefinitionId: 'unit-01',
      });

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            suggestionSource: 'MANUAL_SEARCH',
            resourceCatalogId: 'resource-B',
          }),
        }),
      );
      const call =
        tx.basicPriceImportRowResourceMapping.create.mock.calls[0][0];
      expect(call.data.suggestionSource).not.toBe('SOURCE_ROW_PROVENANCE');
    });
  });

  // RM-02D1-REMEDIATION-V3.2.1 (Blocker 2) — resource type safety.
  describe('RESOURCE_TYPE_MISMATCH', () => {
    it('rejects resolving a LABOR row to a MATERIAL resource, before any row update or mapping insert', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([baseBatch]);
          if (sql.includes('basic_price_import_rows'))
            return Promise.resolve([
              {
                ...baseRow,
                sourceSection: 'LABOR',
                sourceSectionProvenance: 'SOURCE_ROW_CATEGORY',
              },
            ]);
          if (sql.includes('resource_catalogs'))
            return Promise.resolve(candidateRows);
          return Promise.resolve([]);
        },
      );
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-material',
        type: 'MATERIAL',
      });

      await expect(
        service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
          version: 0,
          resourceCatalogId: 'resource-material',
          unitDefinitionId: 'unit-01',
        }),
      ).rejects.toThrow('RESOURCE_TYPE_MISMATCH');
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
      expect(
        tx.basicPriceImportRowResourceMapping.create,
      ).not.toHaveBeenCalled();
    });

    it('rejects resolving a MATERIAL row to an EQUIPMENT resource', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([baseBatch]);
          if (sql.includes('basic_price_import_rows'))
            return Promise.resolve([
              {
                ...baseRow,
                sourceSectionProvenance: 'SOURCE_SECTION_TITLE',
              },
            ]);
          return Promise.resolve([]);
        },
      );
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-equipment',
        type: 'EQUIPMENT',
      });
      await expect(
        service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
          version: 0,
          resourceCatalogId: 'resource-equipment',
          unitDefinitionId: 'unit-01',
        }),
      ).rejects.toThrow('RESOURCE_TYPE_MISMATCH');
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
      expect(
        tx.basicPriceImportRowResourceMapping.create,
      ).not.toHaveBeenCalled();
    });

    it('CAT-02 — a weak UPLOADER_DECLARED Upah hint does not block completing Batu Kali as Bahan', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([baseBatch]);
          if (sql.includes('basic_price_import_rows'))
            return Promise.resolve([
              {
                ...baseRow,
                rawResourceNameText: 'Batu Kali',
                sourceSection: 'LABOR',
                sourceSectionProvenance: 'UPLOADER_DECLARED',
                rawUnitText: 'M3',
              },
            ]);
          return Promise.resolve([]);
        },
      );
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-batu-kali',
        type: 'MATERIAL',
      });
      tx.unitDefinition.findFirst.mockResolvedValue({
        id: 'unit-m3',
        code: 'M3',
      });
      // Preserve the default lawful identity proof. Omitting priceOperation
      // here falsely triggers UNIT_SELECTION_REQUIRES_PRICE_CONVERSION and
      // masks the CAT-02 category question this pin exists to prove.
      unitKernel.resolve.mockResolvedValue({
        status: 'RESOLVED',
        rawSourceUnit: 'M3',
        rawTargetUnit: 'M3',
        priceOperation: 'IDENTITY',
        policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1',
        reasonCodes: ['EXACT_UNIT_ALIAS_EQUIVALENCE', 'EXACT_UNIT_IDENTITY'],
        explanation:
          'Kedua alias menunjuk identitas unit canonical yang sama.',
      });

      const result = await service.resolveRow(
        WORKSPACE_ID,
        BATCH_ID,
        ROW_ID,
        REVIEWER_ID,
        {
          version: 0,
          resourceCatalogId: 'resource-batu-kali',
          unitDefinitionId: 'unit-m3',
        },
      );

      expect(result).toBeDefined();
      expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resourceCatalogId: 'resource-batu-kali',
            sourceSection: 'MATERIAL',
            resolvedResourceType: 'MATERIAL',
          }),
        }),
      );
    });

    it('CAT-03 — a weak UPLOADER_DECLARED Upah hint does not block completing Batu Belah as Bahan', async () => {
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([baseBatch]);
          if (sql.includes('basic_price_import_rows'))
            return Promise.resolve([
              {
                ...baseRow,
                rawResourceNameText: 'Batu Belah',
                sourceSection: 'LABOR',
                sourceSectionProvenance: 'UPLOADER_DECLARED',
                rawUnitText: 'M3',
              },
            ]);
          return Promise.resolve([]);
        },
      );
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-batu-belah',
        type: 'MATERIAL',
      });
      tx.unitDefinition.findFirst.mockResolvedValue({
        id: 'unit-m3',
        code: 'M3',
      });
      unitKernel.resolve.mockResolvedValue({
        status: 'RESOLVED',
        rawSourceUnit: 'M3',
        rawTargetUnit: 'M3',
        priceOperation: 'IDENTITY',
        policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1',
        reasonCodes: ['EXACT_UNIT_ALIAS_EQUIVALENCE', 'EXACT_UNIT_IDENTITY'],
        explanation:
          'Kedua alias menunjuk identitas unit canonical yang sama.',
      });

      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-batu-belah',
        unitDefinitionId: 'unit-m3',
      });

      expect(tx.basicPriceImportRow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resourceCatalogId: 'resource-batu-belah',
            sourceSection: 'MATERIAL',
            resolvedResourceType: 'MATERIAL',
          }),
        }),
      );
    });

    it('a type match at the exact row.sourceSection still resolves normally (regression guard)', async () => {
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-01',
        type: 'MATERIAL',
      }); // baseRow.sourceSection === 'MATERIAL'
      const result = await service.resolveRow(
        WORKSPACE_ID,
        BATCH_ID,
        ROW_ID,
        REVIEWER_ID,
        {
          version: 0,
          resourceCatalogId: 'resource-01',
          unitDefinitionId: 'unit-01',
        },
      );
      expect(result.status).toBe('READY_FOR_SUBMISSION');
    });

    it('passes row.sourceSection through to the provenance lookup', async () => {
      await service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      });
      expect(tx.basicPriceSourceEquivalence.findUnique).toHaveBeenCalled();
      // baseBatch has no equivalence by default, so resourceSourceIdentity.findFirst is never reached here;
      // the sourceSection plumbing itself is covered directly in basic-price-source-provenance.service.spec.ts.
    });
  });

  // ==========================================================
  // RM-03D1 — REVIEWED RESOURCE ADMISSION
  //
  // SIMPROK must not stay permanently blind to a resource its own source
  // documents contain — and must never invent one either.
  //
  // The load-bearing law here is that ADMISSION DOES NOT DEFINE WHAT SIMPROK
  // DOES NOT KNOW. ResourceIdentityResolutionService does, and admission may
  // act only after that authority has exhausted every defensible avenue it
  // has: exact canonical identity, source codes, provenance sightings, prior
  // human decisions, token containment and shared stems, over this workspace's
  // catalog AND the global one. These tests run the REAL authority, so a
  // differently-spelled resource cannot slip past into a duplicate.
  // ==========================================================
  describe('admitResourceForRow', () => {
    const ADMIT = {
      version: 0,
      unitDefinitionId: 'unit-01',
      reason: 'Tidak ada resource kanonik yang sepadan di workspace ini.',
    };

    /** A catalog row exactly as ResourceIdentityResolutionService loads it. */
    const catalogRow = (over: Record<string, unknown> = {}) => ({
      id: 'existing-01',
      code: null,
      name: 'Semen Portlan',
      type: 'MATERIAL',
      baseUnit: 'Zak',
      status: 'ACTIVE',
      specifications: null,
      ...over,
    });

    beforeEach(() => {
      // Model reality: once the resource is admitted, the re-read inside the
      // shared resolution body finds exactly that row — including its type,
      // which the source section decided.
      let admitted: Record<string, unknown> | null = null;
      (tx as any).resourceCatalog.create = jest.fn(({ data }: any) => {
        admitted = { id: 'new-resource-01', ...data };
        return admitted;
      });
      tx.resourceCatalog.findFirst.mockImplementation(async () => admitted);
      (tx as any).resourceSourceIdentity.create = jest.fn(async () => ({ id: 'prov-01' }));
      (tx as any).basicPriceImportRow.findUniqueOrThrow = jest.fn(async () => ({
        sourceCodeCellAddress: 'D33',
        sourceNameCellAddress: 'C33',
        sourceUnitCellAddress: 'E33',
        batch: { sourceFileName: 'DERIVED_EVIDENCE.xlsx' },
      }));
      tx.unitDefinition.findFirst.mockResolvedValue({ id: 'unit-01', code: 'M3' });
    });

    const admit = () =>
      service.admitResourceForRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, ADMIT as any);

    const rowsFrom = (row: Record<string, unknown>) =>
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches')) return Promise.resolve([baseBatch]);
        if (sql.includes('basic_price_import_rows')) return Promise.resolve([{ ...baseRow, ...row }]);
        if (sql.includes('resource_catalogs')) return Promise.resolve(candidateRows);
        return Promise.resolve([]);
      });

    const created = () => (tx as any).resourceCatalog.create.mock.calls[0][0].data;
    const nothingWasCreated = () => {
      expect((tx as any).resourceCatalog.create).not.toHaveBeenCalled();
      expect((tx as any).resourceSourceIdentity.create).not.toHaveBeenCalled();
      expect(tx.basicPriceImportRowResourceMapping.create).not.toHaveBeenCalled();
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
    };

    // ---------- ADMISSION IS ALLOWED ONLY WHEN THE AUTHORITY IS EXHAUSTED ----------

    it('1. authoritative RESOURCE_NOT_FOUND with zero candidates is the one condition that admits', async () => {
      const result = await admit();

      expect((tx as any).resourceCatalog.create).toHaveBeenCalledTimes(1);
      expect(created().workspaceId).toBe(WORKSPACE_ID);
      // Exactly what the source says — not normalized, not tidied.
      expect(created().name).toBe('Semen Portland');
      expect(result.admittedResource.id).toBe('new-resource-01');
    });

    it('2. an exact canonical candidate forbids admission, and the authoritative verdict is handed back verbatim', async () => {
      identityCatalogRows = [catalogRow({ name: 'Semen Portland' })];

      const error = await admit().catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        message: 'RESOURCE_IDENTITY_NOT_EXHAUSTED',
        resourceIdentity: {
          status: 'RESOLVED',
          authority: 'EXACT_CANONICAL_MATCH',
          resolvedResourceCatalogId: 'existing-01',
        },
      });
      nothingWasCreated();
    });

    it('3. A DIFFERENT SPELLING IS NOT A DIFFERENT RESOURCE — "Semen Portlan" against "Semen Portland" forbids admission', async () => {
      // This is the whole blocker this remediation closes: the previous
      // exact-name lookup saw zero candidates here and would have created a
      // second canonical cement.
      identityCatalogRows = [catalogRow({ name: 'Semen Portlan' })];

      const error = await admit().catch((e) => e);
      expect(error.getResponse().resourceIdentity).toMatchObject({
        status: 'NEEDS_REVIEW',
        authority: 'EVIDENCE_CANDIDATE',
      });
      expect(error.getResponse().resourceIdentity.candidates[0]).toMatchObject({
        resourceCatalogId: 'existing-01',
        name: 'Semen Portlan',
      });
      nothingWasCreated();
    });

    it('4. a source-code sighting nominating a differently-named catalog row forbids admission', async () => {
      rowsFrom({ rawResourceCodeText: 'M.23' });
      identityCatalogRows = [catalogRow({ id: 'coded-01', name: 'Bahan pengikat tipe satu' })];
      identitySightingRows = [
        {
          resourceCatalogId: 'coded-01',
          rawName: 'sesuatu yang lain sama sekali',
          rawCode: 'M.23',
          rawUnit: 'Zak',
          sourceSection: 'MATERIAL',
          sourceSha256: 'other-sha',
          sheetName: 'S',
          sourceRowNumber: 7,
        },
      ];

      const error = await admit().catch((e) => e);
      expect(error.getResponse().resourceIdentity.candidates[0]).toMatchObject({
        resourceCatalogId: 'coded-01',
        evidence: ['SOURCE_CODE_MATCH'],
      });
      nothingWasCreated();
    });

    it('5. a ResourceSourceIdentity name sighting forbids admission', async () => {
      identityCatalogRows = [catalogRow({ id: 'seen-01', name: 'Bahan pengikat tipe satu' })];
      identitySightingRows = [
        {
          resourceCatalogId: 'seen-01',
          rawName: 'Semen Portland',
          rawCode: null,
          rawUnit: 'Zak',
          sourceSection: 'MATERIAL',
          sourceSha256: 'other-sha',
          sheetName: 'S',
          sourceRowNumber: 7,
        },
      ];

      const error = await admit().catch((e) => e);
      expect(error.getResponse().resourceIdentity.candidates[0]).toMatchObject({
        resourceCatalogId: 'seen-01',
        evidence: ['SOURCE_SIGHTING_NAME_MATCH'],
      });
      nothingWasCreated();
    });

    it('6. a prior human mapping decision forbids admission and is surfaced as the evidence it is', async () => {
      identityCatalogRows = [catalogRow({ id: 'mapped-01', name: 'Bahan pengikat tipe satu' })];
      identityMappingRows = [
        {
          resourceCatalogId: 'mapped-01',
          reviewerAccountId: 'someone-earlier',
          decidedAt: new Date('2026-01-01T00:00:00.000Z'),
          reason: 'sudah pernah diputuskan untuk baris impor lain',
          row: {
            rawResourceNameText: 'Semen Portland',
            rawResourceCodeText: null,
            resolvedResourceType: 'MATERIAL',
            sourceSection: 'MATERIAL',
          },
        },
      ];

      const error = await admit().catch((e) => e);
      const candidate = error.getResponse().resourceIdentity.candidates[0];
      expect(candidate).toMatchObject({
        resourceCatalogId: 'mapped-01',
        evidence: ['REVIEWED_MAPPING_NAME_MATCH'],
      });
      // THE DECISION STILL DECIDES — it nominated this candidate, under its own
      // row-scoped evidence kind, and the admission is still forbidden.
      //
      // What it no longer does is arrive whole. This assertion used to read
      // `candidate.priorHumanDecision.reviewerAccountId`, which is exactly the
      // leak the 409 projection closes: the earlier reviewer's account, the
      // moment they decided and their private note travelled to whoever called
      // this endpoint. The knowledge is unchanged and still internal — see the
      // same-workspace privacy suite below, which proves the engine still holds
      // all three while the response carries none of them.
      expect(candidate.hasPriorHumanDecision).toBe(true);
      expect(candidate).not.toHaveProperty('priorHumanDecision');
      nothingWasCreated();
    });

    // -----------------------------------------------------------------------
    // SAME-WORKSPACE PRIVATE AUDIT METADATA — the 409 projection.
    //
    // Tenant isolation was never the question here: account A and account B are
    // in the SAME workspace, A's mapping is lawful evidence B's resolution is
    // entitled to benefit from, and no predicate would or should exclude it.
    //
    // The question is what B's HTTP response is allowed to contain. A batch is
    // user-owned: B admitting a resource on B's own row must not read the note A
    // typed while settling A's row. So the engine keeps everything and the reply
    // keeps almost nothing — privacy by projection, never by forgetting.
    // -----------------------------------------------------------------------
    describe('SAME-WORKSPACE PRIVATE AUDIT METADATA (409 identity refusal)', () => {
      const PRIVATE_ACCOUNT_A = 'private-account-A';
      const PRIVATE_NOTE_A = 'CATATAN PRIVAT ACCOUNT A';
      const PRIVATE_DECIDED_AT = '2026-02-03T04:05:06.000Z';

      /**
       * The 409 body, named once. Typing it here is not decoration: it is what
       * lets these assertions read the response as the CONTRACT it is rather
       * than as an `any` chain, so a field that disappears fails at compile time
       * instead of quietly turning an expectation into a no-op.
       */
      interface SafeCandidateBody {
        resourceCatalogId: string;
        name: string;
        code: string | null;
        type: string;
        baseUnit: string;
        evidence: string[];
        specificationUnproved: boolean;
        unprovedSpecificationFacts: string[];
        hasPriorHumanDecision: boolean;
      }
      interface IdentityRefusalBody {
        message: string;
        resourceIdentity: {
          status: string;
          authority: string | null;
          resolvedResourceCatalogId: string | null;
          reasonCodes: string[];
          candidates: SafeCandidateBody[];
        };
      }

      /** A's lawful reviewed mapping, owned by the SAME workspace B works in. */
      const seedAccountADecision = () => {
        identityCatalogRows = [
          catalogRow({
            id: 'mapped-by-a-01',
            name: 'Bahan pengikat tipe satu',
          }),
        ];
        identityMappingRows = [
          {
            id: 'mapping-private-01',
            workspaceId: WORKSPACE_ID,
            resourceCatalogId: 'mapped-by-a-01',
            reviewerAccountId: PRIVATE_ACCOUNT_A,
            decidedAt: new Date(PRIVATE_DECIDED_AT),
            reason: PRIVATE_NOTE_A,
            row: {
              rawResourceNameText: 'Semen Portland',
              rawResourceCodeText: null,
              resolvedResourceType: 'MATERIAL',
              sourceSection: 'MATERIAL',
            },
          },
        ];
      };

      const refusalBody = async (): Promise<IdentityRefusalBody> => {
        const error: unknown = await admit().catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(ConflictException);
        return (
          error as ConflictException
        ).getResponse() as IdentityRefusalBody;
      };

      it("carries NONE of account A's private audit metadata in the serialized body", async () => {
        seedAccountADecision();

        // THE SERIALIZED BODY, not the TypeScript shape. A type can be narrowed
        // while the runtime object still carries the fields, and it is the wire
        // that reaches a browser.
        const payload = JSON.stringify(await refusalBody());

        for (const secret of [
          PRIVATE_ACCOUNT_A,
          PRIVATE_NOTE_A,
          '2026-02-03T04:05:06',
          'reviewerAccountId',
          'priorHumanDecision',
          'decidedAt',
          'mapping-private-01',
        ]) {
          expect(payload).not.toContain(secret);
        }
        nothingWasCreated();
      });

      it('still carries what the caller needs to recover instead of duplicating', async () => {
        seedAccountADecision();
        const body = await refusalBody();

        expect(body.message).toBe('RESOURCE_IDENTITY_NOT_EXHAUSTED');
        expect(body.resourceIdentity.reasonCodes.length).toBeGreaterThan(0);

        const candidate = body.resourceIdentity.candidates[0];
        // Everything a human needs to pick this row instead of making a second
        // one — and the safe signal that somebody already settled it once.
        expect(candidate.resourceCatalogId).toBe('mapped-by-a-01');
        expect(candidate.name).toBe('Bahan pengikat tipe satu');
        expect(candidate.type).toBe('MATERIAL');
        expect(candidate.baseUnit).toBe('Zak');
        expect(candidate.evidence).toEqual(['REVIEWED_MAPPING_NAME_MATCH']);
        expect(candidate.hasPriorHumanDecision).toBe(true);

        // The whole outward candidate shape, fenced key-by-key. A field added to
        // the kernel's candidate cannot reach this response without this test
        // being read and changed.
        expect(Object.keys(candidate).sort()).toEqual([
          'baseUnit',
          'code',
          'evidence',
          'hasPriorHumanDecision',
          'name',
          'resourceCatalogId',
          'specificationUnproved',
          'type',
          'unprovedSpecificationFacts',
        ]);
        // `specifications` is the catalog row's raw claims blob, surfaced for the
        // kernel's own reasoning. It is not part of this reply.
        expect(candidate).not.toHaveProperty('specifications');
      });

      it('does NOT send the raw canonical Resource Identity explanation', async () => {
        seedAccountADecision();
        const body = await refusalBody();

        // No client reads it — callers switch on `message`, which is still here
        // and still machine-readable. The authority keeps its own explanation.
        expect(body.resourceIdentity).not.toHaveProperty('explanation');

        const payload = JSON.stringify(body);
        expect(payload).not.toContain('"explanation"');
        // The kernel's PROSE, not the field name: `resolvedResourceCatalogId` is
        // a structured identity key and legitimately contains that word, which is
        // exactly why this asserts on the sentence form instead.
        expect(payload).not.toContain('entri ResourceCatalog');
        expect(payload).not.toContain('cocok persis');
      });

      it('ACTIVE KNOWLEDGE: the engine still holds the whole decision internally', async () => {
        seedAccountADecision();

        // The projection is the LAST step. Asked directly, the same authority
        // over the same evidence still returns the reviewer, the moment and the
        // note — which is what makes this privacy-by-projection rather than
        // privacy-by-amnesia. If this ever fails, SIMPROK was made to forget.
        //
        // Constructed locally over the SAME mocked evidence, so this test needs
        // nothing from the shared setup and cannot perturb any other test.
        const authority = new ResourceIdentityResolutionService(
          prisma as unknown as PrismaService,
          unitKernel as unknown as UnitKernelService,
        );
        type EvidenceClientArg = Parameters<
          ResourceIdentityResolutionService['loadEvidence']
        >[0];
        const evidence = await authority.loadEvidence(
          tx as unknown as EvidenceClientArg,
          WORKSPACE_ID,
        );
        const verdict = await authority.resolve(evidence, {
          rawName: 'Semen Portland',
          rawCode: null,
          rawUnit: 'M3',
          resourceType: ResourceType.MATERIAL,
        });

        const known = verdict.candidates.find(
          (c) => c.resourceCatalogId === 'mapped-by-a-01',
        );
        expect(known?.priorHumanDecision?.reviewerAccountId).toBe(
          PRIVATE_ACCOUNT_A,
        );
        expect(known?.priorHumanDecision?.reason).toBe(PRIVATE_NOTE_A);
        expect(verdict.explanation.length).toBeGreaterThan(0);
      });
    });

    it('7. a GLOBAL catalog candidate forbids a workspace-local duplicate, and the loader really does look at global rows', async () => {
      // workspaceId null in the database — the loader's own tenant predicate is
      // what brings it into view, so that predicate is asserted here directly.
      identityCatalogRows = [catalogRow({ id: 'global-01', name: 'Semen Portland' })];

      const error = await admit().catch((e) => e);
      expect(error.getResponse().resourceIdentity.resolvedResourceCatalogId).toBe('global-01');
      expect(tx.resourceCatalog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ workspaceId: WORKSPACE_ID }, { workspaceId: null }] },
        }),
      );
      nothingWasCreated();
    });

    it('8. a candidate whose specification the source never proved forbids admission — unknown is not agreement', async () => {
      identityCatalogRows = [
        catalogRow({ name: 'Semen Portland', specifications: { mutu: 'BjTS 420B' } }),
      ];

      const error = await admit().catch((e) => e);
      expect(error.getResponse().resourceIdentity).toMatchObject({
        status: 'NEEDS_REVIEW',
        reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW', 'SPECIFICATION_UNPROVED'],
      });
      nothingWasCreated();
    });

    it('9. a same-name row of the WRONG type is reported as a type mismatch, and still forbids admission', async () => {
      identityCatalogRows = [catalogRow({ name: 'Semen Portland', type: 'LABOR' })];

      const error = await admit().catch((e) => e);
      expect(error.getResponse().resourceIdentity).toMatchObject({
        status: 'UNRESOLVED',
        reasonCodes: ['RESOURCE_TYPE_MISMATCH'],
      });
      nothingWasCreated();
    });

    // ---------- UNIT AUTHORITY ----------

    it('10. a UnitDefinition the unit authority cannot represent forbids admission, and returns the truthful unit outcome', async () => {
      unitKernel.resolve.mockResolvedValue({
        status: 'NEEDS_REVIEW',
        reasonCodes: ['UNKNOWN_UNIT_ALIAS'],
        explanation: 'Satu atau lebih alias unit tidak dikenal.',
      });

      const error = await admit().catch((e) => e);
      expect(error.getResponse()).toMatchObject({
        message: 'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY',
        unitResolution: { status: 'NEEDS_REVIEW', reasonCodes: ['UNKNOWN_UNIT_ALIAS'] },
      });
      nothingWasCreated();
    });

    it('11. the canonical unit is proved through the EXISTING UnitKernel, asked about its own code', async () => {
      await admit();

      expect(unitKernel.resolve).toHaveBeenCalledWith('M3', 'M3');
      expect(created().baseUnit).toBe('M3');
    });

    it('12. an unknown or inactive unit admits nothing — admission never mints unit vocabulary', async () => {
      tx.unitDefinition.findFirst.mockResolvedValue(null);

      await expect(admit()).rejects.toThrow('UNIT_UNKNOWN_OR_INACTIVE');
      nothingWasCreated();
    });

    // ---------- WHAT IS WRITTEN COMES ONLY FROM THE SOURCE ----------

    it('13. an absent source code stays null, and no specification is invented', async () => {
      await admit();

      expect(created().code).toBeNull();
      expect(created().specifications).toBeUndefined();
    });

    it('14. a source code the row genuinely carries is preserved verbatim', async () => {
      rowsFrom({ rawResourceCodeText: 'M.23' });

      await admit();

      expect(created().code).toBe('M.23');
    });

    it('15. the resource type comes from the source section, never from the caller', async () => {
      rowsFrom({ sourceSection: 'LABOR' });

      await admit();

      expect(created().type).toBe('LABOR');
    });

    it('16. records source provenance bound to that exact source row', async () => {
      await admit();

      expect((tx as any).resourceSourceIdentity.create).toHaveBeenCalledTimes(1);
      expect((tx as any).resourceSourceIdentity.create.mock.calls[0][0].data).toMatchObject({
        resourceCatalogId: 'new-resource-01',
        workspaceId: WORKSPACE_ID,
        sourceSha256: 'batch-sha',
        sourceFileName: 'DERIVED_EVIDENCE.xlsx',
        parserContractVersion: 'RM02_BASIC_PRICE_01_V1',
        sheetName: 'HARGA SATUAN UPAH DAN BAHAN',
        sourceRowNumber: 33,
        sourceSection: 'MATERIAL',
        sourceNameCellAddress: 'C33',
        rawName: 'Semen Portland',
        rawUnit: 'Zak',
      });
    });

    // ---------- SERIALIZATION, RE-PROOF, ATOMICITY ----------

    it('17. the authority is re-proved AFTER a deterministic serialization lock, and it is the second verdict that authorizes', async () => {
      const order: string[] = [];
      tx.resourceCatalog.findMany.mockImplementation(async () => {
        order.push('identity');
        return identityCatalogRows;
      });
      tx.$executeRaw.mockImplementation(async (query: { strings?: readonly string[] }) => {
        if ((query?.strings?.join('') ?? '').includes('pg_advisory_xact_lock')) order.push('lock');
        return 1;
      });

      await admit();

      // Pre-lock pass refuses cheaply; the lock serializes; the post-lock pass
      // is the only one that may authorize a create.
      expect(order).toEqual(['identity', 'lock', 'identity']);
    });

    it('18. CONCURRENCY: a resource admitted by another transaction while this one waited is found on re-proof, and is never duplicated', async () => {
      // Before the lock this workspace knew nothing; by the time the lock was
      // granted, a concurrent admission had committed the very same identity.
      let pass = 0;
      tx.resourceCatalog.findMany.mockImplementation(async () => {
        pass += 1;
        return pass === 1 ? [] : [catalogRow({ id: 'won-the-race-01', name: 'Semen Portland' })];
      });

      const error = await admit().catch((e) => e);
      expect(error.getResponse()).toMatchObject({
        message: 'RESOURCE_IDENTITY_NOT_EXHAUSTED',
        resourceIdentity: { resolvedResourceCatalogId: 'won-the-race-01' },
      });
      nothingWasCreated();
    });

    it('19. THE SERIALIZATION DOMAIN DOES NOT DEPEND ON THE RESOURCE NAME — two spellings take the SAME lock', async () => {
      const keysFor = async (row: Record<string, unknown>) => {
        rowsFrom(row);
        tx.$executeRaw.mockClear();
        await admit().catch(() => undefined);
        return tx.$executeRaw.mock.calls
          .map(([query]: any) => query)
          .filter((q: any) => (q?.strings?.join('') ?? '').includes('pg_advisory_xact_lock'))
          .map((q: any) => q.values);
      };

      const portland = await keysFor({ rawResourceNameText: 'Semen Portland' });
      expect(portland).toHaveLength(1);

      // A name-derived key would put these two in different domains, let them
      // run in parallel, and let each re-prove against a catalog that did not
      // yet contain the other — two canonical cements. Keying on the name
      // assumes the very thing this slice denies.
      expect(await keysFor({ rawResourceNameText: 'Semen Portlan' })).toEqual(portland);
      expect(await keysFor({ rawResourceNameText: 'Sesuatu Yang Lain Sekali' })).toEqual(portland);
      expect(await keysFor({ rawResourceNameText: '  SEMEN   portland ' })).toEqual(portland);

      // Tenant and class still separate the domains, so admissions that cannot
      // possibly be the same identity never queue behind each other.
      expect(await keysFor({ sourceSection: 'LABOR' })).not.toEqual(portland);
    });

    it('20. a downstream failure after the catalog write propagates, so the whole transaction rolls back', async () => {
      (tx as any).resourceSourceIdentity.create = jest.fn(async () => {
        throw new Error('PROVENANCE_WRITE_FAILED');
      });

      await expect(admit()).rejects.toThrow('PROVENANCE_WRITE_FAILED');
      expect(tx.basicPriceImportRowResourceMapping.create).not.toHaveBeenCalled();
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
    });

    it('21. a source row already bound to another resource refuses truthfully instead of stealing the binding', async () => {
      (tx as any).resourceSourceIdentity.create = jest.fn(async () => {
        throw new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
        });
      });

      await expect(admit()).rejects.toThrow('RESOURCE_PROVENANCE_ALREADY_BOUND');
      expect(tx.basicPriceImportRowResourceMapping.create).not.toHaveBeenCalled();
    });

    // ---------- IDEMPOTENCY, OWNERSHIP, OUTCOME ----------

    it('22. a stale version cannot replay the decision, so no duplicate resource is born', async () => {
      await expect(
        service.admitResourceForRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
          ...ADMIT,
          version: 99,
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      nothingWasCreated();
    });

    it('23. a row that is no longer mutable admits nothing', async () => {
      rowsFrom({ status: 'READY_FOR_SUBMISSION' });

      await expect(admit()).rejects.toThrow('ROW_NOT_MUTABLE');
      nothingWasCreated();
    });

    it('24. a batch outside the caller workspace admits nothing', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches'))
          return Promise.resolve([{ ...baseBatch, workspaceId: 'other-ws' }]);
        if (sql.includes('basic_price_import_rows')) return Promise.resolve([baseRow]);
        return Promise.resolve([]);
      });

      await expect(admit()).rejects.toBeInstanceOf(NotFoundException);
      nothingWasCreated();
    });

    it('25. a batch uploaded by someone else admits nothing', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches'))
          return Promise.resolve([{ ...baseBatch, uploadedByAccountId: 'someone-else' }]);
        if (sql.includes('basic_price_import_rows')) return Promise.resolve([baseRow]);
        return Promise.resolve([]);
      });

      await expect(admit()).rejects.toBeInstanceOf(NotFoundException);
      nothingWasCreated();
    });

    it('26. the mapping decision records what the human actually saw: nothing suggested this identity', async () => {
      // The just-created row is excluded from the decision-time signal set. It
      // exists by the time the audit is written, and counting it would make the
      // record claim the reviewer picked a candidate their own decision created.
      candidateRows = [
        { resourceCatalogId: 'new-resource-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'M3' },
      ];

      await admit();

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledTimes(1);
      expect(tx.basicPriceImportRowResourceMapping.create.mock.calls[0][0].data).toMatchObject({
        workspaceId: WORKSPACE_ID,
        rowId: ROW_ID,
        resourceCatalogId: 'new-resource-01',
        unitDefinitionId: 'unit-01',
        reviewerAccountId: REVIEWER_ID,
        reason: ADMIT.reason,
        suggestionSource: 'MANUAL_SEARCH',
        candidateCountAtDecision: 0,
      });
    });

    it('27. the admitted row lands READY_FOR_SUBMISSION bound to the new resource', async () => {
      const result = await admit();

      expect(tx.basicPriceImportRow.update).toHaveBeenCalledTimes(1);
      expect(tx.basicPriceImportRow.update.mock.calls[0][0].data).toMatchObject({
        resourceCatalogId: 'new-resource-01',
        resolvedResourceType: 'MATERIAL',
        unitDefinitionId: 'unit-01',
        resolutionStatus: 'RESOLVED',
        status: 'READY_FOR_SUBMISSION',
        resolvedByAccountId: REVIEWER_ID,
      });
      expect(result.row.status).toBe('READY_FOR_SUBMISSION');
    });
    // ---------- TRUSTED UNIT CONTEXT, ON THE ADMISSION PATH ----------
    //
    // Admission runs the SAME shared resolution body, so it must refuse the
    // same unit choices an ordinary resolve refuses. If it did not, admission
    // would be the way around the unit law: mint a resource, bind it to a
    // canonical unit its own source row never proved, and the catalog would
    // carry that unprovable baseUnit forever.

    /** The admission refusal body, typed — and only reached by a real refusal. */
    const admissionRefusal = async (): Promise<Record<string, unknown>> => {
      try {
        await admit();
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        return (error as ConflictException).getResponse() as Record<
          string,
          unknown
        >;
      }
      throw new Error('expected a refusal, but admission succeeded');
    };

    it('28. T12 — admission refuses a unit that needs a price conversion, and admits nothing', async () => {
      unitKernel.resolve.mockImplementation(
        (rawSourceUnit: string, rawTargetUnit: string) =>
          Promise.resolve(
            rawSourceUnit === rawTargetUnit
              ? {
                  // The vocabulary proof admission does first still succeeds…
                  status: 'RESOLVED',
                  rawSourceUnit,
                  rawTargetUnit,
                  priceOperation: 'IDENTITY',
                  reasonCodes: ['EXACT_UNIT_IDENTITY'],
                  explanation: 'sama',
                }
              : {
                  // …and the row-level proof is what refuses.
                  status: 'RESOLVED',
                  rawSourceUnit,
                  rawTargetUnit,
                  priceOperation: 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR',
                  quantityFactor: '40',
                  reasonCodes: ['UNIQUE_EVIDENCE_BOUND_RULE'],
                  explanation:
                    'Tepat satu aturan directional aktif dan berbukti ditemukan.',
                },
          ),
      );

      expect(await admissionRefusal()).toMatchObject({
        message: 'UNIT_SELECTION_REQUIRES_PRICE_CONVERSION',
        unitResolution: {
          rawSourceUnit: 'Zak',
          selectedUnitCode: 'M3',
          resourceContext: 'MATERIAL',
          priceOperation: 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR',
        },
      });
      nothingWasCreated();
    });

    it('29. T13 — admission refuses a unit the source unit cannot prove, and admits nothing', async () => {
      unitKernel.resolve.mockImplementation(
        (rawSourceUnit: string, rawTargetUnit: string) =>
          Promise.resolve(
            rawSourceUnit === rawTargetUnit
              ? {
                  status: 'RESOLVED',
                  rawSourceUnit,
                  rawTargetUnit,
                  priceOperation: 'IDENTITY',
                  reasonCodes: ['EXACT_UNIT_IDENTITY'],
                  explanation: 'sama',
                }
              : {
                  status: 'NEEDS_REVIEW',
                  rawSourceUnit,
                  rawTargetUnit,
                  priceOperation: null,
                  reasonCodes: ['CONVERSION_RULE_NOT_FOUND'],
                  explanation:
                    'Aturan konversi directional yang memenuhi bukti tidak ditemukan.',
                },
          ),
      );

      expect(await admissionRefusal()).toMatchObject({
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution: {
          status: 'NEEDS_REVIEW',
          reasonCodes: ['CONVERSION_RULE_NOT_FOUND'],
        },
      });
      nothingWasCreated();
    });
  });

  // ==========================================================
  // BASIC PRICE TRUSTED UNIT CONTEXT (PRODUCT SEAM 01)
  //
  // A reviewer picks a ResourceCatalog and a UnitDefinition. Before this seam,
  // SIMPROK checked only that both rows existed — so a row whose source
  // document said "Zak" could be persisted as M3, and the price, which is the
  // raw source price PER THAT SOURCE UNIT, would silently become a per-m3
  // price. Nothing downstream could ever detect it: BasicPrice.value is read
  // as being per ResourceCatalog.baseUnit, with no memory of the sack.
  //
  // The fix is not a new unit brain. It is asking the ONE Unit Kernel the
  // question Basic Price always should have asked: does the unit this human
  // chose actually denote the unit this document wrote, in this row's trusted
  // resource context? The human still chooses. SIMPROK only refuses to write
  // down a choice it cannot prove.
  // ==========================================================
  describe('trusted unit context (PRODUCT SEAM 01)', () => {
    /** Put a row with these overrides in front of the service. */
    /**
     * Put a row with these overrides in front of the service — and make the
     * update echo THAT row, not the default one.
     *
     * The shared `update` mock returns `{...baseRow, ...data}`, so without this
     * a test could assert the returned row still carries its source spelling
     * while actually reading the default fixture's spelling. Source-truth
     * assertions have to read the row that was really under review.
     */
    const rowIs = (over: Record<string, unknown>) => {
      const row = { ...baseRow, ...over };
      tx.$queryRaw.mockImplementation(
        (query: { strings?: readonly string[] }) => {
          const sql = query?.strings?.join('') ?? '';
          if (sql.includes('basic_price_import_batches'))
            return Promise.resolve([baseBatch]);
          if (sql.includes('basic_price_import_rows'))
            return Promise.resolve([row]);
          if (sql.includes('resource_catalogs'))
            return Promise.resolve(candidateRows);
          return Promise.resolve([]);
        },
      );
      tx.basicPriceImportRow.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }),
      );
    };

    const resolve = () =>
      service.resolveRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
        version: 0,
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
      });

    const nothingWasWritten = () => {
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
      expect(
        tx.basicPriceImportRowResourceMapping.create,
      ).not.toHaveBeenCalled();
      expect(tx.basicPriceImportBatch.update).not.toHaveBeenCalled();
    };

    /**
     * The refusal body, typed — and only ever reached by an actual refusal.
     *
     * `resolve().catch((e) => e)` would hand back `any`, so a test could assert
     * against a resolution that quietly SUCCEEDED and still read as green.
     * Throwing here makes "it was refused" part of what the test proves.
     */
    const refusalOf = async (
      call: () => Promise<unknown> = resolve,
    ): Promise<Record<string, unknown>> => {
      try {
        await call();
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        return (error as ConflictException).getResponse() as Record<
          string,
          unknown
        >;
      }
      throw new Error('expected a refusal, but the resolution succeeded');
    };

    const kernelAnswers = (answer: Record<string, unknown>) =>
      unitKernel.resolve.mockImplementation(
        (rawSourceUnit: string, rawTargetUnit: string) =>
          Promise.resolve({
            rawSourceUnit,
            rawTargetUnit,
            policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1',
            ...answer,
          }),
      );

    it('T1 — a source unit that proves the chosen canonical unit resolves normally', async () => {
      const result = await resolve();

      expect(result.status).toBe('READY_FOR_SUBMISSION');
      expect(unitKernel.resolve).toHaveBeenCalledWith(
        'Zak',
        'ZAK',
        'resource-01',
        'MATERIAL',
      );
    });

    it('T2 — an unknown source unit refuses the choice and writes nothing', async () => {
      kernelAnswers({
        status: 'NEEDS_REVIEW',
        priceOperation: null,
        reasonCodes: ['UNKNOWN_UNIT_ALIAS'],
        explanation: 'Satu atau lebih alias unit tidak dikenal.',
      });

      expect(await refusalOf()).toMatchObject({
        statusCode: 409,
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution: {
          status: 'NEEDS_REVIEW',
          reasonCodes: ['UNKNOWN_UNIT_ALIAS'],
          rawSourceUnit: 'Zak',
          selectedUnitCode: 'ZAK',
          resourceContext: 'MATERIAL',
        },
      });
      nothingWasWritten();
    });

    it('T3 — a pair the evidence declares NOT_CONVERTIBLE refuses, with the kernel’s own reason', async () => {
      kernelAnswers({
        status: 'NOT_CONVERTIBLE',
        priceOperation: null,
        reasonCodes: ['NOT_CONVERTIBLE'],
        explanation:
          'Evidence menyatakan pasangan unit tidak dapat dikonversi.',
      });

      expect(await refusalOf()).toMatchObject({
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution: {
          status: 'NOT_CONVERTIBLE',
          reasonCodes: ['NOT_CONVERTIBLE'],
        },
      });
      nothingWasWritten();
    });

    it('T4 — a convertible unit whose PRICE would have to change is refused, not silently persisted', async () => {
      // This is the whole point. The kernel is happy: "Zak" converts to M3 by a
      // real evidence-bound rule. But `proposedCanonicalPrice` is the price PER
      // SACK, and Basic Price has no seam that divides it by the factor. Writing
      // the m3 unit against the sack price would publish a false canonical price.
      kernelAnswers({
        status: 'RESOLVED',
        priceOperation: 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR',
        quantityFactor: '40',
        conversionType: 'PACKAGE_CONTENT',
        reasonCodes: ['UNIQUE_EVIDENCE_BOUND_RULE'],
        explanation:
          'Tepat satu aturan directional aktif dan berbukti ditemukan.',
      });

      expect(await refusalOf()).toMatchObject({
        message: 'UNIT_SELECTION_REQUIRES_PRICE_CONVERSION',
        unitResolution: {
          status: 'RESOLVED',
          priceOperation: 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR',
        },
      });
      nothingWasWritten();
    });

    it('T5 — the trusted context is the row’s own sourceSection, for a LABOR row', async () => {
      rowIs({ sourceSection: 'LABOR', rawUnitText: 'jam' });
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-01',
        type: 'LABOR',
      });
      tx.unitDefinition.findFirst.mockResolvedValue({
        id: 'unit-01',
        code: 'JAM_ORANG',
      });

      await resolve();

      expect(unitKernel.resolve).toHaveBeenCalledWith(
        'jam',
        'JAM_ORANG',
        'resource-01',
        'LABOR',
      );
    });

    it('T6 — and the EQUIPMENT context for an EQUIPMENT row', async () => {
      rowIs({ sourceSection: 'EQUIPMENT', rawUnitText: 'jam' });
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-01',
        type: 'EQUIPMENT',
      });
      tx.unitDefinition.findFirst.mockResolvedValue({
        id: 'unit-01',
        code: 'JAM_ALAT',
      });

      await resolve();

      expect(unitKernel.resolve).toHaveBeenCalledWith(
        'jam',
        'JAM_ALAT',
        'resource-01',
        'EQUIPMENT',
      );
    });

    it('T7 — "jam" can never swap: the equipment hour is unreachable from a LABOR row', async () => {
      // A faithful stand-in for the kernel's context law: the spelling "jam" is
      // context-scoped, so only the alias belonging to the row's own context is
      // ever eligible. A foreign-context unit is not "the last row standing" —
      // it is simply not a candidate.
      const HOUR_OF: Record<string, string> = {
        LABOR: 'JAM_ORANG',
        EQUIPMENT: 'JAM_ALAT',
      };
      unitKernel.resolve.mockImplementation(
        (
          rawSourceUnit: string,
          rawTargetUnit: string,
          _resourceCatalogId?: string,
          context?: string,
        ) => {
          const eligible = context ? HOUR_OF[context] : undefined;
          if (
            rawSourceUnit.toLowerCase() !== 'jam' ||
            eligible !== rawTargetUnit
          )
            return {
              status: 'NEEDS_REVIEW',
              rawSourceUnit,
              rawTargetUnit,
              priceOperation: null,
              reasonCodes: context
                ? ['UNKNOWN_UNIT_ALIAS']
                : ['CONTEXT_REQUIRED_UNIT_ALIAS'],
              explanation: 'Alias unit terikat konteks.',
            };
          return {
            status: 'RESOLVED',
            rawSourceUnit,
            rawTargetUnit,
            priceOperation: 'IDENTITY',
            reasonCodes: ['CONTEXT_SCOPED_UNIT_ALIAS', 'EXACT_UNIT_IDENTITY'],
            explanation:
              'Kedua alias menunjuk identitas unit canonical yang sama.',
          };
        },
      );

      // The reviewer of a LABOR row reaches for the equipment hour.
      rowIs({ sourceSection: 'LABOR', rawUnitText: 'jam' });
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-01',
        type: 'LABOR',
      });
      tx.unitDefinition.findFirst.mockResolvedValue({
        id: 'unit-01',
        code: 'JAM_ALAT',
      });

      expect(await refusalOf()).toMatchObject({
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution: {
          resourceContext: 'LABOR',
          selectedUnitCode: 'JAM_ALAT',
        },
      });
      nothingWasWritten();

      // …and the labour hour, on that same row, is accepted — so the refusal
      // above is the context law working, not the row being unresolvable.
      tx.unitDefinition.findFirst.mockResolvedValue({
        id: 'unit-01',
        code: 'JAM_ORANG',
      });

      expect((await resolve()).status).toBe('READY_FOR_SUBMISSION');
    });

    it('T8 — a context-free unit still resolves under a context, unchanged', async () => {
      // "m3" means the same thing on every kind of row. Passing context must
      // not make previously-working resolutions start failing.
      kernelAnswers({
        status: 'RESOLVED',
        priceOperation: 'IDENTITY',
        reasonCodes: ['EXACT_UNIT_ALIAS_EQUIVALENCE', 'EXACT_UNIT_IDENTITY'],
        explanation: 'Kedua alias menunjuk identitas unit canonical yang sama.',
      });
      rowIs({ rawUnitText: 'm3' });
      tx.unitDefinition.findFirst.mockResolvedValue({
        id: 'unit-01',
        code: 'M3',
      });

      const result = await resolve();

      expect(result.status).toBe('READY_FOR_SUBMISSION');
      expect(unitKernel.resolve).toHaveBeenCalledWith(
        'm3',
        'M3',
        'resource-01',
        'MATERIAL',
      );
    });

    it('T9 — a row whose source document carried no unit refuses the choice, and writes nothing', async () => {
      // The absent unit is the DANGEROUS case, not the mild one. An unknown
      // spelling fails loudly; an absent one would have been accepted in
      // silence, storing a canonical unit with nothing at all behind it.
      rowIs({ rawUnitText: null });

      expect(await refusalOf()).toMatchObject({
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution: {
          status: 'NEEDS_REVIEW',
          // The intake adapter's own existing code for this exact fact — the
          // reviewer already saw it on this row. No new reason family.
          reasonCodes: ['UNIT_REQUIRED'],
          // The original cell, unaltered: null is reported as null.
          rawSourceUnit: null,
          selectedUnitCode: 'ZAK',
          resourceContext: 'MATERIAL',
          priceOperation: null,
        },
      });
      // The kernel is never asked to resolve an absent spelling, so safety here
      // cannot depend on the catalogue happening to hold no empty alias.
      expect(unitKernel.resolve).not.toHaveBeenCalled();
      nothingWasWritten();
    });

    it('T10 — a blank-looking source unit is no proof either, and is reported exactly as written', async () => {
      rowIs({ rawUnitText: '   ' });

      expect(await refusalOf()).toMatchObject({
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution: {
          reasonCodes: ['UNIT_REQUIRED'],
          // Whitespace is not silently rewritten to null or to '' — the cell is
          // evidence, and it is handed back the way the document wrote it.
          rawSourceUnit: '   ',
        },
      });
      expect(unitKernel.resolve).not.toHaveBeenCalled();
      nothingWasWritten();
    });

    it('T10b — refusing one unprovable row never touches the batch, so every other row stays resolvable', async () => {
      // FAIL-CLOSED ON THE FACT, NOT FAIL-STOP ON THE WORKFLOW. The refusal is
      // thrown inside THIS row's own transaction: the row stays NEEDS_REVIEW and
      // no batch-wide state is written, so a reviewer can carry straight on with
      // the other rows. A batch-level stop would show up here as a batch update.
      rowIs({ rawUnitText: null });

      await refusalOf();

      expect(tx.basicPriceImportBatch.update).not.toHaveBeenCalled();
      expect(tx.basicPriceImportRow.update).not.toHaveBeenCalled();
    });

    it('T11 — surrounding whitespace is not part of the spelling handed to the kernel', async () => {
      rowIs({ rawUnitText: '  Zak  ' });

      await resolve();

      expect(unitKernel.resolve).toHaveBeenCalledWith(
        'Zak',
        'ZAK',
        'resource-01',
        'MATERIAL',
      );
    });

    it('T14 — an accepted proof changes nothing about the human’s choice or the price', async () => {
      const result = await resolve();

      expect(tx.basicPriceImportRow.update).toHaveBeenCalledTimes(1);
      const [[firstUpdate]] = tx.basicPriceImportRow.update.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      const written = firstUpdate.data;
      expect(written).toMatchObject({
        resourceCatalogId: 'resource-01',
        unitDefinitionId: 'unit-01',
        resolvedResourceType: 'MATERIAL',
      });
      // SIMPROK proves; it does not substitute. No canonical unit of its own
      // choosing, and no price arithmetic, may appear in the written row.
      expect(written).not.toHaveProperty('proposedCanonicalPrice');
      expect(result.proposedCanonicalPrice?.toString()).toBe('100.00');
    });

    /**
     * T15 — THE SOURCE-TRUTH CONTRACT, end to end.
     *
     * An equipment rental schedule writes its machine hour as "U/J". SIMPROK
     * must be able to read that — and must NOT achieve it by tidying the
     * document. Three things are distinct and all three survive: the raw
     * spelling the source wrote, the normalised key the kernel looks up, and
     * the canonical unit the reviewer chose. Only the third is SIMPROK's
     * interpretation; the first is evidence and stays exactly as received.
     *
     * If this test ever passes because rawUnitText became "jam", the product
     * has started editing its own evidence, and every audit built on that row
     * is worthless.
     */
    it('T15 — "U/J" resolves to EQUIPMENT_HOUR, and the row still says "U/J" at the price it came with', async () => {
      rowIs({
        sourceSection: 'EQUIPMENT',
        rawUnitText: 'U/J',
        proposedCanonicalPrice: { toString: () => '1714285.71' },
      });
      tx.resourceCatalog.findFirst.mockResolvedValue({
        id: 'resource-01',
        type: 'EQUIPMENT',
      });
      tx.unitDefinition.findFirst.mockResolvedValue({
        id: 'unit-01',
        code: 'EQUIPMENT_HOUR',
      });
      // The kernel answers as the shipped catalogue does: one machine hour,
      // spelled differently. A spelling is not a conversion.
      kernelAnswers({
        status: 'RESOLVED',
        priceOperation: 'IDENTITY',
        quantityFactor: '1',
        reasonCodes: ['CONTEXT_SCOPED_UNIT_ALIAS', 'EXACT_UNIT_IDENTITY'],
        explanation: 'Kedua alias menunjuk identitas unit canonical yang sama.',
      });

      const result = await resolve();

      // The raw source spelling is what was asked about — not a cleaned-up one.
      expect(unitKernel.resolve).toHaveBeenCalledWith(
        'U/J',
        'EQUIPMENT_HOUR',
        'resource-01',
        'EQUIPMENT',
      );
      expect(result.status).toBe('READY_FOR_SUBMISSION');

      const [[firstUpdate]] = tx.basicPriceImportRow.update.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      const written = firstUpdate.data;
      // The human's canonical interpretation is stored…
      expect(written).toMatchObject({
        unitDefinitionId: 'unit-01',
        resolvedResourceType: 'EQUIPMENT',
      });
      // …and nothing was written over the source evidence or the money.
      expect(written).not.toHaveProperty('rawUnitText');
      expect(written).not.toHaveProperty('sourceSection');
      expect(written).not.toHaveProperty('proposedCanonicalPrice');
      expect(result.rawUnitText).toBe('U/J');
      expect(result.proposedCanonicalPrice?.toString()).toBe('1714285.71');
    });
  });
});

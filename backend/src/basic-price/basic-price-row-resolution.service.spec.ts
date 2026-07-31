import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BasicPriceRowResolutionService', () => {
  let service: BasicPriceRowResolutionService;
  let tx: {
    $queryRaw: jest.Mock;
    basicPriceImportRow: {
      findFirst: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    basicPriceImportBatch: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    resourceCatalog: { findFirst: jest.Mock };
    unitDefinition: { findFirst: jest.Mock };
    basicPriceImportRowResourceMapping: { create: jest.Mock };
    basicPriceSourceEquivalence: { findUnique: jest.Mock };
    resourceSourceIdentity: { findFirst: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

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
    tx = {
      $queryRaw: jest.fn(),
      basicPriceImportRow: {
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      basicPriceImportBatch: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      resourceCatalog: { findFirst: jest.fn() },
      unitDefinition: { findFirst: jest.fn() },
      basicPriceImportRowResourceMapping: { create: jest.fn() },
      basicPriceSourceEquivalence: { findUnique: jest.fn() },
      resourceSourceIdentity: { findFirst: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(tx),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BasicPriceRowResolutionService,
        { provide: PrismaService, useValue: prisma },
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
    tx.unitDefinition.findFirst.mockResolvedValue({ id: 'unit-01' });
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
            return Promise.resolve([{ ...baseRow, sourceSection: 'LABOR' }]);
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
});

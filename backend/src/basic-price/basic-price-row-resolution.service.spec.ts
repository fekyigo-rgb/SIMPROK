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

  // ==========================================================
  // RM-03D1 — REVIEWED RESOURCE ADMISSION
  //
  // SIMPROK must not stay permanently blind to a resource its own source
  // documents contain — and must never invent one either. These prove both
  // halves: an authorised human can admit a genuinely new row, and every path
  // that would let a resource appear by accident is closed.
  // ==========================================================
  describe('admitResourceForRow', () => {
    const ADMIT = {
      version: 0,
      unitDefinitionId: 'unit-01',
      reason: 'Tidak ada resource kanonik yang sepadan di workspace ini.',
    };

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

    it('1. admits exactly one canonical resource from a reviewed row with no candidates', async () => {
      const result = await admit();

      expect((tx as any).resourceCatalog.create).toHaveBeenCalledTimes(1);
      const created = (tx as any).resourceCatalog.create.mock.calls[0][0].data;
      expect(created.workspaceId).toBe(WORKSPACE_ID);
      // Exactly what the source says — not normalized, not tidied.
      expect(created.name).toBe('Semen Portland');
      expect(result.admittedResource.id).toBe('new-resource-01');
    });

    it('2. records source provenance bound to that exact source row', async () => {
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

    it('3. records the row-scoped mapping decision in the same shape a chosen resource produces', async () => {
      await admit();

      expect(tx.basicPriceImportRowResourceMapping.create).toHaveBeenCalledTimes(1);
      expect(tx.basicPriceImportRowResourceMapping.create.mock.calls[0][0].data).toMatchObject({
        workspaceId: WORKSPACE_ID,
        rowId: ROW_ID,
        resourceCatalogId: 'new-resource-01',
        unitDefinitionId: 'unit-01',
        reviewerAccountId: REVIEWER_ID,
        reason: ADMIT.reason,
        // Nothing suggested this identity; a human supplied it.
        suggestionSource: 'MANUAL_SEARCH',
        candidateCountAtDecision: 0,
      });
    });

    it('4. a stale version cannot replay the decision, so no duplicate resource is born', async () => {
      await expect(
        service.admitResourceForRow(WORKSPACE_ID, BATCH_ID, ROW_ID, REVIEWER_ID, {
          ...ADMIT,
          version: 99,
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((tx as any).resourceCatalog.create).not.toHaveBeenCalled();
    });

    it('5. an existing same-name same-type resource blocks admission outright', async () => {
      candidateRows = [
        { resourceCatalogId: 'existing-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' },
      ];

      await expect(admit()).rejects.toThrow('RESOURCE_CANDIDATE_EXISTS');
      expect((tx as any).resourceCatalog.create).not.toHaveBeenCalled();
      expect((tx as any).resourceSourceIdentity.create).not.toHaveBeenCalled();
    });

    it('6. several plausible candidates are never settled by creating yet another one', async () => {
      candidateRows = [
        { resourceCatalogId: 'existing-01', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Zak' },
        { resourceCatalogId: 'existing-02', code: null, name: 'Semen Portland', type: 'MATERIAL', baseUnit: 'Kg' },
      ];

      await expect(admit()).rejects.toThrow('RESOURCE_CANDIDATE_EXISTS');
      expect((tx as any).resourceCatalog.create).not.toHaveBeenCalled();
    });

    it('7. a batch outside the caller workspace admits nothing', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches'))
          return Promise.resolve([{ ...baseBatch, workspaceId: 'other-ws' }]);
        if (sql.includes('basic_price_import_rows')) return Promise.resolve([baseRow]);
        return Promise.resolve([]);
      });

      await expect(admit()).rejects.toBeInstanceOf(NotFoundException);
      expect((tx as any).resourceCatalog.create).not.toHaveBeenCalled();
    });

    it('8. a batch uploaded by someone else admits nothing', async () => {
      tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('basic_price_import_batches'))
          return Promise.resolve([{ ...baseBatch, uploadedByAccountId: 'someone-else' }]);
        if (sql.includes('basic_price_import_rows')) return Promise.resolve([baseRow]);
        return Promise.resolve([]);
      });

      await expect(admit()).rejects.toBeInstanceOf(NotFoundException);
      expect((tx as any).resourceCatalog.create).not.toHaveBeenCalled();
    });

    it('9. an unknown or inactive unit admits nothing — admission never mints unit vocabulary', async () => {
      tx.unitDefinition.findFirst.mockResolvedValue(null);

      await expect(admit()).rejects.toThrow('UNIT_UNKNOWN_OR_INACTIVE');
      expect((tx as any).resourceCatalog.create).not.toHaveBeenCalled();
    });

    it('10. an absent source code stays null, and no specification is invented', async () => {
      await admit();

      const created = (tx as any).resourceCatalog.create.mock.calls[0][0].data;
      expect(created.code).toBeNull();
      expect(created.specifications).toBeUndefined();
    });

    it('11. a source code the row genuinely carries is preserved verbatim', async () => {
      rowsFrom({ rawResourceCodeText: 'M.23' });

      await admit();

      expect((tx as any).resourceCatalog.create.mock.calls[0][0].data.code).toBe('M.23');
    });

    it('12. the resource type comes from the source section, never from the caller', async () => {
      rowsFrom({ sourceSection: 'LABOR' });

      await admit();

      expect((tx as any).resourceCatalog.create.mock.calls[0][0].data.type).toBe('LABOR');
    });

    it('13. baseUnit is the canonical UnitDefinition code, so the UnitKernel can always prove it later', async () => {
      await admit();

      expect((tx as any).resourceCatalog.create.mock.calls[0][0].data.baseUnit).toBe('M3');
    });

    it('14. a failure after the catalog write propagates, so the whole transaction rolls back', async () => {
      (tx as any).resourceSourceIdentity.create = jest.fn(async () => {
        throw new Error('PROVENANCE_WRITE_FAILED');
      });

      await expect(admit()).rejects.toThrow('PROVENANCE_WRITE_FAILED');
      expect(tx.basicPriceImportRowResourceMapping.create).not.toHaveBeenCalled();
    });

    it('15. a row that is no longer mutable admits nothing', async () => {
      rowsFrom({ status: 'READY_FOR_SUBMISSION' });

      await expect(admit()).rejects.toThrow('ROW_NOT_MUTABLE');
      expect((tx as any).resourceCatalog.create).not.toHaveBeenCalled();
    });

    it('16. the admitted row lands READY_FOR_SUBMISSION bound to the new resource', async () => {
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
  });
});

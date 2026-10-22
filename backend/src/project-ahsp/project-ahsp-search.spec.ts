import { BadRequestException } from '@nestjs/common';
import 'reflect-metadata';
import { PERMISSIONS } from '../common/constants/permissions';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { ProjectAhspController } from './project-ahsp.controller';
import { ProjectAhspService } from './project-ahsp.service';

describe('RI-01K scalable AHSP picker: canonical eligible search', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const projectId = '10000000-0000-4000-8000-000000000001';
  const asOf = '2026-10-14';
  let prisma: { aHSP: { findMany: jest.Mock } };
  let service: ProjectAhspService;

  const parent = (index: number, code: string | null = null) => ({
    id: 'ahsp-parent-' + index,
    code,
    workType: 'Pasangan batu ' + index,
    methodName: 'Metode uji Bina Marga',
    workspaceId: null,
    ownershipType: 'SIMPROK_ASSET',
    versions: [{
      id: 'ahsp-version-' + index,
      versionNumber: 3,
      status: 'PUBLISHED',
      outputUnit: 'm3',
      effectiveDate: null,
      expiredDate: null,
      _count: { resources: 1 },
    }],
  });

  beforeEach(() => {
    prisma = { aHSP: { findMany: jest.fn().mockResolvedValue([parent(1, 'BM-001')]) } };
    service = new ProjectAhspService(prisma as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any);
  });

  it('searches code/uraian/metode case-insensitively in DB, bounded, with existing eligibility and current snapshot', async () => {
    const result = await service.searchEligibleVersions(workspaceId, asOf,
      { projectId }, { q: 'BM-001', page: '1', limit: '25' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('ahsp-version-1');
    expect(result.items[0].ahsp.code).toBe('BM-001');
    expect(result.items[0].origin).toBe('SIMPROK_CATALOG');
    expect(result.hasNext).toBe(false);
    expect(result.query).toBe('BM-001');
    const query = prisma.aHSP.findMany.mock.calls[0][0];
    expect(query.take).toBe(26);
    expect(query.skip).toBe(0);
    expect(query.where.versions.some).toMatchObject({
      outputUnit: { not: null }, resources: { some: {} },
    });
    expect(JSON.stringify(query.where.versions.some)).toContain(workspaceId);
    expect(query.where.OR).toEqual([
      { code: { contains: 'BM-001', mode: 'insensitive' } },
      { workType: { contains: 'BM-001', mode: 'insensitive' } },
      { methodName: { contains: 'BM-001', mode: 'insensitive' } },
    ]);
    expect(query.select.versions.take).toBe(1);
    expect(query.select.versions.orderBy).toEqual([
      { versionNumber: 'desc' }, { id: 'asc' },
    ]);
    expect(query.select.versions.where).toEqual(query.where.versions.some);
  });

  it('limits every page, returns hasNext, and does not fetch all thousands of AHSP', async () => {
    prisma.aHSP.findMany.mockResolvedValue(Array.from({length: 26}, (_, i) => parent(i)));
    const result = await service.searchEligibleVersions(workspaceId, asOf,
      { projectId }, { page: '2' });
    expect(result.items).toHaveLength(25);
    expect(result.hasNext).toBe(true);
    expect(result.page).toBe(2);
    expect(prisma.aHSP.findMany.mock.calls[0][0].skip).toBe(25);
    expect(prisma.aHSP.findMany.mock.calls[0][0].take).toBe(26);
  });

  it('rejects malformed search and unbounded pages instead of full-catalogue fallback', async () => {
    for (const query of [
      { q: 'a' }, { q: 'a'.repeat(121) }, { page: '0' },
      { page: '1.2' }, { page: 'Infinity' }, { page: '-1' },
      { limit: '51' }, { limit: '0' }, { limit: 'bogus' },
    ]) {
      await expect(service.searchEligibleVersions(workspaceId, asOf,
        { projectId }, query)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.aHSP.findMany).not.toHaveBeenCalled();
  });

  it('route retains project guards and AHSP_VIEW; legacy candidate route is untouched', async () => {
    const controller = new ProjectAhspController(service, {} as any, {} as any);
    const result = await controller.searchEligibleVersions(
      { projectAccess: { workspaceId } }, projectId, asOf, undefined, 'batu', '1', '25');
    expect(result.items).toHaveLength(1);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.searchEligibleVersions))
      .toEqual([PERMISSIONS.AHSP_VIEW]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.listEligibleVersions))
      .toEqual([PERMISSIONS.AHSP_VIEW]);
  });
});

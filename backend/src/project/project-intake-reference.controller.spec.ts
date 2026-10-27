import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { SearchRegionDto } from '../basic-price/dto/search-basic-price-import-lookups.dto';
import { ProjectIntakeReferenceController } from './project-intake-reference.controller';

describe('ProjectIntakeReferenceController', () => {
  function createController() {
    const classification = {
      listVisibleRoots: jest.fn().mockResolvedValue([{ id: 'root-1' }]),
      listChildren: jest.fn().mockResolvedValue([{ id: 'child-1' }]),
    };
    const regions = {
      searchRegions: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    return {
      classification,
      regions,
      controller: new ProjectIntakeReferenceController(
        classification as any,
        regions as any,
        { region: { findUnique: jest.fn() } } as any,
      ),
    };
  }

  it('delegates classification reads to ConstructionClassificationService', async () => {
    const { controller, classification } = createController();
    const request = { workspaceContext: { workspaceId: 'workspace-1' } };

    await controller.classificationRoots(request);
    await controller.classificationChildren(request, 'parent-1');

    expect(classification.listVisibleRoots).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    });
    expect(classification.listChildren).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      parentId: 'parent-1',
    });
  });

  it('delegates region reads to BasicPriceImportLookupService.searchRegions', async () => {
    const { controller, regions } = createController();
    const dto = Object.assign(new SearchRegionDto(), {
      q: 'maluku',
      parentId: 'country-1',
      page: 1,
      limit: 20,
    });

    await controller.searchRegions(dto);

    expect(regions.searchRegions).toHaveBeenCalledWith(dto);
  });

  it('requires PROJECT_CREATE and does not require AHSP or Basic Price permissions', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ProjectIntakeReferenceController,
    );
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
    );

    for (const method of [
      ProjectIntakeReferenceController.prototype.classificationRoots,
      ProjectIntakeReferenceController.prototype.classificationChildren,
      ProjectIntakeReferenceController.prototype.searchRegions,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual([
        'PROJECT_CREATE',
      ]);
    }
  });

  it('refuses a classification child read without workspace context or parentId', async () => {
    const { controller, classification } = createController();

    expect(() => controller.classificationRoots({})).toThrow(
      BadRequestException,
    );
    expect(() =>
      controller.classificationChildren(
        { workspaceContext: { workspaceId: 'workspace-1' } },
        undefined,
      ),
    ).toThrow('CLASSIFICATION_PARENT_ID_REQUIRED');
    expect(classification.listChildren).not.toHaveBeenCalled();
  });
});

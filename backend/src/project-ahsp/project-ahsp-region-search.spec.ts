import 'reflect-metadata';
import { PERMISSIONS } from '../common/constants/permissions';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { BasicPriceImportLookupService } from '../basic-price/basic-price-import-lookup.service';
import { ProjectAhspController } from './project-ahsp.controller';
import { ProjectAhspService } from './project-ahsp.service';
import { GhxResourceIdentityDecisionService } from './ghx-resource-identity-decision.service';

describe('RAB Region search — one canonical bounded lookup', () => {
  it('keeps BASIC_PRICE_VIEW and delegates q/page/limit to existing search', async () => {
    const result = {
      items: [{ id: 'region-1', code: '81', name: 'Maluku' }],
      page: 1,
      limit: 25,
      total: 91600,
      hasNext: true,
    };
    const lookup = { searchRegions: jest.fn().mockResolvedValue(result) };
    const service = { listActiveRegions: jest.fn() };
    const controller = new ProjectAhspController(
      service as unknown as ProjectAhspService,
      {} as GhxResourceIdentityDecisionService,
      lookup as unknown as BasicPriceImportLookupService,
    );
    const query = { q: 'Maluku', page: 1, limit: 25 };

    await expect(controller.listRegions(query)).resolves.toEqual(result);
    expect(lookup.searchRegions).toHaveBeenCalledTimes(1);
    expect(lookup.searchRegions).toHaveBeenCalledWith(query);
    expect(service.listActiveRegions).not.toHaveBeenCalled();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.listRegions))
      .toEqual([PERMISSIONS.BASIC_PRICE_VIEW]);
  });
});

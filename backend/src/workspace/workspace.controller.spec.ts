import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceController', () => {
  let controller: WorkspaceController;
  const workspaceService = {
    findAllForAccount: jest.fn(),
    findOneForAccount: jest.fn(),
    findByOrganizationForAccount: jest.fn(),
    healthCheck: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceController],
      providers: [
        {
          provide: WorkspaceService,
          useValue: workspaceService,
        },
      ],
    }).compile();

    controller = module.get<WorkspaceController>(WorkspaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll scopes workspace list to authenticated account', () => {
    const request = { user: { id: 'account-1' } };

    controller.findAll(request);

    expect(workspaceService.findAllForAccount).toHaveBeenCalledWith('account-1');
  });

  it('findOne scopes workspace read to authenticated account', () => {
    const request = { user: { id: 'account-1' } };

    controller.findOne('workspace-1', request);

    expect(workspaceService.findOneForAccount).toHaveBeenCalledWith('workspace-1', 'account-1');
  });

  it('findByOrganization scopes organization workspace list to authenticated account', () => {
    const request = { user: { id: 'account-1' } };

    controller.findByOrganization('organization-1', request);

    expect(workspaceService.findByOrganizationForAccount).toHaveBeenCalledWith('organization-1', 'account-1');
  });
});

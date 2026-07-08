import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceMembershipController } from './workspace-membership.controller';
import { WorkspaceMembershipService } from './workspace-membership.service';

describe('WorkspaceMembershipController', () => {
  let controller: WorkspaceMembershipController;
  const workspaceMembershipService = {
    findAllForAccount: jest.fn(),
    findByWorkspaceForAccount: jest.fn(),
    findByUserForAccount: jest.fn(),
    findOneForAccount: jest.fn(),
    healthCheck: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceMembershipController],
      providers: [
        {
          provide: WorkspaceMembershipService,
          useValue: workspaceMembershipService,
        },
      ],
    }).compile();

    controller = module.get<WorkspaceMembershipController>(
      WorkspaceMembershipController,
    );
  });

  it('requires JWT authentication at controller level', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      WorkspaceMembershipController,
    );

    expect(guards).toContain(JwtAuthGuard);
  });

  it('findAll scopes membership list to authenticated account', () => {
    const request = { user: { id: 'account-1' } };

    controller.findAll(request);

    expect(workspaceMembershipService.findAllForAccount).toHaveBeenCalledWith(
      'account-1',
    );
  });

  it('findByWorkspace scopes membership list to authenticated account', () => {
    const request = { user: { id: 'account-1' } };

    controller.findByWorkspace('workspace-1', request);

    expect(
      workspaceMembershipService.findByWorkspaceForAccount,
    ).toHaveBeenCalledWith('workspace-1', 'account-1');
  });

  it('findOne scopes membership read to authenticated account', () => {
    const request = { user: { id: 'account-1' } };

    controller.findOne('membership-1', request);

    expect(workspaceMembershipService.findOneForAccount).toHaveBeenCalledWith(
      'membership-1',
      'account-1',
    );
  });
});

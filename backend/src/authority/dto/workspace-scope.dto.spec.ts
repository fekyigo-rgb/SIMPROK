import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApprovalMatrixDto } from './create-approval-matrix.dto';
import { CreatePositionDto } from './create-position.dto';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('Authority workspace scope DTO contract', () => {
  it.each([
    [CreatePositionDto, { code: 'PM', name: 'Project Manager' }],
    [
      CreateApprovalMatrixDto,
      {
        authorityId: VALID_UUID,
        objectType: 'RAB',
        requiredPositionId: VALID_UUID,
      },
    ],
  ])('%s accepts an omitted workspaceId claim', async (dtoClass, payload) => {
    const dto = plainToInstance(dtoClass, payload);

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [CreatePositionDto, { code: 'PM', name: 'Project Manager' }],
    [
      CreateApprovalMatrixDto,
      {
        authorityId: VALID_UUID,
        objectType: 'RAB',
        requiredPositionId: VALID_UUID,
      },
    ],
  ])('%s rejects an invalid workspaceId claim', async (dtoClass, payload) => {
    const dto = plainToInstance(dtoClass, {
      ...payload,
      workspaceId: 'not-a-uuid',
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'workspaceId',
          constraints: expect.objectContaining({ isUuid: expect.any(String) }),
        }),
      ]),
    );
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApprovalMatrixDto } from './create-approval-matrix.dto';
import { CreatePositionDto } from './create-position.dto';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('Authority workspace scope DTO contract', () => {
  const dtoCases = [
    [CreatePositionDto, { code: 'PM', name: 'Project Manager' }],
    [
      CreateApprovalMatrixDto,
      {
        authorityId: VALID_UUID,
        objectType: 'RAB',
        requiredPositionId: VALID_UUID,
      },
    ],
  ] as const;

  it.each(dtoCases)('%s accepts an omitted workspaceId claim', async (dtoClass, payload) => {
    const dto = plainToInstance(dtoClass, payload);

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(dtoCases)('%s accepts a valid workspaceId claim', async (dtoClass, payload) => {
    const dto = plainToInstance(dtoClass, {
      ...payload,
      workspaceId: VALID_UUID,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(
    dtoCases.flatMap(([dtoClass, payload]) =>
      ['not-a-uuid', '', null].map((workspaceId) => [dtoClass, payload, workspaceId] as const),
    ),
  )('%s rejects workspaceId claim %p', async (dtoClass, payload, workspaceId) => {
    const dto = plainToInstance(dtoClass, {
      ...payload,
      workspaceId,
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

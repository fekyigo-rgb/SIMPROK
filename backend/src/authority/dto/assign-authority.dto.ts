import { IsString } from 'class-validator';

export class AssignAuthorityDto {
@IsString()
positionId: string;

@IsString()
authorityId: string;
}

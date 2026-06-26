import { IsString } from 'class-validator';

export class AssignPositionDto {
  @IsString()
  userId: string;

  @IsString()
  positionId: string;
}

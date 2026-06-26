import {
    IsOptional,
    IsString,
    } from 'class-validator';
    
    export class UpdateApprovalMatrixDto {
    @IsOptional()
    @IsString()
    code?: string;
    
    @IsOptional()
    @IsString()
    name?: string;
    
    @IsOptional()
    @IsString()
    description?: string;
    
    @IsOptional()
    @IsString()
    positionId?: string;
    }
    
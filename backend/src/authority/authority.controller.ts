import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthorityService } from './authority.service';

import { CreatePositionDto } from './dto/create-position.dto';
import { CreateAuthorityDto } from './dto/create-authority.dto';
import { AssignPositionDto } from './dto/assign-position.dto';
import { AssignAuthorityDto } from './dto/assign-authority.dto';
import { CreateApprovalMatrixDto } from './dto/create-approval-matrix.dto';

@Controller('authority')
export class AuthorityController {
  constructor(private readonly authorityService: AuthorityService) {}

  @Get('health')
  healthCheck() {
    return this.authorityService.healthCheck();
  }

  @Post('positions')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('AUTHORITY_MANAGE')
  createPosition(@Req() request: any, @Body() createPositionDto: CreatePositionDto) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (
      createPositionDto.workspaceId !== undefined &&
      createPositionDto.workspaceId !== workspaceId
    ) {
      throw new ForbiddenException('Workspace claim does not match workspace context');
    }
    return this.authorityService.createPosition(workspaceId, createPositionDto);
  }

  @Get('positions')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('AUTHORITY_VIEW')
  findAllPositions(@Req() request: any) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.findAllPositions(workspaceId);
  }

  @Get('positions/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('AUTHORITY_VIEW')
  findPosition(@Req() request: any, @Param('id') id: string) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.findPosition(id, workspaceId);
  }

  @Post('authorities')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('AUTHORITY_MANAGE')
  createAuthority(@Req() request: any, @Body() createAuthorityDto: CreateAuthorityDto) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.createAuthority(workspaceId, createAuthorityDto);
  }

  @Get('authorities')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('AUTHORITY_VIEW')
  findAllAuthorities(@Req() request: any) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.findAllAuthorities(workspaceId);
  }

  @Post('assignments')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('AUTHORITY_ASSIGN')
  assignPosition(@Req() request: any, @Body() assignPositionDto: AssignPositionDto) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.assignPosition(workspaceId, assignPositionDto);
  }

  @Post('position-authorities')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('AUTHORITY_ASSIGN')
  assignAuthority(@Req() request: any, @Body() assignAuthorityDto: AssignAuthorityDto) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.assignAuthority(workspaceId, assignAuthorityDto);
  }

  @Get('positions/:id/authorities')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('AUTHORITY_VIEW')
  findAuthoritiesByPosition(@Req() request: any, @Param('id') id: string) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.findAuthoritiesByPosition(id, workspaceId);
  }

  @Post('approval-matrices')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('APPROVAL_MATRIX_MANAGE')
  createApprovalMatrix(@Req() request: any, @Body() createApprovalMatrixDto: CreateApprovalMatrixDto) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (
      createApprovalMatrixDto.workspaceId !== undefined &&
      createApprovalMatrixDto.workspaceId !== workspaceId
    ) {
      throw new ForbiddenException('Workspace claim does not match workspace context');
    }
    return this.authorityService.createApprovalMatrix(workspaceId, createApprovalMatrixDto);
  }

  @Get('approval-matrices')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('APPROVAL_MATRIX_VIEW')
  findAllApprovalMatrices(@Req() request: any) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.findAllApprovalMatrices(workspaceId);
  }

  @Get('approval-matrices/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('APPROVAL_MATRIX_VIEW')
  findApprovalMatrix(@Req() request: any, @Param('id') id: string) {
    const workspaceId = request.workspaceContext?.workspaceId;
    return this.authorityService.findApprovalMatrix(id, workspaceId);
  }
}

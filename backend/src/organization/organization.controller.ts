import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  } from '@nestjs/common';
  
  import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
  import { PermissionsGuard } from '../auth/guards/permissions.guard';
  import { RolesGuard } from '../auth/guards/roles.guard';
  
  import { Permissions } from '../common/decorators/permissions.decorator';
  
  import { CreateOrganizationDto } from './dto/create-organization.dto';
  import { UpdateOrganizationDto } from './dto/update-organization.dto';
  
  import { OrganizationService } from './organization.service';
  
  @Controller('organizations')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  export class OrganizationController {
  constructor(
  private readonly organizationService: OrganizationService,
  ) {}
  
  @Post()
  @Permissions('PROJECT_CREATE')
  create(
  @Body() createOrganizationDto: CreateOrganizationDto,
  ) {
  return this.organizationService.create(
  createOrganizationDto,
  );
  }
  
  @Get()
  @Permissions('PROJECT_VIEW')
  findAll() {
  return this.organizationService.findAll();
  }
  
  @Get(':id')
  @Permissions('PROJECT_VIEW')
  findOne(@Param('id') id: string) {
  return this.organizationService.findOne(id);
  }
  
  @Patch(':id')
  @Permissions('PROJECT_CREATE')
  update(
  @Param('id') id: string,
  @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
  return this.organizationService.update(
  id,
  updateOrganizationDto,
  );
  }
  
  @Delete(':id')
  @Permissions('PROJECT_CREATE')
  remove(@Param('id') id: string) {
  return this.organizationService.remove(id);
  }
  }
  
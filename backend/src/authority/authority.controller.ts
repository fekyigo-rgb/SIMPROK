import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    } from '@nestjs/common';
    
    import { AuthorityService } from './authority.service';
    
    import { CreatePositionDto } from './dto/create-position.dto';
    import { CreateAuthorityDto } from './dto/create-authority.dto';
    import { AssignPositionDto } from './dto/assign-position.dto';
    import { AssignAuthorityDto } from './dto/assign-authority.dto';
    import { CreateApprovalMatrixDto } from './dto/create-approval-matrix.dto';
    
    @Controller('authority')
    export class AuthorityController {
    constructor(
    private readonly authorityService: AuthorityService,
    ) {}
    
    @Get('health')
    healthCheck() {
    return this.authorityService.healthCheck();
    }
    
    @Post('positions')
    createPosition(
    @Body() createPositionDto: CreatePositionDto,
    ) {
    return this.authorityService.createPosition(
    createPositionDto,
    );
    }
    
    @Get('positions')
    findAllPositions() {
    return this.authorityService.findAllPositions();
    }
    
    @Get('positions/:id')
    findPosition(@Param('id') id: string) {
    return this.authorityService.findPosition(id);
    }
    
    @Post('authorities')
    createAuthority(
    @Body() createAuthorityDto: CreateAuthorityDto,
    ) {
    return this.authorityService.createAuthority(
    createAuthorityDto,
    );
    }
    
    @Get('authorities')
    findAllAuthorities() {
    return this.authorityService.findAllAuthorities();
    }
    
    @Post('assignments')
    assignPosition(
    @Body() assignPositionDto: AssignPositionDto,
    ) {
    return this.authorityService.assignPosition(
    assignPositionDto,
    );
    }
    
    @Post('position-authorities')
    assignAuthority(
    @Body() assignAuthorityDto: AssignAuthorityDto,
    ) {
    return this.authorityService.assignAuthority(
    assignAuthorityDto,
    );
    }
    
    @Get('positions/:id/authorities')
    findAuthoritiesByPosition(
    @Param('id') id: string,
    ) {
    return this.authorityService.findAuthoritiesByPosition(
    id,
    );
    }
    
    @Post('approval-matrices')
    createApprovalMatrix(
    @Body()
    createApprovalMatrixDto: CreateApprovalMatrixDto,
    ) {
    return this.authorityService.createApprovalMatrix(
    createApprovalMatrixDto,
    );
    }
    
    @Get('approval-matrices')
    findAllApprovalMatrices() {
    return this.authorityService.findAllApprovalMatrices();
    }
    
    @Get('approval-matrices/:id')
    findApprovalMatrix(
    @Param('id') id: string,
    ) {
    return this.authorityService.findApprovalMatrix(
    id,
    );
    }
    }
    
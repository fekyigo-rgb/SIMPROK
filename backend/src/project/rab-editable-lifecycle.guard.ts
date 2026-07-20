import { CanActivate, ConflictException, ExecutionContext, Injectable, InternalServerErrorException } from '@nestjs/common';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';

/**
 * Pre-Multer lifecycle gate for RAB draft-editing routes. This guard is NOT
 * a lifecycle source of truth — it holds zero baseline/RabDocument/
 * BoqStructure derivation logic and zero reason-priority logic of its own.
 * It only calls RabLifecyclePolicyService (the single canonical authority)
 * and enforces the result.
 *
 * Must run after ProjectAccessGuard (which resolves trusted projectId/
 * projectStatus onto request.projectAccess) and before FileInterceptor, so a
 * blocked project is rejected before any file buffering, XLSX validation,
 * parsing, or fingerprint calculation occurs. NestJS runs all guards before
 * any interceptor regardless of decorator order, but the decorator order
 * here still follows the required sequence for readability.
 */
@Injectable()
export class RabEditableLifecycleGuard implements CanActivate {
  constructor(private readonly rabLifecyclePolicy: RabLifecyclePolicyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const projectAccess = request.projectAccess;

    if (!projectAccess?.projectId) {
      throw new InternalServerErrorException(
        'RabEditableLifecycleGuard requires ProjectAccessGuard to run first',
      );
    }

    if (!projectAccess.projectStatus) {
      throw new InternalServerErrorException('PROJECT_STATUS_MISSING_FROM_ACCESS_CONTEXT');
    }

    const capability = await this.rabLifecyclePolicy.evaluate(
      projectAccess.projectId,
      projectAccess.projectStatus,
    );

    if (!capability.canEditDraft) {
      throw new ConflictException(capability.reasonCode);
    }

    return true;
  }
}

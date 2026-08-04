import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_ALL_KEY = 'permissions_all';

export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Additive all-of contract. Existing @Permissions keeps its OR semantics. */
export const PermissionsAll = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_ALL_KEY, permissions);

import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@imob/types';

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';

export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Exige TODAS as permissões listadas. */
export const RequirePermissions = (...perms: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, perms);

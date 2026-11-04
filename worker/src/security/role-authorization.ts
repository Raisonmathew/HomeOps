import { UserRole, AccountStatus } from '../types/database';

export function isAuthorized(
  userRole: UserRole,
  requiredRoles: UserRole[],
  accountStatus: AccountStatus
): boolean {
  // SUSPENDED and DELETED accounts are unconditionally blocked from all actions (#12)
  if (accountStatus === 'SUSPENDED' || accountStatus === 'DELETED') {
    return false;
  }
  // RESTRICTED accounts can still authenticate but are barred from creating new
  // requests or modifying state — callers must check for 'RESTRICTED' when
  // enforcing write-action restrictions beyond basic authentication.
  if (accountStatus === 'RESTRICTED') {
    return false;
  }
  return requiredRoles.includes(userRole);
}

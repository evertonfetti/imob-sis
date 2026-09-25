import type { AuthedUser } from '../common/request-context';

/** Só quem tem `lead.view_all` enxerga leads de outros corretores; os demais veem apenas os seus. */
export const canViewAll = (u: AuthedUser) => u.permissions.includes('lead.view_all');

export const leadScope = (u: AuthedUser) => ({
  companyId: u.companyId,
  ...(canViewAll(u) ? {} : { brokerId: u.id }),
});

export const taskScope = (u: AuthedUser) => ({
  companyId: u.companyId,
  ...(canViewAll(u) ? {} : { OR: [{ assignedUserId: u.id }, { createdById: u.id }, { lead: { brokerId: u.id } }] }),
});

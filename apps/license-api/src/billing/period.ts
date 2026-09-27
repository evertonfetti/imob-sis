import type { BillingInterval } from '@imob/types';

export interface NextPeriod { periodStart: Date; periodEnd: Date; dueAt: Date }

/**
 * Próximo período a cobrar: continua de onde a licença já está paga (currentPeriodEnd) ou, sem isso,
 * do fim do teste (trialEndsAt); sem nenhum dos dois, começa agora. O vencimento é o início do período,
 * mas nunca no passado (fatura atrasada em criar ainda dá um prazo justo a partir de hoje).
 */
export function nextPeriod(interval: BillingInterval, basis: { currentPeriodEnd: Date | null; trialEndsAt: Date | null }, now = new Date()): NextPeriod {
  const periodStart = basis.currentPeriodEnd ?? basis.trialEndsAt ?? now;
  const periodEnd = new Date(periodStart);
  if (interval === 'MONTHLY') periodEnd.setMonth(periodEnd.getMonth() + 1);
  else periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  const dueAt = periodStart > now ? periodStart : now;
  return { periodStart, periodEnd, dueAt };
}

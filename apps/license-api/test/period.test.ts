import { describe, expect, it } from 'vitest';
import { nextPeriod } from '../src/billing/period';

describe('nextPeriod', () => {
  it('sem histórico: começa agora', () => {
    const now = new Date('2026-01-10T12:00:00Z');
    const p = nextPeriod('MONTHLY', { currentPeriodEnd: null, trialEndsAt: null }, now);
    expect(p.periodStart).toEqual(now);
    expect(p.periodEnd).toEqual(new Date('2026-02-10T12:00:00Z'));
    expect(p.dueAt).toEqual(now); // não é depois de "now", então o vencimento é hoje
  });

  it('continua do fim do teste (mensal)', () => {
    const trialEndsAt = new Date('2026-03-01T00:00:00Z');
    const now = new Date('2026-02-24T00:00:00Z'); // dentro da janela de aviso, antes do fim do teste
    const p = nextPeriod('MONTHLY', { currentPeriodEnd: null, trialEndsAt }, now);
    expect(p.periodStart).toEqual(trialEndsAt);
    expect(p.periodEnd).toEqual(new Date('2026-04-01T00:00:00Z'));
    expect(p.dueAt).toEqual(trialEndsAt); // vencimento é o próprio fim do teste (ainda no futuro)
  });

  it('continua do fim do período pago (anual) e nunca vence no passado', () => {
    const currentPeriodEnd = new Date('2026-01-01T00:00:00Z'); // já passou
    const now = new Date('2026-01-05T00:00:00Z');
    const p = nextPeriod('YEARLY', { currentPeriodEnd, trialEndsAt: null }, now);
    expect(p.periodStart).toEqual(currentPeriodEnd); // o período continua contíguo, mesmo atrasado
    expect(p.periodEnd).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(p.dueAt).toEqual(now); // mas o prazo para pagar começa hoje, não numa data já vencida
  });
});

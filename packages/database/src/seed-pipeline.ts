import { DEFAULT_STAGES } from '@imob/types';
import type { PrismaClient } from './generated/client';

/** Garante que a empresa tem um funil ativo (com os estágios padrão). Idempotente. */
export async function ensureDefaultPipeline(prisma: Pick<PrismaClient, 'pipeline'>, companyId: string) {
  const existing = await prisma.pipeline.findFirst({
    where: { companyId, active: true },
    orderBy: { id: 'asc' },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  if (existing) return existing;
  try {
    return await prisma.pipeline.create({
      data: {
        companyId,
        name: 'Funil comercial',
        stages: {
          create: DEFAULT_STAGES.map((s, position) => ({
            name: s.name, position, color: s.color, type: s.type, qualifies: s.qualifies ?? false, metaEvent: s.metaEvent ?? null,
          })),
        },
      },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
  } catch (e) {
    // Duas requisições criando ao mesmo tempo: fica a que gravou primeiro.
    const again = await prisma.pipeline.findFirst({ where: { companyId, active: true }, orderBy: { id: 'asc' }, include: { stages: { orderBy: { position: 'asc' } } } });
    if (again) return again;
    throw e;
  }
}

/** Leads criados antes do CRM (Bloco 4) entram no primeiro estágio do funil. */
export async function backfillLeadStages(prisma: PrismaClient, companyId: string) {
  const pipeline = await ensureDefaultPipeline(prisma, companyId);
  const first = pipeline.stages[0];
  if (!first) return 0;
  const orphans = await prisma.lead.findMany({ where: { companyId, stageId: null }, select: { id: true, createdAt: true } });
  for (const l of orphans) {
    await prisma.lead.update({ where: { id: l.id }, data: { stageId: first.id, stageEnteredAt: l.createdAt } });
    // Histórico coerente com os leads novos: criação registrada na data original.
    await prisma.leadStageHistory.create({ data: { companyId, leadId: l.id, toStageId: first.id, createdAt: l.createdAt } });
    await prisma.timelineEvent.create({
      data: { companyId, leadId: l.id, type: 'LEAD_CREATED', title: 'Lead criado', description: 'Registrado antes do funil de CRM', createdAt: l.createdAt },
    });
  }
  return orphans.length;
}

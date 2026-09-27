import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type {
  HeartbeatInput, HeartbeatResponse, LicenseCreatedDto, LicenseDetailDto, LicenseInput, LicenseStatus, LicenseStatusInput, PlanLimits,
} from '@imob/types';
import { LICENSE_OK_STATUSES } from '@imob/types';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedStaff } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
/** "LIC-xxxxxxxxxxxxxxxxxxxxxxxx": só aparece por inteiro na criação (ou ao gerar uma nova). */
const newKey = () => `LIC-${randomBytes(24).toString('base64url')}`;
const HEARTBEAT_INTERVAL_SECONDS = 6 * 3600;

const include = {
  client: { select: { name: true } },
  plan: { select: { name: true } },
  usage: { orderBy: { reportedAt: 'desc' as const }, take: 20 },
  events: { orderBy: { createdAt: 'desc' as const }, take: 30, include: { staff: { select: { name: true } } } },
};
type LicenseRow = NonNullable<Awaited<ReturnType<PrismaService['license']['findFirst']>>> & {
  client: { name: string }; plan: { name: string };
  usage: { reportedAt: Date; counts: unknown }[];
  events: { id: string; type: string; message: string; createdAt: Date; staff: { name: string } | null }[];
};

@Injectable()
export class LicensesService {
  constructor(private readonly prisma: PrismaService) {}

  private detailDto(l: LicenseRow): LicenseDetailDto {
    return {
      id: l.id, status: l.status as LicenseStatus, planName: l.plan.name, keyPreview: l.keyPreview,
      lastSeenAt: l.lastSeenAt?.toISOString() ?? null, currentPeriodEnd: l.currentPeriodEnd?.toISOString() ?? null,
      clientId: l.clientId, clientName: l.client.name, planId: l.planId, trialEndsAt: l.trialEndsAt?.toISOString() ?? null,
      suspendedAt: l.suspendedAt?.toISOString() ?? null, suspendReason: l.suspendReason,
      instanceFingerprint: l.instanceFingerprint, instanceVersion: l.instanceVersion, instanceUrl: l.instanceUrl,
      createdAt: l.createdAt.toISOString(),
      usage: l.usage.map((u) => ({ reportedAt: u.reportedAt.toISOString(), counts: (u.counts ?? {}) as HeartbeatInput['counts'] })),
      events: l.events.map((e) => ({ id: e.id, type: e.type, message: e.message, createdAt: e.createdAt.toISOString(), staffName: e.staff?.name ?? null })),
    };
  }

  private async load(id: string) {
    const row = await this.prisma.license.findUnique({ where: { id }, include });
    if (!row) throw notFound('Licença não encontrada.');
    return row as unknown as LicenseRow;
  }

  private async log(licenseId: string, type: string, message: string, staffId?: string, data?: unknown) {
    await this.prisma.licenseEvent.create({ data: { licenseId, staffId, type, message, data: data as never } });
  }

  async list() {
    const rows = await this.prisma.license.findMany({ include, orderBy: { createdAt: 'desc' } });
    return (rows as unknown as LicenseRow[]).map((r) => this.detailDto(r));
  }

  async detail(id: string) {
    return this.detailDto(await this.load(id));
  }

  async create(input: LicenseInput, staff: AuthedStaff): Promise<LicenseCreatedDto> {
    const [client, plan] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: input.clientId } }),
      this.prisma.plan.findUnique({ where: { id: input.planId } }),
    ]);
    if (!client) throw new AppException('LICENSE_CLIENT_INVALID', 400);
    if (!plan) throw new AppException('LICENSE_PLAN_INVALID', 400);

    const key = newKey();
    const trialDays = input.trialDays ?? 14;
    const created = await this.prisma.license.create({
      data: {
        clientId: input.clientId, planId: input.planId, keyHash: sha256(key), keyPreview: key.slice(-4),
        status: 'TRIALING', trialEndsAt: trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000) : null,
      },
      include,
    });
    await this.log(created.id, 'created', `Licença criada para ${client.name} (plano ${plan.name}).`, staff.id);
    return { ...this.detailDto(created as unknown as LicenseRow), key };
  }

  /** Nova chave: a antiga para de funcionar imediatamente. Também libera a instalação para uma nova "impressão" (ex.: migração de VPS). */
  async regenerateKey(id: string, staff: AuthedStaff): Promise<LicenseCreatedDto> {
    await this.load(id);
    const key = newKey();
    const updated = await this.prisma.license.update({
      where: { id }, data: { keyHash: sha256(key), keyPreview: key.slice(-4), instanceFingerprint: null }, include,
    });
    await this.log(id, 'key_regenerated', 'Nova chave gerada; a instalação precisa ser reconfigurada.', staff.id);
    return { ...this.detailDto(updated as unknown as LicenseRow), key };
  }

  /** Libera a próxima instalação a se vincular (uso legítimo: cliente trocou de VPS). */
  async resetFingerprint(id: string, staff: AuthedStaff) {
    await this.load(id);
    await this.prisma.license.update({ where: { id }, data: { instanceFingerprint: null } });
    await this.log(id, 'fingerprint_reset', 'Vínculo com a instalação anterior foi liberado.', staff.id);
    return this.detail(id);
  }

  async setStatus(id: string, input: LicenseStatusInput, staff: AuthedStaff) {
    const current = await this.load(id);
    if (input.status === current.status) return this.detailDto(current);
    const data: Record<string, unknown> = { status: input.status };
    if (input.status === 'SUSPENDED') { data.suspendedAt = new Date(); data.suspendReason = input.reason ?? null; }
    else { data.suspendedAt = null; data.suspendReason = null; }
    const updated = await this.prisma.license.update({ where: { id }, data, include });
    await this.log(id, 'status_changed', `Status alterado de ${current.status} para ${input.status}.${input.reason ? ` Motivo: ${input.reason}` : ''}`, staff.id);
    return this.detailDto(updated as unknown as LicenseRow);
  }

  async changePlan(id: string, planId: string, staff: AuthedStaff) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new AppException('LICENSE_PLAN_INVALID', 400);
    const current = await this.load(id);
    const updated = await this.prisma.license.update({ where: { id }, data: { planId }, include });
    await this.log(id, 'plan_changed', `Plano alterado de ${current.plan.name} para ${plan.name}.`, staff.id);
    return this.detailDto(updated as unknown as LicenseRow);
  }

  // ---------- Confirmação periódica da instalação do cliente ----------
  async heartbeat(rawKey: string, input: HeartbeatInput): Promise<HeartbeatResponse> {
    const row = await this.prisma.license.findUnique({ where: { keyHash: sha256(rawKey) }, include: { plan: true } });
    if (!row) throw new AppException('LICENSE_KEY_INVALID', 401);

    if (row.instanceFingerprint && row.instanceFingerprint !== input.instanceFingerprint) {
      throw new AppException('LICENSE_FINGERPRINT_MISMATCH', 403);
    }

    let status = row.status;
    // Teste vencido sem virar plano pago: passa a bloquear sozinho, sem depender de ação manual.
    if (status === 'TRIALING' && row.trialEndsAt && row.trialEndsAt < new Date()) {
      status = 'SUSPENDED';
      await this.prisma.license.update({ where: { id: row.id }, data: { status, suspendedAt: new Date(), suspendReason: 'Período de teste encerrado.' } });
      await this.log(row.id, 'trial_expired', 'Período de teste encerrado sem conversão para plano pago.');
    }

    await this.prisma.license.update({
      where: { id: row.id },
      data: {
        instanceFingerprint: row.instanceFingerprint ?? input.instanceFingerprint,
        instanceVersion: input.version ?? row.instanceVersion,
        instanceUrl: input.instanceUrl ?? row.instanceUrl,
        lastSeenAt: new Date(),
      },
    });
    if (!row.instanceFingerprint) await this.log(row.id, 'first_seen', 'Primeira confirmação: instalação vinculada a esta chave.');
    await this.prisma.usageSnapshot.create({ data: { licenseId: row.id, counts: input.counts as never } });

    const ok = (LICENSE_OK_STATUSES as string[]).includes(status);
    const message = !ok
      ? (row.suspendReason ?? (status === 'CANCELED' ? 'Licença cancelada.' : 'Licença suspensa. Fale com o suporte.'))
      : status === 'PAST_DUE' ? 'Pagamento em atraso. Regularize para evitar a suspensão.' : null;

    return {
      status: status as LicenseStatus, ok, planKey: row.plan.key, planName: row.plan.name, limits: (row.plan.limits ?? {}) as PlanLimits,
      message, currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null, trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      checkAgainInSeconds: HEARTBEAT_INTERVAL_SECONDS,
    };
  }
}

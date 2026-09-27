import { Injectable } from '@nestjs/common';
import type { ClientDto, ClientInput, LicenseStatus } from '@imob/types';
import { AppException, notFound } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';

const include = {
  licenses: {
    include: { plan: { select: { name: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
};

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  private dto(c: { id: string; name: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; notes: string | null; createdAt: Date; licenses: { id: string; status: string; keyPreview: string; lastSeenAt: Date | null; currentPeriodEnd: Date | null; plan: { name: string } }[] }): ClientDto {
    return {
      id: c.id, name: c.name, contactName: c.contactName, contactEmail: c.contactEmail, contactPhone: c.contactPhone, notes: c.notes,
      createdAt: c.createdAt.toISOString(),
      licenses: c.licenses.map((l) => ({
        id: l.id, status: l.status as LicenseStatus, planName: l.plan.name, keyPreview: l.keyPreview,
        lastSeenAt: l.lastSeenAt?.toISOString() ?? null, currentPeriodEnd: l.currentPeriodEnd?.toISOString() ?? null,
      })),
    };
  }

  async list() {
    const rows = await this.prisma.client.findMany({ include, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.dto(r));
  }

  async detail(id: string) {
    const row = await this.prisma.client.findUnique({ where: { id }, include });
    if (!row) throw notFound('Cliente não encontrado.');
    return this.dto(row);
  }

  async create(input: ClientInput) {
    const created = await this.prisma.client.create({ data: { ...input, contactEmail: input.contactEmail || null }, include });
    return this.dto(created);
  }

  async update(id: string, input: Partial<ClientInput>) {
    const exists = await this.prisma.client.findUnique({ where: { id } });
    if (!exists) throw new AppException('LICENSE_CLIENT_INVALID', 404);
    const updated = await this.prisma.client.update({ where: { id }, data: { ...input, contactEmail: input.contactEmail || undefined }, include });
    return this.dto(updated);
  }
}

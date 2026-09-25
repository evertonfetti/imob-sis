import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Qual empresa o site público representa.
 * V1: uma empresa (PUBLIC_COMPANY_ID, ou a mais antiga). No SaaS, este é o ponto que passa a resolver por domínio.
 */
@Injectable()
export class PublicCompanyService {
  private cache?: { id: string; at: number };
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  async id(): Promise<string> {
    if (this.env.PUBLIC_COMPANY_ID) return this.env.PUBLIC_COMPANY_ID;
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.id;
    const c = await this.prisma.company.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!c) throw new Error('Nenhuma empresa ativa cadastrada');
    this.cache = { id: c.id, at: Date.now() };
    return c.id;
  }
}

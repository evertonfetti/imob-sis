import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { featureSchema, propertyTypeSchema, slugify } from '@imob/types';
import { z } from 'zod';
import { AuditService, diff, sanitize } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { blankToNull } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

type TypeInput = z.infer<typeof propertyTypeSchema>;
type FeatureInput = z.infer<typeof featureSchema>;

/** Tipos de imóvel e características: listas configuráveis por empresa. */
@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get('property-types')
  @RequirePermissions('property.view')
  types(@Ctx() ctx: ReqCtx) {
    return this.prisma.propertyType.findMany({ where: { companyId: ctx.user!.companyId }, orderBy: { name: 'asc' } });
  }

  @Post('property-types')
  @RequirePermissions('property.edit')
  async createType(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(propertyTypeSchema)) body: TypeInput) {
    const { companyId } = ctx.user!;
    if (await this.prisma.propertyType.findUnique({ where: { companyId_name: { companyId, name: body.name } } })) {
      throw new AppException('CATALOG_NAME_TAKEN', 409);
    }
    const row = await this.prisma.propertyType.create({ data: { companyId, name: body.name, active: body.active ?? true } });
    await this.audit.record({ companyId, entity: 'PROPERTY_TYPE', entityId: row.id, action: 'CREATE', after: sanitize(row), ctx });
    return row;
  }

  @Patch('property-types/:id')
  @RequirePermissions('property.edit')
  async updateType(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(propertyTypeSchema.partial())) body: Partial<TypeInput>) {
    const { companyId } = ctx.user!;
    const current = await this.prisma.propertyType.findFirst({ where: { id, companyId } });
    if (!current) throw notFound('Tipo não encontrado.');
    if (body.name && body.name !== current.name && (await this.prisma.propertyType.findUnique({ where: { companyId_name: { companyId, name: body.name } } }))) {
      throw new AppException('CATALOG_NAME_TAKEN', 409);
    }
    const row = await this.prisma.propertyType.update({ where: { id }, data: body });
    const d = diff(sanitize(current), sanitize(row));
    if (d.changed) await this.audit.record({ companyId, entity: 'PROPERTY_TYPE', entityId: id, action: 'UPDATE', before: d.before, after: d.after, ctx });
    return row;
  }

  @Get('features')
  @RequirePermissions('property.view')
  features(@Ctx() ctx: ReqCtx) {
    return this.prisma.feature.findMany({ where: { companyId: ctx.user!.companyId }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  @Post('features')
  @RequirePermissions('property.edit')
  async createFeature(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(featureSchema)) body: FeatureInput) {
    const { companyId } = ctx.user!;
    const slug = slugify(body.name);
    if (await this.prisma.feature.findUnique({ where: { companyId_slug: { companyId, slug } } })) {
      throw new AppException('CATALOG_NAME_TAKEN', 409);
    }
    const row = await this.prisma.feature.create({ data: { ...blankToNull(body), companyId, slug } as never });
    await this.audit.record({ companyId, entity: 'FEATURE', entityId: row.id, action: 'CREATE', after: sanitize(row), ctx });
    return row;
  }

  @Patch('features/:id')
  @RequirePermissions('property.edit')
  async updateFeature(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(featureSchema.partial())) body: Partial<FeatureInput>) {
    const { companyId } = ctx.user!;
    const current = await this.prisma.feature.findFirst({ where: { id, companyId } });
    if (!current) throw notFound('Característica não encontrada.');
    const data: Record<string, unknown> = { ...blankToNull(body) };
    if (body.name && body.name !== current.name) {
      const slug = slugify(body.name);
      if (slug !== current.slug && (await this.prisma.feature.findUnique({ where: { companyId_slug: { companyId, slug } } }))) {
        throw new AppException('CATALOG_NAME_TAKEN', 409);
      }
      data.slug = slug;
    }
    const row = await this.prisma.feature.update({ where: { id }, data });
    const d = diff(sanitize(current), sanitize(row));
    if (d.changed) await this.audit.record({ companyId, entity: 'FEATURE', entityId: id, action: 'UPDATE', before: d.before, after: d.after, ctx });
    return row;
  }
}

import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS } from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { AuthedUser, CurrentUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Papéis da empresa com suas permissões (matriz somente leitura na V1). */
  @Get()
  @RequirePermissions('admin.users')
  async list(@CurrentUser() user: AuthedUser) {
    const roles = await this.prisma.role.findMany({
      where: { companyId: user.companyId },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      roles: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        userCount: r._count.users,
        permissions: r.permissions.map((p) => p.permission.key),
      })),
      permissions: Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })),
    };
  }
}

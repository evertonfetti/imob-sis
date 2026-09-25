import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { JwtAuthGuard, PermissionsGuard } from './common/guards';
import { CatalogModule } from './catalog/catalog.module';
import { CompanyModule } from './company/company.module';
import { ENV, Env } from './config/env';
import { HealthController } from './health/health.controller';
import { CommercialModule } from './commercial/commercial.module';
import { CrmModule } from './crm/crm.module';
import { MarketingModule } from './marketing/marketing.module';
import { MediaModule } from './media/media.module';
import { OwnersModule } from './owners/owners.module';
import { PrismaModule } from './prisma/prisma.module';
import { PropertiesModule } from './properties/properties.module';
import { PublicModule } from './public/public.module';
import { RolesController } from './roles/roles.controller';
import { SocialModule } from './social/social.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ limit: 300, ttl: 60_000 }],
          skipIf: () => env.NODE_ENV === 'test',
        }),
        EventEmitterModule.forRoot(),
        PrismaModule,
        AuditModule,
        StorageModule,
        AuthModule,
        UsersModule,
        CompanyModule,
        OwnersModule,
        CatalogModule,
        MediaModule,
        CrmModule,
        CommercialModule,
        WhatsappModule,
        MarketingModule,
        SocialModule,
        PublicModule,
        PropertiesModule,
      ],
      controllers: [HealthController, RolesController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Ordem importa: throttle → autenticação → permissões
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
      exports: [ENV],
      global: true,
    };
  }
}

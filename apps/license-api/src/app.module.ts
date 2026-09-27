import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { ClientsModule } from './clients/clients.module';
import { ENV, Env } from './config/env';
import { HealthController } from './health/health.controller';
import { LicensesModule } from './licenses/licenses.module';
import { PlansModule } from './plans/plans.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ThrottlerModule.forRoot({ throttlers: [{ limit: 300, ttl: 60_000 }], skipIf: () => env.NODE_ENV === 'test' }),
        PrismaModule,
        AuthModule,
        BillingModule,
        ClientsModule,
        PlansModule,
        LicensesModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
      exports: [ENV],
      global: true,
    };
  }
}

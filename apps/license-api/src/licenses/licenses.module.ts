import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';

@Module({ imports: [BillingModule], controllers: [LicensesController], providers: [LicensesService], exports: [LicensesService] })
export class LicensesModule {}

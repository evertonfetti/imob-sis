import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { MarketingModule } from '../marketing/marketing.module';
import { PublicCompanyService } from './public-company.service';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({ imports: [CrmModule, MarketingModule], controllers: [PublicController], providers: [PublicService, PublicCompanyService] })
export class PublicModule {}

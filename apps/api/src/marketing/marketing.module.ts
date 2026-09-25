import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingListener } from './marketing.listeners';
import { MarketingQueue } from './marketing.queue';
import { MarketingReportsService } from './marketing-reports.service';
import { MarketingService } from './marketing.service';
import { MetaConversionsService } from './meta-conversions.service';
import { MetaIntegrationService } from './meta-integration.service';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService, MarketingQueue, MarketingListener, MarketingReportsService, MetaConversionsService, MetaIntegrationService],
  exports: [MetaIntegrationService],
})
export class MarketingModule {}

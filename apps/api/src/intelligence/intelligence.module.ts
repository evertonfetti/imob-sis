import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { AlertsService } from './alerts.service';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceListener } from './intelligence.listeners';
import { IntelligenceScheduler } from './intelligence.scheduler';
import { LeadScoreService } from './lead-score.service';
import { MatchingService } from './matching.service';
import { IntelligenceSettingsService } from './settings.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [CrmModule],
  controllers: [IntelligenceController],
  providers: [IntelligenceSettingsService, LeadScoreService, MatchingService, ReportsService, AlertsService, IntelligenceListener, IntelligenceScheduler],
})
export class IntelligenceModule {}

import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { CommercialSummaryService } from './commercial-summary.service';
import { CommercialController, ProposalsController, VisitsController } from './commercial.controllers';
import { CommercialListener } from './commercial.listeners';
import { CommercialScheduler } from './commercial.scheduler';
import { ProposalsService } from './proposals.service';
import { VisitsService } from './visits.service';

@Module({
  imports: [CrmModule],
  controllers: [VisitsController, ProposalsController, CommercialController],
  providers: [VisitsService, ProposalsService, CommercialSummaryService, CommercialListener, CommercialScheduler],
})
export class CommercialModule {}

import { Module } from '@nestjs/common';
import { CustomersImportExportService } from './customers-import-export.service';
import { CrmAutomationListener, TimelineListener } from './crm.listeners';
import { CustomersController, LeadsController, PipelineController, TasksController } from './crm.controllers';
import { CustomersService } from './customers.service';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';
import { TasksService } from './tasks.service';

@Module({
  controllers: [LeadsController, PipelineController, CustomersController, TasksController],
  providers: [LeadsService, PipelineService, CustomersService, CustomersImportExportService, TasksService, TimelineListener, CrmAutomationListener],
  exports: [LeadsService, PipelineService, TasksService],
})
export class CrmModule {}

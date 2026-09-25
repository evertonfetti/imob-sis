import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { ConversationsController, IntegrationsController, MessagesController, WhatsappWebhookController } from './whatsapp.controllers';
import { IntegrationsService } from './integrations.service';
import { WhatsappTimelineListener } from './whatsapp.listeners';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [CrmModule],
  controllers: [WhatsappWebhookController, ConversationsController, MessagesController, IntegrationsController],
  providers: [WhatsappService, IntegrationsService, WhatsappTimelineListener],
  exports: [WhatsappService, IntegrationsService],
})
export class WhatsappModule {}

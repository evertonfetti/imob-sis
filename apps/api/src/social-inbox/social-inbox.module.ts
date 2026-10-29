import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { SocialModule } from '../social/social.module';
import { InstagramWebhookController, MessengerWebhookController } from './social-inbox.controller';
import { SocialInboxTimelineListener } from './social-inbox.listeners';
import { SocialInboxService } from './social-inbox.service';

@Module({
  imports: [CrmModule, SocialModule],
  controllers: [MessengerWebhookController, InstagramWebhookController],
  providers: [SocialInboxService, SocialInboxTimelineListener],
  exports: [SocialInboxService],
})
export class SocialInboxModule {}

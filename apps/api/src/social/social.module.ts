import { Module } from '@nestjs/common';
import { SocialAccountsService } from './social-accounts.service';
import { SocialMediaService } from './social-media.service';
import { SocialPostsService } from './social-posts.service';
import { SocialPublisher } from './social-publisher.service';
import { SocialController } from './social.controller';

@Module({
  controllers: [SocialController],
  providers: [SocialAccountsService, SocialPostsService, SocialPublisher, SocialMediaService],
})
export class SocialModule {}

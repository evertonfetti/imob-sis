import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { MediaController } from './media.controller';
import { MediaProcessor } from './media.processor';
import { MediaQueue } from './media.queue';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController, BrandingController],
  providers: [MediaService, MediaQueue, MediaProcessor, BrandingService],
  exports: [MediaService, MediaQueue],
})
export class MediaModule {}

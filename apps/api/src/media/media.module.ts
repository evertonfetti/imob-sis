import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaProcessor } from './media.processor';
import { MediaQueue } from './media.queue';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaQueue, MediaProcessor],
  exports: [MediaService],
})
export class MediaModule {}

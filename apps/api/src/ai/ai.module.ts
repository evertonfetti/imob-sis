import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AiController } from './ai.controller';
import { AiImagesService } from './ai-images.service';
import { AiSettingsService } from './ai-settings.service';

@Module({ imports: [MediaModule], controllers: [AiController], providers: [AiSettingsService, AiImagesService] })
export class AiModule {}

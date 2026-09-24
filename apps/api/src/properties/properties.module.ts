import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';

@Module({ imports: [MediaModule], controllers: [PropertiesController], providers: [PropertiesService] })
export class PropertiesModule {}

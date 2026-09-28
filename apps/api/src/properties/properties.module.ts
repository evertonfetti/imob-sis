import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { PropertiesImportExportService } from './properties-import-export.service';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';

@Module({ imports: [MediaModule], controllers: [PropertiesController], providers: [PropertiesService, PropertiesImportExportService] })
export class PropertiesModule {}

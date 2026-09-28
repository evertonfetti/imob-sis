import { Module } from '@nestjs/common';
import { OwnersImportExportService } from './owners-import-export.service';
import { OwnersController } from './owners.controller';
import { OwnersService } from './owners.service';

@Module({ controllers: [OwnersController], providers: [OwnersService, OwnersImportExportService] })
export class OwnersModule {}

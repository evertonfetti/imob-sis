import { Global, Module } from '@nestjs/common';
import { LocalStorageController } from './local-storage.controller';
import { StorageService } from './storage.service';

@Global()
@Module({ controllers: [LocalStorageController], providers: [StorageService], exports: [StorageService] })
export class StorageModule {}

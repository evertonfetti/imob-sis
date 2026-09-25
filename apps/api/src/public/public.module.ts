import { Module } from '@nestjs/common';
import { PublicCompanyService } from './public-company.service';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({ controllers: [PublicController], providers: [PublicService, PublicCompanyService] })
export class PublicModule {}

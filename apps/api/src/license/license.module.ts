import { Global, Module } from '@nestjs/common';
import { LicenseService } from './license.service';

// Global: os limites do plano (Fase 3) são conferidos em vários módulos (usuários, imóveis, redes sociais, IA, agente).
@Global()
@Module({ providers: [LicenseService], exports: [LicenseService] })
export class LicenseModule {}

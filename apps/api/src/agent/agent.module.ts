import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CrmModule } from '../crm/crm.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AgentSettingsService } from './agent-settings.service';
import { AgentController } from './agent.controller';
import { AgentListener } from './agent.listener';
import { AgentService } from './agent.service';
import { KnowledgeService } from './knowledge.service';

// O AgentListener escuta tanto o WhatsApp quanto o inbox de Messenger/Instagram (EventEmitter2 é global:
// não é preciso importar o módulo de quem emite o evento, só conhecer o nome dele).
@Module({
  imports: [AiModule, CrmModule, IntelligenceModule, WhatsappModule],
  controllers: [AgentController],
  providers: [AgentSettingsService, KnowledgeService, AgentService, AgentListener],
})
export class AgentModule {}

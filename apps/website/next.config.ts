import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: inclui no build standalone os pacotes do workspace (@imob/types).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  // Não gera AGENTS.md/CLAUDE.md sozinho a cada "next dev": as instruções de agente do projeto já ficam em CLAUDE.md na raiz.
  agentRules: false,
};

export default config;

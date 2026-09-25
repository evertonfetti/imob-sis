import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: inclui no build standalone os pacotes do workspace (@imob/types).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
};

export default config;

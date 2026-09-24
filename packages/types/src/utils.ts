export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const DEFAULT_PROPERTY_TYPES = [
  'Casa', 'Apartamento', 'Sobrado', 'Cobertura', 'Kitnet', 'Terreno', 'Condomínio', 'Comercial', 'Galpão', 'Rural',
];

export const DEFAULT_FEATURES: { name: string; category: string }[] = [
  { name: 'Piscina', category: 'Lazer' },
  { name: 'Churrasqueira', category: 'Lazer' },
  { name: 'Varanda Gourmet', category: 'Lazer' },
  { name: 'Academia', category: 'Condomínio' },
  { name: 'Salão de Festas', category: 'Condomínio' },
  { name: 'Playground', category: 'Condomínio' },
  { name: 'Portaria 24h', category: 'Segurança' },
  { name: 'Câmeras de Segurança', category: 'Segurança' },
  { name: 'Móveis Planejados', category: 'Interior' },
  { name: 'Ar-condicionado', category: 'Interior' },
  { name: 'Energia Solar', category: 'Sustentabilidade' },
  { name: 'Aceita Pets', category: 'Geral' },
];

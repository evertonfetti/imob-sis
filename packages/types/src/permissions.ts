export const PERMISSIONS = {
  // Administração
  'admin.company': 'Gerenciar dados da empresa',
  'admin.branch': 'Gerenciar filiais',
  'admin.users': 'Gerenciar usuários',
  'admin.roles': 'Gerenciar papéis e permissões',
  'admin.audit': 'Consultar auditoria',
  // Imóveis
  'property.view': 'Ver imóveis',
  'property.create': 'Criar imóveis',
  'property.edit': 'Editar imóveis',
  'property.delete': 'Excluir imóveis',
  'property.publish': 'Publicar imóveis',
  'property.archive': 'Arquivar imóveis',
  // Mídia
  'media.view': 'Ver mídias',
  'media.upload': 'Enviar mídias',
  'media.delete': 'Excluir mídias',
  'media.ai_edit': 'Editar mídias com IA',
  // Leads
  'lead.view': 'Ver leads',
  'lead.create': 'Criar leads',
  'lead.edit': 'Editar leads',
  'lead.assign': 'Distribuir leads',
  'lead.delete': 'Excluir leads',
  'lead.export': 'Exportar leads',
  'lead.view_all': 'Ver leads de todos os corretores',
  // CRM
  'crm.pipeline': 'Movimentar pipeline',
  'crm.manage': 'Configurar CRM',
  // Visitas
  'visit.view': 'Ver visitas',
  'visit.create': 'Agendar visitas',
  'visit.edit': 'Editar visitas',
  // Propostas
  'proposal.view': 'Ver propostas',
  'proposal.create': 'Criar propostas',
  'proposal.manage': 'Gerenciar propostas',
  // Marketing
  'marketing.view': 'Ver marketing',
  'marketing.manage': 'Gerenciar marketing',
  'marketing.capi': 'Gerenciar Conversions API',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = ['ADMIN', 'MANAGER', 'BROKER', 'MARKETING', 'ATTENDANT'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  BROKER: 'Corretor',
  MARKETING: 'Marketing',
  ATTENDANT: 'Atendimento',
};

const startsWith = (...prefixes: string[]) =>
  ALL_PERMISSIONS.filter((p) => prefixes.some((x) => p.startsWith(x)));

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  ADMIN: ALL_PERMISSIONS,
  MANAGER: [
    ...startsWith('property.', 'media.', 'lead.', 'crm.', 'visit.', 'proposal.', 'marketing.view'),
    'admin.users',
  ],
  BROKER: [
    'property.view', 'property.create', 'property.edit',
    'media.view', 'media.upload',
    'lead.view', 'lead.create', 'lead.edit',
    'crm.pipeline',
    'visit.view', 'visit.create', 'visit.edit',
    'proposal.view', 'proposal.create',
  ],
  MARKETING: [
    'property.view', 'property.publish',
    'media.view', 'media.upload', 'media.ai_edit',
    'lead.view', 'lead.view_all',
    'marketing.view', 'marketing.manage', 'marketing.capi',
  ],
  ATTENDANT: [
    'property.view', 'media.view',
    'lead.view', 'lead.view_all', 'lead.create', 'lead.edit', 'lead.assign',
    'crm.pipeline',
    'visit.view', 'visit.create', 'visit.edit',
  ],
};

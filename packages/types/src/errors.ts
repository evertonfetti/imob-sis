export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export const ERROR_CODES = {
  VALIDATION_FAILED: 'Os dados informados são inválidos.',
  AUTH_INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  AUTH_USER_INACTIVE: 'Este usuário está inativo ou bloqueado.',
  AUTH_TOKEN_INVALID: 'Sessão inválida ou expirada.',
  AUTH_REFRESH_INVALID: 'Sessão expirada. Faça login novamente.',
  AUTH_RESET_INVALID: 'O link de redefinição é inválido ou expirou.',
  AUTH_FORBIDDEN: 'Você não tem permissão para esta ação.',
  AUTH_WEAK_PASSWORD: 'A senha deve ter ao menos 10 caracteres, com letras e números.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um instante e tente novamente.',
  NOT_FOUND: 'Registro não encontrado.',
  USER_EMAIL_TAKEN: 'Já existe um usuário com este e-mail.',
  USER_SELF_DELETE: 'Você não pode excluir o seu próprio usuário.',
  USER_ROLE_INVALID: 'O papel informado não existe.',
  BRANCH_INVALID: 'A filial informada não existe.',
  PROPERTY_INVALID_PRICE: 'O valor informado para o imóvel é inválido.',
  PROPERTY_INCOMPLETE: 'Complete os dados obrigatórios antes de publicar o imóvel.',
  PROPERTY_NOT_DELETABLE: 'Só é possível excluir imóveis em rascunho. Use "Arquivar" para os demais.',
  PROPERTY_STATUS_INVALID: 'Use a ação "Arquivar" para arquivar o imóvel.',
  PROPERTY_TYPE_INVALID: 'O tipo de imóvel informado não existe.',
  OWNER_INVALID: 'O proprietário informado não existe.',
  OWNER_HAS_PROPERTIES: 'Este proprietário possui imóveis vinculados e não pode ser excluído.',
  BROKER_INVALID: 'O corretor informado não existe ou está inativo.',
  FEATURE_INVALID: 'Uma ou mais características informadas não existem.',
  CATALOG_NAME_TAKEN: 'Já existe um item com este nome.',
  INTERNAL_ERROR: 'Ocorreu um erro inesperado. Tente novamente.',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

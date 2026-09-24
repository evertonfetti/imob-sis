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
  INTERNAL_ERROR: 'Ocorreu um erro inesperado. Tente novamente.',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

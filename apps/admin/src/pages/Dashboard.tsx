import type { Paginated } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CircleDollarSign, FileSignature, Home, MessageCircleWarning, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { brl } from '../lib/money';

const STATS = [
  { label: 'Imóveis disponíveis', icon: Home, block: 2 },
  { label: 'Novos leads', icon: UserPlus, block: 5 },
  { label: 'Leads sem atendimento', icon: MessageCircleWarning, block: 5 },
  { label: 'Visitas hoje', icon: CalendarClock, block: 9 },
  { label: 'Propostas abertas', icon: FileSignature, block: 9 },
  { label: 'Vendas', icon: CircleDollarSign, block: 9 },
];

const ACTIONS: Record<string, string> = {
  LOGIN: 'entrou no sistema', LOGOUT: 'saiu do sistema', CREATE: 'criou', UPDATE: 'atualizou', DEACTIVATE: 'desativou',
  ROLE_CHANGE: 'alterou o papel de', STAGE_CHANGE: 'moveu no funil', ASSIGN: 'atribuiu', PUBLISH: 'publicou', MEDIA_ADDED: 'adicionou arquivo em', MEDIA_REMOVED: 'removeu arquivo de', COVER_CHANGED: 'alterou a capa de', UNPUBLISH: 'despublicou', ARCHIVE: 'arquivou', DELETE: 'excluiu', PASSWORD_RESET: 'redefiniu a senha', LOGIN_FAILED: 'errou a senha', COUNTER: 'registrou uma contraproposta em', CLOSE_DEAL: 'fechou o negócio de', RESCHEDULE: 'remarcou', CONNECT: 'conectou', DISCONNECT: 'desconectou', ACTIVATE: 'ativou', SOCIAL_PUBLISHED: 'publicou nas redes',
};
const ENTITIES: Record<string, string> = { AUTH: '', VISIT: 'uma visita', PROPOSAL: 'uma proposta', USER: 'um usuário', COMPANY: 'a empresa', BRANCH: 'uma filial', PROPERTY: 'um imóvel', LEAD: 'um lead', CUSTOMER: 'um cliente', INTEGRATION: 'uma integração', SOCIAL_ACCOUNT: 'uma conta de rede social', PIPELINE_STAGE: 'uma etapa do funil', OWNER: 'um proprietário', PROPERTY_TYPE: 'um tipo de imóvel', FEATURE: 'uma característica' };

interface AuditItem { id: string; action: string; entity: string; userName: string | null; createdAt: string }

export function Dashboard() {
  const { user, can } = useAuth();
  const canAudit = can('admin.audit');
  const audit = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => api<Paginated<AuditItem>>('/audit-logs?pageSize=8'),
    enabled: canAudit,
  });
  const props = useQuery({
    queryKey: ['properties', 'summary'],
    queryFn: () => api<Record<string, number>>('/properties/summary'),
    enabled: can('property.view'),
  });
  const leads = useQuery({
    queryKey: ['leads', 'summary'],
    queryFn: () => api<{ last7Days: number; total: number; unattended: number; overdueTasks: number }>('/leads/summary'),
    enabled: can('lead.view'),
  });
  const commercial = useQuery({
    queryKey: ['commercial', 'summary'],
    queryFn: () => api<{ visitsToday: number; visitsWeek: number; openProposals: { count: number; value: number }; acceptedProposals: { count: number; value: number } }>('/commercial/summary'),
    enabled: can('visit.view'),
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <>
      <PageHeader title={`${greeting}, ${user!.name.split(' ')[0]}`} subtitle="Um resumo da operação da sua imobiliária." />

      <div className="stats">
        {STATS.map((s) => (
          <div key={s.label} className="card stat">
            <div className="stat-label">{s.label}<s.icon /></div>
            {s.label === 'Novos leads' && leads.data ? (
              <>
                <div className="stat-value">{leads.data.last7Days}</div>
                <div className="stat-foot">nos últimos 7 dias · {leads.data.total} no total</div>
              </>
            ) : s.label === 'Leads sem atendimento' && leads.data ? (
              <>
                <div className="stat-value">{leads.data.unattended}</div>
                <div className="stat-foot">{leads.data.unattended === 0 ? 'todos os leads foram atendidos' : 'parados na primeira etapa do funil'}{leads.data.overdueTasks ? ` · ${leads.data.overdueTasks} tarefa(s) atrasada(s)` : ''}</div>
              </>
            ) : s.label === 'Imóveis disponíveis' && props.data ? (
              <>
                <div className="stat-value">{props.data.AVAILABLE ?? 0}</div>
                <div className="stat-foot">{props.data.published ?? 0} publicados no site · {props.data.DRAFT ?? 0} rascunhos</div>
              </>
            ) : s.label === 'Visitas hoje' && commercial.data ? (
              <>
                <div className="stat-value">{commercial.data.visitsToday}</div>
                <div className="stat-foot">{commercial.data.visitsWeek} nos próximos 7 dias</div>
              </>
            ) : s.label === 'Propostas abertas' && commercial.data ? (
              <>
                <div className="stat-value">{commercial.data.openProposals.count}</div>
                <div className="stat-foot">{commercial.data.openProposals.count ? `${brl(commercial.data.openProposals.value)} em negociação` : 'nenhuma negociação em andamento'}</div>
              </>
            ) : s.label === 'Vendas' && commercial.data ? (
              <>
                <div className="stat-value">{commercial.data.acceptedProposals.count}</div>
                <div className="stat-foot">{commercial.data.acceptedProposals.count ? `${brl(commercial.data.acceptedProposals.value)} em propostas aceitas` : 'nenhuma proposta aceita ainda'}</div>
              </>
            ) : (
              <>
                <div className="stat-value muted">—</div>
                <div className="stat-foot">Disponível com o Bloco {s.block}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><div><div className="card-title">Atividade recente</div><div className="card-sub">Últimas ações registradas no sistema</div></div>
            {canAudit && <Link to="/auditoria" className="btn btn-ghost">Ver tudo</Link>}
          </div>
          {!canAudit ? <div className="empty">Você não tem acesso ao histórico de atividades.</div>
            : audit.isLoading ? <div className="empty"><span>Carregando…</span></div>
            : !audit.data?.items.length ? <div className="empty">Nenhuma atividade ainda.</div>
            : (
              <ul className="feed">
                {audit.data.items.map((a) => (
                  <li key={a.id}>
                    <span className="feed-dot" />
                    <div className="feed-text"><b>{a.userName ?? 'Sistema'}</b> {ACTIONS[a.action] ?? (a.action.startsWith('STATUS_') ? 'alterou a situação de' : a.action.toLowerCase())} {ENTITIES[a.entity] ?? ''}</div>
                    <span className="feed-time">{timeAgo(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="card">
          <div className="card-head"><div><div className="card-title">Primeiros passos</div><div className="card-sub">Configure a base da operação</div></div></div>
          <ol className="steps">
            <li className="step done"><span className="step-n">✓</span><div><div className="step-t">Acessar o painel</div><div className="step-d">Sua conta está ativa.</div></div></li>
            {can('admin.company') && <li className="step"><span className="step-n">2</span><div><Link to="/empresa" className="step-t">Completar dados da empresa</Link><div className="step-d">Nome, CRECI, contatos e identidade visual.</div></div></li>}
            {can('admin.users') && <li className="step"><span className="step-n">3</span><div><Link to="/usuarios" className="step-t">Convidar a equipe</Link><div className="step-d">Cadastre corretores, atendentes e marketing.</div></div></li>}
            {can('property.create') && <li className="step"><span className="step-n">4</span><div><Link to="/imoveis/novo" className="step-t">Cadastrar o primeiro imóvel</Link><div className="step-d">Dados, valores, endereço e características.</div></div></li>}
          </ol>
        </section>
      </div>
    </>
  );
}

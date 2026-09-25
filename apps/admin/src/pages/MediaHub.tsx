import { AI_OPERATION_LABELS, type MediaOverviewDto } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, ImageIcon, Settings2, Sparkles, Stamp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Empty, PageHeader, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';

const STATUS = { QUEUED: ['Na fila', 'warn'], PROCESSING: ['Gerando', 'warn'], READY: ['Pronta', 'ok'], FAILED: ['Falhou', 'danger'] } as const;

/** Central de fotos e IA: números, o que precisa de atenção e o histórico de edições. As edições em si acontecem na galeria de cada imóvel. */
export function MediaHub() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['media-overview'], queryFn: () => api<MediaOverviewDto>('/media/overview'), refetchInterval: 15_000 });
  const d = q.data;
  const admin = can('admin.company');

  return (
    <>
      <PageHeader title="Mídia / IA" subtitle="Suas fotos, as edições por inteligência artificial e a marca d’água, em um só lugar."
        actions={admin && <Link className="btn" to="/empresa?aba=images"><Settings2 /> Contas de IA e marca d’água</Link>} />
      {!d ? <div className="card"><SkeletonRows rows={6} /></div> : (
        <>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <div className="card stat"><div className="stat-label">Fotos publicáveis<ImageIcon /></div><div className="stat-value">{d.totals.images}</div><div className="stat-foot">{d.totals.processing ? `${d.totals.processing} processando` : 'todas processadas'}{d.totals.failed ? ` · ${d.totals.failed} com falha` : ''}</div></div>
            <div className="card stat"><div className="stat-label">Editadas por IA<Sparkles /></div><div className="stat-value">{d.totals.aiModified}</div><div className="stat-foot">{d.totals.aiModified ? 'aparecem no site com aviso' : 'nenhuma versão de IA publicada'}</div></div>
            <div className="card stat"><div className="stat-label">Precisam de atenção<AlertTriangle /></div><div className="stat-value">{d.attention.length}</div><div className="stat-foot">{d.totals.propertiesWithoutPhotos ? `${d.totals.propertiesWithoutPhotos} publicados sem foto` : 'imóveis com poucas fotos ou falhas'}</div></div>
            <div className="card stat"><div className="stat-label">Marca d’água<Stamp /></div><div className="stat-value" style={{ fontSize: 28, marginTop: 18 }}>{d.totals.watermark.enabled ? 'Ativa' : 'Desativada'}</div><div className="stat-foot">{d.totals.watermark.outdated ? `${d.totals.watermark.outdated} fotos para atualizar` : 'fotos em dia'}</div></div>
          </div>

          <div className="two-col" style={{ marginBottom: 20 }}>
            <section className="card">
              <div className="card-head"><div><div className="card-title">Precisa de atenção</div><div className="card-sub">Imóveis no ar com poucas fotos ou com foto que falhou</div></div></div>
              {!d.attention.length ? <div className="empty"><Check /><strong>Tudo certo</strong><span>Os imóveis publicados têm fotos suficientes.</span></div> : (
                <ul className="alerts">
                  {d.attention.map((a) => (
                    <li key={a.propertyId + a.reason}><Link to={`/imoveis/${a.propertyId}`}><span className={`alert-dot ${a.photos === 0 ? 'danger' : 'warn'}`}><AlertTriangle size={13} /></span><span className="alert-text"><strong>{a.code} · {a.title}</strong><small>{a.reason}</small></span></Link></li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <div className="card-head"><div><div className="card-title">Uso de IA neste mês</div><div className="card-sub">Edições com modelos pagos (o modo básico não conta)</div></div></div>
              <div className="section-body" style={{ display: 'grid', gap: 12 }}>
                <div><span className="stat-value" style={{ marginTop: 0, fontSize: 34 }}>{d.usage.generations}</span> <span className="card-sub">de {d.usage.monthlyLimit} edições · ≈ US$ {d.usage.cost.toFixed(2)}</span></div>
                <div className="bar-track" style={{ height: 8 }}><i style={{ width: `${Math.min(100, (d.usage.generations / Math.max(1, d.usage.monthlyLimit)) * 100)}%` }} /></div>
                <div className="card-sub">Para editar uma foto, abra o imóvel e clique no botão ✨ da foto. Cada edição vira uma versão que você aprova antes de publicar; o original nunca é alterado.</div>
                <Link className="btn" to="/imoveis">Ir para os imóveis</Link>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-head"><div><div className="card-title">Últimas edições por IA</div><div className="card-sub">Histórico com modelo, custo e situação de cada versão</div></div></div>
            {!d.recent.length ? <Empty icon={<Sparkles />} title="Nenhuma edição ainda" hint="No imóvel, use o botão ✨ de uma foto para melhorar, esvaziar ou decorar o ambiente." /> : (
              <div className="gen-grid">
                {d.recent.map((g) => (
                  <Link key={g.id} to={`/imoveis/${g.property.id}`} className="gen-card">
                    <div className="gen-pic">
                      {g.thumbUrl ? <img src={g.thumbUrl} alt="" loading="lazy" /> : g.originalUrl ? <img src={g.originalUrl} alt="" loading="lazy" style={{ opacity: .45 }} /> : null}
                      <span className="gen-status"><Badge tone={STATUS[g.status][1]}>{STATUS[g.status][0]}</Badge></span>
                      {g.active && <span className="gen-active">Publicada</span>}
                    </div>
                    <div className="gen-body">
                      <strong>{AI_OPERATION_LABELS[g.operation]}</strong>
                      <span className="card-sub">{g.property.code} · {g.property.title}</span>
                      <span className="card-sub">{g.provider === 'local' ? 'Modo básico' : g.model ?? g.provider}{g.cost ? ` · ≈ US$ ${g.cost.toFixed(2)}` : ''}</span>
                      <span className="card-sub">{g.userName ? `${g.userName} · ` : ''}{timeAgo(g.createdAt)}</span>
                      {g.error && <span className="card-sub" style={{ color: 'var(--danger)' }}>{g.error.slice(0, 80)}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

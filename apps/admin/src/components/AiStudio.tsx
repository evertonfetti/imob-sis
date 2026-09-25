import {
  AI_GENERATIVE_ONLY, AI_OPERATIONS, AI_OPERATION_HINTS, AI_OPERATION_LABELS, STAGING_STYLES, STAGING_STYLE_LABELS,
  type AiOperation, type AiSettingsDto, type MediaGenerationDto, type MediaItem, type MediaVersionsDto,
} from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Armchair, Check, Eraser, ImageDown, Lightbulb, Sparkles, Sun, Trash2, Undo2, Wand2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Input, Modal, Select, Spinner, errorMessage } from './ui';

const ICONS: Record<AiOperation, ReactNode> = {
  ENHANCE: <Wand2 />, LIGHTING: <Lightbulb />, REMOVE_OBJECT: <Eraser />, REMOVE_FURNITURE: <ImageDown />, VIRTUAL_STAGE: <Armchair />, SKY_REPLACEMENT: <Sun />,
};
const usd = (v: number | null) => (v == null || v === 0 ? 'sem custo' : `≈ US$ ${v.toFixed(2)}`);

/** Compara antes/depois arrastando a divisória. */
function Compare({ before, after, labelBefore, labelAfter }: { before: string; after: string; labelBefore: string; labelAfter: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="compare">
      <img src={after} alt={labelAfter} />
      <div className="compare-top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}><img src={before} alt={labelBefore} /></div>
      <span className="compare-tag left">{labelBefore}</span><span className="compare-tag right">{labelAfter}</span>
      <div className="compare-line" style={{ left: `${pos}%` }} />
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Comparar antes e depois" className="compare-range" />
    </div>
  );
}

/** Edição por IA de uma foto: cada pedido vira uma versão; o original nunca é substituído e o usuário escolhe qual publicar. */
export function AiStudio({ media, onClose }: { media: MediaItem; onClose: () => void }) {
  const qc = useQueryClient();
  const [op, setOp] = useState<AiOperation>('ENHANCE');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<(typeof STAGING_STYLES)[number]>('moderno');
  const [selected, setSelected] = useState<string | 'original' | null>(null);
  const [from, setFrom] = useState<string | null>(null); // versão usada como ponto de partida (null = original)
  const [error, setError] = useState<string | null>(null);

  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api<AiSettingsDto>('/ai/status') });
  const versions = useQuery({
    queryKey: ['media-versions', media.id],
    queryFn: () => api<MediaVersionsDto>(`/media/${media.id}/versions`),
    refetchInterval: (q) => (q.state.data?.generations.some((g) => g.status === 'QUEUED' || g.status === 'PROCESSING') ? 2000 : false),
  });
  const v = versions.data;
  const gens = v?.generations ?? [];
  const busy = gens.some((g) => g.status === 'QUEUED' || g.status === 'PROCESSING');
  const refreshMedia = () => { for (const k of ['media', 'properties', 'ai-status']) qc.invalidateQueries({ queryKey: [k] }); };
  const done = (d: MediaVersionsDto) => { qc.setQueryData(['media-versions', media.id], d); refreshMedia(); setError(null); };
  const fail = (e: unknown) => setError(errorMessage(e));

  const create = useMutation({
    mutationFn: () => api<MediaVersionsDto>(`/media/${media.id}/generations`, { method: 'POST', body: { operation: op, prompt: prompt.trim() || null, ...(op === 'VIRTUAL_STAGE' && { style }), parentId: from } }),
    onSuccess: (d) => { done(d); setPrompt(''); const last = d.generations.at(-1); if (last) setSelected(last.id); },
    onError: fail,
  });
  const approve = useMutation({ mutationFn: (id: string) => api<MediaVersionsDto>(`/generations/${id}/approve`, { method: 'POST' }), onSuccess: done, onError: fail });
  const revert = useMutation({ mutationFn: () => api<MediaVersionsDto>(`/media/${media.id}/revert`, { method: 'POST' }), onSuccess: done, onError: fail });
  const discard = useMutation({ mutationFn: (id: string) => api<MediaVersionsDto>(`/generations/${id}`, { method: 'DELETE' }), onSuccess: (d) => { done(d); setSelected(null); if (from && !d.generations.some((g) => g.id === from)) setFrom(null); }, onError: fail });

  const sel: MediaGenerationDto | null = gens.find((g) => g.id === (selected ?? v?.activeGenerationId ?? gens.filter((x) => x.status === 'READY').at(-1)?.id)) ?? null;
  const showing = selected === 'original' ? null : sel;
  const base = showing?.parentId ? gens.find((g) => g.id === showing.parentId)?.outputUrl ?? v?.originalUrl : v?.originalUrl;
  const local = status.data?.provider === 'local';
  const blocked = local && AI_GENERATIVE_ONLY.includes(op);
  const needsPrompt = op === 'REMOVE_OBJECT';
  const limitReached = !!status.data && status.data.provider !== 'local' && status.data.usage.generations >= status.data.monthlyLimit;

  return (
    <Modal title="Editar foto com IA" onClose={onClose} wide>
      <div className="ai-grid">
        <div className="ai-main">
          <div className="ai-stage">
            {!v ? <div className="skeleton" style={{ height: 320 }} /> : showing?.status === 'READY' && showing.outputUrl && base ? (
              <Compare before={base} after={showing.outputUrl} labelBefore={showing.parentId ? 'Base' : 'Original'} labelAfter="Versão de IA" />
            ) : (
              <img className="ai-single" src={v.originalUrl ?? media.processedUrl ?? ''} alt="Foto original" />
            )}
            {busy && <div className="tile-over"><Spinner />Gerando a nova versão… pode levar até 1 minuto.</div>}
          </div>

          <div className="ai-versions" role="listbox" aria-label="Versões da foto">
            <button type="button" className={`ai-ver ${!v?.activeGenerationId ? 'pub' : ''} ${selected === 'original' ? 'sel' : ''}`} onClick={() => setSelected('original')}>
              <img src={media.thumbnailUrl ?? v?.originalUrl ?? ''} alt="" /><span>Original</span>{!v?.activeGenerationId && <i>Publicada</i>}
            </button>
            {gens.map((g, i) => (
              <button type="button" key={g.id} className={`ai-ver ${g.active ? 'pub' : ''} ${sel?.id === g.id && selected !== 'original' ? 'sel' : ''} ${g.status === 'FAILED' ? 'bad' : ''}`} onClick={() => setSelected(g.id)}>
                {g.thumbUrl ? <img src={g.thumbUrl} alt="" /> : <div className="ai-ver-ph">{g.status === 'FAILED' ? '!' : <Spinner />}</div>}
                <span>{i + 1}. {AI_OPERATION_LABELS[g.operation]}</span>{g.active && <i>Publicada</i>}
              </button>
            ))}
          </div>

          {showing && (
            <div className="ai-selected">
              <div className="card-sub">
                {AI_OPERATION_LABELS[showing.operation]}{showing.prompt ? ` · “${showing.prompt}”` : ''}{showing.style ? ` · ${STAGING_STYLE_LABELS[showing.style as keyof typeof STAGING_STYLE_LABELS] ?? showing.style}` : ''} · {showing.provider === 'local' ? 'básico' : showing.provider}{showing.model ? ` (${showing.model})` : ''} · {usd(showing.cost)}
              </div>
              {showing.status === 'FAILED' && <div className="alert">{showing.error}</div>}
              <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                {showing.status === 'READY' && !showing.active && <Button variant="primary" onClick={() => approve.mutate(showing.id)} disabled={approve.isPending}><Check /> Publicar esta versão</Button>}
                {showing.active && <Badge tone="ok">Esta versão está publicada</Badge>}
                {showing.status === 'READY' && <Button onClick={() => { setFrom(showing.id); }}>{from === showing.id ? 'Continuando desta versão' : 'Continuar editando a partir desta'}</Button>}
                {!showing.active && showing.status !== 'PROCESSING' && showing.status !== 'QUEUED' && <Button variant="ghost" className="btn-danger" onClick={() => discard.mutate(showing.id)} disabled={discard.isPending}><Trash2 /> Descartar</Button>}
              </div>
            </div>
          )}
          {v?.activeGenerationId && <Button variant="ghost" onClick={() => revert.mutate()} disabled={revert.isPending}><Undo2 /> Voltar a publicar a foto original</Button>}
        </div>

        <aside className="ai-side">
          <div className="chip-label">O que fazer com a foto?</div>
          <div className="ai-ops">
            {AI_OPERATIONS.map((o) => {
              const off = local && AI_GENERATIVE_ONLY.includes(o);
              return (
                <button type="button" key={o} className={`ai-op ${op === o ? 'on' : ''} ${off ? 'off' : ''}`} onClick={() => setOp(o)} title={off ? 'Precisa de um provedor de IA configurado' : undefined}>
                  {ICONS[o]}<span><strong>{AI_OPERATION_LABELS[o]}</strong><small>{AI_OPERATION_HINTS[o]}</small></span>
                </button>
              );
            })}
          </div>

          {op === 'REMOVE_OBJECT' && <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="O que remover? Ex.: o carro vermelho na garagem" maxLength={500} />}
          {op === 'VIRTUAL_STAGE' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <Select value={style} onChange={(e) => setStyle(e.target.value as never)} aria-label="Estilo">{STAGING_STYLES.map((s) => <option key={s} value={s}>Estilo {STAGING_STYLE_LABELS[s].toLowerCase()}</option>)}</Select>
              <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Pedido extra (opcional)" maxLength={500} />
            </div>
          )}
          {blocked && <div className="alert">Esta edição precisa de um provedor de IA (Google Gemini ou OpenAI). Peça a quem administra a empresa para configurar em <strong>Empresa → Imagens e IA</strong>.</div>}
          {error && <div className="alert">{error}</div>}
          {from && <div className="card-sub">Partindo da versão {gens.findIndex((g) => g.id === from) + 1}. <button type="button" className="linklike" onClick={() => setFrom(null)}>Usar o original</button></div>}
          <Button variant="primary" block onClick={() => { setError(null); create.mutate(); }} disabled={create.isPending || busy || blocked || limitReached || (needsPrompt && !prompt.trim())}>
            <Sparkles /> {create.isPending || busy ? 'Gerando…' : 'Gerar nova versão'}
          </Button>
          {status.data && (
            <div className="card-sub">
              {status.data.provider === 'local' ? 'Modo básico: sem custo.' : `${status.data.usage.generations} de ${status.data.monthlyLimit} edições neste mês · ≈ US$ ${status.data.usage.cost.toFixed(2)}`}
              {limitReached && <strong style={{ color: 'var(--danger)' }}> Limite mensal atingido.</strong>}
            </div>
          )}
          <p className="card-sub" style={{ marginTop: 4 }}>A foto original nunca é alterada. Versões de IA aparecem no site com o aviso “imagem editada digitalmente”, e revisar o resultado antes de publicar é sempre recomendado (a IA pode errar detalhes do imóvel).</p>
        </aside>
      </div>
    </Modal>
  );
}

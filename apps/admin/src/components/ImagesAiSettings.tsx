import {
  WATERMARK_POSITION_LABELS,
  type WatermarkDto, type WatermarkPosition, type WatermarkSettings,
} from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Field, Input, Select, SkeletonRows, errorMessage, useToast } from './ui';

// Posição de cada opção na grade 3×3 (só cantos e centro existem).
const GRID: (WatermarkPosition | null)[] = ['TOP_LEFT', null, 'TOP_RIGHT', null, 'CENTER', null, 'BOTTOM_LEFT', null, 'BOTTOM_RIGHT'];

function markStyle(s: WatermarkSettings) {
  const m = `${(s.margin * 2) / 3}%`; // a margem é % da largura; a altura da prévia é 2/3 da largura
  const x = s.position.endsWith('LEFT') ? { left: `${s.margin}%` } : s.position.endsWith('RIGHT') ? { right: `${s.margin}%` } : { left: '50%', transform: 'translateX(-50%)' };
  const y = s.position.startsWith('TOP') ? { top: m } : s.position.startsWith('BOTTOM') ? { bottom: m } : { top: '50%' };
  const t = s.position === 'CENTER' ? { transform: 'translate(-50%, -50%)' } : {};
  return { width: `${s.scale}%`, opacity: s.opacity / 100, ...x, ...y, ...t } as const;
}

async function sendLogo(file: File) {
  const t = await api<{ key: string; uploadUrl: string; headers: Record<string, string> }>('/company/logo/upload-url', { method: 'POST', body: { contentType: file.type, sizeBytes: file.size } });
  const res = await fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: file });
  if (!res.ok) throw new Error('Falha no envio do arquivo.');
  return api<WatermarkDto>('/company/logo', { method: 'POST', body: { key: t.key } });
}

export function WatermarkCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [applying, setApplying] = useState(false);
  // Depois de "aplicar", atualiza o contador sozinho até todas as fotos ficarem em dia.
  const q = useQuery({ queryKey: ['watermark'], queryFn: () => api<WatermarkDto>('/company/watermark'), refetchInterval: (query) => (applying && (query.state.data?.outdatedPhotos ?? 0) > 0 ? 2500 : false) });
  const sample = useQuery({ queryKey: ['wm-sample'], queryFn: () => api<{ items: { coverUrl: string | null }[] }>('/properties?pageSize=6'), staleTime: 60_000 });
  const [f, setF] = useState<WatermarkSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (q.data) setF(q.data.settings); }, [q.data]);
  const done = (d: WatermarkDto, msg?: string) => { qc.setQueryData(['watermark'], d); setErr(null); if (msg) toast.show(msg); };
  const fail = (e: unknown) => setErr(errorMessage(e));
  const upload = useMutation({ mutationFn: sendLogo, onSuccess: (d) => done(d, 'Logo enviada.'), onError: fail });
  const removeLogo = useMutation({ mutationFn: () => api<WatermarkDto>('/company/logo', { method: 'DELETE' }), onSuccess: (d) => done(d, 'Logo removida.'), onError: fail });
  const save = useMutation({ mutationFn: () => api<WatermarkDto>('/company/watermark', { method: 'PATCH', body: f }), onSuccess: (d) => done(d, 'Marca d’água salva.'), onError: fail });
  const apply = useMutation({
    mutationFn: () => api<{ queued: number }>('/company/watermark/apply', { method: 'POST' }),
    onSuccess: (r) => { toast.show(r.queued ? `Aplicando em ${r.queued} ${r.queued === 1 ? 'foto' : 'fotos'}…` : 'Todas as fotos já estão atualizadas.'); setApplying(r.queued > 0); qc.invalidateQueries({ queryKey: ['watermark'] }); },
    onError: fail,
  });
  if (!q.data || !f) return <div className="card"><SkeletonRows rows={5} /></div>;
  const d = q.data;
  const changed = JSON.stringify(f) !== JSON.stringify(d.settings);
  const bg = sample.data?.items.find((p) => p.coverUrl)?.coverUrl ?? null;

  return (
    <section className="card">
      <div className="card-head"><div><div className="card-title">Marca d’água nas fotos</div><div className="card-sub">Carimba a logo da empresa nas fotos publicadas. A foto original nunca recebe a marca.</div></div>
        <Badge tone={d.settings.enabled ? 'ok' : undefined}>{d.settings.enabled ? 'Ativa' : 'Desativada'}</Badge></div>
      <div className="section-body">
        {err && <div className="alert" style={{ marginBottom: 14 }}>{err}</div>}
        <div className="form-grid">
          <div className="field span-2">
            <label>Logo</label>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ width: 160, height: 64, borderRadius: 8, border: '1px solid var(--line)', background: 'repeating-conic-gradient(#e8e5de 0% 25%, #f7f5f0 0% 50%) 50% / 14px 14px', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                {d.logoUrl ? <img src={d.logoUrl} alt="Logo da empresa" style={{ maxWidth: '90%', maxHeight: '90%' }} /> : <span className="card-sub">Sem logo</span>}
              </div>
              <div className="toolbar">
                <Button type="button" onClick={() => file.current?.click()} disabled={upload.isPending}><ImagePlus /> {upload.isPending ? 'Enviando…' : d.hasLogo ? 'Trocar logo' : 'Enviar logo'}</Button>
                {d.hasLogo && <Button type="button" variant="ghost" className="btn-danger" onClick={() => confirm('Remover a logo? A marca d’água será desativada.') && removeLogo.mutate()}><Trash2 /> Remover</Button>}
              </div>
              <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => { const x = e.target.files?.[0]; if (x) upload.mutate(x); e.target.value = ''; }} />
            </div>
            <span className="field-hint">PNG com fundo transparente funciona melhor. Também aceita JPG, WebP e SVG (até 5 MB, mínimo 64 px).</span>
          </div>

          {d.hasLogo && (
            <>
              <div className="span-2">
                <div className="wm-preview" aria-label="Pré-visualização">
                  {bg ? <img className="bg" src={bg} alt="" /> : null}
                  {f.enabled && d.logoUrl && <img className="mark" src={d.logoUrl} alt="" style={markStyle(f)} />}
                </div>
                <span className="field-hint">Pré-visualização aproximada{bg ? ' sobre uma foto do seu catálogo' : ''}.</span>
              </div>
              <label className="span-2" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Carimbar a logo nas fotos publicadas</label>
              <Field label="Posição">
                <div className="pos-grid" role="radiogroup" aria-label="Posição">
                  {GRID.map((p, i) => <button type="button" key={i} disabled={!p} className={p && f.position === p ? 'on' : ''} title={p ? WATERMARK_POSITION_LABELS[p] : undefined} aria-label={p ? WATERMARK_POSITION_LABELS[p] : undefined} onClick={() => p && setF({ ...f, position: p })} />)}
                </div>
              </Field>
              <div style={{ display: 'grid', gap: 12 }}>
                <Field label={`Tamanho: ${f.scale}% da largura da foto`}><input className="slider" type="range" min={5} max={40} value={f.scale} onChange={(e) => setF({ ...f, scale: Number(e.target.value) })} /></Field>
                <Field label={`Opacidade: ${f.opacity}%`}><input className="slider" type="range" min={10} max={100} value={f.opacity} onChange={(e) => setF({ ...f, opacity: Number(e.target.value) })} /></Field>
                <Field label={`Distância da borda: ${f.margin}%`}><input className="slider" type="range" min={0} max={10} value={f.margin} onChange={(e) => setF({ ...f, margin: Number(e.target.value) })} /></Field>
              </div>
            </>
          )}
        </div>
        {d.hasLogo && (
          <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 18, flexWrap: 'wrap' }}>
            <div className="card-sub">
              {d.outdatedPhotos ? <><strong>{d.outdatedPhotos}</strong> de {d.totalPhotos} fotos ainda estão com a versão anterior.</> : `${d.totalPhotos} ${d.totalPhotos === 1 ? 'foto' : 'fotos'} — todas atualizadas.`} Fotos novas já saem certas.
            </div>
            <div className="toolbar">
              <Button type="button" onClick={() => apply.mutate()} disabled={apply.isPending || !d.outdatedPhotos || changed}>Aplicar nas fotos existentes</Button>
              <Button type="button" variant="primary" onClick={() => save.mutate()} disabled={!changed || save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
            </div>
          </div>
        )}
      </div>
      {toast.node}
    </section>
  );
}

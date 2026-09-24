import {
  MEDIA_CONTENT_TYPES, MEDIA_MAX_BYTES, MEDIA_TYPE_LABELS, type MediaItem, type MediaType,
} from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Film, ImagePlus, RotateCw, Star, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Select, SkeletonRows, Spinner, errorMessage, useToast } from './ui';

interface Upload { tempId: string; name: string; preview: string | null; progress: number; error?: string }
interface Target { key: string; uploadUrl: string; headers: Record<string, string> }

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** Envio direto ao storage por URL assinada, com progresso. */
function putFile(t: Target, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', t.uploadUrl);
    for (const [k, v] of Object.entries(t.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Falha no envio do arquivo.')));
    xhr.onerror = () => reject(new Error('Falha de conexão durante o envio.'));
    xhr.send(file);
  });
}

function typeFor(file: File, chosen: MediaType): MediaType {
  if (file.type.startsWith('video/')) return 'VIDEO';
  if (file.type === 'application/pdf') return chosen === 'FLOOR_PLAN' ? 'FLOOR_PLAN' : 'DOCUMENT';
  return chosen === 'FLOOR_PLAN' || chosen === 'TOUR_360' ? chosen : 'IMAGE';
}

export function Gallery({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const canUpload = can('media.upload');
  const canDelete = can('media.delete');
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<MediaType>('IMAGE');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);

  const q = useQuery({
    queryKey: ['media', propertyId],
    queryFn: () => api<MediaItem[]>(`/properties/${propertyId}/media`),
    // Enquanto houver imagens processando, atualiza sozinho.
    refetchInterval: (query) => (query.state.data?.some((m) => m.status === 'PENDING' || m.status === 'PROCESSING') ? 2000 : false),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['media', propertyId] }); qc.invalidateQueries({ queryKey: ['properties'] }); qc.invalidateQueries({ queryKey: ['property-history', propertyId] }); };

  async function uploadOne(file: File) {
    const type = typeFor(file, chosen);
    const tempId = crypto.randomUUID();
    const patch = (p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.tempId === tempId ? { ...x, ...p } : x)));
    const fail = (msg: string) => setUploads((u) => [...u, { tempId, name: file.name, preview: null, progress: 0, error: msg }]);

    if (!MEDIA_CONTENT_TYPES[type].includes(file.type)) return fail('Tipo de arquivo não permitido.');
    if (file.size > MEDIA_MAX_BYTES[type]) return fail(`Arquivo maior que ${mb(MEDIA_MAX_BYTES[type])}.`);
    setUploads((u) => [...u, { tempId, name: file.name, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, progress: 0 }]);
    try {
      const t = await api<Target>(`/properties/${propertyId}/media/upload-url`, { method: 'POST', body: { type, filename: file.name, contentType: file.type, size: file.size } });
      await putFile(t, file, (p) => patch({ progress: p }));
      patch({ progress: 1 });
      await api(`/properties/${propertyId}/media`, { method: 'POST', body: { type, key: t.key, contentType: file.type, filename: file.name } });
      await qc.invalidateQueries({ queryKey: ['media', propertyId] });
      setUploads((u) => u.filter((x) => x.tempId !== tempId));
      refresh();
    } catch (e) {
      patch({ error: errorMessage(e) });
    }
  }

  async function addFiles(files: FileList | File[]) {
    const list = [...files];
    // 3 envios simultâneos.
    const queue = [...list];
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => { while (queue.length) await uploadOne(queue.shift()!); }));
  }

  const setCover = useMutation({ mutationFn: (id: string) => api(`/media/${id}`, { method: 'PATCH', body: { isCover: true } }), onSuccess: () => { refresh(); toast.show('Foto de capa atualizada.'); }, onError: (e) => toast.show(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/media/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e) => toast.show(errorMessage(e)) });
  const retry = useMutation({ mutationFn: (id: string) => api(`/media/${id}/reprocess`, { method: 'POST' }), onSuccess: refresh, onError: (e) => toast.show(errorMessage(e)) });
  const caption = useMutation({ mutationFn: (v: { id: string; caption: string }) => api(`/media/${v.id}`, { method: 'PATCH', body: { caption: v.caption } }), onError: (e) => toast.show(errorMessage(e)) });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api<MediaItem[]>(`/properties/${propertyId}/media/order`, { method: 'PATCH', body: { ids } }),
    onSuccess: (data) => qc.setQueryData(['media', propertyId], data),
    onError: (e) => { toast.show(errorMessage(e)); refresh(); },
    onSettled: () => setOrder(null),
  });

  const items = q.data ?? [];
  const shown = order ? order.map((id) => items.find((m) => m.id === id)).filter((m): m is MediaItem => !!m) : items;
  const empty = !q.isLoading && !items.length && !uploads.length;

  const dropProps = canUpload ? {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files); } },
  } : {};

  const dropzone = (compact: boolean) => canUpload && (
    <div className={`dropzone ${compact ? 'compact' : ''} ${over ? 'over' : ''}`} role="button" tabIndex={0}
      onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}>
      <ImagePlus />
      <strong>{compact ? 'Adicionar mais arquivos' : 'Arraste as fotos aqui ou clique para selecionar'}</strong>
      {!compact && <span>JPG, PNG, WebP ou AVIF até {mb(MEDIA_MAX_BYTES.IMAGE)}. Vídeos MP4/WebM e PDFs também são aceitos.</span>}
    </div>
  );

  return (
    <section className="card" {...dropProps}>
      <div className="gallery-head">
        <div><div className="section-title">Fotos e vídeos</div><div className="section-desc">{items.length ? `${items.length} ${items.length === 1 ? 'arquivo' : 'arquivos'} · arraste para reordenar` : 'A primeira foto será a capa do anúncio.'}</div></div>
        {canUpload && (
          <div className="toolbar">
            <Select value={chosen} onChange={(e) => setChosen(e.target.value as MediaType)} style={{ width: 150 }} aria-label="Enviar como">
              {(['IMAGE', 'FLOOR_PLAN', 'TOUR_360'] as const).map((t) => <option key={t} value={t}>{MEDIA_TYPE_LABELS[t]}</option>)}
            </Select>
            <Button type="button" variant="primary" onClick={() => input.current?.click()}><ImagePlus /> Adicionar</Button>
          </div>
        )}
      </div>
      <input ref={input} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,application/pdf"
        onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />

      <div className="gallery-body">
        {q.isLoading ? <SkeletonRows rows={3} /> : empty ? dropzone(false) : (
          <>
            {dropzone(true)}
            <div className="grid-media">
              {shown.map((m, i) => (
                <div key={m.id} className={`tile ${m.isCover ? 'cover' : ''} ${dragId === m.id ? 'dragging' : ''}`}
                  draggable={canUpload && !m.isCover}
                  onDragStart={(e) => { setDragId(m.id); setOrder(items.map((x) => x.id)); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); }}
                  onDragOver={(e) => {
                    if (!dragId || dragId === m.id || !order || m.isCover) return; // a capa fica sempre na frente
                    e.preventDefault();
                    const next = order.filter((x) => x !== dragId);
                    next.splice(next.indexOf(m.id) + (order.indexOf(dragId) < order.indexOf(m.id) ? 1 : 0), 0, dragId);
                    if (next.join() !== order.join()) setOrder(next);
                  }}
                  onDrop={(e) => { if (dragId && order) { e.preventDefault(); e.stopPropagation(); reorder.mutate(order); } setDragId(null); }}
                  onDragEnd={() => { setDragId(null); if (!reorder.isPending) setOrder(null); }}>
                  <div className="tile-img">
                    {(m.type === 'IMAGE' || m.type === 'TOUR_360' || m.contentType.startsWith('image/')) && (m.thumbnailUrl || m.processedUrl) ? (
                      <img src={(m.isCover ? m.processedUrl : m.thumbnailUrl) ?? m.thumbnailUrl ?? m.processedUrl!} alt={m.caption ?? `Foto ${i + 1}`} loading="lazy" draggable={false} />
                    ) : (
                      <div className="tile-file">{m.type === 'VIDEO' ? <Film /> : <FileText />}<span>{m.filename ?? MEDIA_TYPE_LABELS[m.type]}</span></div>
                    )}
                    {m.isCover && <span className="pill"><Star fill="currentColor" /> Capa</span>}
                    {m.type !== 'IMAGE' && <span className="pill type">{MEDIA_TYPE_LABELS[m.type]}</span>}
                    {(m.status === 'PENDING' || m.status === 'PROCESSING') && <div className="tile-over"><Spinner />Processando…</div>}
                    {m.status === 'FAILED' && (
                      <div className="tile-over failed"><span>Não foi possível processar{m.processingError ? `: ${m.processingError}` : '.'}</span>
                        {canUpload && <Button type="button" onClick={() => retry.mutate(m.id)}><RotateCw /> Tentar novamente</Button>}</div>
                    )}
                    <div className="tile-actions">
                      {canUpload && m.type === 'IMAGE' && !m.isCover && m.status === 'READY' && <button type="button" className="tile-btn" title="Definir como capa" aria-label="Definir como capa" onClick={() => setCover.mutate(m.id)}><Star /></button>}
                      {canDelete && <button type="button" className="tile-btn danger" title="Excluir" aria-label="Excluir" onClick={() => confirm('Excluir este arquivo? Esta ação não pode ser desfeita.') && remove.mutate(m.id)}><Trash2 /></button>}
                    </div>
                  </div>
                  {canUpload
                    ? <input className="tile-cap" defaultValue={m.caption ?? ''} placeholder="Legenda" maxLength={200} aria-label="Legenda"
                        onBlur={(e) => e.target.value.trim() !== (m.caption ?? '') && caption.mutate({ id: m.id, caption: e.target.value })} />
                    : m.caption && <span className="card-sub">{m.caption}</span>}
                </div>
              ))}
              {uploads.map((u) => (
                <div key={u.tempId} className="tile">
                  <div className="tile-img" style={{ cursor: 'default' }}>
                    {u.preview ? <img src={u.preview} alt="" style={{ opacity: .5 }} /> : <div className="tile-file"><FileText /><span>{u.name}</span></div>}
                    <div className={`tile-over ${u.error ? 'failed' : ''}`}>
                      {u.error ? (<><span>{u.name}: {u.error}</span><Button type="button" onClick={() => setUploads((x) => x.filter((y) => y.tempId !== u.tempId))}>Dispensar</Button></>)
                        : (<><span>Enviando…</span><div className="bar"><i style={{ width: `${Math.round(u.progress * 100)}%` }} /></div></>)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="gallery-hint">As fotos são otimizadas automaticamente (WebP) e o arquivo original é sempre preservado.</p>
          </>
        )}
      </div>
      {toast.node}
    </section>
  );
}

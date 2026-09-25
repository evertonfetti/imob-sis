import {
  AI_MODEL_KIND_LABELS, AI_OPERATIONS, AI_OPERATION_LABELS, AI_PROVIDERS, AI_PROVIDER_CATALOG, AI_TEXT_ONLY_PROVIDERS, AI_TIERS, AI_TIER_LABELS,
  type AiAccountDto, type AiModelDto, type AiModelKind, type AiOperation, type AiProviderId, type AiSettingsDto, type AiTier, type DiscoveredModelDto,
} from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, KeyRound, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Badge, Button, Field, Input, Modal, Select, SkeletonRows, errorMessage, useToast } from './ui';

const usd = (v: number) => (v ? `US$ ${v.toFixed(v < 0.1 ? 3 : 2)}` : 'não informado');
const KIND_TONE = { IMAGE: 'accent', TEXT: 'ok' } as const;

interface Pick { model: string; label: string; kind: AiModelKind; tier: AiTier; costUsd: number; inputCostPerMTok: number | null; outputCostPerMTok: number | null; on: boolean; guess: DiscoveredModelDto['guess'] }
const toPick = (m: DiscoveredModelDto): Pick => ({ model: m.model, label: m.label, kind: m.guess === 'OTHER' ? 'TEXT' : m.guess, tier: m.tier, costUsd: m.costUsd, inputCostPerMTok: m.inputCostPerMTok, outputCostPerMTok: m.outputCostPerMTok, on: false, guess: m.guess });

/** Escolha dos modelos que a chave dá acesso: separados por finalidade, com nível e custo editáveis. */
function ModelPicker({ list, onChange, textOnly = false }: { list: Pick[]; onChange: (l: Pick[]) => void; textOnly?: boolean }) {
  const [filter, setFilter] = useState('');
  const [others, setOthers] = useState(false);
  const set = (model: string, patch: Partial<Pick>) => onChange(list.map((p) => (p.model === model ? { ...p, ...patch } : p)));
  const match = (p: Pick) => !filter.trim() || `${p.model} ${p.label}`.toLowerCase().includes(filter.trim().toLowerCase());
  const groups: { key: string; title: string; hint: string; items: Pick[] }[] = [
    ...(textOnly ? [] : [{ key: 'IMAGE', title: 'Editar imagens', hint: 'Melhorar fotos, remover objetos, decorar…', items: list.filter((p) => p.guess === 'IMAGE' && match(p)) }]),
    { key: 'TEXT', title: 'Gerar texto e conversar', hint: 'Agente de atendimento e textos.', items: list.filter((p) => p.guess === 'TEXT' && match(p)) },
    { key: 'OTHER', title: 'Outros modelos', hint: 'Embeddings, áudio, vídeo… (só adicione se souber que serve).', items: list.filter((p) => p.guess === 'OTHER' && match(p)) },
  ];
  const row = (p: Pick) => (
    <div key={p.model} className={`mp-row ${p.on ? 'on' : ''}`}>
      <label className="mp-check"><input type="checkbox" checked={p.on} onChange={(e) => set(p.model, { on: e.target.checked })} /><span><strong>{p.label}</strong><small>{p.model}</small></span></label>
      {p.on && (
        <div className="mp-fields">
          {p.guess === 'OTHER' && !textOnly && <Select value={p.kind} onChange={(e) => set(p.model, { kind: e.target.value as AiModelKind })} aria-label="Finalidade">{(['IMAGE', 'TEXT'] as const).map((k) => <option key={k} value={k}>{AI_MODEL_KIND_LABELS[k]}</option>)}</Select>}
          <Select value={p.tier} onChange={(e) => set(p.model, { tier: e.target.value as AiTier })} aria-label="Nível">{AI_TIERS.map((t) => <option key={t} value={t}>{AI_TIER_LABELS[t]}</option>)}</Select>
          {p.kind === 'IMAGE' ? (
            <Input type="number" step="0.01" min={0} value={p.costUsd} onChange={(e) => set(p.model, { costUsd: Number(e.target.value) })} aria-label="Custo por imagem (US$)" title="Custo por imagem, em US$" />
          ) : (
            <>
              <Input type="number" step="0.01" min={0} placeholder="entrada" value={p.inputCostPerMTok ?? ''} onChange={(e) => set(p.model, { inputCostPerMTok: e.target.value === '' ? null : Number(e.target.value) })} aria-label="US$ por milhão de tokens de entrada" title="US$ por 1 milhão de tokens lidos" />
              <Input type="number" step="0.01" min={0} placeholder="saída" value={p.outputCostPerMTok ?? ''} onChange={(e) => set(p.model, { outputCostPerMTok: e.target.value === '' ? null : Number(e.target.value) })} aria-label="US$ por milhão de tokens de saída" title="US$ por 1 milhão de tokens escritos" />
            </>
          )}
        </div>
      )}
    </div>
  );
  return (
    <div className="mp">
      <div className="input-icon" style={{ marginBottom: 10 }}><Search /><Input placeholder="Filtrar modelos…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      {groups.map((g) => (
        <div key={g.key} className="mp-group">
          {g.key === 'OTHER' ? (
            <button type="button" className="mp-head linklike" onClick={() => setOthers(!others)}>{others ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {g.title} ({g.items.length})</button>
          ) : <div className="mp-head"><strong>{g.title}</strong> <span className="card-sub">{g.hint} ({g.items.length})</span></div>}
          {(g.key !== 'OTHER' || others) && (g.items.length ? g.items.map(row) : <div className="card-sub" style={{ padding: '6px 0' }}>Nenhum modelo nesta lista.</div>)}
        </div>
      ))}
      <p className="card-sub">Custos são estimativas para acompanhar o gasto (imagem: por imagem; texto: por 1 milhão de tokens). Confira na tabela de preços do provedor.</p>
    </div>
  );
}

/** Assistente de cadastro: chave → lista de modelos do provedor → escolha. */
function AddAccountModal({ onClose, onDone }: { onClose: () => void; onDone: (d: AiSettingsDto) => void }) {
  const [f, setF] = useState<{ provider: AiProviderId; name: string; apiKey: string }>({ provider: 'openai', name: '', apiKey: '' });
  const [list, setList] = useState<Pick[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const find = useMutation({
    mutationFn: () => api<DiscoveredModelDto[]>('/ai/discover', { method: 'POST', body: { provider: f.provider, apiKey: f.apiKey } }),
    onSuccess: (r) => { setList(r.map(toPick)); setErr(null); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () => api<AiSettingsDto>('/ai/accounts', { method: 'POST', body: { name: f.name, provider: f.provider, apiKey: f.apiKey, models: (list ?? []).filter((p) => p.on).map(({ on: _o, guess: _g, ...m }) => m) } }),
    onSuccess: onDone,
    onError: (e) => setErr(errorMessage(e)),
  });
  const chosen = (list ?? []).filter((p) => p.on).length;
  return (
    <Modal title="Adicionar conta de IA" onClose={onClose} wide
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button>
        {list && <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim()}>{save.isPending ? 'Salvando…' : `Salvar conta com ${chosen} ${chosen === 1 ? 'modelo' : 'modelos'}`}</Button>}</>}>
      <div style={{ display: 'grid', gap: 14 }}>
        {err && <div className="alert">{err}</div>}
        <form className="form-grid" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); find.mutate(); }}>
          <Field label="Provedor"><Select value={f.provider} disabled={!!list} onChange={(e) => setF({ ...f, provider: e.target.value as AiProviderId })}>{AI_PROVIDERS.map((p) => <option key={p} value={p}>{AI_PROVIDER_CATALOG[p].label}</option>)}</Select></Field>
          <Field label="Nome da conta" hint="Para você reconhecer, ex.: “OpenAI da matriz”."><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} /></Field>
          <Field label="Chave de acesso (API key)" className="span-2" hint={AI_PROVIDER_CATALOG[f.provider].note}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input type="password" autoComplete="off" required value={f.apiKey} disabled={!!list} onChange={(e) => setF({ ...f, apiKey: e.target.value })} />
              {!list ? <Button variant="primary" disabled={find.isPending || !f.apiKey || !f.name.trim()}>{find.isPending ? 'Buscando…' : 'Buscar modelos'}</Button> : <Button type="button" onClick={() => { setList(null); setErr(null); }}>Trocar chave</Button>}
            </div>
          </Field>
        </form>
        {list && (
          <>
            <div className="card-sub"><strong>{list.length} modelos</strong> disponíveis nesta chave. Marque os que quer usar e ajuste o nível (econômico, padrão, premium).</div>
            <ModelPicker list={list} onChange={setList} textOnly={AI_TEXT_ONLY_PROVIDERS.includes(f.provider)} />
          </>
        )}
      </div>
    </Modal>
  );
}

/** Adiciona à conta modelos novos que o provedor passou a oferecer. */
function MoreModelsModal({ account, onClose, onDone }: { account: AiAccountDto; onClose: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ['ai-discover', account.id], queryFn: () => api<DiscoveredModelDto[]>(`/ai/accounts/${account.id}/discover`), staleTime: 0 });
  const [edits, setEdits] = useState<Pick[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = edits ?? (q.data ?? []).filter((m) => !m.added).map(toPick);
  const save = useMutation({
    mutationFn: async () => { for (const p of list.filter((x) => x.on)) await api(`/ai/accounts/${account.id}/models`, { method: 'POST', body: { label: p.label, model: p.model, kind: p.kind, tier: p.tier, costUsd: p.costUsd, inputCostPerMTok: p.inputCostPerMTok, outputCostPerMTok: p.outputCostPerMTok } }); },
    onSuccess: onDone, onError: (e) => setErr(errorMessage(e)),
  });
  const n = list.filter((p) => p.on).length;
  return (
    <Modal title={`Modelos da conta “${account.name}”`} onClose={onClose} wide footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!n || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Adicionando…' : `Adicionar ${n} ${n === 1 ? 'modelo' : 'modelos'}`}</Button></>}>
      {err && <div className="alert" style={{ marginBottom: 12 }}>{err}</div>}
      {q.isLoading ? <SkeletonRows rows={5} /> : q.error ? <div className="alert">{errorMessage(q.error)}</div> : !list.length ? <div className="card-sub">Todos os modelos desta conta já foram adicionados.</div> : <ModelPicker list={list} onChange={setEdits} textOnly={AI_TEXT_ONLY_PROVIDERS.includes(account.provider)} />}
    </Modal>
  );
}

function ModelRow({ m, onChange }: { m: AiModelDto; onChange: (patch: object) => void }) {
  const [cost, setCost] = useState({ c: String(m.costUsd), i: m.inputCostPerMTok == null ? '' : String(m.inputCostPerMTok), o: m.outputCostPerMTok == null ? '' : String(m.outputCostPerMTok) });
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <tr className={m.enabled ? '' : 'off'}>
      <td><strong style={{ fontWeight: 550 }}>{m.label}</strong><div className="card-sub">{m.model}</div></td>
      <td><Badge tone={KIND_TONE[m.kind]} plain>{m.kind === 'IMAGE' ? 'Imagem' : 'Texto'}</Badge></td>
      <td><Select value={m.tier} onChange={(e) => onChange({ tier: e.target.value })} aria-label="Nível" style={{ minWidth: 120 }}>{AI_TIERS.map((t) => <option key={t} value={t}>{AI_TIER_LABELS[t]}</option>)}</Select></td>
      <td>
        {m.kind === 'IMAGE' ? (
          <Input type="number" step="0.01" min={0} value={cost.c} style={{ width: 92 }} onChange={(e) => setCost({ ...cost, c: e.target.value })} onBlur={() => Number(cost.c) !== m.costUsd && onChange({ costUsd: Number(cost.c) || 0 })} aria-label="US$ por imagem" title="US$ por imagem" />
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <Input type="number" step="0.01" min={0} placeholder="entrada" value={cost.i} style={{ width: 84 }} onChange={(e) => setCost({ ...cost, i: e.target.value })} onBlur={() => num(cost.i) !== m.inputCostPerMTok && onChange({ inputCostPerMTok: num(cost.i) })} aria-label="US$ por milhão de tokens de entrada" title="US$ por 1 milhão de tokens lidos" />
            <Input type="number" step="0.01" min={0} placeholder="saída" value={cost.o} style={{ width: 84 }} onChange={(e) => setCost({ ...cost, o: e.target.value })} onBlur={() => num(cost.o) !== m.outputCostPerMTok && onChange({ outputCostPerMTok: num(cost.o) })} aria-label="US$ por milhão de tokens de saída" title="US$ por 1 milhão de tokens escritos" />
          </div>
        )}
      </td>
      <td className="card-sub">{m.uses ? `${m.uses} ${m.uses === 1 ? 'uso' : 'usos'}` : '—'}</td>
      <td className="actions">
        <label className="switch" title={m.enabled ? 'Em uso' : 'Desativado'}><input type="checkbox" checked={m.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} /><i /></label>
      </td>
    </tr>
  );
}

function AccountBlock({ a, onChanged }: { a: AiAccountDto; onChanged: (d?: AiSettingsDto) => void }) {
  const toast = useToast();
  const [more, setMore] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const patch = useMutation({ mutationFn: (body: object) => api<AiSettingsDto>(`/ai/accounts/${a.id}`, { method: 'PATCH', body }), onSuccess: (d) => { onChanged(d); setKey(null); }, onError: (e) => toast.show(errorMessage(e)) });
  const model = useMutation({ mutationFn: (v: { id: string; body: object }) => api<AiSettingsDto>(`/ai/models/${v.id}`, { method: 'PATCH', body: v.body }), onSuccess: onChanged, onError: (e) => toast.show(errorMessage(e)) });
  const rmModel = useMutation({ mutationFn: (id: string) => api<AiSettingsDto>(`/ai/models/${id}`, { method: 'DELETE' }), onSuccess: onChanged, onError: (e) => toast.show(errorMessage(e)) });
  const rm = useMutation({ mutationFn: () => api<AiSettingsDto>(`/ai/accounts/${a.id}`, { method: 'DELETE' }), onSuccess: onChanged, onError: (e) => toast.show(errorMessage(e)) });
  return (
    <div className="ai-acc">
      <div className="ai-acc-head">
        <div style={{ minWidth: 0 }}>
          <strong>{a.name}</strong> <Badge plain>{a.providerLabel}</Badge> {!a.active && <Badge tone="warn">Pausada</Badge>}
          <div className="card-sub"><KeyRound size={12} style={{ verticalAlign: -1 }} /> chave {a.keyHint} · {a.models.length} {a.models.length === 1 ? 'modelo' : 'modelos'}</div>
        </div>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <Button className="btn-sm" onClick={() => setMore(true)}><RefreshCw /> Modelos</Button>
          <Button className="btn-sm" variant="ghost" onClick={() => setKey(key === null ? '' : null)}>Trocar chave</Button>
          <Button className="btn-sm" variant="ghost" onClick={() => patch.mutate({ active: !a.active })}>{a.active ? 'Pausar' : 'Ativar'}</Button>
          <Button className="btn-sm" variant="ghost" onClick={() => confirm(`Remover a conta “${a.name}” e seus modelos? O histórico de edições continua.`) && rm.mutate()}><Trash2 /></Button>
        </div>
      </div>
      {key !== null && (
        <form className="toolbar" style={{ margin: '10px 0' }} onSubmit={(e: FormEvent) => { e.preventDefault(); patch.mutate({ apiKey: key }); }}>
          <Input type="password" autoComplete="off" placeholder="Nova chave de acesso" value={key} onChange={(e) => setKey(e.target.value)} />
          <Button variant="primary" disabled={key.length < 10 || patch.isPending}>{patch.isPending ? 'Validando…' : 'Salvar chave'}</Button>
        </form>
      )}
      {a.models.length > 0 && (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Modelo</th><th>Serve para</th><th>Nível</th><th>Custo estimado</th><th>Uso</th><th style={{ textAlign: 'right' }}>Ativo</th></tr></thead>
            <tbody>{a.models.map((m) => (
              <ModelRow key={`${m.id}-${m.costUsd}-${m.inputCostPerMTok}-${m.outputCostPerMTok}`} m={m} onChange={(body) => model.mutate({ id: m.id, body })} />
            ))}</tbody>
          </table>
          <div className="card-sub" style={{ padding: '8px 4px' }}>Para remover um modelo da lista use o botão de desativar; ele some das escolhas, mas o histórico continua.
            {a.models.some((m) => m.uses === 0) && <> <button type="button" className="linklike" onClick={() => confirm('Remover da conta os modelos que nunca foram usados?') && a.models.filter((m) => m.uses === 0 && !m.enabled).forEach((m) => rmModel.mutate(m.id))}>Remover os desativados e nunca usados</button></>}</div>
        </div>
      )}
      {more && <MoreModelsModal account={a} onClose={() => setMore(false)} onDone={() => { setMore(false); onChanged(); }} />}
      {toast.node}
    </div>
  );
}

export function AiAccountsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ai-settings'], queryFn: () => api<AiSettingsDto>('/ai/settings') });
  const [adding, setAdding] = useState(false);
  const changed = (d?: AiSettingsDto) => { if (d) qc.setQueryData(['ai-settings'], d); else qc.invalidateQueries({ queryKey: ['ai-settings'] }); for (const k of ['ai-status', 'agent-settings', 'ai-discover']) qc.invalidateQueries({ queryKey: [k] }); };
  if (!q.data) return <div className="card"><SkeletonRows rows={4} /></div>;
  const d = q.data;
  return (
    <section className="card">
      <div className="card-head">
        <div><div className="card-title">Contas de IA</div><div className="card-sub">Cadastre a chave de cada provedor e escolha os modelos disponíveis nela: para editar fotos, conversar com clientes ou gerar textos. Pode ter várias contas, inclusive do mesmo provedor.</div></div>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus /> Adicionar conta</Button>
      </div>
      <div className="section-body">
        {!d.accounts.length ? <div className="card-sub">Nenhuma conta cadastrada. Sem conta, só está disponível o modo básico (melhorar foto e iluminação, sem custo).</div> : d.accounts.map((a) => <AccountBlock key={a.id} a={a} onChanged={changed} />)}
      </div>
      {adding && <AddAccountModal onClose={() => setAdding(false)} onDone={(x) => { setAdding(false); changed(x); toast.show('Conta adicionada.'); }} />}
      {toast.node}
    </section>
  );
}

/** Modelo padrão de imagem (geral e por tipo de edição) e limite mensal. */
export function AiDefaultsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ai-settings'], queryFn: () => api<AiSettingsDto>('/ai/settings') });
  const [limit, setLimit] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api<AiSettingsDto>('/ai/settings', { method: 'PUT', body }),
    onSuccess: (d) => { qc.setQueryData(['ai-settings'], d); qc.invalidateQueries({ queryKey: ['ai-status'] }); setErr(null); setLimit(null); toast.show('Padrões salvos.'); },
    onError: (e) => setErr(errorMessage(e)),
  });
  if (!q.data) return <div className="card"><SkeletonRows rows={3} /></div>;
  const d = q.data;
  const images = d.accounts.filter((a) => a.active).flatMap((a) => a.models.filter((m) => m.kind === 'IMAGE' && m.enabled).map((m) => ({ ...m, account: a.name })));
  const options = (
    <>
      {AI_TIERS.map((t) => { const l = images.filter((m) => m.tier === t); return l.length ? <optgroup key={t} label={AI_TIER_LABELS[t]}>{l.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.account} · ≈ US$ {m.costUsd.toFixed(2)}</option>)}</optgroup> : null; })}
      <option value="local">Básico (servidor, sem custo)</option>
    </>
  );
  const setOp = (op: AiOperation, v: string) => save.mutate({ operationDefaults: { [op]: v || null } });
  return (
    <section className="card">
      <div className="card-head"><div><div className="card-title">Modelos padrão para editar fotos</div><div className="card-sub">Use um modelo mais fraco (e barato) para ajustes simples e um mais forte para decorar ou remover objetos. Quem edita ainda pode trocar o modelo na hora.</div></div></div>
      <div className="section-body">
        {err && <div className="alert" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-grid">
          <Field label="Padrão geral" className="span-2" hint="Usado quando não há padrão para o tipo de edição.">
            <Select value={d.defaultModelId ?? ''} onChange={(e) => save.mutate({ defaultModelId: e.target.value || null })}><option value="">Automático (primeiro modelo “Padrão” cadastrado)</option>{options}</Select>
          </Field>
          {AI_OPERATIONS.map((op) => (
            <Field key={op} label={AI_OPERATION_LABELS[op]}>
              <Select value={d.operationDefaults[op] ?? ''} onChange={(e) => setOp(op, e.target.value)}><option value="">Usar o padrão geral</option>{options}</Select>
            </Field>
          ))}
          <Field label="Limite de edições pagas por mês" hint="Protege contra gasto acidental. O modo básico não conta.">
            <div style={{ display: 'flex', gap: 8 }}>
              <Input type="number" min={1} max={10000} value={limit ?? d.monthlyLimit} onChange={(e) => setLimit(Number(e.target.value))} style={{ maxWidth: 130 }} />
              <Button type="button" disabled={limit === null || save.isPending} onClick={() => save.mutate({ monthlyLimit: limit })}>Salvar</Button>
            </div>
          </Field>
          <div className="field"><label>Consumo neste mês</label><div><strong style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500 }}>{d.usage.generations}</strong> <span className="card-sub">edições · ≈ US$ {d.usage.cost.toFixed(2)} (estimativa)</span></div></div>
        </div>
      </div>
      {toast.node}
    </section>
  );
}

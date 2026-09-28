import type { ImportResultDto } from '@imob/types';
import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Button, Modal, errorMessage } from './ui';
import { api, apiDownload } from '../lib/api';

/**
 * Botões "Exportar" e "Importar" de uma planilha (.xlsx), reaproveitados em Imóveis, Proprietários e Clientes.
 * O caminho da API (ex.: "/properties") já expõe /export, /import/template, /import/upload-url e /import.
 */
export function ImportExportButtons({ path, label, onImported }: { path: string; label: string; onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'export' | 'template' | false>(false);

  async function download(kind: 'export' | 'template') {
    setBusy(kind);
    try {
      await apiDownload(kind === 'export' ? `${path}/export` : `${path}/import/template`, `${label}.xlsx`);
    } catch (e) {
      alert(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button disabled={busy === 'export'} onClick={() => download('export')}><Download size={16} /> Exportar</Button>
      <Button onClick={() => setOpen(true)}><Upload size={16} /> Importar</Button>
      {open && (
        <ImportModal
          path={path} label={label} templateBusy={busy === 'template'}
          onTemplate={() => download('template')}
          onClose={() => setOpen(false)}
          onDone={() => { onImported?.(); }}
        />
      )}
    </>
  );
}

function ImportModal({ path, label, templateBusy, onTemplate, onClose, onDone }: {
  path: string; label: string; templateBusy: boolean; onTemplate: () => void; onClose: () => void; onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function pick(file: File) {
    setFileName(file.name);
    setErr(null);
    setBusy(true);
    try {
      const { uploadUrl, key } = await api<{ uploadUrl: string; key: string }>(`${path}/import/upload-url`, { method: 'POST', body: { sizeBytes: file.size } });
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: file });
      if (!put.ok) throw new Error('Não foi possível enviar o arquivo.');
      const r = await api<ImportResultDto>(`${path}/import`, { method: 'POST', body: { key } });
      setResult(r);
      onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Importar ${label.toLowerCase()}`} onClose={onClose} wide footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}>
      {!result && (
        <>
          <p className="card-sub" style={{ marginBottom: 14 }}>
            Envie uma planilha .xlsx. Quem já existe (pelo código, documento, telefone ou e-mail, conforme o cadastro) é atualizado; o resto é criado.
          </p>
          <div style={{ marginBottom: 16 }}>
            <Button disabled={templateBusy} onClick={onTemplate}><FileSpreadsheet size={16} /> Baixar modelo em branco</Button>
          </div>
          {err != null && <div className="alert" style={{ marginBottom: 14 }}>{errorMessage(err)}</div>}
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? `Processando ${fileName ?? ''}…` : 'Escolher planilha…'}
          </Button>
        </>
      )}
      {result && (
        <div>
          <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
            <div><div className="stat-value" style={{ fontSize: 28 }}>{result.created}</div><div className="card-sub">Criados</div></div>
            <div><div className="stat-value" style={{ fontSize: 28 }}>{result.updated}</div><div className="card-sub">Atualizados</div></div>
            <div><div className="stat-value" style={{ fontSize: 28, color: result.errors.length ? 'var(--danger)' : undefined }}>{result.errors.length}</div><div className="card-sub">Com erro</div></div>
          </div>
          {result.errors.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
              <table className="table">
                <thead><tr><th>Linha</th><th>Motivo</th></tr></thead>
                <tbody>{result.errors.map((e, i) => <tr key={i}><td>{e.line}</td><td>{e.message}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

import type { BillingSettingsDto } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Field, Input, PageHeader, SkeletonRows, errorMessage, useToast } from '../components/ui';
import { api } from '../lib/api';

export function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [err, setErr] = useState<unknown>(null);
  const [advanceDays, setAdvanceDays] = useState(5);
  const [graceDays, setGraceDays] = useState(5);
  const [loaded, setLoaded] = useState(false);

  const settings = useQuery({ queryKey: ['billing-settings'], queryFn: () => api<BillingSettingsDto>('/billing/settings') });
  useEffect(() => {
    if (settings.data && !loaded) { setAdvanceDays(settings.data.advanceDays); setGraceDays(settings.data.graceDays); setLoaded(true); }
  }, [settings.data, loaded]);

  const save = useMutation({
    mutationFn: () => api<BillingSettingsDto>('/billing/settings', { method: 'PATCH', body: { advanceDays, graceDays } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['billing-settings'] }); toast.show('Prazos atualizados.'); },
    onError: setErr,
  });

  if (settings.isLoading || !loaded) return <SkeletonRows rows={4} />;

  return (
    <>
      {toast.node}
      <PageHeader title="Configurações" subtitle="Prazos da cobrança automática (Mercado Pago). Valem para todas as licenças em modo automático." />
      <div className="card">
        <div className="card-pad">
          {err != null && <div className="alert" style={{ marginBottom: 14 }}>{errorMessage(err)}</div>}
          <div className="form-grid">
            <Field label="Avisar com quantos dias de antecedência" hint="Antes do fim do teste ou do período pago, a próxima fatura é gerada sozinha.">
              <Input type="number" min={1} max={90} value={advanceDays} onChange={(e) => setAdvanceDays(Number(e.target.value))} />
            </Field>
            <Field label="Tolerância após o vencimento (dias)" hint="Fatura vencida sem pagar além desse prazo: a licença é suspensa sozinha.">
              <Input type="number" min={1} max={90} value={graceDays} onChange={(e) => setGraceDays(Number(e.target.value))} />
            </Field>
          </div>
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </div>
          {settings.data && <p className="card-sub" style={{ marginTop: 14 }}>Última alteração: {new Date(settings.data.updatedAt).toLocaleString('pt-BR')}</p>}
        </div>
      </div>
    </>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { browserApi } from '@/lib/site';
import { getTracking } from '@/lib/tracking';

interface Props { propertyId?: string; defaultMessage?: string; cta?: string }

function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function ContactForm({ propertyId, defaultMessage = '', cta = 'Enviar mensagem' }: Props) {
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState('sending'); setError(''); setFields({});
    try {
      const res = await fetch(`${browserApi()}/public/leads`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: f.get('name'), phone: f.get('phone'), email: f.get('email') || null, message: f.get('message') || null,
          propertyId: propertyId ?? null, consent: f.get('consent') === 'on', website: f.get('website') ?? '',
          ...getTracking(),
        }),
      });
      if (res.ok) { setState('ok'); return; }
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.details)) setFields(Object.fromEntries(data.details.map((d: { field: string; message: string }) => [d.field, d.message])));
      setError(data.message ?? 'Não foi possível enviar agora. Tente novamente.');
      setState('error');
    } catch {
      setError('Sem conexão. Verifique sua internet e tente novamente.');
      setState('error');
    }
  }

  if (state === 'ok') {
    return <div className="notice ok" role="status"><strong>Mensagem enviada!</strong><br />Recebemos seu contato e retornaremos em breve.</div>;
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      {state === 'error' && !Object.keys(fields).length && <div className="notice bad" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="cf-name">Nome</label>
        <input id="cf-name" name="name" className="input" autoComplete="name" required maxLength={120} />
        {fields.name && <span className="err">{fields.name}</span>}
      </div>
      <div className="field">
        <label htmlFor="cf-phone">Telefone / WhatsApp</label>
        <input id="cf-phone" name="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" required placeholder="(11) 90000-0000"
          value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
        {fields.phone && <span className="err">{fields.phone}</span>}
      </div>
      <div className="field">
        <label htmlFor="cf-email">E-mail <span style={{ color: 'var(--faint)' }}>(opcional)</span></label>
        <input id="cf-email" name="email" className="input" type="email" autoComplete="email" />
        {fields.email && <span className="err">{fields.email}</span>}
      </div>
      <div className="field">
        <label htmlFor="cf-msg">Mensagem</label>
        <textarea id="cf-msg" name="message" className="textarea" defaultValue={defaultMessage} maxLength={2000} />
      </div>
      <input className="hp" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <label className="consent">
        <input type="checkbox" name="consent" required />
        <span>Concordo em ser contatado por telefone, WhatsApp ou e-mail sobre este interesse.</span>
      </label>
      {fields.consent && <span className="err">{fields.consent}</span>}
      <button className="btn btn-primary btn-block" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : cta}</button>
    </form>
  );
}

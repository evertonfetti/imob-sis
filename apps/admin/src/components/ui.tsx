import { X } from 'lucide-react';
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ApiError } from '../lib/api';

export function Button({ variant = 'default', size, block, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'lg' | 'icon'; block?: boolean;
}) {
  const v = variant === 'default' ? '' : `btn-${variant}`;
  const s = size ? `btn-${size === 'icon' ? 'icon' : 'lg'}` : '';
  return <button {...p} className={`btn ${v} ${s} ${block ? 'btn-block' : ''} ${className}`} />;
}

export function Field({ label, error, hint, className = '', children }: { label: string; error?: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`select ${p.className ?? ''}`} />;

export function Badge({ tone, children, plain }: { tone?: 'ok' | 'warn' | 'danger' | 'accent'; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ''} ${plain ? 'badge-plain' : ''}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar"><X /></Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return <div className="empty">{icon}<strong>{title}</strong>{hint && <span>{hint}</span>}</div>;
}

export const Spinner = () => <div className="spinner" role="status" aria-label="Carregando" />;

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 20, display: 'grid', gap: 14 }}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 22 }} />)}
    </div>
  );
}

export function errorMessage(e: unknown) {
  return e instanceof ApiError ? e.message : 'Não foi possível concluir a operação.';
}

export function fieldErrors(e: unknown): Record<string, string> {
  if (e instanceof ApiError && Array.isArray(e.details)) {
    return Object.fromEntries((e.details as { field: string; message: string }[]).map((d) => [d.field, d.message]));
  }
  return {};
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);
  return { show: setMsg, node: msg ? <div className="toast" role="status">{msg}</div> : null };
}

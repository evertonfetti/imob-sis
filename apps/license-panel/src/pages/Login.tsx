import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Field, Input, errorMessage } from '../components/ui';
import { useAuth } from '../lib/auth';

export function Login() {
  const { staff, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (staff) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email, password); nav('/', { replace: true }); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <form className="auth-form" onSubmit={submit}>
        <div><h1>Painel master</h1><p className="lead">Acesso restrito à equipe da plataforma.</p></div>
        {error && <div className="alert" role="alert">{error}</div>}
        <Field label="E-mail"><Input type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Senha"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" size="lg" block disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</Button>
      </form>
    </div>
  );
}

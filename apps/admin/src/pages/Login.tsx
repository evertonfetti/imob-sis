import { Store } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button, Field, Input, errorMessage } from '../components/ui';
import { publicApi } from '../lib/api';
import { useAuth } from '../lib/auth';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-art">
        <div className="brand">
          <div className="brand-mark"><Store /></div>
          <div><div className="brand-name">Imobiliária</div><div className="brand-sub">Painel de gestão</div></div>
        </div>
        <p className="auth-quote">Cada imóvel, cada cliente e cada negociação <em>em um só lugar.</em></p>
        <div className="auth-foot">Acesso restrito à equipe.</div>
      </section>
      <section className="auth-panel">{children}</section>
    </div>
  );
}

export function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email, password); nav('/', { replace: true }); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit}>
        <div><h1>Bem-vindo de volta</h1><p className="lead">Entre com o seu e-mail e senha.</p></div>
        {error && <div className="alert" role="alert">{error}</div>}
        <Field label="E-mail"><Input type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@imobiliaria.com" /></Field>
        <Field label="Senha"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" size="lg" block disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</Button>
        <p className="auth-links"><Link to="/esqueci-senha">Esqueci minha senha</Link></p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await publicApi('/auth/forgot-password', { email }); setSent(true); }
    catch (err) { setError(errorMessage(err)); }
  }
  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit}>
        <div><h1>Recuperar acesso</h1><p className="lead">Enviaremos um link para você criar uma nova senha.</p></div>
        {sent ? <div className="alert alert-ok">Se o e-mail estiver cadastrado, você receberá o link em instantes.</div> : (
          <>
            {error && <div className="alert">{error}</div>}
            <Field label="E-mail"><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Button variant="primary" size="lg" block>Enviar link</Button>
          </>
        )}
        <p className="auth-links"><Link to="/entrar">Voltar ao login</Link></p>
      </form>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await publicApi('/auth/reset-password', { token, password }); nav('/entrar', { replace: true }); }
    catch (err) { setError(errorMessage(err)); }
  }
  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit}>
        <div><h1>Nova senha</h1><p className="lead">Escolha uma senha forte para a sua conta.</p></div>
        {error && <div className="alert">{error}</div>}
        <Field label="Nova senha" hint="Mínimo de 10 caracteres, com letras e números."><Input type="password" required autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" size="lg" block>Redefinir senha</Button>
      </form>
    </AuthLayout>
  );
}

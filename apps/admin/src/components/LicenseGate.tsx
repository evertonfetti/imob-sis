import { ShieldAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { licenseBlock } from '../lib/api';

/**
 * Bloco 11 (SaaS): quando a licença desta instalação está suspensa, a API recusa toda requisição
 * (login incluído). Aqui a gente troca a tela inteira por este aviso, em vez de deixar o usuário
 * tentando entrar sem entender por quê.
 */
export function LicenseGate({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState(licenseBlock.get());
  useEffect(() => licenseBlock.subscribe(setMessage), []);

  if (!message) return <>{children}</>;
  return (
    <div className="center-screen" style={{ padding: 24 }}>
      <div className="card" style={{ maxWidth: 440, textAlign: 'center', padding: '40px 32px' }}>
        <ShieldAlert size={40} style={{ color: 'var(--danger)', marginBottom: 16 }} />
        <h2 style={{ marginBottom: 10 }}>Sistema indisponível</h2>
        <p className="card-sub" style={{ lineHeight: 1.55 }}>{message}</p>
      </div>
    </div>
  );
}

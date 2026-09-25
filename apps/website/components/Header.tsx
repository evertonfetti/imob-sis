import type { PublicCompany } from '@imob/types';
import { Menu, Store } from 'lucide-react';
import Link from 'next/link';
import { WhatsAppButton } from './WhatsAppButton';

export function Header({ company }: { company: PublicCompany }) {
  const name = company.tradeName ?? company.name;
  const links = [['/comprar', 'Comprar'], ['/alugar', 'Alugar'], ['/imoveis', 'Todos os imóveis'], ['/#contato', 'Contato']] as const;
  return (
    <header className="header">
      <div className="wrap">
        <Link href="/" className="brand" aria-label={`${name} — página inicial`}>
          {company.logoUrl ? <img src={company.logoUrl} alt={name} /> : (
            <>
              <span className="brand-mark"><Store /></span>
              <span className="brand-name">{name}</span>
            </>
          )}
        </Link>
        <nav className="nav" aria-label="Principal">
          {links.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className="header-cta">
          <WhatsAppButton whatsapp={company.whatsapp} className="btn btn-wa btn-sm" label="WhatsApp" textClass="btn-text" />
          <details className="menu">
            <summary aria-label="Abrir menu"><Menu size={20} /></summary>
            <div className="menu-panel">{links.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</div>
          </details>
        </div>
      </div>
    </header>
  );
}

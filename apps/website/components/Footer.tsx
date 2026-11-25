import type { PublicCompany } from '@imob/types';
import Link from 'next/link';
import { ContactLink } from './ContactLink';
import { digits } from '@/lib/format';

export function Footer({ company }: { company: PublicCompany }) {
  const name = company.tradeName ?? company.name;
  return (
    <footer className="footer">
      <div className="wrap">
        <div>
          <h3>{name}</h3>
          <p>Atendimento próximo, transparência em cada etapa e imóveis selecionados com cuidado.</p>
        </div>
        <div>
          <h4>Navegue</h4>
          <ul>
            <li><Link href="/comprar">Comprar</Link></li>
            <li><Link href="/alugar">Alugar</Link></li>
            <li><Link href="/imoveis">Todos os imóveis</Link></li>
          </ul>
        </div>
        <div>
          <h4>Contato</h4>
          <ul>
            {company.phone && <li><ContactLink href={`tel:+55${digits(company.phone)}`} method="phone">{company.phone}</ContactLink></li>}
            {company.email && <li><ContactLink href={`mailto:${company.email}`} method="email">{company.email}</ContactLink></li>}
            {company.address && <li>{company.address}</li>}
          </ul>
        </div>
      </div>
      <div className="wrap legal">
        <span>© {new Date().getFullYear()} {company.name}{company.creci ? ` · CRECI ${company.creci}` : ''}</span>
        <span>Todos os direitos reservados.</span>
      </div>
    </footer>
  );
}

import type { PublicCompany } from '@imob/types';
import Link from 'next/link';
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
            {company.phone && <li><a href={`tel:+55${digits(company.phone)}`}>{company.phone}</a></li>}
            {company.email && <li><a href={`mailto:${company.email}`}>{company.email}</a></li>}
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

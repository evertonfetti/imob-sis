import type { PublicPropertyCard } from '@imob/types';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { ContactForm } from '@/components/ContactForm';
import { PropertyCard } from '@/components/PropertyCard';
import { SearchBox } from '@/components/SearchBox';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { getCompany, getFilters, getProperties } from '@/lib/api';
import { brl, priceOf } from '@/lib/format';

export default async function Home() {
  const [company, filters, featured, recent] = await Promise.all([
    getCompany(), getFilters(), getProperties({ featured: 'true', pageSize: 6 }), getProperties({ pageSize: 6 }),
  ]);
  const seen = new Set<string>();
  const list: PublicPropertyCard[] = [...featured.items, ...recent.items].filter((p) => !seen.has(p.id) && !!seen.add(p.id)).slice(0, 6);
  const hero = list.find((p) => p.coverFullUrl);
  const name = company.tradeName ?? company.name;

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">{name}{company.creci ? ` · CRECI ${company.creci}` : ''}</p>
            <h1>Encontre o imóvel certo para a sua <em>próxima fase.</em></h1>
            <p className="lead">Casas, apartamentos e terrenos selecionados, com atendimento próximo do primeiro contato até a entrega das chaves.</p>
            <SearchBox filters={filters} />
          </div>
          <div className="hero-photo" aria-hidden={hero ? undefined : true}>
            {hero && (
              <Link href={`/imovel/${hero.slug}`} aria-label={`Ver ${hero.title}`}>
                <img src={hero.coverFullUrl!} alt={hero.title} fetchPriority="high" />
                <div className="hero-tag">
                  <div><strong>{hero.title}</strong><span>{[hero.neighborhood, hero.city].filter(Boolean).join(', ')}</span></div>
                  <span className="p">{brl(priceOf(hero).value)}</span>
                </div>
              </Link>
            )}
          </div>
        </div>
      </section>

      {list.length > 0 && (
        <section className="section wrap" aria-labelledby="dest">
          <div className="section-head">
            <div><h2 id="dest">Imóveis em destaque</h2><p>Uma seleção do que há de melhor no momento.</p></div>
            <Link href="/imoveis" className="link-arrow">Ver todos os imóveis <ArrowRight /></Link>
          </div>
          <div className="grid">{list.map((p, i) => <PropertyCard key={p.id} p={p} priority={i < 3} />)}</div>
        </section>
      )}

      {filters.types.length > 0 && (
        <section className="section wrap" aria-labelledby="tipos">
          <div className="section-head"><div><h2 id="tipos">Explore por tipo</h2></div></div>
          <div className="types">
            {filters.types.map((t) => <Link key={t.slug} href={`/imoveis?type=${t.slug}`} className="type-tile">{t.name}<span>{t.count}</span></Link>)}
          </div>
        </section>
      )}

      <section className="wrap" id="contato">
        <div className="cta-band">
          <div>
            <h2>Conte o que você procura.</h2>
            <p>Deixe seu contato e um de nossos corretores vai ajudar a encontrar o imóvel ideal, sem compromisso.</p>
            <p style={{ marginTop: 22 }}>
              <WhatsAppButton whatsapp={company.whatsapp} message="Olá! Gostaria de ajuda para encontrar um imóvel." className="btn" label="Prefiro falar no WhatsApp" />
            </p>
          </div>
          <div className="cta-card"><ContactForm cta="Quero ser atendido" /></div>
        </div>
      </section>
    </>
  );
}

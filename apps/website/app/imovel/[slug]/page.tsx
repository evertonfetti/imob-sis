import type { Metadata } from 'next';
import { Bath, BedDouble, Bed, Car, Check, LandPlot, MapPin, Ruler } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContactForm } from '@/components/ContactForm';
import { Gallery } from '@/components/Gallery';
import { PropertyCard } from '@/components/PropertyCard';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { NotFoundError, getCompany, getProperty } from '@/lib/api';
import { area, brl, purposeLabel, truncate } from '@/lib/format';
import { siteUrl } from '@/lib/site';

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  try { return await getProperty(slug); } catch (e) { if (e instanceof NotFoundError) return null; throw e; }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: 'Imóvel não encontrado', robots: { index: false } };
  const where = [p.neighborhood, p.city].filter(Boolean).join(', ');
  const description =
    p.shortDescription ??
    (p.description ? truncate(p.description, 155) : `${p.type} ${p.purpose === 'RENT' ? 'para alugar' : 'à venda'}${where ? ` em ${where}` : ''}.`);
  const gone = p.status === 'SOLD' || p.status === 'RENTED';
  return {
    title: `${p.title}${where ? ` · ${where}` : ''}`,
    description,
    alternates: { canonical: `/imovel/${p.slug}` },
    robots: gone ? { index: false, follow: true } : undefined,
    openGraph: { type: 'website', title: p.title, description, url: `${siteUrl()}/imovel/${p.slug}`, images: p.coverFullUrl ? [{ url: p.coverFullUrl }] : undefined },
    twitter: { card: 'summary_large_image', title: p.title, description, images: p.coverFullUrl ? [p.coverFullUrl] : undefined },
  };
}

const availability = (s: string) => (s === 'SOLD' || s === 'RENTED' ? 'https://schema.org/SoldOut' : s === 'RESERVED' ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/InStock');

export default async function PropertyPage({ params }: Params) {
  const { slug } = await params;
  const [p, company] = await Promise.all([load(slug), getCompany()]);
  if (!p) notFound();

  const images = p.media.filter((m) => m.type === 'IMAGE' || m.type === 'FLOOR_PLAN');
  const videos = p.media.filter((m) => m.type === 'VIDEO');
  const gone = p.status === 'SOLD' || p.status === 'RENTED';
  const isRent = p.purpose === 'RENT';
  const main = isRent ? { v: p.rentPrice, s: '/mês' } : { v: p.salePrice, s: '' };
  const alt = p.purpose === 'SALE_AND_RENT' ? { v: p.rentPrice, s: '/mês' } : null;
  const url = `${siteUrl()}/imovel/${p.slug}`;
  const waMsg = `Olá! Tenho interesse no imóvel ${p.code} — ${p.title}. ${url}`;
  const where = [p.neighborhood, p.city].filter(Boolean).join(', ');
  const size = p.usefulArea ?? p.totalArea ?? p.builtArea;

  const facts = [
    p.bedrooms != null && { icon: <BedDouble />, n: p.bedrooms, l: p.bedrooms === 1 ? 'dormitório' : 'dormitórios' },
    p.suites != null && { icon: <Bed />, n: p.suites, l: p.suites === 1 ? 'suíte' : 'suítes' },
    p.bathrooms != null && { icon: <Bath />, n: p.bathrooms, l: p.bathrooms === 1 ? 'banheiro' : 'banheiros' },
    p.parkingSpaces != null && { icon: <Car />, n: p.parkingSpaces, l: p.parkingSpaces === 1 ? 'vaga' : 'vagas' },
    size != null && { icon: <Ruler />, n: area(size).replace(' m²', ''), l: 'm² úteis' },
    p.landArea != null && { icon: <LandPlot />, n: area(p.landArea).replace(' m²', ''), l: 'm² de terreno' },
  ].filter(Boolean) as { icon: React.ReactNode; n: string | number; l: string }[];

  const groups = new Map<string, string[]>();
  for (const f of p.features) groups.set(f.category ?? 'Outras', [...(groups.get(f.category ?? 'Outras') ?? []), f.name]);

  const address = p.showExactAddress && p.address ? [p.address + (p.number ? `, ${p.number}` : ''), p.complement].filter(Boolean).join(' — ') : null;
  const mapHref = p.showExactAddress && p.latitude != null && p.longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`
    : address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, ${where}`)}` : null;

  const ld = {
    '@context': 'https://schema.org', '@type': 'RealEstateListing', name: p.title, url,
    description: p.description ?? p.shortDescription ?? undefined, datePosted: p.publishedAt ?? undefined, dateModified: p.updatedAt,
    image: images.slice(0, 8).map((m) => m.url),
    ...(main.v && { offers: { '@type': 'Offer', price: main.v, priceCurrency: 'BRL', availability: availability(p.status), url } }),
    contentLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: p.city ?? undefined, addressRegion: p.state ?? undefined, addressCountry: 'BR', ...(address && { streetAddress: address }) },
    },
  };
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início', item: siteUrl() },
    { '@type': 'ListItem', position: 2, name: isRent ? 'Alugar' : 'Comprar', item: `${siteUrl()}/${isRent ? 'alugar' : 'comprar'}` },
    { '@type': 'ListItem', position: 3, name: p.title, item: url },
  ] };

  return (
    <div className="wrap">
      <nav className="crumbs" aria-label="Você está em">
        <Link href="/">Início</Link>/<Link href={isRent ? '/alugar' : '/comprar'}>{isRent ? 'Alugar' : 'Comprar'}</Link>/
        {p.city && <><Link href={`/imoveis?city=${encodeURIComponent(p.city)}`}>{p.city}</Link>/</>}
        <span aria-current="page">{truncate(p.title, 60)}</span>
      </nav>

      {gone && <div className="banner" role="status">Este imóvel já foi {p.status === 'SOLD' ? 'vendido' : 'alugado'}. Veja abaixo opções semelhantes ou fale com a gente.</div>}
      {p.status === 'RESERVED' && <div className="banner" role="status">Este imóvel está reservado no momento. Você ainda pode entrar em contato para ficar na lista de interessados.</div>}

      <Gallery media={images} title={p.title} />

      <div className="detail">
        <article>
          <p className="eyebrow">{p.type} · {purposeLabel(p.purpose)} · Cód. {p.code}</p>
          <h1>{p.title}</h1>
          {where && <p className="loc"><MapPin />{where}{p.state ? ` — ${p.state}` : ''}</p>}

          {facts.length > 0 && (
            <div className="facts">
              {facts.map((f) => <div key={f.l} className="fact">{f.icon}<strong>{f.n}</strong><span>{f.l}</span></div>)}
            </div>
          )}

          {p.description && <section className="block"><h2>Sobre o imóvel</h2><p className="prose">{p.description}</p></section>}

          {groups.size > 0 && (
            <section className="block">
              <h2>Características</h2>
              {[...groups].map(([cat, names]) => (
                <div key={cat} className="feat-group">
                  {groups.size > 1 && <h3>{cat}</h3>}
                  <div className="feat-list">{names.map((n) => <span key={n} className="feat"><Check />{n}</span>)}</div>
                </div>
              ))}
            </section>
          )}

          {videos.length > 0 && (
            <section className="block"><h2>Vídeo</h2>{videos.map((v) => <video key={v.id} className="v" controls preload="metadata" src={v.url} />)}</section>
          )}

          <section className="block">
            <h2>Localização</h2>
            <p className="prose" style={{ whiteSpace: 'normal' }}>
              {address ? <>{address}<br /></> : null}{where}{p.zipCode && p.showExactAddress ? ` · CEP ${p.zipCode}` : ''}
              {!address && <><br /><span style={{ color: 'var(--muted)' }}>O endereço completo é informado durante o atendimento.</span></>}
            </p>
            {mapHref && <p style={{ marginTop: 14 }}><a className="btn btn-sm" href={mapHref} target="_blank" rel="noopener noreferrer"><MapPin />Ver no mapa</a></p>}
          </section>
        </article>

        <aside className="side" id="interesse">
          <div className="panel">
            {main.v ? <div className="price">{brl(main.v)}<small>{main.s}</small></div> : <div className="price" style={{ fontSize: 28 }}>Valor sob consulta</div>}
            {alt?.v && <p style={{ color: 'var(--muted)', marginTop: 6 }}>ou {brl(alt.v)}{alt.s} para alugar</p>}
            {(p.condominiumFee || p.propertyTax) && (
              <div className="costs">
                {p.condominiumFee ? <div>Condomínio<strong>{brl(p.condominiumFee)}</strong></div> : null}
                {p.propertyTax ? <div>IPTU<strong>{brl(p.propertyTax)}</strong></div> : null}
              </div>
            )}

            {!gone && (
              <>
                <WhatsAppButton whatsapp={company.whatsapp} message={waMsg} propertyId={p.id} className="btn btn-wa btn-block" />
                <hr />
                {p.broker && (
                  <div className="broker">
                    <div className="avatar">{p.broker.name.split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase()}</div>
                    <div><strong>{p.broker.name}</strong><span>Corretor responsável{p.broker.creci ? ` · CRECI ${p.broker.creci}` : ''}</span></div>
                  </div>
                )}
                <h3>Tenho interesse</h3>
                <ContactForm propertyId={p.id} defaultMessage={`Olá! Tenho interesse no imóvel ${p.code}. Gostaria de mais informações.`} />
              </>
            )}
            {gone && <Link className="btn btn-primary btn-block" href={isRent ? '/alugar' : '/comprar'}>Ver imóveis disponíveis</Link>}
          </div>
        </aside>
      </div>

      {p.similar.length > 0 && (
        <section className="section" aria-labelledby="sim">
          <div className="section-head"><div><h2 id="sim">Imóveis semelhantes</h2></div></div>
          <div className="grid">{p.similar.map((s) => <PropertyCard key={s.id} p={s} />)}</div>
        </section>
      )}

      {!gone && (
        <div className="mobile-bar">
          <WhatsAppButton whatsapp={company.whatsapp} message={waMsg} propertyId={p.id} className="btn btn-wa" label="WhatsApp" />
          <a href="#interesse" className="btn btn-primary">Tenho interesse</a>
        </div>
      )}

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
    </div>
  );
}

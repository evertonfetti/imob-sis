import type { PublicPropertyCard } from '@imob/types';
import { BedDouble, Car, ImageIcon, MapPin, Ruler } from 'lucide-react';
import Link from 'next/link';
import { area, brl, priceOf } from '@/lib/format';

export function PropertyCard({ p, prefer, priority }: { p: PublicPropertyCard; prefer?: 'SALE' | 'RENT'; priority?: boolean }) {
  const price = priceOf(p, prefer);
  const other = p.purpose === 'SALE_AND_RENT' ? (price.kind === 'SALE' ? { v: p.rentPrice, s: '/mês' } : { v: p.salePrice, s: '' }) : null;
  const size = area(p.usefulArea ?? p.totalArea);
  return (
    <Link href={`/imovel/${p.slug}`} className="pcard">
      <div className="pcard-img">
        {p.coverUrl ? (
          <img
            src={p.coverUrl}
            srcSet={p.coverFullUrl && p.coverFullUrl !== p.coverUrl ? `${p.coverUrl} 480w, ${p.coverFullUrl} 2400w` : undefined}
            sizes="(min-width: 1040px) 400px, (min-width: 620px) 46vw, 92vw"
            alt={p.title}
            loading={priority ? 'eager' : 'lazy'}
            width={480}
            height={360}
          />
        ) : <div className="noimg"><ImageIcon /></div>}
        <div className="tags">
          {p.featured && <span className="tag dark">Destaque</span>}
          {p.status === 'RESERVED' && <span className="tag warn">Reservado</span>}
        </div>
      </div>
      <div className="pcard-body">
        <span className="pcard-type">{p.type}</span>
        <h3 className="pcard-title">{p.title}</h3>
        <span className="pcard-loc"><MapPin />{[p.neighborhood, p.city].filter(Boolean).join(', ') || 'Localização sob consulta'}</span>
        <div className="pcard-price">{price.value ? brl(price.value) : 'Sob consulta'}{price.value && price.suffix && <small>{price.suffix}</small>}</div>
        {other?.v ? <span className="pcard-sub">ou {brl(other.v)}{other.s}</span> : null}
        <div className="specs">
          {p.bedrooms != null && <span><BedDouble />{p.bedrooms}</span>}
          {p.parkingSpaces != null && <span><Car />{p.parkingSpaces}</span>}
          {size && <span><Ruler />{size}</span>}
        </div>
      </div>
    </Link>
  );
}

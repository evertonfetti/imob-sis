import { Search } from 'lucide-react';
import type { Filters } from '@/lib/api';

/** Busca da home: formulário GET simples, funciona sem JavaScript. */
export function SearchBox({ filters }: { filters: Filters }) {
  return (
    <form action="/imoveis" method="get" className="search" role="search" aria-label="Buscar imóveis">
      <div className="seg" role="radiogroup" aria-label="Finalidade">
        <input type="radio" name="purpose" id="p-sale" value="SALE" defaultChecked />
        <label htmlFor="p-sale">Comprar</label>
        <input type="radio" name="purpose" id="p-rent" value="RENT" />
        <label htmlFor="p-rent">Alugar</label>
      </div>
      <div className="search-fields">
        <div className="field">
          <label htmlFor="s-type" className="sr">Tipo de imóvel</label>
          <select id="s-type" name="type" className="select" defaultValue="">
            <option value="">Todos os tipos</option>
            {filters.types.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-city" className="sr">Cidade</label>
          <select id="s-city" name="city" className="select" defaultValue="">
            <option value="">Todas as cidades</option>
            {filters.cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-beds" className="sr">Dormitórios</label>
          <select id="s-beds" name="bedrooms" className="select" defaultValue="">
            <option value="">Dormitórios</option>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}+ dormitórios</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-q" className="sr">Bairro ou código</label>
          <input id="s-q" name="q" className="input" placeholder="Bairro ou código" />
        </div>
        <button className="btn btn-primary full" type="submit"><Search /> Buscar imóveis</button>
      </div>
    </form>
  );
}

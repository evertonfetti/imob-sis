import type { Filters } from '@/lib/api';

type SP = Record<string, string | undefined>;

/** Filtros do listing: formulário GET (indexável, funciona sem JS). `purpose` fixo nas rotas /comprar e /alugar. */
export function FilterPanel({ filters, sp, fixedPurpose, action }: { filters: Filters; sp: SP; fixedPurpose?: 'SALE' | 'RENT'; action: string }) {
  const purpose = fixedPurpose ?? sp.purpose;
  const selectedFeatures = new Set((sp.features ?? '').split(',').filter(Boolean));
  const hoods = filters.neighborhoods.filter((h) => !sp.city || h.city?.toLowerCase() === sp.city.toLowerCase());
  const pills = (name: string, values: number[], label: (n: number) => string) => (
    <div className="pills">
      <input type="radio" id={`${name}-any`} name={name} value="" defaultChecked={!sp[name]} />
      <label htmlFor={`${name}-any`}>Todos</label>
      {values.map((n) => (
        <span key={n} style={{ display: 'contents' }}>
          <input type="radio" id={`${name}-${n}`} name={name} value={n} defaultChecked={sp[name] === String(n)} />
          <label htmlFor={`${name}-${n}`}>{label(n)}</label>
        </span>
      ))}
    </div>
  );

  return (
    <form action={action} method="get" className="filters" aria-label="Filtros">
      <div className="fgroup">
        <label className="title" htmlFor="f-q">Buscar</label>
        <input id="f-q" name="q" className="input" defaultValue={sp.q} placeholder="Bairro, código ou título" />
      </div>
      {!fixedPurpose && (
        <div className="fgroup">
          <span className="title">Finalidade</span>
          <div className="pills">
            {[['', 'Todas'], ['SALE', 'Comprar'], ['RENT', 'Alugar']].map(([v, l]) => (
              <span key={v} style={{ display: 'contents' }}>
                <input type="radio" id={`pu-${v || 'all'}`} name="purpose" value={v} defaultChecked={(purpose ?? '') === v} />
                <label htmlFor={`pu-${v || 'all'}`}>{l}</label>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="fgroup">
        <label className="title" htmlFor="f-type">Tipo</label>
        <select id="f-type" name="type" className="select" defaultValue={sp.type ?? ''}>
          <option value="">Todos</option>
          {filters.types.map((t) => <option key={t.slug} value={t.slug}>{t.name} ({t.count})</option>)}
        </select>
      </div>
      <div className="fgroup">
        <label className="title" htmlFor="f-city">Cidade</label>
        <select id="f-city" name="city" className="select" defaultValue={sp.city ?? ''}>
          <option value="">Todas</option>
          {filters.cities.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
        </select>
      </div>
      <div className="fgroup">
        <label className="title" htmlFor="f-hood">Bairro</label>
        <input id="f-hood" name="neighborhood" className="input" list="hoods" defaultValue={sp.neighborhood} placeholder="Qualquer bairro" />
        <datalist id="hoods">{[...new Set(hoods.map((h) => h.name))].map((n) => <option key={n} value={n} />)}</datalist>
      </div>
      <div className="fgroup">
        <span className="title">Valor (R$)</span>
        <div className="row2">
          <input name="priceMin" type="number" min={0} step={1000} className="input" placeholder="Mínimo" defaultValue={sp.priceMin} aria-label="Valor mínimo" />
          <input name="priceMax" type="number" min={0} step={1000} className="input" placeholder="Máximo" defaultValue={sp.priceMax} aria-label="Valor máximo" />
        </div>
      </div>
      <div className="fgroup"><span className="title">Dormitórios</span>{pills('bedrooms', [1, 2, 3, 4], (n) => `${n}+`)}</div>
      <div className="fgroup"><span className="title">Suítes</span>{pills('suites', [1, 2, 3], (n) => `${n}+`)}</div>
      <div className="fgroup"><span className="title">Vagas</span>{pills('parkingSpaces', [1, 2, 3], (n) => `${n}+`)}</div>
      <div className="fgroup">
        <span className="title">Área (m²)</span>
        <div className="row2">
          <input name="areaMin" type="number" min={0} className="input" placeholder="Mínima" defaultValue={sp.areaMin} aria-label="Área mínima" />
          <input name="areaMax" type="number" min={0} className="input" placeholder="Máxima" defaultValue={sp.areaMax} aria-label="Área máxima" />
        </div>
      </div>
      {filters.features.length > 0 && (
        <div className="fgroup">
          <span className="title">Características</span>
          <div className="checks">
            {filters.features.map((f) => (
              <label key={f.slug}><input type="checkbox" name="feat" value={f.slug} defaultChecked={selectedFeatures.has(f.slug)} />{f.name}</label>
            ))}
          </div>
        </div>
      )}
      <div className="fgroup">
        <label className="title" htmlFor="f-sort">Ordenar por</label>
        <select id="f-sort" name="sort" className="select" defaultValue={sp.sort ?? 'recent'}>
          <option value="recent">Mais recentes</option>
          <option value="price_asc">Menor valor</option>
          <option value="price_desc">Maior valor</option>
        </select>
      </div>
      <button className="btn btn-primary btn-block" type="submit">Aplicar filtros</button>
      <a className="btn btn-block" href={action}>Limpar</a>
    </form>
  );
}

'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap notfound">
      <h1>Não conseguimos carregar esta página</h1>
      <p>Algo deu errado por aqui. Tente novamente em instantes.</p>
      <button className="btn btn-primary" onClick={reset}>Tentar novamente</button>
    </div>
  );
}

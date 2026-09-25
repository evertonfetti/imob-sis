import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap notfound">
      <h1>Página não encontrada</h1>
      <p>O endereço pode ter mudado, ou o imóvel não está mais disponível.</p>
      <Link className="btn btn-primary" href="/imoveis">Ver imóveis disponíveis</Link>
    </div>
  );
}

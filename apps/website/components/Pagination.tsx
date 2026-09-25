import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const nums = new Set([1, pages, page - 1, page, page + 1]);
  const list = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <nav className="pager" aria-label="Paginação">
      {page > 1 ? <Link href={href(page - 1)} aria-label="Página anterior"><ChevronLeft size={18} /></Link> : <span className="off"><ChevronLeft size={18} /></span>}
      {list.map((n, i) => (
        <span key={n} style={{ display: 'contents' }}>
          {i > 0 && n - list[i - 1]! > 1 && <span style={{ border: 0, background: 'none' }}>…</span>}
          {n === page ? <span className="cur" aria-current="page">{n}</span> : <Link href={href(n)}>{n}</Link>}
        </span>
      ))}
      {page < pages ? <Link href={href(page + 1)} aria-label="Próxima página"><ChevronRight size={18} /></Link> : <span className="off"><ChevronRight size={18} /></span>}
    </nav>
  );
}

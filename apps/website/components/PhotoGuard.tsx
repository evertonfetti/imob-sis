'use client';

import { useEffect } from 'react';

/**
 * Dificulta copiar as fotos do site: sem menu do botão direito e sem arrastar a imagem para fora da página
 * (no iPhone, o toque longo também deixa de oferecer "Salvar imagem" — isso vem do CSS, em globals.css).
 * Não impede print de tela: nenhum site consegue. Serve para evitar o "salvar imagem" de um clique.
 */
export function PhotoGuard() {
  useEffect(() => {
    const block = (e: Event) => { if (e.target instanceof HTMLImageElement) e.preventDefault(); };
    document.addEventListener('contextmenu', block);
    document.addEventListener('dragstart', block);
    return () => { document.removeEventListener('contextmenu', block); document.removeEventListener('dragstart', block); };
  }, []);
  return null;
}

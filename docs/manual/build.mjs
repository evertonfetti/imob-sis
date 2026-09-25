/**
 * Gera o Manual do Usuário em PDF.
 *   cd docs/manual && npm install && node build.mjs
 * Lê estilo.css, capa.html e c*.html (capítulos), monta o sumário com números de página reais e grava
 * ../Manual-do-Usuario-Plataforma-Imobiliaria.pdf. Requer um Chromium/Chrome (variável CHROME_PATH ou o headless shell do Playwright).
 */
import { chromium } from 'playwright-core';
import { PDFDocument, rgb } from 'pdf-lib';
import { getDocumentProxy, extractText } from 'unpdf';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'Manual-do-Usuario-Plataforma-Imobiliaria.pdf');
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(process.env.HOME ?? '', '.cache/ms-playwright');
  const d = fs.readdirSync(base).filter((x) => x.startsWith('chromium_headless_shell-')).sort().pop();
  const sub = fs.readdirSync(path.join(base, d)).find((x) => x.startsWith('chrome-headless-shell'));
  return path.join(base, d, sub, 'chrome-headless-shell');
}

const chapters = fs.readdirSync(here).filter((f) => /^c\d+\.html$/.test(f)).sort((a, b) => Number(a.match(/\d+/)) - Number(b.match(/\d+/))).map(read).join('\n');
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// índice: h1 (com "Capítulo N") e h2
const heads = [...chapters.matchAll(/<h([12]) id="([^"]+)">(.*?)<\/h\1>/g)].map((m) => ({
  level: Number(m[1]), id: m[2],
  title: m[1] === '1' ? strip(m[3].replace(/<span class="num">(.*?)<\/span>/, '$1 — ')) : strip(m[3]),
}));

// marcadores invisíveis (achados na extração de texto para descobrir a página real de cada título)
const marked = chapters.replace(/(<h[12] id="([^"]+)">)/g, (_, tag, id) => `<span class="mk">§§${id}§§</span>${tag}`);

function tocHtml(pages) {
  return `<div class="toc-page"><h1 id="sumario" style="page-break-before:avoid"><span class="num">Conteúdo</span>Sumário</h1><div class="toc">${heads.map((h) =>
    `<a href="#${h.id}" class="l${h.level}"><span>${h.title}</span><span class="dots"></span><span class="pg">${pages?.[h.id] ?? '00'}</span></a>`).join('')}</div></div>`;
}
const html = (pages) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Manual do Usuário — Plataforma Imobiliária</title><link rel="stylesheet" href="estilo.css"></head><body>${read('capa.html')}${tocHtml(pages)}${marked}</body></html>`;

const browser = await chromium.launch({ executablePath: chrome(), args: ['--no-sandbox'] });
const page = await browser.newPage();
const tmp = path.join(here, '_manual.html');
const render = async (pages) => {
  fs.writeFileSync(tmp, html(pages));
  await page.goto('file://' + tmp, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))));
  return page.pdf({
    preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, outline: true, tagged: true,
    headerTemplate: '<div style="width:100%;font-family:Liberation Sans,Arial;font-size:7.5pt;color:#7a837e;padding:0 17mm;display:flex;justify-content:space-between"><span>Manual do Usuário</span><span>Plataforma Imobiliária</span></div>',
    footerTemplate: '<div style="width:100%;font-family:Liberation Sans,Arial;font-size:8pt;color:#7a837e;padding:0 17mm;text-align:right">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
  });
};
const pageOf = async (pdf) => {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: false });
  const found = {};
  text.forEach((t, i) => { for (const m of t.matchAll(/§§([\w-]+)§§/g)) found[m[1]] ??= i + 1; });
  return { found, total: text.length };
};

let pdf = await render(null);
const first = await pageOf(pdf);
pdf = await render(first.found); // com os números no sumário (mesma diagramação)
const second = await pageOf(pdf);
const moved = heads.filter((h) => first.found[h.id] !== second.found[h.id]);
if (moved.length) { pdf = await render(second.found); console.log('sumário reajustado em', moved.length, 'itens'); }
await browser.close();
fs.rmSync(tmp, { force: true });

// capa sem cabeçalho/rodapé: cobre as faixas com a cor da capa e define os metadados
const doc = await PDFDocument.load(pdf);
const p1 = doc.getPage(0);
const { width, height } = p1.getSize();
const moss = rgb(0x2c / 255, 0x4a / 255, 0x43 / 255);
p1.drawRectangle({ x: 0, y: height - 45, width, height: 45, color: moss });
p1.drawRectangle({ x: 0, y: 0, width, height: 45, color: moss });
doc.setTitle('Manual do Usuário — Plataforma Imobiliária');
doc.setAuthor('Plataforma Imobiliária');
doc.setSubject('Guia completo para iniciantes');
doc.setLanguage('pt-BR');
fs.writeFileSync(OUT, await doc.save());
console.log(`PDF gerado: ${OUT} (${doc.getPageCount()} páginas)`);

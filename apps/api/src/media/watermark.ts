import sharp from 'sharp';
import type { WatermarkSettings } from '@imob/types';

/**
 * Carimba a logo na foto. A foto já vem no tamanho final; a logo é redimensionada pela largura (scale %),
 * ganha a opacidade pedida e é posicionada no canto (ou centro) com a margem em % da largura.
 */
export async function stamp(image: Buffer, width: number, height: number, logo: Buffer, s: WatermarkSettings): Promise<Buffer> {
  const logoWidth = Math.max(24, Math.round((width * s.scale) / 100));
  const { data: mark, info } = await sharp(logo)
    .resize({ width: logoWidth, height: Math.round(height * 0.4), fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .linear([1, 1, 1, s.opacity / 100], [0, 0, 0, 0]) // só o canal alfa é atenuado
    .png()
    .toBuffer({ resolveWithObject: true });
  const m = Math.round((width * s.margin) / 100);
  const left = s.position.endsWith('RIGHT') ? width - info.width - m : s.position.endsWith('LEFT') ? m : Math.round((width - info.width) / 2);
  const top = s.position.startsWith('BOTTOM') ? height - info.height - m : s.position.startsWith('TOP') ? m : Math.round((height - info.height) / 2);
  return sharp(image).composite([{ input: mark, left: Math.max(0, left), top: Math.max(0, top) }]).toBuffer();
}

/** Converte qualquer logo aceita (PNG/JPG/WebP/SVG) em PNG com transparência, no máximo 1200 px de largura. */
export async function normalizeLogo(input: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const img = sharp(input, { density: 300, failOn: 'error' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 64) throw new Error('logo pequena demais');
  const { data, info } = await img.resize({ width: 1200, withoutEnlargement: true }).ensureAlpha().png().toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}

import { rgb, type PDFFont } from 'pdf-lib';

export const PT_PER_MM = 72 / 25.4;
export const GREY = rgb(0.45, 0.45, 0.45);
export const LIGHT_GREY = rgb(0.8, 0.8, 0.8);

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * The built-in PDF fonts only cover WinAnsi (Latin-1 plus a few symbols) and throw on
 * anything else. Strip accents ("Kōhanga" -> "Kohanga") and replace what's left, so a
 * merchant name can never break the export. Embed a TTF instead if you need full Unicode.
 */
export function toWinAnsi(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff€…–—‘’“”•·]/g, '?');
}

export function fitText(font: PDFFont, size: number, text: string, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && font.widthOfTextAtSize(`${text.slice(0, end)}…`, size) > maxWidth) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

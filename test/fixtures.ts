import { crc32, deflateSync } from 'node:zlib';
import type { Receipt } from '../src/index.js';

/** A solid-colour RGB PNG, so tests can embed real images without binary fixtures. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, default compression/filter/interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'r1',
    batchId: 'b1',
    image: { uri: 'file://r1.png', widthPx: 600, heightPx: 1800 },
    merchant: 'Cafe Uno',
    date: '2026-10-01',
    category: 'Meals',
    amountCents: 1250,
    currency: 'NZD',
    gstCents: 163,
    fx: null,
    notes: '',
    confirmed: true,
    ...overrides,
  };
}

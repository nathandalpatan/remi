import { requireNativeModule } from 'expo';

export type Corners = [number, number, number, number, number, number, number, number];
export type Detection = {
  corners: Corners | null;
  rawCorners: Corners | null;
  score: number;
  edgeContact: boolean;
  visualLossRisk?: number;
  issues: string[];
};
export type ProcessedImage = {
  uri: string;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
  appliedCorners?: number[];
  rotation?: number;
  filter?: string;
  sourceToOutput?: number[];
};
export type RecognizedLine = {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  text?: string;
  confidence?: number;
};
export type RecognizedReceipt = { text: string; lines: RecognizedLine[] };
export type SourceDescription = { rawWidth: number; rawHeight: number; orientation: number };

const native = requireNativeModule<{
  detectCorners(uri: string): Promise<number[]>;
  detectDetailed(uri: string): Promise<Omit<Detection, 'corners' | 'rawCorners'> & { corners: number[]; rawCorners: number[] }>;
  process(uri: string, corners: number[], filter: string, rotation: number): Promise<ProcessedImage>;
  recognize(uri: string): Promise<string>;
  recognizeDetailed(uri: string): Promise<RecognizedReceipt>;
  sha256(uri: string): Promise<string>;
  describeSource(uri: string): Promise<SourceDescription>;
}>('RemiScan');

export async function detectCorners(uri: string): Promise<Corners | null> {
  const points = await native.detectCorners(uri);
  return validCorners(points) ? points as Corners : null;
}

export async function detectReceipt(uri: string): Promise<Detection> {
  const result = await native.detectDetailed(uri);
  return {
    ...result,
    corners: validCorners(result.corners) ? result.corners as Corners : null,
    rawCorners: validCorners(result.rawCorners) ? result.rawCorners as Corners : null,
  };
}

export async function processImage(uri: string, corners: Corners | null, filter: 'original' | 'colour' | 'bw', rotation: number): Promise<ProcessedImage> {
  if (corners && !validCorners(corners)) throw new Error('Corners must outline a visible receipt without crossing');
  const result = await native.process(uri, corners ?? [], filter, rotation);
  const sourceToOutput = result.sourceWidth && result.sourceHeight
    ? imageTransform(result.appliedCorners ?? corners ?? [], result.sourceWidth, result.sourceHeight, result.width, result.height, result.rotation ?? rotation)
    : undefined;
  return { ...result, sourceToOutput };
}

export function recognizeText(uri: string): Promise<string> {
  return native.recognize(uri);
}

export function recognizeReceipt(uri: string): Promise<RecognizedReceipt> {
  return native.recognizeDetailed(uri);
}

export function hashReceiptSource(uri: string): Promise<string> {
  return native.sha256(uri);
}

export function describeReceiptSource(uri: string): Promise<SourceDescription> {
  return native.describeSource(uri);
}

function validCorners(points: number[]): boolean {
  if (points.length !== 8 || points.some((point) => !Number.isFinite(point) || point < 0 || point > 1)) return false;
  const cross = (a: number, b: number, c: number) => {
    const ax = points[a * 2], ay = points[a * 2 + 1];
    const bx = points[b * 2], by = points[b * 2 + 1];
    const cx = points[c * 2], cy = points[c * 2 + 1];
    return (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
  };
  const turns = [0, 1, 2, 3].map((index) => cross(index, (index + 1) % 4, (index + 2) % 4));
  return turns.every((turn) => turn > 0.005) || turns.every((turn) => turn < -0.005);
}

function imageTransform(corners: number[], sourceWidth: number, sourceHeight: number, width: number, height: number, rotation: number): number[] | undefined {
  const quad = validCorners(corners) ? corners : [0, 0, 1, 0, 1, 1, 0, 1];
  const source = [0, 1, 2, 3].map((index) => [quad[index * 2]! * sourceWidth, quad[index * 2 + 1]! * sourceHeight]);
  const destination = rotation === 90
    ? [[width, 0], [width, height], [0, height], [0, 0]]
    : rotation === 180
      ? [[width, height], [0, height], [0, 0], [width, 0]]
      : rotation === 270
        ? [[0, height], [0, 0], [width, 0], [width, height]]
        : [[0, 0], [width, 0], [width, height], [0, height]];
  const rows = source.map(([x, y], index) => {
    const [u, v] = destination[index]!;
    return [
      [x, y, 1, 0, 0, 0, -u! * x!, -u! * y!, u!],
      [0, 0, 0, x, y, 1, -v! * x!, -v! * y!, v!],
    ];
  }).flat();
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    if (Math.abs(rows[pivot]![column]!) < 1e-9) return undefined;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const divisor = rows[column]![column]!;
    for (let cell = column; cell < 9; cell++) rows[column]![cell] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = rows[row]![column]!;
      for (let cell = column; cell < 9; cell++) rows[row]![cell] -= factor * rows[column]![cell]!;
    }
  }
  return [...rows.map((row) => row[8]!), 1];
}

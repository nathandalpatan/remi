import type { TilePlacement } from './layout.js';
import type { TextLine } from './column-layout.js';

/** ISO 4217 currency code, e.g. "NZD". */
export type CurrencyCode = string;

export type CaptureSource = 'remi_camera' | 'gallery' | 'system_scanner';
export type ProcessingStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type IntegrityState = 'ready' | 'needs_review' | 'incomplete' | 'obstructed' | 'unreadable' | 'processing_failed';
export type VerificationStatus = 'unverified' | 'provisional' | 'verified';
export type FinancialField = 'merchant' | 'date' | 'amount' | 'currency' | 'gst';

export interface FinancialEvidence {
  imageRevision: number;
  source: 'ocr' | 'user' | 'legacy';
  lineIndexes?: number[];
}

export interface FinancialFieldVerification {
  status: VerificationStatus;
  evidence?: FinancialEvidence;
}

export interface FinancialCandidate {
  field: FinancialField;
  value: string | number;
  confidence: 'high' | 'medium' | 'low';
  evidence: FinancialEvidence;
}

export interface FinancialVerification {
  amount: FinancialFieldVerification;
  currency: FinancialFieldVerification;
  merchant?: FinancialFieldVerification;
  date?: FinancialFieldVerification;
  gst?: FinancialFieldVerification;
  candidates?: FinancialCandidate[];
}

export interface IntegrityAssessment {
  state: IntegrityState;
  issues: string[];
  imageRevision: number;
  assessmentRevision: number;
  acknowledged?: { imageRevision: number; assessmentRevision: number; issues: string[] };
}

export interface ImageProcessingMetadata {
  /** Coordinates on the upright working source, TL/TR/BR/BL, normalized to [0, 1]. */
  corners: number[] | null;
  rawCorners?: number[] | null;
  originalWidth?: number;
  originalHeight?: number;
  /** Row-major 3x3 transform from original pixels to upright working pixels. Absence means unavailable. */
  originalToWorking?: number[];
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  sourceToOutput?: number[];
  rotation: number;
  filter: 'original' | 'colour' | 'bw';
  marginFraction?: number;
  selectedImage: 'original' | 'processed';
}

export interface DuplicateDecision {
  leftId: string;
  rightId: string;
  leftImageRevision: number;
  rightImageRevision: number;
  resolution: 'keep_both' | 'exclude_left' | 'exclude_right';
}

/** A claim: the set of receipts exported together as one PDF + CSV. */
export interface Batch {
  id: string;
  name: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Legacy preferred display currency; new summaries never convert into it. */
  homeCurrency: CurrencyCode;
}

/** The cropped, upright photo produced by the platform document scanner. */
export interface ReceiptImage {
  uri: string;
  widthPx: number;
  heightPx: number;
}

export interface FxConversion {
  /** Units of home currency per one unit of the receipt's currency. */
  rate: number;
  /** YYYY-MM-DD the rate applies to; finance teams usually ask for it. */
  rateDate: string;
}

export interface Receipt {
  id: string;
  batchId: string;
  image: ReceiptImage;
  merchant: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  category: string | null;
  /** Money is always integer cents in `currency`, never a float. */
  amountCents: number | null;
  /** Canonical amount in the currency's integer minor unit. */
  amountMinorUnits?: number | null;
  currency: CurrencyCode | null;
  gstCents: number | null;
  /** Required when `currency` differs from the batch's home currency. */
  fx: FxConversion | null;
  /** Business purpose of the expense. */
  notes: string;
  /** True once the user has checked the extracted fields against the photo. */
  confirmed: boolean;
  imageRevision?: number;
  jobRevision?: number;
  captureSource?: CaptureSource;
  originalPhotoAvailable?: boolean;
  sourceSha256?: string;
  transactionId?: string | null;
  ocrText?: string;
  processingStatus?: ProcessingStatus;
  financialVerification?: FinancialVerification;
  integrity?: IntegrityAssessment;
  imageProcessing?: ImageProcessingMetadata;
  claimIncluded?: boolean;
  /** Print width the user chose; absent or null means guess from the photo's shape. */
  printWidthMm?: number | null;
  /** Tiles the user dragged into place; the rest are packed automatically. */
  placements?: TilePlacement[];
  /** Text positions in the processed image, normalized from its top edge. */
  ocrLines?: TextLine[];
  /** User-confirmed safe continuation positions in the processed image. */
  breakFractions?: number[];
}

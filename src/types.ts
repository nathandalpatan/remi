/** ISO 4217 currency code, e.g. "NZD". */
export type CurrencyCode = string;

/** A claim: the set of receipts exported together as one PDF + CSV. */
export interface Batch {
  id: string;
  name: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Currency the claim is paid in; foreign receipts are converted into it. */
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
  currency: CurrencyCode;
  gstCents: number | null;
  /** Required when `currency` differs from the batch's home currency. */
  fx: FxConversion | null;
  /** Business purpose of the expense. */
  notes: string;
  /** True once the user has checked the extracted fields against the photo. */
  confirmed: boolean;
}

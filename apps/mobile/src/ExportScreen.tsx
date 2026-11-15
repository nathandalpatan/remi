import { formatMinorUnits, maxSourceSpan, summarizeClaim, type ExportConfig } from '@remi/core';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { originalUri, type SavedDocument, type SavedReceipt } from './documents';
import { BreakEditor } from './BreakEditor';
import { theme } from './theme';

export function ExportScreen({ document, busy, onBack, onPreview, onExport, onReview, onInclude }: {
  document: SavedDocument;
  busy: boolean;
  onBack: () => void;
  onPreview: (config: ExportConfig) => void;
  onExport: (config: ExportConfig) => void;
  onReview: (receipt: SavedReceipt) => void;
  onInclude: (id: string, included: boolean) => void;
}) {
  const [mode, setMode] = useState<'image_only' | 'reimbursement'>('reimbursement');
  const [selected, setSelected] = useState<string[]>(document.receipts.map((receipt) => receipt.id));
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [originalBreaks, setOriginalBreaks] = useState<Record<string, { imageRevision: number; fractions: number[] }>>({});
  const [breakingOriginal, setBreakingOriginal] = useState<SavedReceipt | null>(null);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [listExcluded, setListExcluded] = useState(true);
  const summary = summarizeClaim(document.receipts, document.batch.homeCurrency, document.duplicateDecisions ?? []);
  const config: ExportConfig = mode === 'image_only'
    ? { mode, receiptIds: selected, originalIds, originalBreaks, columnCount: document.layout.columnCount }
    : { mode, includeSummary, listExcluded };
  const issueNames: Record<string, string> = {
    processing: 'Processing is unfinished', 'missing-amount': 'Amount is missing',
    'amount-unverified': 'Amount needs verification', 'missing-currency': 'Currency is missing',
    'currency-unverified': 'Currency needs verification', 'invalid-currency': 'Currency is invalid',
    'integrity-unreviewed': 'Image issue needs review or acknowledgment',
    'strong-duplicate': 'Strong duplicate needs resolution',
  };
  const toggleSelected = (id: string) => {
    setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
    setOriginalIds((ids) => ids.filter((item) => item !== id));
    setOriginalBreaks((breaks) => Object.fromEntries(Object.entries(breaks).filter(([key]) => key !== id)));
  };
  const selectedNeedsBreak = document.layout.needsBreak.some((id) =>
    mode === 'image_only' ? selected.includes(id) && !originalIds.includes(id)
      : document.receipts.some((receipt) => receipt.id === id && receipt.claimIncluded !== false));
  const canPreview = !busy && !selectedNeedsBreak &&
    (mode === 'image_only' ? selected.length > 0 : summary.isFinal);
  const originalNeedsBreak = (receipt: SavedReceipt) => {
    const width = receipt.imageProcessing?.sourceWidth ?? receipt.image.widthPx;
    const height = receipt.imageProcessing?.sourceHeight ?? receipt.image.heightPx;
    return width > 0 && height > 0 && maxSourceSpan({ id: receipt.id, widthPx: width, heightPx: height },
      document.layout.columnCount, document.layout.spec) < 1;
  };

  if (breakingOriginal) {
    const width = breakingOriginal.imageProcessing?.sourceWidth ?? breakingOriginal.image.widthPx;
    const height = breakingOriginal.imageProcessing?.sourceHeight ?? breakingOriginal.image.heightPx;
    return <BreakEditor receipt={{ ...breakingOriginal,
      image: { uri: originalUri(breakingOriginal), widthPx: width, heightPx: height }, ocrLines: undefined }}
      columns={document.layout.columnCount}
      onSave={(fractions) => {
        setOriginalBreaks((breaks) => ({ ...breaks, [breakingOriginal.id]: {
          imageRevision: breakingOriginal.imageRevision ?? 0, fractions,
        } }));
        setBreakingOriginal(null);
      }} onCancel={() => setBreakingOriginal(null)} />;
  }

  return <ScrollView contentContainerStyle={styles.root}>
    <Pressable onPress={onBack}><Text style={styles.link}>‹ Document</Text></Pressable>
    <Text style={styles.title}>Export PDF</Text>
    <View style={styles.row}>
      <Pressable onPress={() => setMode('image_only')} style={[styles.choice, mode === 'image_only' && styles.active]}>
        <Text style={styles.choiceText}>Receipt images</Text>
      </Pressable>
      <Pressable onPress={() => setMode('reimbursement')} style={[styles.choice, mode === 'reimbursement' && styles.active]}>
        <Text style={styles.choiceText}>Reimbursement</Text>
      </Pressable>
    </View>
    {mode === 'reimbursement' ? <>
      <Text style={styles.note}>Every included receipt must be ready and financially verified before export.</Text>
      {Object.entries(summary.confirmedByCurrency).map(([currency, amount]) =>
        <Text key={currency} style={styles.total}>{currency} {formatMinorUnits(amount, currency)}</Text>)}
      {!summary.isFinal && <Text style={styles.warning}>Claim not final · {summary.issues.length} issue(s) to resolve</Text>}
      <Pressable onPress={() => setIncludeSummary((value) => !value)}><Text style={styles.link}>{includeSummary ? '☑' : '☐'} Reimbursement summary</Text></Pressable>
      <Pressable onPress={() => setListExcluded((value) => !value)}><Text style={styles.link}>{listExcluded ? '☑' : '☐'} List excluded receipts in summary</Text></Pressable>
    </> : <>
      <Text style={styles.note}>Choose any draft receipts. Financial verification is not required.</Text>
      <Pressable onPress={() => setSelected(document.receipts.map((receipt) => receipt.id))}><Text style={styles.link}>Select all</Text></Pressable>
      {document.receipts.some((receipt) => selected.includes(receipt.id) && receipt.integrity?.state !== 'ready') &&
        <Text style={styles.warning}>Selected images include unresolved integrity warnings.</Text>}
    </>}
    {selectedNeedsBreak && <Text style={styles.warning}>A selected receipt needs a safe page break before export.</Text>}
    {document.receipts.map((receipt, index) => {
      const issues = summary.issues.filter((item) => item.receiptId === receipt.id);
      const included = receipt.claimIncluded !== false;
      return <View key={receipt.id} style={styles.receipt}>
        <Text style={styles.receiptTitle}>#{index + 1} {receipt.merchant ?? 'Receipt'}</Text>
        <Text style={styles.note}>{receipt.processingStatus} · {receipt.integrity?.state ?? 'Not assessed'}</Text>
        {mode === 'image_only'
          ? <View><Pressable onPress={() => toggleSelected(receipt.id)}><Text style={styles.link}>{selected.includes(receipt.id) ? '☑' : '☐'} Include image</Text></Pressable>
              {selected.includes(receipt.id) && <Pressable onPress={() => setOriginalIds((ids) => ids.includes(receipt.id)
                ? ids.filter((id) => id !== receipt.id) : [...ids, receipt.id])}>
                <Text style={styles.link}>{originalIds.includes(receipt.id) ? '☑' : '☐'} Use earliest source image</Text>
              </Pressable>}
              {selected.includes(receipt.id) && originalIds.includes(receipt.id) && originalNeedsBreak(receipt) &&
                <Pressable onPress={() => setBreakingOriginal(receipt)}><Text style={styles.link}>
                  {originalBreaks[receipt.id]?.imageRevision === (receipt.imageRevision ?? 0)
                    ? 'Adjust source page breaks' : 'Choose safe source page breaks'}
                </Text></Pressable>}</View>
          : <Pressable onPress={() => onInclude(receipt.id, !included)}><Text style={styles.link}>{included ? '☑ Included in claim' : '☐ Excluded from claim'}</Text></Pressable>}
        {mode === 'reimbursement' && included && issues.map((issue) =>
          <Text key={issue.kind} style={styles.warning}>{issueNames[issue.kind] ?? issue.kind}</Text>)}
        <Pressable onPress={() => onReview(receipt)}><Text style={styles.link}>Review receipt</Text></Pressable>
      </View>;
    })}
    <View style={styles.row}>
      <Pressable disabled={!canPreview} onPress={() => onPreview(config)} style={[styles.button, !canPreview && styles.disabled]}><Text style={styles.buttonText}>Preview</Text></Pressable>
      <Pressable disabled={!canPreview} onPress={() => onExport(config)} style={[styles.button, !canPreview && styles.disabled]}><Text style={styles.buttonText}>Export PDF</Text></Pressable>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingBottom: 50, gap: 12, backgroundColor: theme.canvas },
  title: { fontSize: 25, fontWeight: '700', color: theme.ink },
  row: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: theme.white, borderWidth: 1, borderColor: theme.border },
  active: { borderColor: theme.violet, borderWidth: 2 },
  choiceText: { color: theme.ink, textAlign: 'center', fontWeight: '600' },
  note: { color: theme.muted, fontSize: 13 },
  total: { fontSize: 17, fontWeight: '700', color: theme.ink },
  warning: { color: '#a34f0a', fontSize: 13 },
  receipt: { backgroundColor: theme.white, borderRadius: 10, borderWidth: 1, borderColor: theme.border, padding: 12, gap: 6 },
  receiptTitle: { color: theme.ink, fontWeight: '700' },
  link: { color: theme.violetDark, fontWeight: '600', paddingVertical: 4 },
  button: { flex: 1, backgroundColor: theme.violet, padding: 14, borderRadius: 10 },
  buttonText: { color: theme.white, textAlign: 'center', fontWeight: '700' },
  disabled: { opacity: 0.45 },
});

import type { SavedReceipt } from './documents';
import { formatMinorUnits } from '@remi/core';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

function amountLabel(receipt: SavedReceipt): string {
  if (receipt.amountMinorUnits === null || receipt.amountMinorUnits === undefined || !receipt.currency) {
    return 'Amount or currency needed';
  }
  try { return `${formatMinorUnits(receipt.amountMinorUnits, receipt.currency)} ${receipt.currency}`; }
  catch { return 'Currency needs review'; }
}

export function ReceiptRow({ number, receipt, selected, dragging, onSelect, onOpen, onDrag }: {
  number: number;
  receipt: SavedReceipt;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDrag: () => void;
}) {
  return <View style={[styles.row, dragging && styles.dragging]}>
    <Pressable onPress={onSelect} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} style={styles.select}><Text>{selected ? '☑' : '□'}</Text></Pressable>
    <Pressable onPress={onOpen} style={styles.body} accessibilityRole="button">
      <Image source={{ uri: receipt.image.uri }} style={styles.thumb} />
      <View style={styles.details}>
        <Text style={styles.title}>#{number} {receipt.merchant || 'Receipt'}</Text>
        <Text>{amountLabel(receipt)}</Text>
        <Text style={styles.hint}>{receipt.processingStatus === 'failed' ? 'Processing failed — retry' :
          receipt.processingStatus !== 'ready' ? receipt.processingStatus :
            receipt.financialVerification?.amount.status === 'verified' && receipt.financialVerification.currency.status === 'verified'
              ? 'Financial fields verified' : 'Review needed'}</Text>
      </View>
    </Pressable>
    <Pressable onLongPress={onDrag} accessibilityRole="button" accessibilityLabel={`Drag receipt ${number} to reorder`}><Text style={styles.handle}>☰</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
  dragging: { backgroundColor: '#e9f2ff' },
  select: { padding: 8 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 48, height: 68, borderRadius: 4, backgroundColor: '#eee' },
  details: { flex: 1, gap: 2 },
  title: { fontWeight: '600' },
  hint: { color: '#666', fontSize: 12 },
  handle: { color: '#1266c4', fontSize: 24, padding: 8 },
});

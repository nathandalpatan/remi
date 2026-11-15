import { findDuplicates, formatMinorUnits, summarizeClaim } from '@remi/core';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SavedDocument, SavedReceipt } from './documents';
import { theme } from './theme';

type Props = {
  document: SavedDocument;
  onEdit: (receipt: SavedReceipt) => void;
  onReviewImage: (receipt: SavedReceipt) => void;
  onReplace: (receipt: SavedReceipt) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onInclude: (id: string, included: boolean) => void;
  onAcknowledge: (id: string) => void;
  onKeepBoth: (leftId: string, rightId: string) => void;
  onConfirmHigh: (ids: string[]) => void;
};

export function BatchReview(props: Props) {
  const { document: doc } = props;
  const [filter, setFilter] = useState<'all' | 'image' | 'financial' | 'duplicates' | 'processing'>('all');
  const [expandedPair, setExpandedPair] = useState<string | null>(null);
  const [shownReceipts, setShownReceipts] = useState(10);
  const [shownPairs, setShownPairs] = useState(10);
  const summary = summarizeClaim(doc.receipts, doc.batch.homeCurrency, doc.duplicateDecisions ?? []);
  const duplicates = findDuplicates(doc.receipts);
  const duplicateIds = new Set(duplicates.flatMap((pair) => [pair.left.id, pair.right.id]));
  const high = doc.receipts.filter((receipt) => receipt.processingStatus === 'ready' &&
    receipt.financialVerification?.amount.status === 'provisional' &&
    receipt.financialVerification.candidates?.some((candidate) => candidate.field === 'amount' && candidate.confidence === 'high') &&
    receipt.amountMinorUnits !== null && receipt.amountMinorUnits !== undefined);
  const visible = doc.receipts.filter((receipt) => {
    if (filter === 'all') return true;
    if (filter === 'image') return receipt.integrity?.state !== 'ready';
    if (filter === 'financial') return summary.issues.some((issue) => issue.receiptId === receipt.id &&
      ['missing-amount', 'amount-unverified', 'missing-currency', 'currency-unverified', 'invalid-currency'].includes(issue.kind));
    if (filter === 'duplicates') return duplicateIds.has(receipt.id);
    return receipt.processingStatus !== 'ready';
  });
  const processed = doc.receipts.filter((receipt) => receipt.processingStatus === 'ready' || receipt.processingStatus === 'failed').length;
  const queued = doc.receipts.filter((receipt) => receipt.processingStatus === 'queued').length;
  const processing = doc.receipts.filter((receipt) => receipt.processingStatus === 'processing').length;
  const failed = doc.receipts.filter((receipt) => receipt.processingStatus === 'failed').length;

  return <View style={styles.root}>
    <Text style={styles.title}>Receipt review</Text>
    <Text style={styles.muted}>{processed} of {doc.receipts.length} processed · {processing} processing · {queued} queued · {failed} failed</Text>
    {high.length > 0 && <Pressable onPress={() => props.onConfirmHigh(high.map((receipt) => receipt.id))}>
      <Text style={styles.link}>Confirm {high.length} high-confidence amount{high.length === 1 ? '' : 's'}</Text>
    </Pressable>}
    <View style={styles.filters}>{(['all', 'image', 'financial', 'duplicates', 'processing'] as const).map((name) =>
      <Pressable key={name} onPress={() => { setFilter(name); setShownReceipts(10); setShownPairs(10); }} style={[styles.filter, filter === name && styles.active]}>
        <Text style={styles.filterText}>{name}</Text>
      </Pressable>)}</View>
    {visible.slice(0, shownReceipts).map((receipt) => {
      const integrity = receipt.integrity;
      const acknowledged = !!integrity?.acknowledged &&
        integrity.acknowledged.imageRevision === receipt.imageRevision &&
        integrity.acknowledged.assessmentRevision === integrity.assessmentRevision;
      let amount = 'Amount or currency needs review';
      if (receipt.currency && receipt.amountMinorUnits !== null && receipt.amountMinorUnits !== undefined) {
        try { amount = `${formatMinorUnits(receipt.amountMinorUnits, receipt.currency)} ${receipt.currency}`; }
        catch { amount = 'Currency needs review'; }
      }
      return <View key={receipt.id} style={styles.card}>
      <View style={styles.row}><Image source={{ uri: receipt.thumbnailUri ?? receipt.image.uri }} style={styles.thumb} />
        <View style={{ flex: 1 }}><Text style={styles.name}>#{doc.receipts.indexOf(receipt) + 1} {receipt.merchant ?? 'Receipt'}</Text>
          <Text style={styles.muted}>{receipt.processingStatus} · {receipt.integrity?.state ?? 'Not assessed'}{acknowledged ? ' · acknowledged' : ''}{receipt.claimIncluded === false ? ' · excluded' : ''}</Text>
          <Text style={styles.muted}>{amount}</Text></View></View>
      {receipt.integrity?.issues.map((issue) => <Text key={issue} style={styles.warning}>{issue.replace(/_/g, ' ')}</Text>)}
      <View style={styles.actions}>
        <Pressable onPress={() => props.onEdit(receipt)}><Text style={styles.link}>Fields</Text></Pressable>
        <Pressable onPress={() => props.onReviewImage(receipt)}><Text style={styles.link}>Image</Text></Pressable>
        <Pressable onPress={() => props.onReplace(receipt)}><Text style={styles.link}>Replace</Text></Pressable>
        {receipt.processingStatus === 'failed' && <Pressable onPress={() => props.onRetry(receipt.id)}><Text style={styles.link}>Retry</Text></Pressable>}
        {receipt.processingStatus === 'queued' && <Pressable onPress={() => props.onCancel(receipt.id)}><Text style={styles.link}>Cancel</Text></Pressable>}
        <Pressable onPress={() => props.onInclude(receipt.id, receipt.claimIncluded === false)}>
          <Text style={styles.link}>{receipt.claimIncluded === false ? 'Include' : 'Exclude'}</Text></Pressable>
        {receipt.integrity && receipt.integrity.state !== 'ready' && receipt.processingStatus === 'ready' && !acknowledged &&
          <Pressable onPress={() => props.onAcknowledge(receipt.id)}><Text style={styles.link}>Acknowledge image issue</Text></Pressable>}
      </View>
    </View>;
    })}
    {visible.length > shownReceipts && <Pressable onPress={() => setShownReceipts((count) => count + 10)}>
      <Text style={styles.link}>Show 10 more receipts ({visible.length - shownReceipts} remaining)</Text>
    </Pressable>}
    {(filter === 'all' || filter === 'duplicates') && duplicates.slice(0, shownPairs).map((pair) => {
      const key = `${pair.left.id}:${pair.right.id}`;
      const kept = doc.duplicateDecisions?.some((decision) => decision.resolution === 'keep_both' &&
        decision.leftId === pair.left.id && decision.rightId === pair.right.id &&
        decision.leftImageRevision === (pair.left.imageRevision ?? 0) &&
        decision.rightImageRevision === (pair.right.imageRevision ?? 0));
      return <View key={key} style={styles.card}>
      <Text style={styles.name}>{pair.severity} duplicate candidate{kept ? ' · kept as separate purchases' : ''}</Text>
      <View style={styles.row}><Image source={{ uri: pair.left.image.uri }} style={styles.thumb} />
        <Image source={{ uri: pair.right.image.uri }} style={styles.thumb} />
        <Text style={styles.muted}>{pair.reasons.join(', ')}</Text></View>
      {expandedPair === key && <View style={styles.compare}>
        <Image source={{ uri: pair.left.image.uri }} resizeMode="contain" style={styles.compareImage} />
        <Image source={{ uri: pair.right.image.uri }} resizeMode="contain" style={styles.compareImage} />
      </View>}
      <View style={styles.actions}>
        <Pressable onPress={() => setExpandedPair(expandedPair === key ? null : key)}><Text style={styles.link}>{expandedPair === key ? 'Hide comparison' : 'Compare images'}</Text></Pressable>
        {!kept && <Pressable onPress={() => props.onKeepBoth(pair.left.id, pair.right.id)}><Text style={styles.link}>Keep both</Text></Pressable>}
        <Pressable onPress={() => props.onInclude(pair.right.id, false)}><Text style={styles.link}>Exclude second</Text></Pressable>
        <Pressable onPress={() => props.onReplace(pair.right as SavedReceipt)}><Text style={styles.link}>Replace second</Text></Pressable>
        <Pressable onPress={() => props.onCancel(pair.right.id)}><Text style={styles.link}>Remove second</Text></Pressable>
      </View>
    </View>;
    })}
    {(filter === 'all' || filter === 'duplicates') && duplicates.length > shownPairs &&
      <Pressable onPress={() => setShownPairs((count) => count + 10)}>
        <Text style={styles.link}>Show 10 more duplicate pairs ({duplicates.length - shownPairs} remaining)</Text>
      </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 8 }, title: { color: theme.ink, fontWeight: '700', fontSize: 17 },
  muted: { color: theme.muted, fontSize: 12 }, warning: { color: '#a34f0a', fontSize: 12 },
  link: { color: theme.violetDark, fontWeight: '600', fontSize: 12, paddingVertical: 4 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 }, filter: { padding: 7, borderRadius: 8, backgroundColor: theme.lavender },
  active: { backgroundColor: '#d5c6ff' }, filterText: { color: theme.ink, fontSize: 11 },
  card: { backgroundColor: theme.white, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 10, gap: 5 },
  row: { flexDirection: 'row', gap: 9, alignItems: 'center' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  compare: { flexDirection: 'row', gap: 8 }, compareImage: { flex: 1, height: 220, backgroundColor: '#eee' },
  thumb: { width: 42, height: 58, resizeMode: 'contain', backgroundColor: '#eee' },
  name: { color: theme.ink, fontWeight: '700' },
});

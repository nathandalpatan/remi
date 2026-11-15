import { columnWidthMm, formatMinorUnits, layoutScore, moveColumnTile, packColumns, summarizeClaim, type ColumnCount, type ColumnLayout, type ColumnTile } from '@remi/core';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { LinearTransition, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { SavedDocument, SavedReceipt } from './documents';
import { theme } from './theme';
import { BatchReview } from './BatchReview';

type Props = {
  document: SavedDocument;
  busy: boolean;
  saveState: 'saved' | 'saving' | 'failed';
  onBack: () => void;
  onTitle: (title: string) => void;
  onScan: () => void;
  onImport: () => void;
  onEdit: (receipt: SavedReceipt) => void;
  onReplace: (receipt: SavedReceipt) => void;
  onRotate: (receipt: SavedReceipt) => void;
  onBreak: (receipt: SavedReceipt, columns: ColumnCount) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => void;
  onReorder: (ids: string[]) => void;
  onDeleteDocument: () => void;
  onLayout: (layout: ColumnLayout) => Promise<boolean>;
  onPreview: () => void;
  onExport: () => void;
  onShare: (uri: string) => void;
  onRetry?: () => void;
  onRetryReceipt: (id: string) => void;
  onCancelReceipt: (id: string) => void;
  onSetClaimIncluded: (id: string, included: boolean) => void;
  onAcknowledgeIntegrity: (id: string) => void;
  onConfirmHighConfidence: (ids: string[]) => void;
  onKeepBoth: (leftId: string, rightId: string) => void;
  onReviewImage: (receipt: SavedReceipt) => void;
  exportUri: (file: SavedDocument['exports'][number]) => string;
  canExport: boolean;
};

function itemOf(receipt: SavedReceipt) {
  return { id: receipt.id, widthPx: receipt.image.widthPx, heightPx: receipt.image.heightPx,
    lines: receipt.ocrLines, breaks: receipt.breakFractions };
}

function ReceiptTile({ tile, receipt, pageWidth, selected, onSelect, onDrag, onDragStart, onHover, onDragCancel }: {
  tile: ColumnTile; receipt: SavedReceipt; pageWidth: number; selected: boolean;
  onSelect: () => void; onDrag: (dx: number, dy: number) => void; onDragStart: () => void;
  onHover: (dx: number, dy: number) => void; onDragCancel: () => void;
}) {
  const ratio = pageWidth / 210;
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const hoverBucket = useSharedValue(0);
  const pan = Gesture.Pan().activateAfterLongPress(280)
    .onStart(() => scheduleOnRN(onDragStart))
    .onUpdate((event) => {
      x.set(event.translationX); y.set(event.translationY);
      const bucket = Math.round(event.translationX / 28) * 10000 + Math.round(event.translationY / 28);
      if (bucket !== hoverBucket.get()) { hoverBucket.set(bucket); scheduleOnRN(onHover, event.translationX, event.translationY); }
    })
    .onEnd((event) => {
      scheduleOnRN(onDrag, event.translationX, event.translationY);
      x.set(withSpring(0, { duration: 300, dampingRatio: 1 }));
      y.set(withSpring(0, { duration: 300, dampingRatio: 1 }));
    })
    .onFinalize((_event, success) => { if (!success) scheduleOnRN(onDragCancel); });
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));
  const fullHeight = tile.imageHeightMm / (tile.sourceBottom - tile.sourceTop) * ratio;
  return <GestureDetector gesture={pan}><Animated.View layout={LinearTransition.duration(180).reduceMotion(ReduceMotion.System)} style={[styles.tile, animated, selected && styles.selectedTile, {
    left: tile.xMm * ratio, top: tile.yMm * ratio, width: tile.widthMm * ratio, height: tile.heightMm * ratio,
  }]}>
    <Pressable onPress={onSelect} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Receipt ${tile.number}, part ${tile.part} of ${tile.partCount}. Select for actions.`} style={{ flex: 1 }}>
      <Text numberOfLines={1} style={[styles.tileLabel, { height: tile.heightMm - tile.imageHeightMm > 0 ? (tile.heightMm - tile.imageHeightMm) * ratio : 0 }]}>
        #{tile.number} {receipt.merchant ?? 'Receipt'}{tile.partCount > 1 ? ` · ${tile.part}/${tile.partCount}` : ''}
      </Text>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Image source={{ uri: selected ? receipt.image.uri : receipt.thumbnailUri ?? receipt.image.uri }} resizeMode="stretch" style={{ width: tile.widthMm * ratio, height: fullHeight,
          position: 'absolute', top: -tile.sourceTop * fullHeight }} />
      </View>
    </Pressable>
  </Animated.View></GestureDetector>;
}

export function DocumentEditor(props: Props) {
  const { document: doc } = props;
  const { width: screenWidth } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<{ pageIndex: number; columnIndex: number; yMm: number; heightMm: number } | null>(null);
  const [proposal, setProposal] = useState<ColumnLayout | null>(null);
  const [proposalName, setProposalName] = useState('');
  const [undo, setUndo] = useState<{ layout: ColumnLayout; revision: number } | null>(null);
  const [title, setTitle] = useState(doc.batch.name);
  const [manage, setManage] = useState(false);
  const [multi, setMulti] = useState<string[]>([]);
  const pageWidth = Math.min(screenWidth - 32, 500);
  const layout = proposal ?? doc.layout;
  const visiblePage = Math.min(page, Math.max(0, layout.pageCount - 1));
  const receipt = selected ? doc.receipts.find((item) => item.id === selected) : null;
  const scale = useSharedValue(1);
  const startingScale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startingX = useSharedValue(0);
  const startingY = useSharedValue(0);
  const pinch = Gesture.Pinch().onStart(() => startingScale.set(scale.get()))
    .onUpdate((event) => { scale.set(Math.max(1, Math.min(4, startingScale.get() * event.scale))); });
  const move = Gesture.Pan().minPointers(2).onStart(() => {
    startingX.set(offsetX.get()); startingY.set(offsetY.get());
  }).onUpdate((event) => {
    offsetX.set(startingX.get() + event.translationX); offsetY.set(startingY.get() + event.translationY);
  });
  const canvasGesture = Gesture.Simultaneous(pinch, move);
  const canvasMotion = useAnimatedStyle(() => ({ transform: [
    { translateX: offsetX.get() }, { translateY: offsetY.get() }, { scale: scale.get() },
  ] }));

  useEffect(() => { setTitle(doc.batch.name); }, [doc.batch.id, doc.batch.name]);
  useEffect(() => { setPage((current) => Math.min(current, Math.max(0, doc.layout.pageCount - 1))); }, [doc.layout.pageCount]);
  useEffect(() => { setProposal(null); }, [doc.revision]);
  useEffect(() => { setMulti((ids) => ids.filter((id) => doc.receipts.some((item) => item.id === id))); }, [doc.receipts]);
  const byId = useMemo(() => new Map(doc.receipts.map((item) => [item.id, item])), [doc.receipts]);
  const summary = useMemo(() => summarizeClaim(doc.receipts, doc.batch.homeCurrency, doc.duplicateDecisions ?? []),
    [doc.receipts, doc.batch.homeCurrency, doc.duplicateDecisions]);

  async function apply(next: ColumnLayout): Promise<boolean> {
    const before = doc.layout;
    if (await props.onLayout(next)) { setUndo({ layout: before, revision: doc.revision + 1 }); setProposal(null); setSelected(null); return true; }
    return false;
  }

  function propose(columns: ColumnCount | null) {
    const next = packColumns(doc.receipts.map(itemOf), columns ?? doc.layout.columnCount, undefined, true);
    if (next.needsBreak.length) {
      const item = doc.receipts.find((receipt) => receipt.id === next.needsBreak[0]);
      Alert.alert('Page break needed', 'Choose a safe break for the wider layout, then retry this change.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose break', onPress: () => { if (item) props.onBreak(item, columns ?? doc.layout.columnCount); } },
      ]);
      return;
    }
    const oldScore = layoutScore(doc.layout);
    const newScore = layoutScore(next);
    if (columns === null && (newScore[0] > oldScore[0] || newScore[0] === oldScore[0] && newScore[1] >= oldScore[1])) {
      Alert.alert('Layout already compact', 'Optimising would not improve this document.');
      return;
    }
    setProposal(next);
    setProposalName(columns === null ? 'Optimised layout' : `${columns} column${columns === 1 ? '' : 's'}`);
    setPage(0);
  }

  function targetFor(tile: ColumnTile, dx: number, dy: number) {
    const ratio = pageWidth / 210;
    const centre = tile.xMm + tile.widthMm / 2 + dx / (ratio * scale.get());
    const top = tile.yMm + dy / (ratio * scale.get());
    let pageIndex = visiblePage;
    let columnIndex = Math.max(0, Math.min(layout.columnCount - 1,
      Math.floor((centre - layout.spec.marginMm) / (columnWidthMm(layout.columnCount) + layout.spec.gapMm))));
    if (centre < 0) pageIndex = Math.max(0, visiblePage - 1);
    if (centre > layout.spec.widthMm) pageIndex = Math.min(layout.pageCount, visiblePage + 1);
    if (pageIndex !== visiblePage) columnIndex = tile.columnIndex;
    const others = layout.tiles.filter((item) => item.pageIndex === pageIndex && item.columnIndex === columnIndex &&
      !(item.receiptId === tile.receiptId && item.part === tile.part)).sort((a, b) => a.yMm - b.yMm);
    const index = others.filter((item) => item.yMm + item.heightMm / 2 < top).length;
    const yMm = layout.spec.marginMm + others.slice(0, index).reduce((sum, item) => sum + item.heightMm + layout.spec.gapMm, 0);
    return { pageIndex, columnIndex, index, yMm };
  }

  function drop(tile: ColumnTile, dx: number, dy: number) {
    setDragging(false);
    setHover(null);
    try {
      const next = moveColumnTile(layout, tile.receiptId, tile.part, targetFor(tile, dx, dy));
      const destination = next.tiles.find((item) => item.receiptId === tile.receiptId && item.part === tile.part)!.pageIndex;
      void apply(next).then((saved) => { if (saved) setPage(destination); });
    }
    catch (error) { Alert.alert('Cannot move receipt', String(error)); }
  }

  function accessibleMove(direction: 'left' | 'right' | 'up' | 'down' | 'previous' | 'next') {
    if (!selected) return;
    const tile = layout.tiles.find((item) => item.receiptId === selected && item.pageIndex === visiblePage);
    if (!tile) return;
    let pageIndex = tile.pageIndex;
    let columnIndex = tile.columnIndex;
    if (direction === 'left') columnIndex = Math.max(0, columnIndex - 1);
    if (direction === 'right') columnIndex = Math.min(layout.columnCount - 1, columnIndex + 1);
    if (direction === 'previous') pageIndex = Math.max(0, pageIndex - 1);
    if (direction === 'next') pageIndex = Math.min(layout.pageCount, pageIndex + 1);
    const siblings = layout.tiles.filter((item) => item.pageIndex === pageIndex && item.columnIndex === columnIndex)
      .sort((a, b) => a.yMm - b.yMm);
    const currentIndex = siblings.findIndex((item) => item === tile);
    const index = direction === 'up' ? Math.max(0, currentIndex - 1) : direction === 'down' ? currentIndex + 1 : siblings.length;
    const next = moveColumnTile(layout, tile.receiptId, tile.part, { pageIndex, columnIndex, index: Math.max(0, index) });
    const destination = next.tiles.find((item) => item.receiptId === tile.receiptId && item.part === tile.part)!.pageIndex;
    void apply(next).then((saved) => { if (saved) setPage(destination); });
  }

  return <View style={styles.root}>
    <View style={styles.header}>
      <Pressable onPress={props.onBack} style={styles.iconButton} accessibilityLabel="Back to documents"><Text style={styles.icon}>‹</Text></Pressable>
      <View style={{ flex: 1 }}><TextInput value={title} onChangeText={setTitle} onEndEditing={() => { const value = title.trim(); if (value && value !== doc.batch.name) props.onTitle(value); }} style={styles.title} accessibilityLabel="Document title" />
        <Text style={styles.status}>{props.saveState === 'saving' ? '◌ Saving…' : props.saveState === 'failed' ? 'Save failed' : '● All changes saved'} · {doc.receipts.length} receipts · {doc.exports.length ? doc.revision > doc.exports[doc.exports.length - 1]!.revision ? 'Unexported changes' : 'Exported' : 'Draft'}</Text></View>
    </View>
    <View style={styles.toolbar}>
      <Text style={styles.format}>A4 · Portrait</Text>
      <View style={styles.segmented}>{([1, 2, 3] as const).map((count) => <Pressable key={count} onPress={() => count !== doc.layout.columnCount && propose(count)} style={[styles.segment, layout.columnCount === count && styles.segmentActive]}><Text style={[styles.segmentText, layout.columnCount === count && styles.segmentTextActive]}>{count} col{count > 1 ? 's' : ''}</Text></Pressable>)}</View>
    </View>
    {props.onRetry && props.saveState === 'failed' && <Pressable onPress={props.onRetry} style={styles.warning}><Text style={styles.warningText}>Save failed · Tap to retry</Text></Pressable>}
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.summary}>Confirmed: {Object.entries(summary.confirmedByCurrency).map(([currency, amount]) => `${formatMinorUnits(amount, currency)} ${currency}`).join(' · ') || 'none'}{summary.isFinal ? '' : ' · Claim not final'}</Text>
      {!!Object.keys(summary.provisionalByCurrency).length && <Text style={styles.status}>Provisional: {Object.entries(summary.provisionalByCurrency).map(([currency, amount]) => `${formatMinorUnits(amount, currency)} ${currency}`).join(' · ')}</Text>}
      <BatchReview document={doc} onEdit={props.onEdit} onReviewImage={props.onReviewImage}
        onReplace={props.onReplace} onRetry={props.onRetryReceipt} onCancel={props.onCancelReceipt}
        onInclude={props.onSetClaimIncluded} onAcknowledge={props.onAcknowledgeIntegrity}
        onKeepBoth={props.onKeepBoth} onConfirmHigh={props.onConfirmHighConfidence} />
      {doc.receipts.filter((item) => item.processingStatus === 'failed').map((item) => <View key={item.id} style={styles.warning}><Text style={styles.warningText}>Image missing for #{doc.receipts.indexOf(item) + 1} {item.merchant ?? 'Receipt'}.</Text><Pressable onPress={() => props.onReplace(item)}><Text style={styles.link}>Replace image</Text></Pressable></View>)}
      {!!layout.needsBreak.length && <View style={styles.warning}><Text style={styles.warningText}>Safe page break needed before export.</Text>{layout.needsBreak.map((id) => {
        const item = byId.get(id);
        return item ? <Pressable key={id} onPress={() => props.onBreak(item, layout.columnCount)}><Text style={styles.link}>Set break for #{doc.receipts.indexOf(item) + 1} {item.merchant ?? 'Receipt'}</Text></Pressable> : null;
      })}</View>}
      {proposal && <View style={styles.proposal}><Text style={styles.proposalTitle}>{proposalName}</Text><Text style={styles.status}>{doc.layout.pageCount} → {proposal.pageCount} receipt pages. Review the proposed arrangement.</Text><View style={styles.row}><Pressable onPress={() => setProposal(null)}><Text style={styles.link}>Cancel</Text></Pressable><Pressable onPress={() => { void apply(proposal); }}><Text style={styles.primarySmall}>Apply layout</Text></Pressable></View></View>}
      <View style={styles.canvasFrame}>
        {dragging && <View style={styles.dragHint}><Text style={styles.dragHintText}>Drop in a column · drag beyond the page edge to change pages</Text></View>}
        <GestureDetector gesture={canvasGesture}><Animated.View style={[styles.paper, canvasMotion, { width: pageWidth, height: pageWidth * 297 / 210 }]}>
          {Array.from({ length: layout.columnCount }, (_, column) => <View key={column} pointerEvents="none" style={{
            position: 'absolute', left: (layout.spec.marginMm + column * (columnWidthMm(layout.columnCount) + layout.spec.gapMm)) * pageWidth / 210,
            top: layout.spec.marginMm * pageWidth / 210, width: columnWidthMm(layout.columnCount) * pageWidth / 210,
            height: (layout.spec.heightMm - 2 * layout.spec.marginMm) * pageWidth / 210,
            borderWidth: dragging ? 1 : 0, borderStyle: 'dashed', borderColor: theme.violet,
          }} />)}
          {hover?.pageIndex === visiblePage && <View pointerEvents="none" style={[styles.placeholder, {
            left: (layout.spec.marginMm + hover.columnIndex * (columnWidthMm(layout.columnCount) + layout.spec.gapMm)) * pageWidth / 210,
            top: hover.yMm * pageWidth / 210, width: columnWidthMm(layout.columnCount) * pageWidth / 210,
            height: hover.heightMm * pageWidth / 210,
          }]} />}
          {layout.tiles.filter((tile) => tile.pageIndex === visiblePage).map((tile) => {
            const item = byId.get(tile.receiptId);
            return item ? <ReceiptTile key={`${tile.receiptId}:${tile.part}`} tile={tile} receipt={item} pageWidth={pageWidth}
              selected={selected === tile.receiptId} onSelect={() => setSelected(tile.receiptId)}
              onDragStart={() => { setDragging(true); setHover({ pageIndex: tile.pageIndex, columnIndex: tile.columnIndex, yMm: tile.yMm, heightMm: tile.heightMm }); }}
              onHover={(dx, dy) => { const target = targetFor(tile, dx, dy); setHover({ ...target, heightMm: tile.heightMm }); }}
              onDrag={(dx, dy) => drop(tile, dx, dy)} onDragCancel={() => { setDragging(false); setHover(null); }} /> : null;
          })}
          {layout.pageCount === 0 && <Text style={styles.empty}>Scan or import a receipt to start this document.</Text>}
        </Animated.View></GestureDetector>
      </View>
      <View style={styles.pageNav}><Pressable onPress={() => setPage(Math.max(0, visiblePage - 1))} style={styles.navButton} accessibilityLabel="Previous receipt page"><Text style={styles.icon}>‹</Text></Pressable><Text style={styles.pageText}>Receipt page {layout.pageCount ? visiblePage + 1 : 1} of {Math.max(1, layout.pageCount)}</Text><Pressable onPress={() => setPage(Math.min(Math.max(0, layout.pageCount - 1), visiblePage + 1))} style={styles.navButton} accessibilityLabel="Next receipt page"><Text style={styles.icon}>›</Text></Pressable></View>
      <View style={styles.row}><Text style={styles.zoomHint}>Pinch to zoom · two fingers to pan · hold to move</Text><Pressable onPress={() => { scale.set(withSpring(1)); offsetX.set(withSpring(0)); offsetY.set(withSpring(0)); }}><Text style={styles.link}>Reset zoom</Text></Pressable></View>
      {receipt && <View style={styles.actionsCard}>
        <Text style={styles.proposalTitle}>#{doc.receipts.indexOf(receipt) + 1} {receipt.merchant ?? 'Receipt'}</Text>
        <View style={styles.actionRow}><Pressable onPress={() => props.onEdit(receipt)}><Text style={styles.link}>View & edit</Text></Pressable><Pressable onPress={() => props.onReplace(receipt)}><Text style={styles.link}>Replace</Text></Pressable><Pressable onPress={() => props.onRotate(receipt)}><Text style={styles.link}>Rotate</Text></Pressable><Pressable onPress={() => props.onDelete(receipt.id)}><Text style={styles.danger}>Remove</Text></Pressable></View>
        <View style={styles.actionRow}>{(['left', 'right', 'up', 'down', 'previous', 'next'] as const).map((direction) => <Pressable key={direction} onPress={() => accessibleMove(direction)} accessibilityLabel={`Move receipt ${direction}`} style={styles.moveButton}><Text style={styles.moveText}>{direction}</Text></Pressable>)}</View>
      </View>}
      <View style={styles.row}><Pressable onPress={props.onImport} style={styles.secondary}><Text style={styles.secondaryText}>＋ Add receipt</Text></Pressable><Pressable onPress={() => propose(null)} style={styles.secondary}><Text style={styles.secondaryText}>✦ Optimise layout</Text></Pressable></View>
      <View style={styles.row}><Pressable onPress={props.onScan}><Text style={styles.link}>Scan receipt</Text></Pressable>{undo && doc.revision === undo.revision && <Pressable onPress={() => { void props.onLayout(undo.layout).then((ok) => { if (ok) setUndo(null); }); }}><Text style={styles.link}>Undo layout</Text></Pressable>}</View>
      <View style={styles.row}><Pressable disabled={!!proposal || !props.canExport || props.busy} onPress={props.onPreview} style={styles.secondary}><Text style={styles.secondaryText}>Export options</Text></Pressable><Pressable disabled={!!proposal || !props.canExport || props.busy} onPress={props.onExport} style={[styles.primary, (!!proposal || !props.canExport || props.busy) && styles.disabled]}><Text style={styles.primaryText}>↓ Export PDF</Text></Pressable></View>
      {summary.issues.length > 0 && <Text style={styles.warningText}>Included receipts have unresolved issues. Image-only export remains available.</Text>}
      {doc.exports.map((file, index) => <Pressable key={file.id} onPress={() => props.onShare(props.exportUri(file))}><Text style={styles.link}>Share PDF version {index + 1} · {file.createdAt.slice(0, 10)}</Text></Pressable>)}
      <Pressable onPress={() => setManage((value) => !value)}><Text style={styles.link}>{manage ? 'Hide receipt list' : 'Manage receipt order and selection'}</Text></Pressable>
      {manage && <View style={styles.actionsCard}>{doc.receipts.map((item, index) => <View key={item.id} style={styles.manageRow}>
        <Pressable onPress={() => setMulti((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])} accessibilityRole="checkbox" accessibilityState={{ checked: multi.includes(item.id) }}><Text style={styles.link}>{multi.includes(item.id) ? '☑' : '□'}</Text></Pressable>
        <Pressable onPress={() => props.onEdit(item)} style={{ flex: 1 }}><Text numberOfLines={1} style={styles.proposalTitle}>#{index + 1} {item.merchant ?? 'Receipt'}</Text></Pressable>
        <Pressable disabled={index === 0} onPress={() => { const ids = doc.receipts.map((receipt) => receipt.id); [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]; props.onReorder(ids); }} accessibilityLabel={`Move receipt ${index + 1} earlier`}><Text style={styles.link}>↑</Text></Pressable>
        <Pressable disabled={index === doc.receipts.length - 1} onPress={() => { const ids = doc.receipts.map((receipt) => receipt.id); [ids[index + 1], ids[index]] = [ids[index]!, ids[index + 1]!]; props.onReorder(ids); }} accessibilityLabel={`Move receipt ${index + 1} later`}><Text style={styles.link}>↓</Text></Pressable>
      </View>)}{multi.length > 0 && <Pressable onPress={() => props.onDeleteMany(multi)}><Text style={styles.danger}>Delete {multi.length} selected</Text></Pressable>}</View>}
      <Pressable onPress={props.onDeleteDocument}><Text style={styles.danger}>Delete document</Text></Pressable>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.canvas },
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: theme.white, gap: 8 },
  iconButton: { minWidth: 32, minHeight: 40, justifyContent: 'center' },
  icon: { color: theme.ink, fontSize: 30, lineHeight: 32 },
  title: { color: theme.ink, fontSize: 19, fontWeight: '700', padding: 0 },
  status: { color: theme.muted, fontSize: 11, marginTop: 2 },
  toolbar: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  format: { color: theme.ink, fontSize: 12, fontWeight: '600', backgroundColor: theme.white, borderRadius: 9, padding: 8 },
  segmented: { flexDirection: 'row', backgroundColor: theme.lavender, borderRadius: 9, padding: 3 },
  segment: { paddingHorizontal: 8, minHeight: 40, justifyContent: 'center', borderRadius: 7 },
  segmentActive: { backgroundColor: theme.violet },
  segmentText: { color: theme.ink, fontSize: 11 },
  segmentTextActive: { color: theme.white, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 30, gap: 12 },
  summary: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  canvasFrame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 11 },
  paper: { backgroundColor: theme.white, borderColor: theme.border, borderWidth: 1, borderRadius: 4, overflow: 'hidden', elevation: 3 },
  tile: { position: 'absolute', backgroundColor: '#fafafa', borderColor: '#d8d7e3', borderWidth: 1, borderRadius: 3, overflow: 'hidden', zIndex: 1 },
  selectedTile: { borderColor: theme.violet, borderWidth: 2, zIndex: 2 },
  placeholder: { position: 'absolute', borderWidth: 2, borderStyle: 'dashed', borderColor: theme.violet, backgroundColor: '#e6dfff', opacity: 0.65 },
  tileLabel: { fontSize: 8, color: theme.muted, paddingHorizontal: 2 },
  empty: { textAlign: 'center', color: theme.muted, marginTop: 100, marginHorizontal: 20 },
  pageNav: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28 },
  navButton: { width: 44, height: 44, backgroundColor: theme.lavender, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pageText: { color: theme.ink, fontSize: 12 },
  zoomHint: { color: theme.muted, textAlign: 'center', fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 },
  secondary: { flex: 1, backgroundColor: theme.lavender, borderRadius: 11, padding: 12, alignItems: 'center' },
  secondaryText: { color: theme.violetDark, fontWeight: '700', fontSize: 12 },
  primary: { flex: 1, backgroundColor: theme.violet, padding: 12, borderRadius: 11, alignItems: 'center' },
  primaryText: { color: theme.white, fontWeight: '700' },
  primarySmall: { color: theme.white, fontWeight: '700', backgroundColor: theme.violet, padding: 10, borderRadius: 9 },
  disabled: { opacity: 0.4 },
  link: { color: theme.violetDark, fontWeight: '600', paddingVertical: 7 },
  danger: { color: theme.danger, fontWeight: '600', paddingVertical: 7 },
  warning: { borderColor: '#efd79c', borderWidth: 1, backgroundColor: '#fff9e8', borderRadius: 10, padding: 12 },
  warningText: { color: '#765715', fontSize: 12 },
  proposal: { backgroundColor: theme.white, borderRadius: 12, padding: 13, gap: 7 },
  proposalTitle: { fontWeight: '700', color: theme.ink },
  actionsCard: { backgroundColor: theme.white, borderRadius: 12, padding: 12, gap: 8 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  moveButton: { backgroundColor: theme.lavender, borderRadius: 7, minHeight: 44, minWidth: 44, padding: 7, alignItems: 'center', justifyContent: 'center' },
  moveText: { color: theme.violetDark, fontSize: 11 },
  dragHint: { backgroundColor: theme.lavender, padding: 8, borderRadius: 9, marginBottom: 4 },
  dragHintText: { color: theme.violetDark, fontSize: 11, textAlign: 'center' },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: theme.border, paddingVertical: 6 },
});

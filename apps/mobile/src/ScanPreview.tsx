import { extractFields, type CaptureSource } from '@remi/core';
import { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { Corners } from '../modules/remi-scan/src';
import type { ScanFilter } from './documents';
import type { RecognizedReceipt } from '../modules/remi-scan/src';
import { theme } from './theme';

export type PendingScan = {
  id: string;
  originalUri: string;
  sourceUri: string;
  processedUri: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  corners: Corners | null;
  filter: ScanFilter;
  rotation: number;
  ocrText: string;
  ocrLines: RecognizedReceipt['lines'];
  sourceSha256?: string;
  replaceId?: string;
  captureSource?: CaptureSource;
  originalPhotoAvailable?: boolean;
  source: 'camera' | 'gallery';
};

function Corner({ x, y, width, height, onDragEnd }: {
  x: number; y: number; width: number; height: number;
  onDragEnd: (x: number, y: number) => void;
}) {
  const latest = useRef({ x, y, width, height, onDragEnd });
  latest.current = { x, y, width, height, onDragEnd };
  const origin = useRef({ x, y });
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { origin.current = { x: latest.current.x, y: latest.current.y }; },
    onPanResponderMove: (_, gesture) => latest.current.onDragEnd(
      Math.max(0, Math.min(1, origin.current.x + gesture.dx / latest.current.width)),
      Math.max(0, Math.min(1, origin.current.y + gesture.dy / latest.current.height)),
    ),
  })).current;
  return <View {...responder.panHandlers} style={[styles.corner, { left: x * width - 12, top: y * height - 12 }]} />;
}

export function ScanPreview({ scan, busy, onProcess, onConfirm, onCancel, onReplace }: {
  scan: PendingScan;
  busy: boolean;
  onProcess: (filter: ScanFilter, rotation: number, corners: Corners | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReplace: () => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [editingCorners, setEditingCorners] = useState(false);
  const [corners, setCorners] = useState<Corners>(scan.corners ?? [0, 0, 1, 0, 1, 1, 0, 1]);
  useEffect(() => {
    if (!editingCorners) setCorners(scan.corners ?? [0, 0, 1, 0, 1, 1, 0, 1]);
  }, [scan.processedUri, editingCorners]);
  const totalFound = extractFields(scan.ocrText).totalCents !== null;
  const { width: screenWidth } = useWindowDimensions();
  const frameWidth = screenWidth - 32;
  const originalWidth = scan.sourceWidth;
  const originalHeight = scan.sourceHeight;
  const imageWidth = Math.min(frameWidth, 360 * originalWidth / originalHeight);
  const imageHeight = imageWidth * originalHeight / originalWidth;

  function moveCorner(index: number, x: number, y: number) {
    setCorners((current) => {
      const next = [...current] as Corners;
      next[index * 2] = x;
      next[index * 2 + 1] = y;
      return next;
    });
  }

  return <ScrollView contentContainerStyle={styles.root}>
    <View style={styles.header}><Pressable onPress={onCancel} style={styles.backButton}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.title}>Scan Preview</Text></View>
    <Text style={styles.hint}>{scan.source === 'gallery' && !scan.corners ? 'Corners were not found. Adjust them before adding.' : 'Check that all printed text is visible.'}</Text>
    <View style={styles.frame}><ScrollView horizontal contentContainerStyle={{ alignItems: 'center' }}>
      <ScrollView contentContainerStyle={{ justifyContent: 'center', minHeight: 390 }}>
        <View style={{ width: imageWidth * (zoomed ? 2 : 1), height: imageHeight * (zoomed ? 2 : 1) }}>
          <Image source={{ uri: editingCorners ? scan.sourceUri : showOriginal ? scan.originalUri : scan.processedUri }} resizeMode="contain"
            style={{ width: imageWidth * (zoomed ? 2 : 1), height: imageHeight * (zoomed ? 2 : 1) }} />
          {editingCorners && !zoomed && [0, 1, 2, 3].map((index) => <Corner key={index} x={corners[index * 2]} y={corners[index * 2 + 1]} width={imageWidth} height={imageHeight} onDragEnd={(x, y) => moveCorner(index, x, y)} />)}
        </View>
      </ScrollView></ScrollView></View>
    <View style={styles.actions}>
      <Pressable disabled={editingCorners} onPress={() => setShowOriginal((value) => !value)}><Text style={styles.link}>{editingCorners ? 'Adjusting working image' : showOriginal ? 'Show processed' :
        scan.captureSource === 'system_scanner' ? 'Show scanner source' : 'Show original photo'}</Text></Pressable>
      <Pressable onPress={() => setZoomed((value) => !value)}><Text style={styles.link}>{zoomed ? 'Fit image' : 'Zoom 2×'}</Text></Pressable>
      <Pressable onPress={() => { setZoomed(false); setShowOriginal(false); setEditingCorners((value) => !value); }}><Text style={styles.link}>{editingCorners ? 'Hide corners' : 'Adjust corners'}</Text></Pressable>
      <Pressable disabled={busy} onPress={() => { setShowOriginal(false); onProcess(scan.filter, (scan.rotation + 90) % 360, editingCorners ? corners : scan.corners); }}><Text style={styles.link}>Rotate</Text></Pressable>
    </View>
    {editingCorners && <Pressable disabled={busy} onPress={() => { onProcess(scan.filter, scan.rotation, corners); setEditingCorners(false); setShowOriginal(false); }}><Text style={styles.link}>Apply corners</Text></Pressable>}
    <Pressable disabled={busy} onPress={() => { setCorners([0, 0, 1, 0, 1, 1, 0, 1]); setEditingCorners(false); setShowOriginal(false); onProcess('original', 0, null); }}><Text style={styles.link}>Reset processing</Text></Pressable>
    <View style={styles.actions}>
      {(['original', 'colour', 'bw'] as const).map((filter) => <Pressable key={filter} disabled={busy} onPress={() => { setShowOriginal(false); onProcess(filter, scan.rotation, editingCorners ? corners : scan.corners); }}><Text style={[styles.filter, scan.filter === filter && styles.selected]}>{filter === 'bw' ? 'Black & White' : filter === 'colour' ? 'Enhanced Colour' : 'Original'}</Text></Pressable>)}
    </View>
    {scan.ocrText.trim() === '' && <Text style={styles.hint}>No text was recognised. Retake if important text is covered or unreadable.</Text>}
    {scan.ocrText.trim() !== '' && !totalFound && <Text style={styles.hint}>The total could not be read. Retake if obscured, or enter it manually after adding.</Text>}
    {editingCorners && <Text style={styles.hint}>Apply corners before adding this receipt.</Text>}
    <View style={styles.actions}>
      <Pressable disabled={busy} onPress={onCancel}><Text style={styles.link}>Cancel</Text></Pressable>
      <Pressable disabled={busy} onPress={onReplace}><Text style={styles.link}>Retake / replace</Text></Pressable>
      <Pressable disabled={busy || editingCorners} onPress={onConfirm}><Text style={[styles.primary, editingCorners && styles.disabled]}>{busy ? 'Processing…' : scan.replaceId ? 'Save image' : 'Add to Document'}</Text></Pressable>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, gap: 14, backgroundColor: '#1d1c25', paddingHorizontal: 16, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 38 },
  backButton: { position: 'absolute', left: 0, top: 0, width: 40, height: 38, justifyContent: 'center' },
  back: { color: theme.white, fontSize: 32 },
  title: { fontSize: 17, fontWeight: '700', color: theme.white },
  hint: { color: '#d6d3e5', fontSize: 12 },
  frame: { height: 390, justifyContent: 'center', alignItems: 'center', backgroundColor: '#26232a', borderRadius: 13 },
  corner: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: theme.violet, borderWidth: 2, borderColor: 'white' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  link: { color: theme.white, padding: 8, fontSize: 12 },
  filter: { color: '#eee', padding: 10, borderRadius: 9, backgroundColor: '#44424d', fontSize: 12 },
  selected: { color: '#fff', backgroundColor: theme.violet },
  primary: { color: '#fff', backgroundColor: theme.violet, padding: 12, borderRadius: 11, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});

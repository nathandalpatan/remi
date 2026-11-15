import { maxSourceSpan, type ColumnCount } from '@remi/core';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { SavedReceipt } from './documents';
import { theme } from './theme';

export function BreakEditor({ receipt, columns, onSave, onCancel }: {
  receipt: SavedReceipt; columns: ColumnCount; onSave: (breaks: number[]) => void; onCancel: () => void;
}) {
  const [breaks, setBreaks] = useState<number[]>([]);
  const [candidate, setCandidate] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  const imageWidth = Math.min(width - 32, 480);
  const imageHeight = imageWidth * receipt.image.heightPx / receipt.image.widthPx;
  const span = maxSourceSpan({ id: receipt.id, widthPx: receipt.image.widthPx, heightPx: receipt.image.heightPx }, columns);
  const start = breaks.at(-1) ?? 0;
  const limit = Math.min(1, start + span);

  function choose(value: number) {
    if (!(value > start + 0.002 && value < limit - 0.002)) {
      Alert.alert('Choose a gap', 'Tap a blank strip between the start and the red limit.');
      return;
    }
    if ((receipt.ocrLines ?? []).some((line) => value > line.top && value < line.bottom)) {
      Alert.alert('Text at this position', 'The break crosses a recognized text line. Choose a blank gap.');
      return;
    }
    setCandidate(value);
  }

  function confirm() {
    if (candidate === null) return;
    const next = [...breaks, candidate];
    setBreaks(next);
    setCandidate(null);
    if (1 - candidate <= span) onSave(next);
  }

  return <View style={styles.root}>
    <View style={styles.header}><Pressable onPress={onCancel}><Text style={styles.link}>‹ Document</Text></Pressable><Text style={styles.title}>Choose a safe page break</Text></View>
    <Text style={styles.hint}>Inspect the printed text, then tap a blank horizontal strip above the red line. Each part must fit on an A4 page.</Text>
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable onPress={(event) => choose(event.nativeEvent.locationY / imageHeight)} style={{ width: imageWidth, height: imageHeight, alignSelf: 'center' }}>
        <Image source={{ uri: receipt.image.uri }} resizeMode="stretch" style={{ width: imageWidth, height: imageHeight }} />
        {breaks.map((value) => <View key={value} pointerEvents="none" style={[styles.line, { top: value * imageHeight, borderColor: theme.success }]} />)}
        <View pointerEvents="none" style={[styles.line, { top: limit * imageHeight, borderColor: theme.danger }]} />
        {candidate !== null && <View pointerEvents="none" style={[styles.line, { top: candidate * imageHeight, borderColor: theme.violet }]} />}
      </Pressable>
      <Text style={styles.hint}>Segment {breaks.length + 1} starts at {Math.round(start * 100)}%. Maximum break: {Math.round(limit * 100)}%.</Text>
      {candidate !== null && <View style={{ width: imageWidth, gap: 5 }}><Text style={styles.hint}>Zoomed break preview · confirm the line crosses only blank paper</Text><View style={[styles.magnifier, { width: imageWidth }]}>
        <Image source={{ uri: receipt.image.uri }} resizeMode="stretch" style={{ position: 'absolute', width: imageWidth * 2, height: imageHeight * 2,
          left: -imageWidth / 2, top: 55 - candidate * imageHeight * 2 }} />
        <View style={styles.magnifierLine} />
      </View></View>}
    </ScrollView>
    <View style={styles.footer}>
      {breaks.length > 0 && <Pressable onPress={() => { setBreaks(breaks.slice(0, -1)); setCandidate(null); }}><Text style={styles.link}>Undo break</Text></Pressable>}
      <Pressable disabled={candidate === null} onPress={confirm} style={[styles.button, candidate === null && styles.disabled]}><Text style={styles.buttonText}>Confirm blank gap</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.canvas, paddingHorizontal: 16, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 12 },
  title: { color: theme.ink, fontSize: 17, fontWeight: '700' },
  hint: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  link: { color: theme.violetDark, fontWeight: '600' },
  scroll: { alignItems: 'center', gap: 10, paddingBottom: 20 },
  line: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  magnifier: { height: 110, overflow: 'hidden', borderRadius: 9, borderWidth: 1, borderColor: theme.border },
  magnifierLine: { position: 'absolute', top: 55, left: 0, right: 0, borderTopWidth: 2, borderColor: theme.violet, borderStyle: 'dashed' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 12 },
  button: { flex: 1, alignItems: 'center', padding: 13, borderRadius: 10, backgroundColor: theme.violet },
  buttonText: { color: theme.white, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});

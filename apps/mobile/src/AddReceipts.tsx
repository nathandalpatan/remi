import { CameraView } from 'expo-camera';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './theme';

export function AddReceipts({ onCamera, onGallery, onQuickScan, onCancel }: {
  onCamera: () => void;
  onGallery: () => void;
  onQuickScan: () => void;
  onCancel: () => void;
}) {
  return <View style={styles.root}>
    <View style={styles.header}>
      <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Close add receipts"><Text style={styles.back}>‹</Text></Pressable>
      <Text style={styles.title}>Add receipts</Text>
    </View>
    <Text style={styles.hint}>Choose how to add photos to this document.</Text>
    <Pressable style={styles.option} onPress={onCamera} accessibilityRole="button">
      <Text style={styles.optionTitle}>Take photos</Text>
      <Text style={styles.optionHint}>Use Remi Camera and capture several receipts.</Text>
    </Pressable>
    <Pressable style={styles.option} onPress={onGallery} accessibilityRole="button">
      <Text style={styles.optionTitle}>Import from gallery</Text>
      <Text style={styles.optionHint}>Select up to 50 photos at once.</Text>
    </Pressable>
    <Pressable style={[styles.option, !CameraView.isDocumentScannerAvailable && styles.disabled]}
      disabled={!CameraView.isDocumentScannerAvailable} onPress={onQuickScan} accessibilityRole="button">
      <Text style={styles.optionTitle}>Quick Scan</Text>
      <Text style={styles.optionHint}>{CameraView.isDocumentScannerAvailable
        ? 'Use your device’s document scanner.' : 'Unavailable on this device.'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.canvas, paddingHorizontal: 22, paddingTop: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  back: { color: theme.ink, fontSize: 32, lineHeight: 38 },
  title: { color: theme.ink, fontSize: 22, fontWeight: '700' },
  hint: { color: theme.muted, fontSize: 14, marginBottom: 20 },
  option: { backgroundColor: theme.white, borderColor: theme.border, borderWidth: 1, borderRadius: 14,
    padding: 19, marginBottom: 12, gap: 5 },
  optionTitle: { color: theme.ink, fontSize: 17, fontWeight: '700' },
  optionHint: { color: theme.muted, fontSize: 13 },
  disabled: { opacity: 0.45 },
});

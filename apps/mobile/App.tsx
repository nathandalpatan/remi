import { formatCents, parseAmountToCents, summarizeClaim, type Receipt } from '@remi/core';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Button, FlatList, StyleSheet, Text, View } from 'react-native';
import { exportAndShare, HOME_CURRENCY, newBatch, receiptFromPhoto } from './src/claim';
import { ReceiptRow } from './src/ReceiptRow';

export default function App() {
  const [batch] = useState(newBatch);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  // What the user typed, kept separately so "12." isn't wiped while they're still typing.
  const [amountText, setAmountText] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);

  const summary = summarizeClaim(receipts, HOME_CURRENCY);
  const canExport = receipts.length > 0 && summary.issues.length === 0 && !exporting;

  async function addPhoto(source: 'camera' | 'library') {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Allow camera access in Settings to photograph receipts.');
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const photo = result.assets?.[0];
    if (!result.canceled && photo) setReceipts((list) => [...list, receiptFromPhoto(photo, batch.id)]);
  }

  function setAmount(id: string, text: string) {
    setAmountText((texts) => ({ ...texts, [id]: text }));
    const amountCents = parseAmountToCents(text);
    // shortcut: typing a valid amount while looking at the photo counts as confirming it,
    // until there is a review screen with merchant, date and GST.
    setReceipts((list) =>
      list.map((r) => (r.id === id ? { ...r, amountCents, confirmed: amountCents !== null } : r)),
    );
  }

  function remove(id: string) {
    setReceipts((list) => list.filter((r) => r.id !== id));
  }

  async function exportPdf() {
    setExporting(true);
    try {
      await exportAndShare(batch, receipts);
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{batch.name}</Text>
      <Text style={styles.total}>
        Total {formatCents(summary.totalCents)} {HOME_CURRENCY}
      </Text>

      <View style={styles.actions}>
        <Button title="Take photo" onPress={() => addPhoto('camera')} />
        <Button title="Choose photo" onPress={() => addPhoto('library')} />
      </View>

      <FlatList
        data={receipts}
        keyExtractor={(r) => r.id}
        renderItem={({ item, index }) => (
          <ReceiptRow
            number={index + 1}
            receipt={item}
            amountText={amountText[item.id] ?? ''}
            onAmountChange={(text) => setAmount(item.id, text)}
            onRemove={() => remove(item.id)}
          />
        )}
        ListEmptyComponent={<Text style={styles.hint}>Add a receipt photo to start a claim.</Text>}
        style={styles.list}
      />

      {receipts.length > 0 && !canExport && !exporting && (
        <Text style={styles.hint}>Enter an amount for every receipt to export.</Text>
      )}
      <Button title={exporting ? 'Exporting…' : 'Export PDF'} onPress={exportPdf} disabled={!canExport} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  // shortcut: fixed top padding instead of safe-area insets; add react-native-safe-area-context with navigation.
  screen: { flex: 1, backgroundColor: '#fff', paddingTop: 64, paddingHorizontal: 16, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: '700' },
  total: { fontSize: 18, marginTop: 4, marginBottom: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  list: { flex: 1 },
  hint: { color: '#666', textAlign: 'center', marginVertical: 12 },
});

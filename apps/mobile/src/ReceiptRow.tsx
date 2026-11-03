import type { Receipt } from '@remi/core';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface Props {
  number: number;
  receipt: Receipt;
  amountText: string;
  onAmountChange: (text: string) => void;
  onRemove: () => void;
}

export function ReceiptRow({ number, receipt, amountText, onAmountChange, onRemove }: Props) {
  const invalid = amountText !== '' && receipt.amountCents === null;
  return (
    <View style={styles.row}>
      <Image source={{ uri: receipt.image.uri }} style={styles.thumb} accessibilityLabel={`Receipt ${number} photo`} />
      <View style={styles.body}>
        <Text style={styles.number}>#{number}</Text>
        <TextInput
          value={amountText}
          onChangeText={onAmountChange}
          placeholder="Amount, e.g. 12.50"
          keyboardType="decimal-pad"
          accessibilityLabel={`Receipt ${number} amount`}
          style={[styles.input, invalid && styles.inputInvalid]}
        />
        {invalid && <Text style={styles.error}>Enter an amount like 12.50</Text>}
      </View>
      <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove receipt ${number}`}>
        <Text style={styles.remove}>Remove</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  thumb: { width: 56, height: 84, borderRadius: 4, backgroundColor: '#eee' },
  body: { flex: 1, gap: 4 },
  number: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, fontSize: 16 },
  inputInvalid: { borderColor: '#c62828' },
  error: { color: '#c62828', fontSize: 12 },
  remove: { color: '#c62828', padding: 8 },
});

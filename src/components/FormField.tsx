import { View, Text, TextInput, StyleSheet, KeyboardTypeOptions } from 'react-native';

interface Props {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
}

export function FormField({ label, value, onChangeText, keyboardType, multiline }: Props) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4, marginBottom: 12 },
  label: { fontSize: 13, color: '#334155', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, fontSize: 15 },
  inputMultiline: { height: 80, textAlignVertical: 'top' },
});

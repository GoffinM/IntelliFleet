import { View, Pressable, Text, StyleSheet } from 'react-native';

export interface ChipItem {
  id: string;
  label: string;
}

interface Props {
  items: ChipItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ChipRow({ items, selectedId, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onSelect(item.id)}
          style={[styles.chip, item.id === selectedId && styles.chipActive]}
        >
          <Text style={[styles.text, item.id === selectedId && styles.textActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  text: { color: '#334155', fontWeight: '500' },
  textActive: { color: 'white' },
});

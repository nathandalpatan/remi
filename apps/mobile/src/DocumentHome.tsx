import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SavedDocument } from './documents';
import { theme } from './theme';

export function DocumentHome({ documents, busy, onCreate, onScan, onImport, onOpen, onShare, exportUri }: {
  documents: SavedDocument[]; busy: boolean; onCreate: () => void; onScan: () => void; onImport: () => void;
  onOpen: (doc: SavedDocument) => void; onShare: (uri: string) => void;
  exportUri: (file: SavedDocument['exports'][number]) => string;
}) {
  const [tab, setTab] = useState<'documents' | 'exports' | 'profile'>('documents');
  const [filter, setFilter] = useState<'all' | 'drafts' | 'completed'>('all');
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const visible = documents.filter((doc) => doc.batch.name.toLowerCase().includes(query.toLowerCase()))
    .filter((doc) => filter === 'all' || (filter === 'drafts' ? !doc.exports.length : !!doc.exports.length))
    .sort((a, b) => sort === 'title' ? a.batch.name.localeCompare(b.batch.name) : b.updatedAt.localeCompare(a.updatedAt));
  const exports = documents.flatMap((doc) => doc.exports.map((file) => ({ doc, file })))
    .sort((a, b) => b.file.createdAt.localeCompare(a.file.createdAt));

  return <View style={styles.root}>
    <View style={styles.header}>
      <View style={styles.logo}><Text style={styles.logoText}>R</Text></View><Text style={styles.brand}>Remi</Text>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => setSearch((value) => !value)} style={styles.headerButton} accessibilityLabel="Search documents"><Text style={styles.headerIcon}>⌕</Text></Pressable>
      <Pressable onPress={() => setSort(sort === 'recent' ? 'title' : 'recent')} style={styles.headerButton} accessibilityLabel="Change sort order"><Text style={styles.headerIcon}>↕</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {tab === 'documents' ? <>
        <Text style={styles.title}>My Documents</Text>
        {search && <TextInput value={query} onChangeText={setQuery} placeholder="Search documents" autoFocus style={styles.search} />}
        <View style={styles.filters}>{(['all', 'drafts', 'completed'] as const).map((name) => <Pressable key={name} onPress={() => setFilter(name)} style={[styles.filter, filter === name && styles.activeFilter]}><Text style={[styles.filterText, filter === name && styles.activeFilterText]}>{name[0].toUpperCase() + name.slice(1)}</Text></Pressable>)}</View>
        <View style={styles.divider} />
        {visible.map((doc) => <Pressable key={doc.batch.id} onPress={() => onOpen(doc)} style={styles.row}>
          <View style={styles.thumbFrame}>{doc.receipts[0] ? <Image source={{ uri: doc.receipts[0].thumbnailUri ?? doc.receipts[0].image.uri }} resizeMode="contain" style={styles.thumb} /> : <Text style={styles.emptyThumb}>▤</Text>}</View>
          <View style={styles.details}><Text numberOfLines={1} style={styles.docTitle}>{doc.batch.name}</Text><Text style={styles.meta}>{doc.receipts.length} receipts · {doc.updatedAt.slice(0, 10)}</Text><Text style={[styles.badge, doc.exports.length ? styles.complete : styles.draft]}>{doc.exports.length ? doc.revision > doc.exports[doc.exports.length - 1]!.revision ? '✓ Unexported changes' : '✓ Completed' : 'Draft'}</Text></View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>)}
        {visible.length === 0 && <Text style={styles.empty}>No documents here yet.</Text>}
        <View style={styles.quickActions}><Pressable onPress={onScan}><Text style={styles.quickText}>＋ Add receipts to a new document</Text></Pressable><Pressable onPress={onImport}><Text style={styles.quickText}>Import from gallery</Text></Pressable></View>
      </> : tab === 'exports' ? <>
        <Text style={styles.title}>Exports</Text><Text style={styles.meta}>Your PDF versions stay available after editing a draft.</Text>
        {exports.map(({ doc, file }) => <Pressable key={file.id} onPress={() => onShare(exportUri(file))} style={styles.exportRow}><Text style={styles.pdfIcon}>PDF</Text><View style={{ flex: 1 }}><Text style={styles.docTitle}>{doc.batch.name}.pdf</Text><Text style={styles.meta}>{file.createdAt.slice(0, 10)} · version {doc.exports.indexOf(file) + 1}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}
        {!exports.length && <Text style={styles.empty}>Exported PDFs will appear here.</Text>}
      </> : <><Text style={styles.title}>Profile</Text><View style={styles.profileCard}><Text style={styles.docTitle}>On this device</Text><Text style={styles.meta}>Your drafts and PDF versions are stored locally on this device.</Text></View></>}
    </ScrollView>
    {tab === 'documents' && <Pressable disabled={busy} onPress={onCreate} style={styles.fab} accessibilityLabel="Create document"><Text style={styles.fabText}>＋</Text></Pressable>}
    <View style={styles.nav}>
      <Pressable onPress={() => setTab('documents')} style={styles.navItem}><Text style={[styles.navIcon, tab === 'documents' && styles.navActive]}>▤</Text><Text style={[styles.navLabel, tab === 'documents' && styles.navActive]}>Documents</Text></Pressable>
      <Pressable onPress={onScan} style={styles.navItem}><Text style={styles.navIcon}>⌗</Text><Text style={styles.navLabel}>Add receipts</Text></Pressable>
      <Pressable onPress={() => setTab('exports')} style={styles.navItem}><Text style={[styles.navIcon, tab === 'exports' && styles.navActive]}>⇩</Text><Text style={[styles.navLabel, tab === 'exports' && styles.navActive]}>Exports</Text></Pressable>
      <Pressable onPress={() => setTab('profile')} style={styles.navItem}><Text style={[styles.navIcon, tab === 'profile' && styles.navActive]}>♙</Text><Text style={[styles.navLabel, tab === 'profile' && styles.navActive]}>Profile</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8f7fe' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, gap: 7 },
  logo: { width: 23, height: 23, borderRadius: 6, backgroundColor: theme.violet, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: theme.white, fontSize: 15, fontWeight: '800' },
  brand: { color: theme.ink, fontWeight: '800', fontSize: 16 },
  headerButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { color: theme.ink, fontSize: 28 },
  content: { paddingHorizontal: 22, paddingBottom: 80 },
  title: { color: theme.ink, fontWeight: '800', fontSize: 26, marginTop: 24, marginBottom: 18 },
  search: { backgroundColor: theme.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.border, marginBottom: 12 },
  filters: { flexDirection: 'row', gap: 6 },
  filter: { flex: 1, paddingVertical: 9, borderRadius: 20, backgroundColor: theme.lavender, alignItems: 'center' },
  activeFilter: { backgroundColor: theme.violet },
  filterText: { color: theme.ink, fontSize: 12 },
  activeFilterText: { color: theme.white, fontWeight: '700' },
  divider: { height: 1, backgroundColor: theme.border, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 86, borderBottomWidth: 1, borderColor: theme.border, gap: 12 },
  thumbFrame: { width: 50, height: 62, borderRadius: 5, backgroundColor: '#ececf1', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: 44, height: 58 },
  emptyThumb: { fontSize: 33, color: '#aaa9ba' },
  details: { flex: 1, gap: 4 },
  docTitle: { color: theme.ink, fontWeight: '700', fontSize: 15 },
  meta: { color: theme.muted, fontSize: 12 },
  badge: { alignSelf: 'flex-start', borderRadius: 10, paddingVertical: 2, paddingHorizontal: 9, fontSize: 11 },
  draft: { color: theme.violetDark, backgroundColor: '#e9e2ff' },
  complete: { color: '#197c52', backgroundColor: '#e4f4ea' },
  chevron: { fontSize: 28, color: theme.muted },
  empty: { color: theme.muted, textAlign: 'center', padding: 30 },
  quickActions: { marginTop: 24, gap: 10 },
  quickText: { color: theme.violetDark, fontWeight: '600' },
  fab: { position: 'absolute', right: 22, bottom: 90, width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.violet, elevation: 5 },
  fabText: { color: theme.white, fontSize: 30, marginTop: -3 },
  nav: { height: 72, borderTopWidth: 1, borderColor: theme.border, backgroundColor: theme.white, flexDirection: 'row' },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  navIcon: { color: theme.ink, fontSize: 24 },
  navLabel: { color: theme.muted, fontSize: 10 },
  navActive: { color: theme.violetDark, fontWeight: '700' },
  exportRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.white, borderRadius: 12, padding: 12, marginBottom: 10, gap: 12 },
  pdfIcon: { backgroundColor: theme.violet, color: theme.white, padding: 8, borderRadius: 5, fontSize: 10, fontWeight: '800' },
  profileCard: { backgroundColor: theme.white, borderRadius: 12, padding: 16, gap: 8 },
});

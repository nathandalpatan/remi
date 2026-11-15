import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import { File } from 'expo-file-system';
import { useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from './theme';

type CapturedPhoto = { uri: string; width: number; height: number };

function largestPictureSize(sizes: string[]): string | undefined {
  return sizes
    .map((value) => ({ value, dimensions: /^(\d+)x(\d+)$/.exec(value) }))
    .filter((item) => item.dimensions)
    .sort((a, b) => Number(b.dimensions![1]) * Number(b.dimensions![2]) -
      Number(a.dimensions![1]) * Number(a.dimensions![2]))[0]?.value;
}

export function RemiCamera({ onDone, onCancel }: {
  onDone: (uris: string[]) => Promise<void> | void;
  onCancel: () => void;
}) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string>();
  const [flash, setFlash] = useState<FlashMode>('off');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const captureLock = useRef(false);

  function removeFile(uri: string) {
    try { new File(uri).delete(); }
    catch (error) { Alert.alert('Could not remove temporary photo', String(error)); }
  }

  async function capture() {
    if (!camera.current || !ready || captureLock.current) return;
    captureLock.current = true;
    setCapturing(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 1 });
      if (!photo) throw new Error('Camera did not return a photo.');
      if (retakeIndex === null) setPhotos((current) => [...current, photo]);
      else {
        const old = photos[retakeIndex];
        setPhotos((current) => current.map((item, index) => index === retakeIndex ? photo : item));
        if (old) removeFile(old.uri);
        setRetakeIndex(null);
      }
    } catch (error) { Alert.alert('Photo not saved', String(error)); }
    finally { captureLock.current = false; setCapturing(false); }
  }

  async function finish() {
    if (!photos.length || finishing || retakeIndex !== null) return;
    setFinishing(true);
    try { await onDone(photos.map((photo) => photo.uri)); }
    catch (error) { Alert.alert('Could not add photos', String(error)); setFinishing(false); }
  }

  function cancel() {
    if (capturing || finishing) return;
    photos.forEach((photo) => removeFile(photo.uri));
    onCancel();
  }

  if (!permission) return <View style={styles.center}><Text style={styles.message}>Checking camera permission…</Text></View>;
  if (!permission.granted) return <View style={styles.center}>
    <Text style={styles.message}>Remi needs camera access to photograph receipts.</Text>
    <Pressable style={styles.primary} onPress={() => { void requestPermission(); }}><Text style={styles.primaryText}>Allow camera</Text></Pressable>
    <Pressable onPress={cancel}><Text style={styles.link}>Cancel</Text></Pressable>
  </View>;

  const reviewing = reviewIndex !== null ? photos[reviewIndex] : undefined;
  return <View style={styles.root}>
    <View style={styles.topBar}>
      <Pressable disabled={capturing || finishing} onPress={cancel} accessibilityLabel="Cancel camera session"><Text style={styles.topText}>Cancel</Text></Pressable>
      <Text style={styles.topTitle}>{reviewing ? 'Review photo' : 'Remi Camera'}</Text>
      <Pressable disabled={!photos.length || finishing || capturing || retakeIndex !== null} onPress={() => { void finish(); }} accessibilityLabel="Add captured receipts">
        <Text style={[styles.topText, (!photos.length || retakeIndex !== null) && styles.dimmed]}>Add {photos.length}</Text>
      </Pressable>
    </View>
    <View style={styles.cameraFrame}>
      {reviewing ? <Image source={{ uri: reviewing.uri }} resizeMode="contain" style={styles.preview} />
        : <>
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" mode="picture" flash={flash}
            autofocus="off" pictureSize={pictureSize} onCameraReady={() => {
              setReady(true);
              if (!pictureSize) void camera.current?.getAvailablePictureSizesAsync()
                .then((sizes) => setPictureSize(largestPictureSize(sizes)))
                .catch(() => undefined);
            }} onMountError={(error) => { setReady(false); Alert.alert('Camera unavailable', error.message); }} />
          <View pointerEvents="none" style={styles.guide} />
        </>}
    </View>
    {reviewing ? <View style={styles.controls}>
      <Pressable onPress={() => setReviewIndex(null)}><Text style={styles.control}>Keep</Text></Pressable>
      <Pressable onPress={() => { setRetakeIndex(reviewIndex); setReviewIndex(null); setReady(false); }}><Text style={styles.control}>Retake</Text></Pressable>
      <Pressable onPress={() => {
        removeFile(reviewing.uri);
        setPhotos((current) => current.filter((_, index) => index !== reviewIndex));
        setReviewIndex(null);
      }}><Text style={styles.danger}>Remove</Text></Pressable>
    </View> : <>
      <Text style={styles.guidance}>Keep the whole receipt inside the frame. Avoid covering printed information.</Text>
      <View style={styles.controls}>
        <Pressable onPress={() => setFlash((value) => value === 'off' ? 'auto' : value === 'auto' ? 'on' : 'off')}
          accessibilityLabel={`Flash ${flash}`}><Text style={styles.control}>Flash {flash}</Text></Pressable>
        <Pressable disabled={!ready || capturing || finishing} onPress={() => { void capture(); }}
          accessibilityLabel="Take receipt photo" style={[styles.shutter, (!ready || capturing) && styles.dimmed]}>
          <View style={styles.shutterInner} />
        </Pressable>
        <Text style={styles.count}>{photos.length} saved</Text>
      </View>
    </>}
    {photos.length > 0 && <ScrollView horizontal contentContainerStyle={styles.thumbnails}>
      {photos.map((photo, index) => <Pressable key={photo.uri} onPress={() => setReviewIndex(index)}
        accessibilityLabel={`Review photo ${index + 1}`}>
        <Image source={{ uri: photo.uri }} style={[styles.thumbnail, index === reviewIndex && styles.selected]} />
      </Pressable>)}
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121217' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20, padding: 24, backgroundColor: '#121217' },
  message: { color: theme.white, textAlign: 'center', fontSize: 16 },
  primary: { backgroundColor: theme.violet, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  primaryText: { color: theme.white, fontWeight: '700' },
  link: { color: theme.white, padding: 10 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, height: 54 },
  topText: { color: theme.white, fontWeight: '600', minWidth: 54 },
  topTitle: { color: theme.white, fontWeight: '700', fontSize: 16 },
  cameraFrame: { flex: 1, backgroundColor: '#050505', marginHorizontal: 12, borderRadius: 12, overflow: 'hidden' },
  preview: { width: '100%', height: '100%' },
  guide: { position: 'absolute', left: '16%', right: '16%', top: '8%', bottom: '8%', borderColor: '#ffffffb8', borderWidth: 2, borderRadius: 8 },
  guidance: { color: '#ddd', textAlign: 'center', fontSize: 12, marginHorizontal: 20, marginTop: 12 },
  controls: { height: 94, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  control: { color: theme.white, fontSize: 14, fontWeight: '600', padding: 10 },
  danger: { color: '#ff6e80', fontSize: 14, fontWeight: '600', padding: 10 },
  shutter: { width: 66, height: 66, borderColor: theme.white, borderWidth: 3, borderRadius: 33, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 52, height: 52, backgroundColor: theme.white, borderRadius: 26 },
  count: { color: theme.white, minWidth: 65, textAlign: 'right' },
  dimmed: { opacity: 0.45 },
  thumbnails: { paddingHorizontal: 12, paddingTop: 5, paddingBottom: 10, gap: 8 },
  thumbnail: { width: 48, height: 62, borderRadius: 5, borderWidth: 2, borderColor: 'transparent' },
  selected: { borderColor: theme.violet },
});

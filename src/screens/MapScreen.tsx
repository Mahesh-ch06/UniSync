import { MaterialIcons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

function Marker({ active = false }: { active?: boolean }) {
  return (
    <View style={styles.markerWrap}>
      <View style={[styles.markerLabel, active ? styles.activeLabel : styles.mutedLabel]}>
        <MaterialIcons color={active ? colors.onPrimary : colors.primary} name="location-on" size={14} />
        <Text style={[styles.markerText, active ? styles.activeMarkerText : undefined]}>Safe Drop Zone</Text>
      </View>
      <View style={[styles.markerDot, active ? styles.activeDot : undefined]} />
    </View>
  );
}

export function MapScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar leftIcon="menu" title="CampusFind" />

      <View style={styles.root}>
        <View style={styles.mapCanvas}>
          <Image
            source={{
              uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCKizRdim2KPIdFu2jMVFSD7Ljyb2UTs3D7x-IpnXJ8SfrLp3gMnaxTLFSYxlOA9ky_qTbNkxXSq3CQ14qlyvEyY_Vzmqb2VfyZaUfmuDFC_woONnPNvaFcxyItU-QiXc1nc-Zf1o6SJQ3qGPO2Lf26x5Cp34q0Fbko9UrVyI9UWJ4vjtchBQKvA_P2k1pV-mrp0s2mgoVfBNW9MaOW3SRJu7VNH6gon_p3_IU4_Dw_kbI1wL9maaHhNc46Gw3a_qvBPU47wmZEX1jP',
            }}
            style={styles.mapImage}
          />

          <View style={styles.primaryMarker}>
            <Marker active />
          </View>
          <View style={styles.secondaryMarker}>
            <Marker />
          </View>
          <View style={styles.thirdMarker}>
            <Marker />
          </View>

          <View style={styles.controlStack}>
            {['add', 'remove', 'my-location'].map((icon, index) => (
              <Pressable key={icon} style={[styles.controlButton, index === 2 ? styles.controlButtonActive : undefined]}>
                <MaterialIcons
                  color={index === 2 ? colors.primary : colors.onSurface}
                  name={icon as 'add' | 'remove' | 'my-location'}
                  size={20}
                />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <View>
              <Text style={styles.sheetTitle}>Library Front Desk</Text>
              <View style={styles.openRow}>
                <View style={styles.openDot} />
                <Text style={styles.openLabel}>Open until 10:00 PM</Text>
              </View>
            </View>
            <View style={styles.distanceChip}>
              <MaterialIcons color={colors.primaryContainer} name="directions-walk" size={16} />
              <Text style={styles.distanceLabel}>3 min away</Text>
            </View>
          </View>

          <View style={styles.qrArea}>
            <View style={styles.qrShell}>
              <View style={styles.qrInner}>
                <MaterialIcons color="rgba(0, 6, 102, 0.24)" name="qr-code-2" size={56} />
              </View>
            </View>
            <Text style={styles.qrCaption}>Scan at kiosk for handover</Text>
          </View>

          <Pressable style={styles.confirmButton}>
            <MaterialIcons color={colors.onPrimary} name="verified-user" size={20} />
            <Text style={styles.confirmLabel}>Confirm Drop-off</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  root: {
    flex: 1,
  },
  mapCanvas: {
    backgroundColor: colors.surfaceLow,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  mapImage: {
    height: '100%',
    opacity: 0.42,
    position: 'absolute',
    width: '100%',
  },
  markerWrap: {
    alignItems: 'center',
  },
  markerLabel: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  activeLabel: {
    backgroundColor: colors.primary,
  },
  mutedLabel: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  markerText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  activeMarkerText: {
    color: colors.onPrimary,
  },
  markerDot: {
    backgroundColor: colors.primary,
    borderColor: colors.surface,
    borderRadius: 9,
    borderWidth: 2,
    height: 14,
    width: 14,
  },
  activeDot: {
    height: 16,
    width: 16,
  },
  primaryMarker: {
    left: '45%',
    position: 'absolute',
    top: '33%',
  },
  secondaryMarker: {
    left: '16%',
    position: 'absolute',
    top: '22%',
  },
  thirdMarker: {
    position: 'absolute',
    right: '12%',
    top: '64%',
  },
  controlStack: {
    position: 'absolute',
    right: 16,
    top: 18,
  },
  controlButton: {
    ...shadows.soft,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    marginBottom: 8,
    width: 42,
  },
  controlButtonActive: {
    backgroundColor: '#EDF0FF',
  },
  sheet: {
    ...shadows.strong,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    minHeight: 340,
    paddingBottom: 22,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceHighest,
    borderRadius: radii.pill,
    height: 5,
    marginBottom: 18,
    width: 46,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 29,
    letterSpacing: -0.7,
    lineHeight: 31,
  },
  openRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 6,
  },
  openDot: {
    backgroundColor: colors.success,
    borderRadius: 4,
    height: 8,
    marginRight: 7,
    width: 8,
  },
  openLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
  },
  distanceChip: {
    alignItems: 'center',
    backgroundColor: '#EDF0FF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  distanceLabel: {
    color: colors.primaryContainer,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.7,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  qrArea: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    marginTop: 24,
  },
  qrShell: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderRadius: radii.lg,
    height: 164,
    justifyContent: 'center',
    width: 164,
  },
  qrInner: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    borderStyle: 'dashed',
    borderWidth: 2,
    height: 128,
    justifyContent: 'center',
    width: 128,
  },
  qrCaption: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.4,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 15,
  },
  confirmLabel: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 16,
    marginLeft: 8,
  },
});

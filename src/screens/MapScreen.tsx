import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

type MapTabParamList = {
  Home: undefined;
  Map: undefined;
  Report: undefined;
  History:
    | {
        focusRequestId?: string;
        focusFoundItemId?: string;
        focusNonce?: number;
        autoOpenMessages?: boolean;
      }
    | undefined;
  Profile: undefined;
  Settings: undefined;
};

type RouteState = 'idle' | 'routing' | 'paused' | 'arrived' | 'completed';

type DropZone = {
  id: string;
  name: string;
  pinLabel: string;
  openUntil: string;
  etaMinutes: number;
  mapLeft: `${number}%`;
  mapTop: `${number}%`;
  latitude: number;
  longitude: number;
};

type LiveLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  updatedAt: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateDistanceMeters(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const earthRadiusM = 6371000;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
}

function formatDistanceMeters(distanceMeters: number | null): string {
  if (distanceMeters === null) {
    return '--';
  }

  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(2)} km`;
  }

  return `${Math.round(distanceMeters)} m`;
}

function formatLiveAge(updatedAt: number | null): string {
  if (!updatedAt) {
    return 'not updated yet';
  }

  const seconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (seconds < 2) {
    return 'just now';
  }

  return `${seconds}s ago`;
}

const DROP_ZONES: DropZone[] = [
  {
    id: 'library-front-desk',
    name: 'Library Front Desk',
    pinLabel: 'Library Desk',
    openUntil: '10:00 PM',
    etaMinutes: 3,
    mapLeft: '45%',
    mapTop: '33%',
    latitude: 12.9716,
    longitude: 77.5946,
  },
  {
    id: 'north-gate-security',
    name: 'North Gate Security',
    pinLabel: 'North Gate',
    openUntil: '11:30 PM',
    etaMinutes: 6,
    mapLeft: '16%',
    mapTop: '22%',
    latitude: 12.9738,
    longitude: 77.5898,
  },
  {
    id: 'sports-complex-helpdesk',
    name: 'Sports Complex Helpdesk',
    pinLabel: 'Sports Desk',
    openUntil: '09:00 PM',
    etaMinutes: 8,
    mapLeft: '80%',
    mapTop: '64%',
    latitude: 12.9689,
    longitude: 77.6002,
  },
];

function Marker({ active = false, label }: { active?: boolean; label: string }) {
  return (
    <View style={styles.markerWrap}>
      <View style={[styles.markerLabel, active ? styles.activeLabel : styles.mutedLabel]}>
        <MaterialIcons color={active ? colors.onPrimary : colors.primary} name="location-on" size={14} />
        <Text numberOfLines={1} style={[styles.markerText, active ? styles.activeMarkerText : undefined]}>
          {label}
        </Text>
      </View>
      <View style={[styles.markerDot, active ? styles.activeDot : undefined]} />
    </View>
  );
}

export function MapScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<MapTabParamList, 'Map'>>();
  const [selectedZoneId, setSelectedZoneId] = useState<string>(DROP_ZONES[0].id);
  const [mapScale, setMapScale] = useState(1);
  const [mapStatus, setMapStatus] = useState('Use controls to inspect campus drop zones.');
  const [routeState, setRouteState] = useState<RouteState>('idle');
  const [routeProgress, setRouteProgress] = useState(0);
  const [hasScannedQr, setHasScannedQr] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isLiveTracking, setIsLiveTracking] = useState(false);
  const [livePermissionState, setLivePermissionState] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [liveLocation, setLiveLocation] = useState<LiveLocation | null>(null);
  const [distanceToZoneM, setDistanceToZoneM] = useState<number | null>(null);
  const [lastKnownLocation, setLastKnownLocation] = useState<string | null>(null);

  const routeStartDistanceRef = useRef<number | null>(null);

  const selectedZone = useMemo(
    () => DROP_ZONES.find((zone) => zone.id === selectedZoneId) ?? DROP_ZONES[0],
    [selectedZoneId],
  );

  const routeSteps = useMemo(
    () => [
      { id: 'zone', label: 'Select drop zone', done: Boolean(selectedZoneId) },
      { id: 'start', label: 'Start route guidance', done: routeState !== 'idle' },
      {
        id: 'arrive',
        label: 'Arrive at desk',
        done: routeState === 'arrived' || routeState === 'completed',
      },
      { id: 'scan', label: 'Scan kiosk QR', done: hasScannedQr },
      { id: 'confirm', label: 'Confirm handover', done: routeState === 'completed' },
    ],
    [hasScannedQr, routeState, selectedZoneId],
  );

  const livePreviewPoint = useMemo(() => {
    if (!liveLocation) {
      return { x: 50, y: 82 };
    }

    const x = clamp(50 + (liveLocation.longitude - selectedZone.longitude) * 15000, 10, 90);
    const y = clamp(50 - (liveLocation.latitude - selectedZone.latitude) * 15000, 10, 90);
    return { x, y };
  }, [liveLocation, selectedZone.latitude, selectedZone.longitude]);

  const etaLabel = useMemo(() => {
    if (routeState === 'completed') {
      return 'Done';
    }

    if (routeState === 'arrived') {
      return 'Arrived';
    }

    const remaining = Math.max(1, Math.ceil(selectedZone.etaMinutes * (1 - routeProgress / 100)));
    return `${remaining} min`;
  }, [routeProgress, routeState, selectedZone.etaMinutes]);

  const canConfirmDropOff = routeState === 'arrived' && hasScannedQr;

  useEffect(() => {
    let isMounted = true;
    let watcher: Location.LocationSubscription | null = null;

    const startLiveTracking = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (!isMounted) {
          return;
        }

        if (!permission.granted) {
          setLivePermissionState('denied');
          setIsLiveTracking(false);
          setMapStatus('Live preview needs location permission. You can still use manual map actions.');
          return;
        }

        setLivePermissionState('granted');

        const lastPosition = await Location.getLastKnownPositionAsync();
        if (isMounted && lastPosition) {
          const lat = lastPosition.coords.latitude;
          const lon = lastPosition.coords.longitude;

          setLiveLocation({
            latitude: lat,
            longitude: lon,
            accuracy: lastPosition.coords.accuracy ?? null,
            speed: lastPosition.coords.speed ?? null,
            heading: lastPosition.coords.heading ?? null,
            updatedAt: Date.now(),
          });
          setLastKnownLocation(`${lat.toFixed(5)}, ${lon.toFixed(5)}`);
        }

        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 2000,
            distanceInterval: 3,
          },
          (position) => {
            if (!isMounted) {
              return;
            }

            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            setLiveLocation({
              latitude: lat,
              longitude: lon,
              accuracy: position.coords.accuracy ?? null,
              speed: position.coords.speed ?? null,
              heading: position.coords.heading ?? null,
              updatedAt: Date.now(),
            });
            setLastKnownLocation(`${lat.toFixed(5)}, ${lon.toFixed(5)}`);
            setIsLiveTracking(true);
          },
        );

        if (isMounted) {
          setIsLiveTracking(true);
        }
      } catch {
        if (!isMounted) {
          return;
        }

        setIsLiveTracking(false);
        setMapStatus('Could not start live tracking. Manual controls remain available.');
      }
    };

    void startLiveTracking();

    return () => {
      isMounted = false;
      watcher?.remove();
    };
  }, []);

  useEffect(() => {
    if (!liveLocation) {
      setDistanceToZoneM(null);
      return;
    }

    const distance = calculateDistanceMeters(
      liveLocation.latitude,
      liveLocation.longitude,
      selectedZone.latitude,
      selectedZone.longitude,
    );

    setDistanceToZoneM(distance);

    if (routeState !== 'routing') {
      return;
    }

    const baseline = routeStartDistanceRef.current ?? Math.max(distance, 60);
    routeStartDistanceRef.current = baseline;

    const progressFromDistance = clamp(Math.round(((baseline - distance) / baseline) * 100), 0, 99);
    setRouteProgress((current) => Math.max(current, progressFromDistance));

    if (distance <= 35) {
      setRouteState('arrived');
      setRouteProgress(100);
      setMapStatus(`You arrived at ${selectedZone.name}. Scan kiosk QR to unlock confirmation.`);
    }
  }, [liveLocation, routeState, selectedZone.latitude, selectedZone.longitude, selectedZone.name]);

  useEffect(() => {
    if (routeState !== 'routing') {
      return;
    }

    if (livePermissionState === 'granted' && liveLocation !== null) {
      return;
    }

    const timer = setInterval(() => {
      setRouteProgress((current) => Math.min(100, current + 12));
    }, 1300);

    return () => clearInterval(timer);
  }, [liveLocation, livePermissionState, routeState]);

  useEffect(() => {
    if (routeState === 'routing' && routeProgress >= 100) {
      setRouteState('arrived');
      setMapStatus(`You arrived at ${selectedZone.name}. Scan kiosk QR to unlock confirmation.`);
    }
  }, [routeProgress, routeState, selectedZone.name]);

  const handleZoomIn = useCallback(() => {
    setMapScale((current) => Math.min(1.6, current + 0.12));
    setMapStatus('Zoomed in to review nearby drop zones.');
  }, []);

  const handleZoomOut = useCallback(() => {
    setMapScale((current) => Math.max(0.8, current - 0.12));
    setMapStatus('Zoomed out for a wider campus overview.');
  }, []);

  const handleSelectZone = useCallback((zone: DropZone) => {
    setSelectedZoneId(zone.id);
    setRouteState('idle');
    setRouteProgress(0);
    setHasScannedQr(false);
    routeStartDistanceRef.current = null;
    setMapStatus(`Selected ${zone.name}. Tap Start Route to begin guidance.`);
  }, []);

  const handleLocate = useCallback(async () => {
    if (isLocating) {
      return;
    }

    setIsLocating(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLivePermissionState('denied');
        setMapStatus('Location access denied. Enable location permission to center guidance.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      setLivePermissionState('granted');
      setLiveLocation({
        latitude,
        longitude,
        accuracy: position.coords.accuracy ?? null,
        speed: position.coords.speed ?? null,
        heading: position.coords.heading ?? null,
        updatedAt: Date.now(),
      });
      setLastKnownLocation(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      setMapScale(1);
      setMapStatus(`Centered on your location (${latitude.toFixed(5)}, ${longitude.toFixed(5)}).`);
    } catch {
      setMapStatus('Could not fetch your location right now. Try again.');
    } finally {
      setIsLocating(false);
    }
  }, [isLocating]);

  const handleOpenInMaps = useCallback(async () => {
    const lat = selectedZone.latitude;
    const lon = selectedZone.longitude;
    const label = encodeURIComponent(selectedZone.name);
    const url = Platform.select({
      ios: `maps:0,0?q=${lat},${lon}(${label})`,
      android: `geo:${lat},${lon}?q=${lat},${lon}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    });

    if (!url) {
      setMapStatus('Unable to generate a map link on this device.');
      return;
    }

    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      setMapStatus('No map app available to open directions.');
      return;
    }

    await Linking.openURL(url);
  }, [selectedZone.latitude, selectedZone.longitude, selectedZone.name]);

  const handleStartRoute = useCallback(() => {
    if (routeState === 'routing') {
      setRouteState('paused');
      setMapStatus('Route paused. Tap Resume Route to continue guidance.');
      return;
    }

    if (routeState === 'paused') {
      setRouteState('routing');
      setMapStatus(`Resuming route to ${selectedZone.name}.`);
      return;
    }

    setRouteState('routing');
    routeStartDistanceRef.current = distanceToZoneM !== null ? Math.max(distanceToZoneM, 60) : null;
    setRouteProgress((current) => (current > 0 && routeState === 'completed' ? 0 : Math.max(current, 8)));
    setHasScannedQr(false);
    setMapScale((scale) => Math.max(scale, 1.12));
    setMapStatus(`Route started to ${selectedZone.name}. Follow the guidance plan below.`);
  }, [distanceToZoneM, routeState, selectedZone.name]);

  const handleResetRoute = useCallback(() => {
    setRouteState('idle');
    setRouteProgress(0);
    setHasScannedQr(false);
    routeStartDistanceRef.current = null;
    setMapScale(1);
    setMapStatus('Route reset. Choose a drop zone and start again.');
  }, []);

  const handleScanQr = useCallback(() => {
    if (routeState !== 'arrived' && routeState !== 'completed') {
      setMapStatus('Reach your selected desk first, then scan the kiosk QR.');
      return;
    }

    if (hasScannedQr) {
      setMapStatus('Kiosk QR already verified. Confirm drop-off when ready.');
      return;
    }

    setHasScannedQr(true);
    setMapStatus('Kiosk QR verified. Confirm drop-off to complete handover.');
  }, [hasScannedQr, routeState]);

  const handleConfirmDropOff = useCallback(() => {
    if (routeState !== 'arrived') {
      setMapStatus('Complete the route to arrival before confirming drop-off.');
      return;
    }

    if (!hasScannedQr) {
      setMapStatus('Scan kiosk QR first to verify handover.');
      return;
    }

    setRouteState('completed');
    setRouteProgress(100);
    setMapScale(1);
    setMapStatus(`Drop-off confirmed at ${selectedZone.name}. Pickup team has been notified.`);
  }, [hasScannedQr, routeState, selectedZone.name]);

  const routeActionLabel =
    routeState === 'routing'
      ? 'Pause Route'
      : routeState === 'paused'
        ? 'Resume Route'
        : routeState === 'completed'
          ? 'Restart Route'
          : 'Start Route';

  const routeActionIcon =
    routeState === 'routing' ? 'pause-circle-outline' : routeState === 'completed' ? 'replay' : 'play-circle-outline';

  const liveStatusLabel = isLiveTracking ? 'Live tracking on' : 'Live tracking idle';

  const speedLabel = useMemo(() => {
    if (!liveLocation || liveLocation.speed === null || liveLocation.speed < 0) {
      return '--';
    }

    const kmh = liveLocation.speed * 3.6;
    return `${kmh.toFixed(1)} km/h`;
  }, [liveLocation]);

  const headingLabel = useMemo(() => {
    if (!liveLocation || liveLocation.heading === null || liveLocation.heading < 0) {
      return '--';
    }

    return `${Math.round(liveLocation.heading)}°`;
  }, [liveLocation]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar
        leftIcon="home"
        onLeftPress={() => navigation.navigate('Home')}
        onRightPress={() => navigation.navigate('Settings')}
        rightIcon="settings"
        title="UniSync"
      />

      <View style={styles.root}>
        <View style={styles.mapCanvas}>
          <Image
            source={{
              uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCKizRdim2KPIdFu2jMVFSD7Ljyb2UTs3D7x-IpnXJ8SfrLp3gMnaxTLFSYxlOA9ky_qTbNkxXSq3CQ14qlyvEyY_Vzmqb2VfyZaUfmuDFC_woONnPNvaFcxyItU-QiXc1nc-Zf1o6SJQ3qGPO2Lf26x5Cp34q0Fbko9UrVyI9UWJ4vjtchBQKvA_P2k1pV-mrp0s2mgoVfBNW9MaOW3SRJu7VNH6gon_p3_IU4_Dw_kbI1wL9maaHhNc46Gw3a_qvBPU47wmZEX1jP',
            }}
            style={[styles.mapImage, { transform: [{ scale: mapScale }] }]}
          />

          {DROP_ZONES.map((zone) => (
            <Pressable
              key={zone.id}
              onPress={() => handleSelectZone(zone)}
              style={[styles.markerPoint, { left: zone.mapLeft, top: zone.mapTop }]}
            >
              <Marker active={zone.id === selectedZone.id} label={zone.pinLabel} />
            </Pressable>
          ))}

          <View style={styles.livePreviewCard}>
            <View style={styles.livePreviewHeaderRow}>
              <View style={[styles.liveStatusDot, isLiveTracking ? styles.liveStatusDotOn : styles.liveStatusDotOff]} />
              <Text style={styles.livePreviewTitle}>Live Map Preview</Text>
            </View>

            <View style={styles.previewMiniMap}>
              <View style={styles.previewGridLineHorizontal} />
              <View style={styles.previewGridLineVertical} />

              <View style={styles.previewZonePin}>
                <MaterialIcons color={colors.onPrimary} name="place" size={12} />
              </View>

              <View
                style={[
                  styles.previewUserPin,
                  {
                    left: `${livePreviewPoint.x}%`,
                    top: `${livePreviewPoint.y}%`,
                  },
                ]}
              >
                <MaterialIcons color={colors.primary} name="person-pin-circle" size={13} />
              </View>
            </View>

            <Text style={styles.liveMetaText}>{liveStatusLabel}</Text>
            <Text numberOfLines={1} style={styles.liveMetaText}>
              {liveLocation
                ? `${liveLocation.latitude.toFixed(5)}, ${liveLocation.longitude.toFixed(5)}`
                : 'Waiting for GPS lock'}
            </Text>
            <Text style={styles.liveMetaText}>Distance: {formatDistanceMeters(distanceToZoneM)}</Text>
            <Text style={styles.liveMetaText}>Speed: {speedLabel} | Heading: {headingLabel}</Text>
            <Text style={styles.liveMetaText}>Updated: {formatLiveAge(liveLocation?.updatedAt ?? null)}</Text>
          </View>

          <View style={styles.controlStack}>
            <Pressable onPress={handleZoomIn} style={styles.controlButton}>
              <MaterialIcons color={colors.onSurface} name="add" size={20} />
            </Pressable>

            <Pressable onPress={handleZoomOut} style={styles.controlButton}>
              <MaterialIcons color={colors.onSurface} name="remove" size={20} />
            </Pressable>

            <Pressable onPress={handleLocate} style={[styles.controlButton, styles.controlButtonActive]}>
              {isLocating ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <MaterialIcons color={colors.primary} name="my-location" size={20} />
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <View style={styles.sheetMainInfo}>
              <Text numberOfLines={2} style={styles.sheetTitle}>
                {selectedZone.name}
              </Text>
              <View style={styles.openRow}>
                <View style={styles.openDot} />
                <Text style={styles.openLabel}>Open until {selectedZone.openUntil}</Text>
              </View>
            </View>
            <View style={styles.distanceChip}>
              <MaterialIcons color={colors.primaryContainer} name="directions-walk" size={16} />
              <Text style={styles.distanceLabel}>{etaLabel} away</Text>
            </View>
          </View>

          <View style={styles.planCard}>
            <Text style={styles.planTitle}>Handover Plan</Text>
            {routeSteps.map((step) => (
              <View key={step.id} style={styles.planRow}>
                <MaterialIcons
                  color={step.done ? colors.success : colors.outline}
                  name={step.done ? 'check-circle' : 'radio-button-unchecked'}
                  size={16}
                />
                <Text style={[styles.planLabel, step.done ? styles.planLabelDone : undefined]}>{step.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Route Progress</Text>
            <Text style={styles.progressValue}>{routeProgress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${routeProgress}%` }]} />
          </View>

          <Pressable onPress={handleScanQr} style={[styles.qrArea, hasScannedQr ? styles.qrAreaReady : undefined]}>
            <View style={styles.qrShell}>
              <View style={styles.qrInner}>
                <MaterialIcons color="rgba(0, 6, 102, 0.24)" name="qr-code-2" size={56} />
              </View>
            </View>
            <Text style={styles.qrCaption}>{hasScannedQr ? 'QR verified' : 'Tap after kiosk scan'}</Text>
          </Pressable>

          <Text style={styles.mapStatusText}>{mapStatus}</Text>
          {lastKnownLocation ? <Text style={styles.locationHint}>Last location: {lastKnownLocation}</Text> : null}
          {livePermissionState === 'denied' ? (
            <Text style={styles.permissionHint}>Enable location permission for full real-time preview.</Text>
          ) : null}

          <View style={styles.actionButtonsRow}>
            <Pressable
              onPress={handleStartRoute}
              style={[styles.startButton, routeState === 'routing' ? styles.startButtonActive : undefined]}
            >
              <MaterialIcons
                color={colors.primary}
                name={routeActionIcon as keyof typeof MaterialIcons.glyphMap}
                size={20}
              />
              <Text style={styles.startLabel}>{routeActionLabel}</Text>
            </Pressable>

            <Pressable onPress={() => void handleOpenInMaps()} style={styles.secondaryButton}>
              <MaterialIcons color={colors.primary} name="near-me" size={20} />
              <Text style={styles.secondaryLabel}>Open Maps</Text>
            </Pressable>
          </View>

          <View style={styles.actionButtonsRow}>
            <Pressable onPress={handleResetRoute} style={styles.secondaryButton}>
              <MaterialIcons color={colors.primary} name="restart-alt" size={20} />
              <Text style={styles.secondaryLabel}>Reset</Text>
            </Pressable>

            <Pressable
              disabled={!canConfirmDropOff}
              onPress={handleConfirmDropOff}
              style={[styles.confirmButton, !canConfirmDropOff ? styles.actionButtonDisabled : undefined]}
            >
              <MaterialIcons color={colors.onPrimary} name="verified-user" size={20} />
              <Text style={styles.confirmLabel}>Confirm Drop-off</Text>
            </Pressable>
          </View>
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
    maxWidth: 128,
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
    letterSpacing: 0.3,
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
  markerPoint: {
    position: 'absolute',
    zIndex: 2,
  },
  livePreviewCard: {
    ...shadows.soft,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: radii.md,
    left: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    position: 'absolute',
    top: 14,
    width: 190,
    zIndex: 3,
  },
  livePreviewHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 8,
  },
  liveStatusDot: {
    borderRadius: 5,
    height: 10,
    marginRight: 6,
    width: 10,
  },
  liveStatusDotOn: {
    backgroundColor: colors.success,
  },
  liveStatusDotOff: {
    backgroundColor: colors.outline,
  },
  livePreviewTitle: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  previewMiniMap: {
    backgroundColor: '#EFF3FF',
    borderColor: 'rgba(0, 6, 102, 0.12)',
    borderRadius: radii.md,
    borderWidth: 1,
    height: 88,
    marginBottom: 8,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  previewGridLineHorizontal: {
    backgroundColor: 'rgba(0, 6, 102, 0.08)',
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
    top: '50%',
  },
  previewGridLineVertical: {
    backgroundColor: 'rgba(0, 6, 102, 0.08)',
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: StyleSheet.hairlineWidth,
    left: '50%',
  },
  previewZonePin: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -9,
    marginTop: -9,
    position: 'absolute',
    top: '50%',
    width: 18,
  },
  previewUserPin: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(0, 6, 102, 0.2)',
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    marginLeft: -9,
    marginTop: -9,
    position: 'absolute',
    width: 18,
  },
  liveMetaText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    lineHeight: 14,
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
    minHeight: 420,
    paddingBottom: 22,
    paddingHorizontal: 18,
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
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  sheetMainInfo: {
    flex: 1,
    marginRight: 8,
  },
  sheetTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 24,
    letterSpacing: -0.4,
    lineHeight: 27,
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
    alignSelf: 'flex-start',
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
  planCard: {
    backgroundColor: '#F4F7FF',
    borderRadius: radii.md,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  planTitle: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginBottom: 8,
  },
  planRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 6,
  },
  planLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    marginLeft: 6,
  },
  planLabelDone: {
    color: colors.onSurface,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  progressTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  progressValue: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
  },
  progressTrack: {
    backgroundColor: 'rgba(0, 6, 102, 0.12)',
    borderRadius: radii.pill,
    height: 7,
    marginTop: 7,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: 7,
  },
  qrArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingVertical: 6,
  },
  qrAreaReady: {
    backgroundColor: '#F1FBF6',
    borderRadius: radii.md,
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
  mapStatusText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6,
    marginTop: 8,
    textAlign: 'center',
  },
  locationHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    textAlign: 'center',
  },
  permissionHint: {
    color: colors.error,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  startButton: {
    alignItems: 'center',
    backgroundColor: '#E9EEFF',
    borderColor: 'rgba(0, 6, 102, 0.16)',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 15,
  },
  startButtonActive: {
    backgroundColor: '#DCE5FF',
  },
  startLabel: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
    marginLeft: 6,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderColor: 'rgba(0, 6, 102, 0.15)',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 15,
  },
  secondaryLabel: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
    marginLeft: 6,
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 15,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  confirmLabel: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 16,
    marginLeft: 8,
  },
});

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Network from 'expo-network';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radii, shadows } from '../theme/tokens';

const BOARD_WIDTH = 280;
const BOARD_HEIGHT = 196;
const TARGET_SIZE = 48;
const ROUND_SECONDS = 30;
const TARGET_MOVE_MS = 820;

type TargetPoint = {
  x: number;
  y: number;
};

function randomTargetPoint(): TargetPoint {
  return {
    x: Math.floor(Math.random() * (BOARD_WIDTH - TARGET_SIZE)),
    y: Math.floor(Math.random() * (BOARD_HEIGHT - TARGET_SIZE)),
  };
}

function isOfflineState(state: Network.NetworkState | null | undefined): boolean {
  if (!state) {
    return false;
  }

  if (state.isConnected === false) {
    return true;
  }

  if (state.isInternetReachable === false) {
    return true;
  }

  return false;
}

export function OfflineExperienceModal() {
  const [isOffline, setIsOffline] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [target, setTarget] = useState<TargetPoint>(randomTargetPoint());

  const iconPulse = useRef(new Animated.Value(1)).current;
  const iconFloat = useRef(new Animated.Value(0)).current;
  const targetScale = useRef(new Animated.Value(1)).current;

  const refreshConnectionState = useCallback(async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      setIsOffline(isOfflineState(state));
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void refreshConnectionState();

    const subscription = Network.addNetworkStateListener((state) => {
      if (!isMounted) {
        return;
      }

      setIsOffline(isOfflineState(state));
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [refreshConnectionState]);

  const startGame = useCallback(() => {
    setScore(0);
    setCombo(0);
    setTimeLeft(ROUND_SECONDS);
    setTarget(randomTargetPoint());
    setGameActive(true);
  }, []);

  const moveTarget = useCallback(() => {
    setTarget(randomTargetPoint());
  }, []);

  useEffect(() => {
    if (!isOffline) {
      setGameActive(false);
      setCombo(0);
      return;
    }

    if (!gameActive) {
      startGame();
    }
  }, [gameActive, isOffline, startGame]);

  useEffect(() => {
    if (!isOffline || !gameActive) {
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          setGameActive(false);
          return 0;
        }

        return previous - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [gameActive, isOffline]);

  useEffect(() => {
    if (!isOffline || !gameActive) {
      return;
    }

    const mover = setInterval(() => {
      setCombo(0);
      moveTarget();
    }, TARGET_MOVE_MS);

    return () => {
      clearInterval(mover);
    };
  }, [gameActive, isOffline, moveTarget]);

  useEffect(() => {
    if (gameActive || timeLeft > 0) {
      return;
    }

    setBestScore((previous) => Math.max(previous, score));
  }, [gameActive, score, timeLeft]);

  useEffect(() => {
    if (!isOffline) {
      iconPulse.setValue(1);
      iconFloat.setValue(0);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, {
          duration: 700,
          toValue: 1.1,
          useNativeDriver: true,
        }),
        Animated.timing(iconPulse, {
          duration: 700,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(iconFloat, {
          duration: 1000,
          toValue: -4,
          useNativeDriver: true,
        }),
        Animated.timing(iconFloat, {
          duration: 1000,
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    pulseLoop.start();
    floatLoop.start();

    return () => {
      pulseLoop.stop();
      floatLoop.stop();
    };
  }, [iconFloat, iconPulse, isOffline]);

  useEffect(() => {
    if (!isOffline) {
      targetScale.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(targetScale, {
          duration: 380,
          toValue: 0.92,
          useNativeDriver: true,
        }),
        Animated.timing(targetScale, {
          duration: 380,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();

    return () => {
      pulse.stop();
    };
  }, [isOffline, targetScale]);

  const handleCatchTarget = useCallback(() => {
    if (!gameActive || !isOffline) {
      return;
    }

    setCombo((previous) => {
      const nextCombo = previous + 1;
      const bonus = nextCombo % 5 === 0 ? 2 : 0;
      setScore((previousScore) => previousScore + 1 + bonus);
      return nextCombo;
    });

    moveTarget();
  }, [gameActive, isOffline, moveTarget]);

  const statusLine = useMemo(() => {
    if (!gameActive && timeLeft === 0) {
      return `Round over. Final score: ${score}`;
    }

    if (combo >= 2) {
      return `Hot streak x${combo}`;
    }

    return 'Tap the moving signal beacon fast.';
  }, [combo, gameActive, score, timeLeft]);

  return (
    <Modal animationType="fade" onRequestClose={() => {}} transparent visible={isOffline}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Animated.View
            style={[
              styles.iconWrap,
              {
                transform: [{ scale: iconPulse }, { translateY: iconFloat }],
              },
            ]}
          >
            <MaterialIcons color={colors.onPrimary} name="wifi-off" size={26} />
          </Animated.View>

          <Text style={styles.title}>No Internet Connection</Text>
          <Text style={styles.subtitle}>You are offline. Play Signal Sprint until connection is back.</Text>

          <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Time</Text>
              <Text style={styles.statValue}>{timeLeft}s</Text>
            </View>

            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Score</Text>
              <Text style={styles.statValue}>{score}</Text>
            </View>

            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Best</Text>
              <Text style={styles.statValue}>{Math.max(bestScore, score)}</Text>
            </View>
          </View>

          <View style={styles.gameBoard}>
            <Animated.View
              style={[
                styles.targetShell,
                {
                  left: target.x,
                  top: target.y,
                  transform: [{ scale: targetScale }],
                },
              ]}
            >
              <Pressable onPress={handleCatchTarget} style={styles.targetButton}>
                <MaterialIcons color={colors.onPrimary} name="gps-fixed" size={20} />
              </Pressable>
            </Animated.View>
          </View>

          <Text style={styles.statusLine}>{statusLine}</Text>

          <View style={styles.actionsRow}>
            <Pressable onPress={startGame} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{gameActive ? 'Restart Round' : 'Play Again'}</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                void refreshConnectionState();
              }}
              style={styles.secondaryButton}
            >
              <MaterialIcons color={colors.primaryContainer} name="refresh" size={16} />
              <Text style={styles.secondaryButtonText}>Check Connection</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(6, 10, 45, 0.68)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#111621',
    borderColor: '#1A2745',
    borderRadius: radii.xl,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 20,
    width: '100%',
    ...shadows.strong,
  },
  iconWrap: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#253D70',
    borderRadius: 999,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  title: {
    color: '#F4F7FF',
    fontFamily: fontFamily.headlineBold,
    fontSize: 23,
    letterSpacing: -0.4,
    marginTop: 10,
    textAlign: 'center',
  },
  subtitle: {
    color: '#BFC8E3',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  statChip: {
    backgroundColor: '#17233D',
    borderColor: '#22345D',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 8,
  },
  statLabel: {
    color: '#95A8D8',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  statValue: {
    color: '#F4F7FF',
    fontFamily: fontFamily.headlineBold,
    fontSize: 18,
    marginTop: 2,
    textAlign: 'center',
  },
  gameBoard: {
    alignSelf: 'center',
    backgroundColor: '#0C1221',
    borderColor: '#1D2A4A',
    borderRadius: radii.lg,
    borderWidth: 1,
    height: BOARD_HEIGHT,
    marginTop: 14,
    overflow: 'hidden',
    width: BOARD_WIDTH,
  },
  targetShell: {
    position: 'absolute',
  },
  targetButton: {
    alignItems: 'center',
    backgroundColor: '#2A5BD7',
    borderColor: '#7EA0F5',
    borderRadius: 999,
    borderWidth: 2,
    height: TARGET_SIZE,
    justifyContent: 'center',
    width: TARGET_SIZE,
  },
  statusLine: {
    color: '#CED8F2',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#EAF0FF',
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: colors.primaryContainer,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 12,
    marginLeft: 6,
  },
});

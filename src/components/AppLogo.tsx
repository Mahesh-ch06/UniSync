import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '../theme/tokens';

type AppLogoProps = {
  size?: number;
  showWordmark?: boolean;
  wordmark?: string;
  textColor?: string;
};

export function AppLogo({
  size = 34,
  showWordmark = true,
  wordmark = 'CampusFind',
  textColor = '#070B2B',
}: AppLogoProps) {
  const iconSize = Math.max(Math.floor(size * 0.5), 14);

  return (
    <View style={styles.row}>
      <View style={[styles.markWrap, { height: size, width: size, borderRadius: size * 0.34 }]}>
        <LinearGradient
          colors={['#060A2D', '#1A237E']}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={[styles.markGradient, { borderRadius: size * 0.34 }]}
        >
          <MaterialIcons color={colors.onPrimary} name="location-on" size={iconSize} />
        </LinearGradient>
      </View>

      {showWordmark ? (
        <Text style={[styles.wordmark, { color: textColor }]}>{wordmark}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  markWrap: {
    shadowColor: '#000666',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 14,
  },
  markGradient: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  wordmark: {
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 23,
    letterSpacing: -0.55,
  },
});

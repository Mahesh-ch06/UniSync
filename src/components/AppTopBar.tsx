import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '../theme/tokens';

type AppTopBarProps = {
  title: string;
  leftIcon: keyof typeof MaterialIcons.glyphMap;
  onLeftPress?: () => void;
  rightIcon?: keyof typeof MaterialIcons.glyphMap;
  onRightPress?: () => void;
};

export function AppTopBar({
  title,
  leftIcon,
  onLeftPress,
  rightIcon = 'notifications-none',
  onRightPress,
}: AppTopBarProps) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.leftGroup}>
        <Pressable onPress={onLeftPress} style={styles.iconButton}>
          <MaterialIcons color={colors.primaryContainer} name={leftIcon} size={24} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
      </View>
      <Pressable onPress={onRightPress} style={styles.iconButton}>
        <MaterialIcons color={colors.primaryContainer} name={rightIcon} size={24} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    backgroundColor: 'rgba(248, 249, 250, 0.94)',
    borderBottomColor: 'rgba(118, 118, 131, 0.16)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  leftGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  title: {
    color: '#070B2B',
    fontFamily: fontFamily.headlineBold,
    fontSize: 22,
    letterSpacing: -0.4,
  },
});

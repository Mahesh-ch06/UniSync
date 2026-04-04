import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppLogo } from './AppLogo';
import { colors } from '../theme/tokens';

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
        <AppLogo showWordmark size={30} textColor="#070B2B" wordmark={title} />
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
});

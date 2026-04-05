import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppLogo } from './AppLogo';
import { colors } from '../theme/tokens';

type AppTopBarProps = {
  title: string;
  leftIcon: keyof typeof MaterialIcons.glyphMap;
  onLeftPress?: () => void;
  rightIcon?: keyof typeof MaterialIcons.glyphMap;
  onRightPress?: () => void;
  rightBadgeCount?: number;
};

export function AppTopBar({
  title,
  leftIcon,
  onLeftPress,
  rightIcon = 'notifications-none',
  onRightPress,
  rightBadgeCount = 0,
}: AppTopBarProps) {
  const safeBadgeCount = Math.max(0, Math.floor(rightBadgeCount));

  return (
    <View style={styles.wrapper}>
      <View style={styles.leftGroup}>
        <Pressable onPress={onLeftPress} style={styles.iconButton}>
          <MaterialIcons color={colors.primaryContainer} name={leftIcon} size={24} />
        </Pressable>
        <AppLogo showWordmark size={24} textColor="#070B2B" wordmark={title} wordmarkSize={19} />
      </View>
      <Pressable onPress={onRightPress} style={styles.iconButton}>
        <MaterialIcons color={colors.primaryContainer} name={rightIcon} size={24} />
        {safeBadgeCount > 0 ? (
          <View style={styles.badgeWrap}>
            <Text style={styles.badgeText}>{safeBadgeCount > 99 ? '99+' : String(safeBadgeCount)}</Text>
          </View>
        ) : null}
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
    position: 'relative',
    width: 40,
  },
  badgeWrap: {
    alignItems: 'center',
    backgroundColor: '#D22F27',
    borderColor: '#F8F9FA',
    borderRadius: 999,
    borderWidth: 1.6,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -2,
    top: -2,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
});

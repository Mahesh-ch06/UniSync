import { useAuth } from '@clerk/clerk-expo';
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

export function ProfileScreen() {
  const { signOut } = useAuth();
  const [answer, setAnswer] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const canSubmit = useMemo(() => answer.trim().length > 2, [answer]);

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar leftIcon="arrow-back" title="CampusFind" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.previewCard}>
          <Image
            blurRadius={12}
            source={{
              uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCHA54C37DMlcivb5vbPdeIOmQRrtGxcxqWZ9J7kEed1v2X6lmOOpm9tYdlaT2rEMTdDBL_7q1EXddy24XTY3lipDbhaUd3P_amxvJTdMpKDackvqpDh09kHiaiOlXNob4EvBjmmS2-KpCPRU-zA4-kHaVvCSBjEGM8bA7wHtVjVgwfu65vwQ3pg2qnxJLYQmQBZ527jiyCAjue9HzGpIm2UVK0f6i9aZ8m-hnE1GqhbLJzwtKYKiKC3Jcx9PPyAmQ3LlPE4gCOAvHl',
            }}
            style={styles.previewImage}
          />
          <View style={styles.previewOverlay}>
            <View style={styles.lockBubble}>
              <MaterialIcons color={colors.primary} name="lock" size={34} />
            </View>
            <Text style={styles.secureLabel}>Secure Preview</Text>
          </View>
        </View>

        <View style={styles.identityBadge}>
          <MaterialIcons color={colors.onTertiaryContainer} name="verified-user" size={18} />
          <Text style={styles.identityLabel}>Identity Verification</Text>
        </View>

        <Text style={styles.promptTitle}>
          To claim this item, please answer the finder&apos;s security question:
        </Text>

        <View style={styles.questionCard}>
          <Text style={styles.questionText}>"What color is the laptop case?"</Text>

          <TextInput
            onChangeText={setAnswer}
            placeholder="Type your answer here..."
            placeholderTextColor="rgba(69, 70, 82, 0.52)"
            style={styles.answerInput}
            value={answer}
          />

          <Text style={styles.warningText}>
            Ensure your answer matches physical item details. Multiple failed attempts may lock your account.
          </Text>
        </View>

        <Pressable disabled={!canSubmit} style={[styles.proofButton, !canSubmit ? styles.proofButtonDisabled : undefined]}>
          <MaterialIcons color={canSubmit ? colors.onPrimary : colors.outline} name="security" size={19} />
          <Text style={[styles.proofText, !canSubmit ? styles.proofTextDisabled : undefined]}>
            Submit Proof of Ownership
          </Text>
        </Pressable>

        <Pressable
          onPress={handleSignOut}
          style={[styles.signOutButton, isSigningOut ? styles.signOutButtonDisabled : undefined]}
        >
          <MaterialIcons color={colors.primary} name="logout" size={18} />
          <Text style={styles.signOutText}>{isSigningOut ? 'Signing out...' : 'Sign out'}</Text>
        </Pressable>

        <View style={styles.encryptedRow}>
          <MaterialIcons color="rgba(69,70,82,0.4)" name="enhanced-encryption" size={18} />
          <Text style={styles.encryptedText}>End-to-End Encrypted Claim</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingBottom: 36,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  previewCard: {
    backgroundColor: colors.surfaceLow,
    borderRadius: 24,
    height: 268,
    marginBottom: 22,
    overflow: 'hidden',
    position: 'relative',
  },
  previewImage: {
    height: '100%',
    transform: [{ scale: 1.1 }],
    width: '100%',
  },
  previewOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 6, 102, 0.2)',
    height: '100%',
    justifyContent: 'center',
    position: 'absolute',
    width: '100%',
  },
  lockBubble: {
    ...shadows.strong,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 999,
    height: 82,
    justifyContent: 'center',
    marginBottom: 14,
    width: 82,
  },
  secureLabel: {
    backgroundColor: 'rgba(0,0,0,0.56)',
    borderRadius: radii.pill,
    color: colors.onPrimary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1.2,
    paddingHorizontal: 14,
    paddingVertical: 7,
    textTransform: 'uppercase',
  },
  identityBadge: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(92,24,0,0.08)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  identityLabel: {
    color: colors.onTertiaryContainer,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  promptTitle: {
    color: colors.onSurface,
    fontFamily: fontFamily.headlineBold,
    fontSize: 30,
    lineHeight: 34,
    marginBottom: 16,
    textAlign: 'center',
  },
  questionCard: {
    ...shadows.soft,
    backgroundColor: colors.surface,
    borderColor: 'rgba(118, 118, 131, 0.12)',
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 14,
    padding: 20,
  },
  questionText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 22,
    fontStyle: 'italic',
    lineHeight: 29,
    marginBottom: 18,
    textAlign: 'center',
  },
  answerInput: {
    backgroundColor: colors.surfaceHighest,
    borderRadius: radii.md,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 15,
    height: 52,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  warningText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyRegular,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  proofButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 14,
    paddingVertical: 14,
  },
  proofButtonDisabled: {
    backgroundColor: colors.surfaceHighest,
  },
  proofText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 16,
    marginLeft: 6,
  },
  proofTextDisabled: {
    color: colors.outline,
  },
  signOutButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 6, 102, 0.08)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  signOutButtonDisabled: {
    opacity: 0.7,
  },
  signOutText: {
    color: colors.primary,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    marginLeft: 6,
  },
  encryptedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  encryptedText: {
    color: 'rgba(69,70,82,0.4)',
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 2,
    marginLeft: 6,
    textTransform: 'uppercase',
  },
});

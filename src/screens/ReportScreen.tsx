import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppTopBar } from '../components/AppTopBar';
import { colors, fontFamily, radii, shadows } from '../theme/tokens';

const allTags = ['Blue', 'Electronics', 'Apple', 'Case', 'Personalized', 'Small'];

export function ReportScreen() {
  const [selectedTags, setSelectedTags] = useState<string[]>(['Blue', 'Electronics', 'Apple']);
  const [question, setQuestion] = useState('');

  const canSubmit = useMemo(() => question.trim().length > 8, [question]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => {
      if (current.includes(tag)) {
        return current.filter((value) => value !== tag);
      }
      return [...current, tag];
    });
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <AppTopBar leftIcon="menu" title="UniSync" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.uploadZone}>
          <Image
            source={{
              uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD5orpYUAZ2FU165f--XS5tNxEmJcZa_rgO2SAwnEl6HuIjMATHRMd-T1Q7b-m9x6mfL80YZFImoc436sLb8s1oyvfknVtV-8PScj08_DJxyr8x8p1A8T0hf9u1jipUlSBKBQsl_teW5SgHPybwR5NDRQih7NOWeWZvoqDlydWK8ZeFgRcsOH3q2vQY8OL79qbjUgHQai4nq89nBTheiQSgEHPoC40OGQmlWMWYPQUraLUBFnLB5YoEJR7TC3MkzNeBsrcF6SacPUtC',
            }}
            style={styles.uploadImage}
          />
          <View style={styles.uploadOverlay}>
            <View style={styles.uploadIconCircle}>
              <MaterialIcons color={colors.onPrimary} name="photo-camera" size={30} />
            </View>
            <Text style={styles.uploadTitle}>Add Object Photo</Text>
            <Text style={styles.uploadHint}>High-quality images aid AI recognition</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>AI Auto-Tags</Text>
          <View style={styles.assistantBadge}>
            <Text style={styles.assistantBadgeText}>Assistant Active</Text>
          </View>
        </View>

        <View style={styles.tagsWrap}>
          {allTags.map((tag) => {
            const selected = selectedTags.includes(tag);
            return (
              <Pressable
                key={tag}
                onPress={() => toggleTag(tag)}
                style={[styles.tagChip, selected ? styles.tagChipSelected : styles.tagChipIdle]}
              >
                <Text style={[styles.tagText, selected ? styles.tagTextSelected : undefined]}>{tag}</Text>
                {selected ? <MaterialIcons color={colors.onPrimary} name="check" size={14} style={styles.tagIcon} /> : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.ownershipCard}>
          <MaterialIcons color="rgba(225,124,90,0.12)" name="verified-user" size={84} style={styles.watermark} />
          <Text style={styles.ownershipTitle}>Proof of Ownership Setup</Text>
          <Text style={styles.ownershipSubtitle}>
            Create a security gate to ensure the item reaches its rightful owner.
          </Text>

          <Text style={styles.questionLabel}>Secret Question</Text>
          <TextInput
            multiline
            onChangeText={setQuestion}
            placeholder="e.g., What is the lock screen wallpaper?"
            placeholderTextColor="rgba(118, 118, 131, 0.72)"
            style={styles.questionInput}
            value={question}
          />

          <Pressable disabled={!canSubmit} style={styles.submitOuter}>
            <LinearGradient
              colors={canSubmit ? [colors.primary, colors.primaryContainer] : ['#A9AECE', '#959AB5']}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.submitGradient}
            >
              <Text style={styles.submitText}>Secure & Match Item</Text>
            </LinearGradient>
          </Pressable>
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
  uploadZone: {
    alignItems: 'center',
    backgroundColor: colors.surfaceLow,
    borderColor: 'rgba(198, 197, 212, 0.6)',
    borderRadius: 32,
    borderStyle: 'dashed',
    borderWidth: 2,
    height: 430,
    justifyContent: 'center',
    marginBottom: 26,
    overflow: 'hidden',
    position: 'relative',
  },
  uploadImage: {
    height: '100%',
    opacity: 0.16,
    position: 'absolute',
    width: '100%',
  },
  uploadOverlay: {
    alignItems: 'center',
  },
  uploadIconCircle: {
    ...shadows.strong,
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 64,
    justifyContent: 'center',
    marginBottom: 14,
    width: 64,
  },
  uploadTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 24,
    marginBottom: 6,
  },
  uploadHint: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 28,
    letterSpacing: -0.6,
  },
  assistantBadge: {
    backgroundColor: 'rgba(92, 24, 0, 0.08)',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assistantBadgeText: {
    color: colors.onTertiaryContainer,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 24,
  },
  tagChip: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    marginBottom: 10,
    marginRight: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  tagChipSelected: {
    backgroundColor: colors.primary,
  },
  tagChipIdle: {
    backgroundColor: colors.surfaceHigh,
  },
  tagText: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
  },
  tagTextSelected: {
    color: colors.onPrimary,
  },
  tagIcon: {
    marginLeft: 4,
  },
  ownershipCard: {
    ...shadows.soft,
    backgroundColor: colors.surfaceLow,
    borderRadius: 30,
    overflow: 'hidden',
    padding: 22,
    position: 'relative',
  },
  watermark: {
    position: 'absolute',
    right: 12,
    top: 10,
  },
  ownershipTitle: {
    color: colors.primary,
    fontFamily: fontFamily.headlineExtraBold,
    fontSize: 28,
    lineHeight: 30,
    marginBottom: 8,
    maxWidth: '78%',
  },
  ownershipSubtitle: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
    maxWidth: '90%',
  },
  questionLabel: {
    color: colors.onSurfaceVariant,
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  questionInput: {
    backgroundColor: colors.surfaceHighest,
    borderRadius: radii.lg,
    color: colors.onSurface,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 15,
    minHeight: 110,
    paddingHorizontal: 16,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  submitOuter: {
    marginTop: 16,
  },
  submitGradient: {
    alignItems: 'center',
    borderRadius: radii.lg,
    justifyContent: 'center',
    paddingVertical: 15,
  },
  submitText: {
    color: colors.onPrimary,
    fontFamily: fontFamily.headlineBold,
    fontSize: 17,
  },
});

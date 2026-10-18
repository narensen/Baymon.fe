import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormError } from '@/components/auth-scaffold';
import { DrawerScreen, ScreenTitle } from '@/components/drawer-screen';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { AppUpdates } from '@/components/app-updates';
import { NudgeSettings } from '@/components/nudge-settings';
import { QuickAccessSettings } from '@/components/quick-access-settings';
import { PhoneAccess } from '@/components/phone-access';
import { VoiceSettings } from '@/components/voice-settings';
import { Colors, MaxContentWidth, Radius, Spacing, Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import {
  isUsernameAvailable,
  normalizeUsername,
  ROLES,
  validateUsername,
  type Profile,
} from '@/lib/profile';
import { useAuth } from '@/providers/auth-provider';

export default function SettingsScreen() {
  const { profile } = useAuth();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => scrollY.set(e.contentOffset.y));
  const insets = useSafeAreaInsets();

  return (
    <DrawerScreen title="Settings" scrollY={scrollY}>
      <View style={styles.flex}>
        {profile ? (
          <ProfileForm key={profile.user_id} profile={profile} onScroll={onScroll} />
        ) : (
          <SettingsSkeleton />
        )}
      </View>
      {/* Shrinks the form above the keyboard so the save bar rides on top of it. */}
      <KeyboardSpacer subtract={insets.bottom} />
    </DrawerScreen>
  );
}

type FormProps = {
  profile: Profile;
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
};

function ProfileForm({ profile, onScroll }: FormProps) {
  const { session, saveProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [username, setUsername] = useState(profile.username);
  const [role, setRole] = useState(profile.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [takenHandle, setTakenHandle] = useState<string | null>(null);

  const handle = normalizeUsername(username);
  const usernameChanged = handle !== profile.username;
  const formatError = validateUsername(handle);
  const dirty = displayName.trim() !== profile.display_name || usernameChanged || role !== profile.role;
  const taken = usernameChanged && takenHandle === handle;

  useEffect(() => {
    if (!usernameChanged || formatError) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const available = await isUsernameAvailable(handle);
      if (!cancelled && available === false) setTakenHandle(handle);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, usernameChanged, formatError]);

  const errors = {
    displayName: displayName.trim() ? null : 'Display name can’t be empty',
    username: formatError ?? (taken ? 'That username is taken' : null),
  };
  const roleOptions = ROLES.includes(profile.role as (typeof ROLES)[number])
    ? ROLES
    : [...ROLES, profile.role];

  function discard() {
    haptics.light();
    setDisplayName(profile.display_name);
    setUsername(profile.username);
    setRole(profile.role);
    setError(null);
  }

  async function save() {
    if (errors.displayName || errors.username) {
      haptics.error();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveProfile({
        display_name: displayName.trim(),
        ...(usernameChanged && { username: handle }),
        ...(role !== profile.role && { role }),
      });
      setDisplayName((v) => v.trim());
      haptics.success();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  const memberSince = new Date(profile.created_on).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <View style={styles.flex}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}>
        <ScreenTitle title="Settings" subtitle="How your agent knows you." />

        <Section title="Profile" index={0}>
          <TextField
            label="Display name"
            value={displayName}
            onChangeText={setDisplayName}
            error={errors.displayName}
            autoComplete="name"
            textContentType="name"
          />
          <TextField
            label="Username"
            value={username}
            onChangeText={(v) => setUsername(normalizeUsername(v))}
            error={usernameChanged ? errors.username : null}
            hint="Lowercase letters, numbers and _"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
          />
        </Section>

        <Section title="Role" index={1}>
          <SegmentedControl options={roleOptions} value={role} onChange={setRole} />
        </Section>

        <Section title="Voice" index={2}>
          <VoiceSettings />
        </Section>

        <Section title="Speaking up" index={3}>
          <NudgeSettings />
        </Section>

        <Section title="Quick access" index={4}>
          <QuickAccessSettings />
        </Section>

        <Section title="Phone access" index={5}>
          <PhoneAccess />
        </Section>

        <Section title="App" index={6}>
          <AppUpdates />
        </Section>

        <Section title="Account" index={7}>
          <View style={styles.card}>
            <InfoRow label="Email" value={session?.user.email ?? '—'} />
            <View style={styles.divider} />
            <InfoRow label="Member since" value={memberSince} />
          </View>
        </Section>

        <FormError message={error} />
      </Animated.ScrollView>

      {dirty && (
        <Animated.View
          entering={SlideInDown.springify().damping(Springs.snappy.damping).stiffness(Springs.snappy.stiffness)}
          exiting={SlideOutDown.duration(180)}
          style={[styles.saveBar, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Button label="Discard" variant="secondary" onPress={discard} style={styles.discard} />
          <Button label="Save changes" loading={saving} onPress={save} style={styles.save} />
        </Animated.View>
      )}
    </View>
  );
}

function Section({ title, index, children }: { title: string; index: number; children: React.ReactNode }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(60 + index * 60).springify().damping(Springs.snappy.damping)}
      style={styles.section}>
      <Text variant="overline" tone="faint" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </Animated.View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text tone="muted">{label}</Text>
      <Text numberOfLines={1} style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

function SettingsSkeleton() {
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.content, styles.skeleton]}>
      <View style={[styles.skeletonBlock, { width: 160, height: 30 }]} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.skeletonBlock, { height: 60 }]} />
      ))}
      <View style={styles.loadingRow}>
        <Icon name="person" size={16} color={Colors.textFaint} />
        <Text variant="caption" tone="faint">
          Loading your profile…
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.five,
  },
  section: { gap: Spacing.three },
  sectionTitle: { paddingHorizontal: Spacing.one },
  card: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
  },
  row: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.four,
  },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.five,
    backgroundColor: Colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  discard: { flex: 1 },
  save: { flex: 2 },
  skeleton: { paddingTop: Spacing.two },
  skeletonBlock: { borderRadius: Radius.md, backgroundColor: Colors.surface },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, justifyContent: 'center' },
});

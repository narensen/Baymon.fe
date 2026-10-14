import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { AuthScaffold, enter, FormError } from '@/components/auth-scaffold';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Colors, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { isUsernameAvailable, normalizeUsername, validateUsername } from '@/lib/profile';
import { useAuth } from '@/providers/auth-provider';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD = 8;

type Availability = 'idle' | 'checking' | 'available' | 'taken';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ handle: string; result: Availability } | null>(null);

  const usernameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const handle = normalizeUsername(username);
  const handleFormatError = handle ? validateUsername(handle) : null;
  const availability: Availability =
    !handle || handleFormatError ? 'idle' : checked?.handle === handle ? checked.result : 'checking';

  // Debounced availability check; stale responses are ignored.
  useEffect(() => {
    if (!handle || handleFormatError) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const available = await isUsernameAvailable(handle);
      if (cancelled) return;
      setChecked({ handle, result: available === null ? 'idle' : available ? 'available' : 'taken' });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, handleFormatError]);

  const errors = {
    displayName: !displayName.trim() ? 'Tell us what to call you' : null,
    username: !handle
      ? 'Choose a username'
      : (handleFormatError ?? (availability === 'taken' ? 'That username is taken' : null)),
    email: !EMAIL_PATTERN.test(email.trim()) ? 'Enter a valid email' : null,
    password: password.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters` : null,
  };
  const shown = (key: keyof typeof errors) =>
    submitted || (key === 'username' && handle) ? errors[key] : null;

  async function onSubmit() {
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) {
      haptics.error();
      return;
    }
    setLoading(true);
    try {
      const { needsConfirmation } = await signUp({ email, password, username: handle, displayName });
      haptics.success();
      if (needsConfirmation) {
        setConfirmEmail(email.trim());
        setLoading(false);
      }
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Could not create account');
      setLoading(false);
    }
  }

  if (confirmEmail) {
    return (
      <AuthScaffold title="Check your inbox" subtitle={`We sent a confirmation link to ${confirmEmail}.`}>
        <Animated.View entering={FadeInDown.springify().damping(18)}>
          <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} />
        </Animated.View>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Create account"
      subtitle="Set up your personal agent in a few seconds."
      footer={
        <Pressable hitSlop={12} onPress={() => router.replace('/sign-in')}>
          <Text tone="muted">
            Already have an account? <Text variant="label">Sign in</Text>
          </Text>
        </Pressable>
      }>
      <Animated.View entering={enter(1)}>
        <TextField
          label="Display name"
          value={displayName}
          onChangeText={setDisplayName}
          error={shown('displayName')}
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => usernameRef.current?.focus()}
        />
      </Animated.View>
      <Animated.View entering={enter(2)}>
        <TextField
          ref={usernameRef}
          label="Username"
          value={username}
          onChangeText={(v) => setUsername(normalizeUsername(v))}
          error={shown('username')}
          hint={
            availability === 'checking' || availability === 'available' ? (
              <AvailabilityHint state={availability} />
            ) : undefined
          }
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="username"
          maxLength={24}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
        />
      </Animated.View>
      <Animated.View entering={enter(3)}>
        <TextField
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={shown('email')}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
      </Animated.View>
      <Animated.View entering={enter(4)}>
        <TextField
          ref={passwordRef}
          label="Password"
          secure
          value={password}
          onChangeText={setPassword}
          error={shown('password')}
          hint={`At least ${MIN_PASSWORD} characters`}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
      </Animated.View>
      <FormError message={error} />
      <Animated.View entering={enter(5)} style={styles.action}>
        <Button label="Create account" loading={loading} onPress={onSubmit} />
      </Animated.View>
    </AuthScaffold>
  );
}

function AvailabilityHint({ state }: { state: 'checking' | 'available' }) {
  return (
    <Animated.View key={state} entering={FadeIn.duration(160)} style={styles.hint}>
      {state === 'available' && <Icon name="check" size={13} color={Colors.success} />}
      <Text variant="caption" tone={state === 'available' ? 'success' : 'faint'}>
        {state === 'checking' ? 'Checking…' : 'Available'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: Spacing.three },
  hint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});

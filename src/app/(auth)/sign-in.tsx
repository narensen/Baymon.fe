import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import Animated from 'react-native-reanimated';

import { AuthScaffold, enter, FormError } from '@/components/auth-scaffold';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/providers/auth-provider';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const emailError = submitted && !EMAIL_PATTERN.test(email.trim()) ? 'Enter a valid email' : null;
  const passwordError = submitted && !password ? 'Enter your password' : null;

  async function onSubmit() {
    setSubmitted(true);
    setError(null);
    if (!EMAIL_PATTERN.test(email.trim()) || !password) {
      haptics.error();
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password);
      haptics.success();
      // The root navigator's protected guard swaps to the app once the session lands.
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Sign in failed');
      setLoading(false);
    }
  }

  return (
    <AuthScaffold
      title="Welcome back"
      subtitle="Sign in to continue with your agent."
      footer={
        <Pressable hitSlop={12} onPress={() => router.replace('/sign-up')}>
          <Text tone="muted">
            New here? <Text variant="label">Create an account</Text>
          </Text>
        </Pressable>
      }>
      <Animated.View entering={enter(1)}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={emailError}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
      </Animated.View>
      <Animated.View entering={enter(2)}>
        <TextField
          ref={passwordRef}
          label="Password"
          secure
          value={password}
          onChangeText={setPassword}
          error={passwordError}
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
      </Animated.View>
      <FormError message={error} />
      <Animated.View entering={enter(3)} style={styles.action}>
        <Button label="Sign in" loading={loading} onPress={onSubmit} />
      </Animated.View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: Spacing.three },
});

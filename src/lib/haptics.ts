import * as Haptics from 'expo-haptics';

const enabled = process.env.EXPO_OS !== 'web';

/** Fire-and-forget haptics; no-ops on web. */
export const haptics = {
  selection: () => enabled && void Haptics.selectionAsync(),
  light: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  success: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

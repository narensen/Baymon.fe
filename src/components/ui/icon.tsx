import { SymbolView } from 'expo-symbols';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

/** SF Symbols on iOS, Material Symbols on Android and web. */
const ICONS = {
  home: { ios: 'house', android: 'home', web: 'home' },
  memory: { ios: 'brain', android: 'neurology', web: 'neurology' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  person: { ios: 'person', android: 'person', web: 'person' },
  mic: { ios: 'mic.fill', android: 'mic', web: 'mic' },
  micOff: { ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' },
  send: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  waveform: { ios: 'waveform', android: 'graphic_eq', web: 'graphic_eq' },
  keyboard: { ios: 'keyboard', android: 'keyboard', web: 'keyboard' },
  speaker: { ios: 'speaker.wave.2', android: 'volume_up', web: 'volume_up' },
  speakerOff: { ios: 'speaker.slash', android: 'volume_off', web: 'volume_off' },
  stop: { ios: 'stop.fill', android: 'stop', web: 'stop' },
  pause: { ios: 'pause.fill', android: 'pause', web: 'pause' },
  compose: { ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' },
  retry: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  tip: { ios: 'lightbulb', android: 'lightbulb', web: 'lightbulb' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  success: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
  checked: { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' },
  unchecked: { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' },
} as const;

export type IconName = keyof typeof ICONS;

type Props = {
  name: IconName;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 20, color = Colors.text, style }: Props) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} style={style} />;
}

import { Drawer } from 'expo-router/drawer';
import { useWindowDimensions } from 'react-native';

import { DrawerPanel } from '@/components/drawer-panel';
import { Colors } from '@/constants/theme';

export default function DrawerLayout() {
  const { width } = useWindowDimensions();

  return (
    <Drawer
      drawerContent={(props) => <DrawerPanel {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        overlayColor: 'transparent',
        // Swipe right from anywhere on the screen to open.
        swipeEdgeWidth: width,
        swipeMinDistance: 12,
        drawerStyle: { width: Math.min(304, width * 0.8), backgroundColor: Colors.background },
        sceneStyle: { backgroundColor: Colors.background },
      }}>
      <Drawer.Screen name="index" options={{ title: 'Home' }} />
      <Drawer.Screen
        name="memory"
        // Memory rows use horizontal swipes, so the drawer only opens from the left edge here.
        options={{ title: 'Memory', swipeEdgeWidth: 32 }}
      />
      <Drawer.Screen name="settings" options={{ title: 'Settings' }} />
    </Drawer>
  );
}

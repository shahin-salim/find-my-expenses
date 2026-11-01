import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from './design';
import { RootNavigator } from './navigation/RootNavigator';
import { AppProvider } from './state/AppProvider';

function ThemedStatusBar() {
  const theme = useTheme();
  // React Native 0.88 draws edge to edge on Android, so the status bar takes
  // its colour from the screen behind it rather than from a prop.
  return <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <ThemedStatusBar />
          <RootNavigator />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

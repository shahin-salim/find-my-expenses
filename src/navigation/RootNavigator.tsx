/**
 * Section 8.5: "The import decides where the app opens. If onboarding has not
 * been finished the user is taken to onboarding. If `import_status` is
 * anything other than `COMPLETED` the user is taken back to the import screen,
 * which continues from `import_stage` and `scan_cursor_at` instead of starting
 * again. Only when the import is complete does the app open on the Home page."
 */

import {
  NavigationContainer,
  createNavigationContainerRef,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import type { ProfileRow } from '../core/db/models';
import {
  onPromptOpened,
  takePendingPrompt,
} from '../core/platform/categoryPrompt';
import { useTheme } from '../design';
import { HomeScreen } from '../features/home/HomeScreen';
import { CashLendScreen } from '../features/lending/CashLendScreen';
import { LendDetailScreen } from '../features/lending/LendDetailScreen';
import { LendingScreen } from '../features/lending/LendingScreen';
import { ImportProgressScreen } from '../features/onboarding/ImportProgressScreen';
import { OptionalAccessScreen } from '../features/onboarding/OptionalAccessScreen';
import { PermissionDeniedScreen } from '../features/onboarding/PermissionDeniedScreen';
import { SmsDisclosureScreen } from '../features/onboarding/SmsDisclosureScreen';
import { WelcomeScreen } from '../features/onboarding/WelcomeScreen';
import { CategoriesScreen } from '../features/settings/CategoriesScreen';
import { CategoryEditScreen } from '../features/settings/CategoryEditScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { UnreadableMessagesScreen } from '../features/settings/UnreadableMessagesScreen';
import { AddPaymentScreen } from '../features/transactions/AddPaymentScreen';
import { TransactionDetailScreen } from '../features/transactions/TransactionDetailScreen';
import { TransactionsScreen } from '../features/transactions/TransactionsScreen';
import { useApp } from '../state/AppProvider';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Held outside the tree because the thing that needs it is not in the tree:
 * a notification tap arrives from Android, not from a screen.
 */
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Opens the payment a "what was this for?" notification was asking about.
 *
 * The card's pills answer it in place; the card itself is the other answer —
 * "none of these" — and the only useful thing it can do is show the payment.
 * It used to open the app and stop at Home, which left the user holding a
 * page of figures with nothing saying which payment had asked.
 *
 * Guarded on landing on Home: the import is a gate, and a notification from
 * a previous run has no business jumping over it. The tap still brings the
 * app forward, and the payment is still there afterwards.
 */
function useNotificationRoute(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let live = true;
    const open = (id: number) => {
      if (live && navigationRef.isReady()) {
        navigationRef.navigate('TransactionDetail', { id });
      }
    };

    // The tap that started the app, and the tap that merely brought it
    // forward. Neither covers the other; see `platform/categoryPrompt.ts`.
    takePendingPrompt().then((id) => {
      if (id !== null) {
        open(id);
      }
    });
    const stop = onPromptOpened(open);

    return () => {
      live = false;
      stop();
    };
  }, [enabled]);
}

export function initialRouteFor(profile: ProfileRow): keyof RootStackParamList {
  if (profile.import_status === 'IN_PROGRESS') {
    // An import that was interrupted outranks everything: it has to finish
    // before the app is usable, and it resumes rather than restarting.
    return 'ImportProgress';
  }
  if (!profile.onboarding_completed) {
    return 'Welcome';
  }
  return profile.import_status === 'COMPLETED' ? 'Home' : 'ImportProgress';
}

export function RootNavigator() {
  const theme = useTheme();
  const { profile } = useApp();
  const [navigatorReady, setNavigatorReady] = useState(false);

  const landsOnHome = initialRouteFor(profile) === 'Home';
  // Waits for the container, because a tap can arrive before it is ready —
  // a cold start from a notification is exactly that case, and navigating
  // early is silently dropped.
  useNotificationRoute(navigatorReady && landsOnHome);

  const navigationTheme = useMemo<NavTheme>(
    () => ({
      dark: theme.dark,
      colors: {
        primary: theme.color.primary,
        background: theme.color.background,
        card: theme.color.surface,
        text: theme.color.textPrimary,
        border: theme.color.border,
        notification: theme.color.danger,
      },
      fonts: {
        regular: { fontFamily: 'System', fontWeight: '400' },
        medium: { fontFamily: 'System', fontWeight: '500' },
        bold: { fontFamily: 'System', fontWeight: '700' },
        heavy: { fontFamily: 'System', fontWeight: '800' },
      },
    }),
    [theme],
  );

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={() => setNavigatorReady(true)}>
      <Stack.Navigator
        initialRouteName={initialRouteFor(profile)}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.background },
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="SmsDisclosure" component={SmsDisclosureScreen} />
        <Stack.Screen name="PermissionDenied" component={PermissionDeniedScreen} />
        <Stack.Screen
          name="ImportProgress"
          component={ImportProgressScreen}
          // The import is a gate; there is nothing to go back to.
          options={{ gestureEnabled: false }}
        />
        {/* Section 7's optional permissions, asked for once the import has
            earned them. Nothing here blocks Home. */}
        <Stack.Screen
          name="OptionalAccess"
          component={OptionalAccessScreen}
          options={{ gestureEnabled: false }}
        />
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ gestureEnabled: false }}
        />
        {/* Section 11.1. Reached from the import summary and, later, from
            Settings; it is read only, so it sits outside the import gate. */}
        <Stack.Screen
          name="UnreadableMessages"
          component={UnreadableMessagesScreen}
        />

        {/* The payments themselves. The list and the detail push in from the
            right like the rest of the stack; the form comes up from the
            bottom, because it is a task that is finished or abandoned rather
            than a place in the app. */}
        <Stack.Screen name="Transactions" component={TransactionsScreen} />

        {/* Section 12. The lending pages sit beside the transaction pages
            rather than under them: a lend is a transaction, but what is
            still owed is a different question from what was spent. */}
        <Stack.Screen name="Lending" component={LendingScreen} />
        <Stack.Screen name="LendDetail" component={LendDetailScreen} />
        <Stack.Screen
          name="CashLend"
          component={CashLendScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
        <Stack.Screen
          name="AddPayment"
          component={AddPaymentScreen}
          options={{ animation: 'slide_from_bottom' }}
        />

        {/* Section 11. The category editor comes up from the bottom for the
            same reason the payment form does: it is a task, not a place. */}
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Categories" component={CategoriesScreen} />
        <Stack.Screen
          name="CategoryEdit"
          component={CategoryEditScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

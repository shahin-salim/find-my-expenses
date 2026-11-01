/**
 * Section 9.3, permission denied.
 *
 * "If the user denies SMS access, show the following message: 'You can still
 * add transactions manually.' Buttons: Try Again, Continue Without SMS."
 *
 * When Android has stopped showing the prompt altogether, Try Again cannot do
 * anything on its own, so it sends the user to the app's settings page instead
 * of re-asking and appearing to do nothing.
 */

import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile, updateProfile } from '../../core/db/dao/profile';
import { requestSmsPermission } from '../../core/platform/permissions';
import { useApp } from '../../state/AppProvider';
import { useTheme } from '../../design';
import { Button, Icon, Text } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';

export function PermissionDeniedScreen({
  navigation,
  route,
}: ScreenProps<'PermissionDenied'>) {
  const theme = useTheme();
  const { db, reloadProfile } = useApp();
  const [requesting, setRequesting] = useState(false);
  const { permanentlyDenied } = route.params;

  const tryAgain = async () => {
    if (permanentlyDenied) {
      // The system prompt will not appear again; only Settings can grant it.
      await Linking.openSettings();
      return;
    }
    setRequesting(true);
    try {
      const outcome = await requestSmsPermission();
      if (outcome === 'GRANTED') {
        navigation.replace('ImportProgress');
      } else if (outcome === 'NEVER_ASK_AGAIN') {
        navigation.setParams({ permanentlyDenied: true });
      }
    } finally {
      setRequesting(false);
    }
  };

  const continueWithoutSms = () => {
    // Nothing to import, so onboarding is finished here and the app opens on
    // Home with an empty history the user fills in by hand.
    updateProfile(db, {
      onboarding_completed: 1,
      import_status: 'COMPLETED',
      import_completed_at: Date.now(),
    });
    reloadProfile();
    getProfile(db);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top', 'bottom']}>
      <View style={[styles.body, { padding: theme.space(5) }]}>
        <View
          style={[
            styles.badge,
            { backgroundColor: theme.category.amber.soft, borderRadius: theme.radius.lg },
          ]}>
          <Icon name="alert" size={26} color={theme.category.amber.onSoft} />
        </View>

        <Text variant="title" style={{ marginTop: theme.space(5) }}>
          You can still add transactions manually.
        </Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.space(2) }}>
          Without SMS access the app cannot find your payments on its own. Everything
          else works: categories, spending totals, and the monthly view are all built
          from whatever you enter.
        </Text>

        {permanentlyDenied ? (
          <View
            style={[
              styles.note,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                padding: theme.space(4),
                marginTop: theme.space(5),
              },
            ]}>
            <Text variant="bodyStrong">Android has stopped asking</Text>
            <Text variant="body" tone="secondary">
              You turned the prompt off, so it will not appear again. SMS access can
              still be granted from this app's page in Settings.
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={{
          paddingHorizontal: theme.space(5),
          paddingBottom: theme.space(3),
          gap: theme.space(2),
        }}>
        <Button
          label={permanentlyDenied ? 'Open Settings' : 'Try Again'}
          loading={requesting}
          onPress={tryAgain}
        />
        <Button label="Continue Without SMS" variant="secondary" onPress={continueWithoutSms} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  badge: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  note: { gap: 4 },
});

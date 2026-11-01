/**
 * The two optional permissions from section 7, asked for at the end of
 * onboarding.
 *
 * The welcome screen tells the user their phone will ask for SMS, Location and
 * Notifications. Only SMS was ever actually requested, so the other two sat in
 * the manifest and were never granted — location could never be attached to a
 * payment and no alert could ever be shown.
 *
 * They are asked for here rather than before the import for two reasons.
 * Section 6 attaches a location to a *new* message only, so nothing in the
 * historical import can use one; and the import is the moment the app earns
 * the ask, which is a better place to spend it than the run-up.
 *
 * Neither blocks anything. A refusal is recorded on the profile and the user
 * goes to Home exactly the same way.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  hasLocationPermission,
  hasNotificationPermission,
  requestLocationPermission,
  requestNotificationPermission,
  type PermissionOutcome,
} from '../../core/platform/permissions';
import { useTheme } from '../../design';
import { Button, Icon, Text, type IconName } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';

type Key = 'LOCATION' | 'NOTIFICATIONS';
type State = 'UNASKED' | 'ASKING' | 'GRANTED' | 'DECLINED';

interface Extra {
  key: Key;
  icon: IconName;
  title: string;
  detail: string;
  /** What the user loses by saying no, in one line. Never a nag. */
  whenDeclined: string;
  check: () => Promise<boolean>;
  request: () => Promise<PermissionOutcome>;
}

const EXTRAS: Extra[] = [
  {
    key: 'LOCATION',
    icon: 'location',
    title: 'Where a payment happened',
    detail:
      'When a bank message arrives, the app notes where you were, so a payment can ' +
      'show its place. The fix stays on this phone and nothing is looked up online.',
    whenDeclined: 'Payments will have no place attached.',
    check: hasLocationPermission,
    request: requestLocationPermission,
  },
  {
    key: 'NOTIFICATIONS',
    icon: 'bell',
    title: 'When spending runs high',
    detail:
      'One alert when you have spent more than usual for this point in the month. ' +
      'Nothing else is ever sent.',
    whenDeclined: 'You will not be told when spending runs above usual.',
    check: hasNotificationPermission,
    request: requestNotificationPermission,
  },
];

export function OptionalAccessScreen({ navigation }: ScreenProps<'OptionalAccess'>) {
  const theme = useTheme();
  const { patchProfile } = useApp();
  const [states, setStates] = useState<Record<Key, State>>({
    LOCATION: 'UNASKED',
    NOTIFICATIONS: 'UNASKED',
  });

  // Section 8.5: "Whether SMS or location access is actually granted is read
  // from the system every time it is needed." A permission already in place —
  // after a reinstall, say — shows as on rather than asking again.
  useEffect(() => {
    let live = true;
    (async () => {
      for (const extra of EXTRAS) {
        const granted = await extra.check();
        if (live && granted) {
          setStates((previous) => ({ ...previous, [extra.key]: 'GRANTED' }));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const ask = (extra: Extra) => {
    setStates((previous) => ({ ...previous, [extra.key]: 'ASKING' }));
    (async () => {
      const outcome = await extra.request();
      const granted = outcome === 'GRANTED';
      setStates((previous) => ({
        ...previous,
        [extra.key]: granted ? 'GRANTED' : 'DECLINED',
      }));
      // The profile column is the user's preference, not the permission. It is
      // written either way so Settings opens showing what actually happened.
      patchProfile(
        extra.key === 'LOCATION'
          ? { location_enabled: granted ? 1 : 0 }
          : { notifications_enabled: granted ? 1 : 0 },
      );
    })();
  };

  const openHome = () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] });

  const anyUnasked = EXTRAS.some((extra) => states[extra.key] === 'UNASKED');

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: theme.space(5), paddingBottom: theme.space(6) }}
        showsVerticalScrollIndicator={false}>
        <Text variant="title">Two things you can turn on.</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.space(2) }}>
          Your spending is already being tracked. Neither of these is needed for that,
          and you can change both later in Settings.
        </Text>

        <View style={{ gap: theme.space(3), marginTop: theme.space(6) }}>
          {EXTRAS.map((extra) => {
            const state = states[extra.key];
            const granted = state === 'GRANTED';
            return (
              <View
                key={extra.key}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.color.surface,
                    borderRadius: theme.radius.lg,
                    padding: theme.space(4),
                    gap: theme.space(3),
                  },
                ]}>
                <View style={styles.head}>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: granted
                          ? theme.category.green.soft
                          : theme.color.surfaceMuted,
                        borderRadius: theme.radius.md,
                      },
                    ]}>
                    <Icon
                      name={granted ? 'check' : extra.icon}
                      size={18}
                      color={
                        granted ? theme.category.green.onSoft : theme.color.textSecondary
                      }
                    />
                  </View>
                  <View style={styles.headBody}>
                    <Text variant="bodyStrong">{extra.title}</Text>
                    <Text variant="caption" tone="muted">
                      Optional
                    </Text>
                  </View>
                </View>

                <Text variant="body" tone="secondary">
                  {extra.detail}
                </Text>

                {granted ? (
                  <View style={styles.settled}>
                    <Icon
                      name="check"
                      size={14}
                      color={theme.color.primary}
                      strokeWidth={2.4}
                    />
                    <Text variant="label" tone="accent">
                      Turned on
                    </Text>
                  </View>
                ) : state === 'DECLINED' ? (
                  <Text variant="caption" tone="muted">
                    {extra.whenDeclined} You can turn it on in Settings whenever you
                    want.
                  </Text>
                ) : (
                  <Button
                    label="Allow"
                    variant="secondary"
                    loading={state === 'ASKING'}
                    onPress={() => ask(extra)}
                    accessibilityHint={`Opens the system prompt for ${extra.title.toLowerCase()}`}
                  />
                )}
              </View>
            );
          })}
        </View>

        <View style={[styles.privacy, { marginTop: theme.space(5) }]}>
          <Icon name="lock" size={14} color={theme.color.textSecondary} />
          <Text variant="label" tone="secondary" style={styles.privacyText}>
            Neither sends anything anywhere. This app has no network access at all.
          </Text>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: theme.space(5), paddingBottom: theme.space(3) }}>
        <Button label={anyUnasked ? 'Not now' : 'Done'} onPress={openHome} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {},
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headBody: { flex: 1, gap: 2 },
  settled: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  privacyText: { flex: 1 },
});

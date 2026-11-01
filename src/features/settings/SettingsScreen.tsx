/**
 * Section 11, Settings.
 *
 * The document specifies only 11.1, the unreadable messages entry. The rest
 * is what the app has made changeable elsewhere and has nowhere to change
 * from: the categories in section 8.2, the theme and the optional
 * permissions in the profile of section 8.5.
 *
 * The last card is not a setting. The app's central claim is that nothing
 * leaves the phone, and section 7 makes that true by giving the release build
 * no INTERNET permission. A claim the user cannot check is a claim they have
 * to take on trust, so the page says what is held and where.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDataVersion } from '../../core/db/changes';
import { listAccounts } from '../../core/db/dao/accounts';
import { listCategories } from '../../core/db/dao/categories';
import { unreadableCount } from '../../core/db/dao/smsMessages';
import { countTransactions } from '../../core/db/dao/transactions';
import {
  hasBackgroundLocationPermission,
  hasLocationPermission,
  hasNotificationPermission,
  requestBackgroundLocationPermission,
  requestLocationPermission,
  requestNotificationPermission,
} from '../../core/platform/permissions';
import { pressedDim, pressedFill, type ThemePreference, useTheme } from '../../design';
import { Icon, Text, iconName } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'SYSTEM', label: 'System' },
  { value: 'LIGHT', label: 'Light' },
  { value: 'DARK', label: 'Dark' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginTop: theme.space(6) }}>
      <Text variant="label" tone="secondary">
        {title}
      </Text>
      <View
        style={[
          styles.group,
          {
            backgroundColor: theme.color.surface,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.space(4),
            marginTop: theme.space(2),
          },
        ]}>
        {children}
      </View>
    </View>
  );
}

function Row({
  icon,
  title,
  detail,
  value,
  onPress,
  divider,
  trailing,
}: {
  icon: string;
  title: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  divider: boolean;
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.border,
        },
        pressed && onPress ? { backgroundColor: theme.color.surfaceMuted } : null,
      ]}>
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: theme.color.surfaceMuted, borderRadius: theme.radius.md },
        ]}>
        <Icon name={iconName(icon)} size={18} color={theme.color.textSecondary} />
      </View>
      <View style={styles.rowBody}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" tone="secondary">
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ?? (
        <View style={styles.rowTrailing}>
          {value ? (
            <Text variant="body" tone="secondary" tabular>
              {value}
            </Text>
          ) : null}
          {onPress ? (
            <Icon name="chevron-right" size={16} color={theme.color.textMuted} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const theme = useTheme();
  const { db, profile, patchProfile } = useApp();
  const changed = useDataVersion();

  const read = useCallback(
    () => ({
      unreadable: unreadableCount(db),
      transactions: countTransactions(db),
      categories: listCategories(db).length,
      accounts: listAccounts(db).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, changed],
  );
  const [counts, setCounts] = useState(read);
  useEffect(() => setCounts(read()), [read]);

  // The profile columns record what the user answered; the OS records what is
  // actually granted. They can disagree — a permission revoked in Android
  // settings never tells the app — so the switch reports the OS.
  const [granted, setGranted] = useState({
    location: false,
    backgroundLocation: false,
    notifications: false,
  });
  const refreshPermissions = useCallback(() => {
    (async () => {
      const location = await hasLocationPermission();
      const notifications = await hasNotificationPermission();
      setGranted({
        location,
        backgroundLocation: await hasBackgroundLocationPermission(),
        notifications,
      });

      // Section 8.5's two preferences, brought back into line with what the
      // system actually allows.
      //
      // They are written once, when the permission is answered during
      // onboarding, and then drift: someone who refuses at onboarding and
      // turns the permission on later in Android's own settings ends up
      // with the permission granted and the preference still off. The rows
      // here say "On" and do nothing — they are only tappable while the
      // permission is missing — so there is no way back from inside the
      // app, and everything the preference gates stays silently off for
      // good.
      //
      // Only ever upwards. A preference that is off while the permission is
      // off is not drift, it is agreement, and turning something on because
      // a permission exists would undo a refusal rather than repair one.
      const repair: Partial<{ location_enabled: 0 | 1; notifications_enabled: 0 | 1 }> = {};
      if (location && profile.location_enabled === 0) {
        repair.location_enabled = 1;
      }
      if (notifications && profile.notifications_enabled === 0) {
        repair.notifications_enabled = 1;
      }
      if (Object.keys(repair).length > 0) {
        patchProfile(repair);
      }
    })();
  }, [profile.location_enabled, profile.notifications_enabled, patchProfile]);
  useEffect(refreshPermissions, [refreshPermissions]);
  useEffect(
    () => navigation.addListener('focus', refreshPermissions),
    [navigation, refreshPermissions],
  );

  const ask = (which: 'LOCATION' | 'BACKGROUND_LOCATION' | 'NOTIFICATIONS') => {
    (async () => {
      const outcome =
        which === 'LOCATION'
          ? await requestLocationPermission()
          : which === 'BACKGROUND_LOCATION'
          ? await requestBackgroundLocationPermission()
          : await requestNotificationPermission();
      // `outcome` is one of three words, and every one of them is a truthy
      // string. Comparing it was the point; treating it as a boolean set
      // the preference to on after a refusal and never opened settings.
      const allowed = outcome === 'GRANTED';

      if (which === 'LOCATION') {
        patchProfile({ location_enabled: allowed ? 1 : 0 });
      } else if (which === 'NOTIFICATIONS') {
        patchProfile({ notifications_enabled: allowed ? 1 : 0 });
      }
      refreshPermissions();

      if (!allowed) {
        // Android stops asking once it has been refused twice, and never
        // offers "Allow all the time" in a dialog at all, so the only way
        // to either is the system screen.
        Linking.openSettings().catch(() => undefined);
      }
    })();
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top']}>
      <View style={[styles.bar, { paddingHorizontal: theme.space(4) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.barButton,
            { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
            pressedFill(theme, pressed),
          ]}>
          <Icon name="chevron-left" size={20} color={theme.color.textPrimary} />
        </Pressable>
        <Text variant="subheading">Settings</Text>
        <View style={styles.barButton} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space(4),
          paddingBottom: theme.space(12),
        }}
        showsVerticalScrollIndicator={false}>
        <Section title="Your money">
          <Row
            icon="list"
            title="Categories"
            detail="Rename, restyle, and choose what counts as spending"
            value={String(counts.categories)}
            onPress={() => navigation.navigate('Categories')}
            divider={false}
          />
          {/* Section 11.1: "Settings carries an entry showing the count." It
              is the only place a bank changing its wording becomes visible. */}
          <Row
            icon="alert"
            title="Unreadable messages"
            detail={
              counts.unreadable === 0
                ? 'Every bank message has been read'
                : 'Bank messages the app could not read'
            }
            value={String(counts.unreadable)}
            onPress={() => navigation.navigate('UnreadableMessages')}
            divider
          />
        </Section>

        <Section title="Appearance">
          <View style={styles.themeRow}>
            {THEMES.map((option) => {
              const active = profile.theme === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => patchProfile({ theme: option.value })}
                  style={({ pressed }) => [
                    styles.themeChip,
                    pressedDim(pressed),
                    {
                      borderRadius: theme.radius.pill,
                      backgroundColor: active ? theme.color.selected : 'transparent',
                      borderColor: active ? theme.color.selected : theme.color.border,
                    },
                  ]}>
                  <Text
                    variant="label"
                    style={{
                      color: active ? theme.color.onSelected : theme.color.textPrimary,
                    }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="Permissions">
          <Row
            icon="location"
            title="Location"
            detail={
              granted.location
                ? 'New payments can record where they happened'
                : 'Payments are recorded without a place'
            }
            onPress={granted.location ? undefined : () => ask('LOCATION')}
            divider={false}
            trailing={
              <Text variant="label" tone={granted.location ? 'accent' : 'secondary'}>
                {granted.location ? 'On' : 'Allow'}
              </Text>
            }
          />

          {/* Section 6.1. Only once the ordinary grant is in hand, because
              Android will not entertain this one before that, and only as a
              second question because it is a materially bigger one. Almost
              every payment is made with the app closed, which is exactly
              when the row above stops applying. */}
          {granted.location ? (
            <Row
              icon="location"
              title="Location while closed"
              detail={
                granted.backgroundLocation
                  ? 'Payments are placed even when the app is not open'
                  : 'Needs "Allow all the time" — without it, only payments made with the app open get a place'
              }
              onPress={
                granted.backgroundLocation ? undefined : () => ask('BACKGROUND_LOCATION')
              }
              divider
              trailing={
                <Text
                  variant="label"
                  tone={granted.backgroundLocation ? 'accent' : 'secondary'}>
                  {granted.backgroundLocation ? 'On' : 'Allow'}
                </Text>
              }
            />
          ) : null}

          <Row
            icon="bell"
            title="Notifications"
            detail={
              granted.notifications
                ? 'Alerts when spending runs above usual'
                : 'No alerts will be sent'
            }
            onPress={granted.notifications ? undefined : () => ask('NOTIFICATIONS')}
            divider
            trailing={
              <Text variant="label" tone={granted.notifications ? 'accent' : 'secondary'}>
                {granted.notifications ? 'On' : 'Allow'}
              </Text>
            }
          />
          <Row
            icon="message"
            title="Bank messages"
            detail="Read once, on this phone, to find your payments"
            divider
            trailing={
              <Text variant="label" tone="accent">
                On
              </Text>
            }
          />
        </Section>

        <Section title="On this phone">
          <Row
            icon="lock"
            title="Nothing leaves this device"
            detail="The app has no internet permission at all, so it cannot send your payments anywhere even if it tried."
            divider={false}
          />
          <Row
            icon="briefcase"
            title="What is stored"
            detail={`${counts.transactions.toLocaleString('en-IN')} payments across ${
              counts.accounts
            } account${counts.accounts === 1 ? '' : 's'}. Message text is never kept — only the id needed to read one back.`}
            divider
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  group: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rowIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  themeRow: { flexDirection: 'row', gap: 8, paddingVertical: 14 },
  themeChip: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderWidth: 1,
  },
});

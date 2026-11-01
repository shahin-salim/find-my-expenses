/**
 * Section 9.1, the welcome screen.
 *
 *   - App name.
 *   - A one-line value proposition.
 *   - Three short benefit points covering automatic tracking, categories, and
 *     insights.
 *   - A privacy statement: "Your data stays on your phone".
 *   - A primary Get Started button.
 *
 * The permission preview below the benefits is not in the list, but it is on
 * the screen, and it is what makes the system prompts that follow legible
 * rather than abrupt.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../design';
import { Button, Icon, Text, type IconName } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { SpendPreview } from './components/SpendPreview';

const BENEFITS = [
  'Tracks every UPI payment from your bank SMS',
  'Sorts it into categories, and learns your fixes',
  'Flags when you spend more than usual',
];

const PERMISSIONS: Array<{
  icon: IconName;
  title: string;
  requirement: 'REQUIRED' | 'OPTIONAL';
  detail: string;
}> = [
  {
    icon: 'message',
    title: 'SMS',
    requirement: 'REQUIRED',
    detail: 'Only bank messages are read. Personal chats and OTPs are skipped.',
  },
  {
    icon: 'location',
    title: 'Location',
    requirement: 'OPTIONAL',
    detail: 'Notes where a payment happened.',
  },
  {
    icon: 'bell',
    title: 'Notifications',
    requirement: 'OPTIONAL',
    detail: 'Alerts when spending runs above usual.',
  },
];

export function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const theme = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.content, { padding: theme.space(5) }]}
        showsVerticalScrollIndicator={false}>
        <SpendPreview />

        <View style={{ gap: theme.space(2), marginTop: theme.space(6) }}>
          <Text variant="label" tone="accent" style={styles.eyebrow}>
            SPEND CLARITY
          </Text>
          <Text variant="display">
            See where your UPI money goes, without lifting a finger.
          </Text>
        </View>

        <View style={{ gap: theme.space(3), marginTop: theme.space(5) }}>
          {BENEFITS.map((benefit) => (
            <View key={benefit} style={styles.benefit}>
              <View
                style={[styles.dot, { backgroundColor: theme.color.primary }]}
              />
              <Text variant="body" style={styles.benefitText}>
                {benefit}
              </Text>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.permissions,
            {
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.lg,
              padding: theme.space(4),
              marginTop: theme.space(6),
            },
          ]}>
          <Text variant="label" tone="secondary">
            Next, your phone will ask for
          </Text>

          {PERMISSIONS.map((permission, index) => (
            <View
              key={permission.title}
              style={[
                styles.permissionRow,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.color.border,
                  paddingTop: theme.space(3.5),
                },
              ]}>
              <View
                style={[
                  styles.permissionIcon,
                  {
                    backgroundColor: theme.color.surfaceMuted,
                    borderRadius: theme.radius.sm,
                  },
                ]}>
                <Icon name={permission.icon} size={18} color={theme.color.textSecondary} />
              </View>
              <View style={styles.permissionBody}>
                <View style={styles.permissionTitle}>
                  <Text variant="bodyStrong">{permission.title}</Text>
                  <View
                    style={[
                      styles.tag,
                      {
                        backgroundColor:
                          permission.requirement === 'REQUIRED'
                            ? theme.category.orange.soft
                            : theme.color.surfaceMuted,
                        borderRadius: theme.radius.sm,
                      },
                    ]}>
                    <Text
                      variant="caption"
                      style={{
                        color:
                          permission.requirement === 'REQUIRED'
                            ? theme.category.orange.onSoft
                            : theme.color.textSecondary,
                        fontSize: 10,
                        letterSpacing: 0.4,
                      }}>
                      {permission.requirement}
                    </Text>
                  </View>
                </View>
                <Text variant="body" tone="secondary">
                  {permission.detail}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: theme.space(5), paddingBottom: theme.space(3) }}>
        <View style={styles.privacy}>
          <Icon name="lock" size={14} color={theme.color.textSecondary} />
          <Text variant="label" tone="secondary">
            Your data stays on your phone
          </Text>
        </View>
        <Button
          label="Get Started"
          onPress={() => navigation.navigate('SmsDisclosure')}
          accessibilityHint="Explains how SMS access is used before asking for permission"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  eyebrow: { letterSpacing: 1.1 },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },
  benefitText: { flex: 1 },
  permissions: { gap: 14 },
  permissionRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  permissionIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  permissionBody: { flex: 1, gap: 2 },
  permissionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { paddingHorizontal: 6, paddingVertical: 2 },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
});

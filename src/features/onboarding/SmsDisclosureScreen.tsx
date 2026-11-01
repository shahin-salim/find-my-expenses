/**
 * Section 9.2, the SMS permission disclosure.
 *
 * "Before displaying the system SMS permission prompt, show a disclosure
 * screen explaining how SMS access will be used."
 *
 * This screen is also a Play Store requirement for the SMS permission group,
 * which is why the three points are worded as plainly as they are.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requestSmsPermission } from '../../core/platform/permissions';
import { useTheme } from '../../design';
import { Button, Icon, Text, type IconName } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';

const POINTS: Array<{
  icon: IconName;
  title: string;
  detail: string;
  tone: 'positive' | 'neutral';
}> = [
  {
    icon: 'check',
    title: 'What we read',
    detail:
      'Only messages from bank sender IDs, such as HDFCBK or ICICIT, and only from the last year.',
    tone: 'positive',
  },
  {
    icon: 'close',
    title: "What we don't read",
    detail:
      'Personal messages and OTPs. A one-time password is skipped before its text is even looked at.',
    tone: 'neutral',
  },
  {
    icon: 'list',
    title: 'Why we need access',
    detail:
      'To build your transaction history automatically, so you never have to enter a payment by hand.',
    tone: 'neutral',
  },
];

export function SmsDisclosureScreen({ navigation }: ScreenProps<'SmsDisclosure'>) {
  const theme = useTheme();
  const [requesting, setRequesting] = useState(false);

  const askForPermission = async () => {
    setRequesting(true);
    try {
      const outcome = await requestSmsPermission();
      if (outcome === 'GRANTED') {
        navigation.replace('ImportProgress');
      } else {
        navigation.navigate('PermissionDenied', {
          permanentlyDenied: outcome === 'NEVER_ASK_AGAIN',
        });
      }
    } finally {
      setRequesting(false);
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: theme.space(5), paddingBottom: theme.space(6) }}
        showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.badge,
            { backgroundColor: theme.category.green.soft, borderRadius: theme.radius.lg },
          ]}>
          <Icon name="message" size={26} color={theme.category.green.onSoft} />
        </View>

        <Text variant="title" style={{ marginTop: theme.space(5) }}>
          We read your bank messages, and nothing else.
        </Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.space(2) }}>
          Android asks for SMS access as one permission. Here is exactly what this app
          does with it.
        </Text>

        <View style={{ gap: theme.space(3), marginTop: theme.space(6) }}>
          {POINTS.map((point) => (
            <View
              key={point.title}
              style={[
                styles.point,
                {
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.lg,
                  padding: theme.space(4),
                },
              ]}>
              <View
                style={[
                  styles.pointIcon,
                  {
                    backgroundColor:
                      point.tone === 'positive'
                        ? theme.category.green.soft
                        : theme.color.surfaceMuted,
                    borderRadius: theme.radius.pill,
                  },
                ]}>
                <Icon
                  name={point.icon}
                  size={16}
                  color={
                    point.tone === 'positive'
                      ? theme.category.green.onSoft
                      : theme.color.textSecondary
                  }
                />
              </View>
              <View style={styles.pointBody}>
                <Text variant="bodyStrong">{point.title}</Text>
                <Text variant="body" tone="secondary">
                  {point.detail}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.privacy, { marginTop: theme.space(5) }]}>
          <Icon name="lock" size={14} color={theme.color.textSecondary} />
          <Text variant="label" tone="secondary" style={{ flex: 1 }}>
            Messages are read on this phone and never leave it. No account, no upload.
          </Text>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: theme.space(5), paddingBottom: theme.space(3), gap: theme.space(2) }}>
        <Button
          label="Allow SMS Access"
          loading={requesting}
          onPress={askForPermission}
          accessibilityHint="Opens the system permission prompt"
        />
        <Button
          label="Not Now"
          variant="ghost"
          onPress={() => navigation.navigate('PermissionDenied', { permanentlyDenied: false })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  badge: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  point: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pointIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  pointBody: { flex: 1, gap: 3 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});

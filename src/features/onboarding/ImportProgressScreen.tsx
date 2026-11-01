/**
 * Section 9.4, the import progress screen. Two numbered steps across the top,
 * one set of counters below, and a footer reminding the user that everything
 * stays on the phone — "since this is the point at which the app is reading a
 * year of the user's messages."
 *
 * The screen is a gate: "The import must finish before the user can use the
 * app. The Home page opens only once both stages are complete."
 */

import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { pressedDim, useTheme } from '../../design';
import { Button, Icon, ProgressBar, Text } from '../../design/components';
import { unreadableCount } from '../../core/db/dao/smsMessages';
import { useApp } from '../../state/AppProvider';
import type { ScreenProps } from '../../navigation/types';
import { AccountListRow, AccountPlaceholderRow } from './components/AccountRow';
import { StepHeader } from './components/StepHeader';
import { useImport } from './useImport';

const STEPS = ['Find accounts', 'Read payments'];

function Divider() {
  const theme = useTheme();
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border }}
    />
  );
}

function SummaryRow({
  label,
  value,
  hint,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Present when the row opens a screen; it then gets a chevron. */
  onPress?: () => void;
}) {
  const theme = useTheme();

  const content = (
    <View style={{ gap: 2 }}>
      <View style={styles.summaryRow}>
        <Text variant="body" tone="secondary">
          {label}
        </Text>
        <View style={styles.summaryValue}>
          <Text variant="bodyStrong" tabular>
            {value}
          </Text>
          {onPress ? (
            <Icon name="chevron-right" size={16} color={theme.color.textSecondary} />
          ) : null}
        </View>
      </View>
      {hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) {
    return content;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => pressedDim(pressed)}>
      {content}
    </Pressable>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

export function ImportProgressScreen({ navigation }: ScreenProps<'ImportProgress'>) {
  const theme = useTheme();
  const { db, patchProfile } = useApp();
  const { snapshot, state, error, retry } = useImport();

  const findingAccounts = snapshot.stage === 'ACCOUNTS';
  const { messagesTotal, messagesScanned } = snapshot;

  // Both stages read the same year of messages, so the bar restarts at step two.
  const fraction = messagesTotal > 0 ? messagesScanned / messagesTotal : 0;
  const percent = Math.min(100, Math.round(fraction * 100));

  useEffect(() => {
    if (state !== 'COMPLETED') {
      return;
    }
    // Onboarding is finished once both stages are done, whether or not the
    // user has tapped Continue yet. If they close the app on this screen,
    // section 8.5 sends the next launch straight to Home rather than back
    // through onboarding.
    patchProfile({ onboarding_completed: 1 });
  }, [state, patchProfile]);

  // Section 7's optional permissions are asked for between here and Home, so
  // the import is not interrupted by prompts that nothing in it can use.
  const openNext = () => navigation.replace('OptionalAccess');

  const headlineNumber = findingAccounts
    ? snapshot.accountsFound
    : snapshot.transactionsFound;
  const headlineLabel = findingAccounts
    ? 'accounts found so far'
    : 'payments found so far';
  // The stage is held on screen briefly once it reaches the end, so the text
  // has to stop saying it is still working.
  const stageFinished = messagesTotal > 0 && messagesScanned >= messagesTotal;
  const statusText = findingAccounts
    ? stageFinished
      ? 'All accounts found'
      : 'Looking for your accounts…'
    : stageFinished
      ? 'All messages read'
      : 'Reading your bank messages…';

  if (state === 'COMPLETED') {
    const unreadable = unreadableCount(db);

    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.color.background }}
        edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{
            padding: theme.space(5),
            // Clears the pinned Continue button, so the last account row is
            // reachable rather than sitting under it.
            paddingBottom: theme.space(22),
          }}
          showsVerticalScrollIndicator={false}>
          <StepHeader steps={STEPS} activeIndex={STEPS.length} />

          <View style={{ marginTop: theme.space(9) }}>
            <Text
              tabular
              style={{
                fontSize: 64,
                lineHeight: 70,
                fontWeight: '800',
                letterSpacing: -2,
                color: theme.color.textPrimary,
              }}>
              {formatCount(snapshot.transactionsFound)}
            </Text>
            <Text variant="heading" style={{ marginTop: theme.space(2) }}>
              payments found
            </Text>
            <Text variant="body" tone="secondary" style={{ marginTop: theme.space(2) }}>
              Your history is ready. Everything from here on is kept up to date as
              new bank messages arrive.
            </Text>
          </View>

          {/* The payments total is the headline above, so the card below does
              not repeat it. What it adds is the accounts those payments were
              spread across, which is what step one spent its time finding. */}
          <View style={{ marginTop: theme.space(7) }}>
            <View style={styles.summaryRow}>
              <Text variant="heading">Accounts found</Text>
              <Text variant="heading" tabular>
                {formatCount(snapshot.accountsFound)}
              </Text>
            </View>

            <View
              style={[
                styles.accounts,
                {
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.lg,
                  paddingHorizontal: theme.space(4),
                  marginTop: theme.space(2),
                },
              ]}>
              {snapshot.accounts.map((account, index) => (
                <AccountListRow
                  key={account.id}
                  account={account}
                  showDivider={index > 0}
                />
              ))}
            </View>

            <Text variant="caption" tone="muted" style={{ marginTop: theme.space(2) }}>
              Cash is already here as a payment source, so it is not listed.
            </Text>
          </View>

          <View
            style={[
              styles.accounts,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                padding: theme.space(4),
                marginTop: theme.space(5),
                gap: theme.space(3),
              },
            ]}>
            <SummaryRow label="Messages read" value={formatCount(snapshot.messagesScanned)} />
            {unreadable > 0 ? (
              <>
                <Divider />
                <SummaryRow
                  label="Could not be read"
                  value={formatCount(unreadable)}
                  hint="Tap to read them and see what stopped each one."
                  onPress={() => navigation.navigate('UnreadableMessages')}
                />
              </>
            ) : null}
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: theme.space(5), paddingBottom: theme.space(3) }}>
          <Button label="Continue" onPress={openNext} />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'NO_PERMISSION') {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.color.background }}
        edges={['top', 'bottom']}>
        <View style={[styles.failed, { padding: theme.space(5) }]}>
          <View
            style={[
              styles.failedBadge,
              { backgroundColor: theme.category.amber.soft, borderRadius: theme.radius.lg },
            ]}>
            <Icon name="message" size={26} color={theme.category.amber.onSoft} />
          </View>
          <Text variant="title" style={{ marginTop: theme.space(5) }}>
            SMS access is switched off.
          </Text>
          <Text variant="body" tone="secondary" style={{ marginTop: theme.space(2) }}>
            The import needs to read your bank messages to find your payments. Nothing
            that was already imported has been lost.
          </Text>
        </View>
        <View style={{ paddingHorizontal: theme.space(5), paddingBottom: theme.space(3) }}>
          <Button
            label="Review SMS access"
            onPress={() => navigation.replace('SmsDisclosure')}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'FAILED') {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.color.background }}
        edges={['top', 'bottom']}>
        <View style={[styles.failed, { padding: theme.space(5) }]}>
          <View
            style={[
              styles.failedBadge,
              { backgroundColor: theme.color.dangerSoft, borderRadius: theme.radius.lg },
            ]}>
            <Icon name="alert" size={26} color={theme.color.danger} />
          </View>
          <Text variant="title" style={{ marginTop: theme.space(5) }}>
            The import stopped partway.
          </Text>
          <Text variant="body" tone="secondary" style={{ marginTop: theme.space(2) }}>
            Nothing was lost. Trying again picks up from where it stopped rather than
            starting over.
          </Text>
          {error ? (
            <Text variant="caption" tone="muted" style={{ marginTop: theme.space(3) }}>
              {error.message}
            </Text>
          ) : null}
        </View>
        <View style={{ paddingHorizontal: theme.space(5), paddingBottom: theme.space(3) }}>
          <Button label="Try Again" onPress={retry} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: theme.space(5) }}
        showsVerticalScrollIndicator={false}>
        <StepHeader steps={STEPS} activeIndex={findingAccounts ? 0 : 1} />

        <View
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${headlineNumber} ${headlineLabel}`}
          style={{ marginTop: theme.space(9) }}>
          <Text
            tabular
            style={{
              fontSize: 64,
              lineHeight: 70,
              fontWeight: '800',
              letterSpacing: -2,
              color: theme.color.textPrimary,
            }}>
            {formatCount(headlineNumber)}
          </Text>
          <Text variant="heading" style={{ marginTop: theme.space(2) }}>
            {headlineLabel}
          </Text>
        </View>

        <View style={{ marginTop: theme.space(6), gap: theme.space(2) }}>
          <ProgressBar value={fraction} indeterminate={messagesTotal === 0} />
          <View style={styles.statusRow}>
            <Text variant="bodyStrong">{statusText}</Text>
            <Text variant="bodyStrong" tone="accent" tabular>
              {messagesTotal === 0 ? '' : `${percent}%`}
            </Text>
          </View>
          <Text variant="body" tone="secondary" tabular>
            {messagesTotal === 0
              ? 'Counting your messages…'
              : `${formatCount(messagesScanned)} of ${formatCount(messagesTotal)} messages checked`}
          </Text>
        </View>

        {findingAccounts ? (
          <>
            <View
              style={[
                styles.accounts,
                {
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.lg,
                  paddingHorizontal: theme.space(4),
                  marginTop: theme.space(5),
                },
              ]}>
              {snapshot.accounts.map((account, index) => (
                <AccountListRow
                  key={account.id}
                  account={account}
                  showDivider={index > 0}
                />
              ))}
              {/* An empty placeholder sits below the list while the scan runs. */}
              <AccountPlaceholderRow />
            </View>

            <Text variant="body" tone="secondary" style={{ marginTop: theme.space(4) }}>
              We find your accounts first, so money moved between them is marked as a
              self-transfer, not spending.
            </Text>
          </>
        ) : (
          <View
            style={[
              styles.accounts,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                padding: theme.space(4),
                marginTop: theme.space(5),
                gap: theme.space(3),
              },
            ]}>
            <View style={styles.summaryRow}>
              <Text variant="body" tone="secondary">
                Accounts found
              </Text>
              <Text variant="bodyStrong" tabular>
                {formatCount(snapshot.accountsFound)}
              </Text>
            </View>
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: theme.color.border,
              }}
            />
            <View style={styles.summaryRow}>
              <Text variant="body" tone="secondary">
                Payments found
              </Text>
              <Text variant="bodyStrong" tabular>
                {formatCount(snapshot.transactionsFound)}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Icon name="lock" size={14} color={theme.color.textSecondary} />
        <Text variant="label" tone="secondary">
          Everything stays on this phone
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  failed: { flex: 1 },
  failedBadge: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accounts: { overflow: 'hidden' },
  summaryValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
  },
});

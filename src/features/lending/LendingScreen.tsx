/**
 * Section 12.6, the Lending page. `screens/Lending · list@1x.png`.
 *
 * The header figure is the one number in the app that is neither spending nor
 * income, and it is deliberately not reachable from anywhere that adds money
 * up: lent money has left the account but has not been spent, and money
 * coming back was never earned.
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatRupees } from '../../core/analytics/spending';
import { useDataVersion } from '../../core/db/changes';
import { listLends, lendingTotals, type LendRow } from '../../core/lending/lends';
import { pressedDim, pressedFill, useTheme } from '../../design';
import { Card, Icon, ProgressBar, Text } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';
import { TitleMenu } from '../navigation/TitleMenu';
import { PersonAvatar } from './components/PersonAvatar';

const DAY = 86_400_000;

function shortDate(at: number): string {
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * "22 days ago", and nothing longer than that reads as a number.
 *
 * How long a lend has been out is the fact the user is actually weighing when
 * they look at this list, and "lent 2 Oct" on its own makes them work it out.
 */
function howLongAgo(at: number, now: number): string {
  const days = Math.floor((now - at) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return months === 1 ? 'a month ago' : `${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? 'a year ago' : `${years} years ago`;
}

function OpenLend({ lend, now, onPress }: { lend: LendRow; now: number; onPress: () => void }) {
  const theme = useTheme();
  const progress = lend.amount === 0 ? 0 : lend.repaid / lend.amount;
  const started = lend.repaid > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${lend.person}, ${formatRupees(lend.left)} left of ${formatRupees(
        lend.amount,
      )}, lent ${shortDate(lend.occurred_at)}`}
      onPress={onPress}
      style={({ pressed }) => pressedDim(pressed)}>
      <Card style={{ gap: theme.space(3) }}>
        <View style={styles.row}>
          <PersonAvatar name={lend.person} />
          <View style={styles.body}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {lend.person}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={2}>
              {lend.note ? `${lend.note} · ` : ''}lent {shortDate(lend.occurred_at)} ·{' '}
              {howLongAgo(lend.occurred_at, now)}
            </Text>
          </View>
          <View style={styles.amounts}>
            <Text variant="subheading" tabular>
              {formatRupees(lend.left)}
            </Text>
            <Text variant="caption" tone="secondary" tabular>
              left of {formatRupees(lend.amount)}
            </Text>
          </View>
        </View>
        {/* Drawn even at nothing repaid, because an empty bar beside a part
            filled one is what makes the part filled one mean anything. */}
        <ProgressBar value={progress} />
        {started ? (
          <Text variant="caption" tone="secondary">
            {formatRupees(lend.repaid)} of {formatRupees(lend.amount)} back
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

function ClosedLend({ lend, onPress }: { lend: LendRow; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${lend.person}, paid back, ${formatRupees(lend.amount)}`}
      onPress={onPress}
      style={({ pressed }) => pressedDim(pressed)}>
      <Card style={{ ...styles.row, opacity: 0.85 }}>
        <PersonAvatar name={lend.person} size={38} />
        <View style={styles.body}>
          <Text variant="bodyStrong" tone="secondary" numberOfLines={1}>
            {lend.person}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {lend.note ? `${lend.note} · ` : ''}paid back
            {lend.repaid_at ? ` ${shortDate(lend.repaid_at)}` : ''}
          </Text>
        </View>
        <View style={styles.closedAmount}>
          <Icon name="check" size={15} color={theme.color.primary} />
          <Text variant="bodyStrong" tone="accent" tabular>
            {formatRupees(lend.amount)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

export function LendingScreen({ navigation }: ScreenProps<'Lending'>) {
  const theme = useTheme();
  const { db } = useApp();
  const version = useDataVersion();
  const now = Date.now();

  // `version` moves on every write — see `HomeScreen` for the same pattern.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { open, closed } = useMemo(() => listLends(db), [db, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totals = useMemo(() => lendingTotals(db), [db, version]);

  const summary =
    totals.openLends === 0
      ? 'Nothing out at the moment'
      : `${totals.openLends} open lend${totals.openLends === 1 ? '' : 's'} · ${
          totals.people
        } ${totals.people === 1 ? 'person' : 'people'}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={['top']}>
      <View style={[styles.bar, { paddingHorizontal: theme.space(4) }]}>
        <TitleMenu current="Lending" navigation={navigation} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a cash lend"
          onPress={() => navigation.navigate('CashLend', {})}
          style={({ pressed }) => [
            styles.add,
            { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
            pressedFill(theme, pressed),
          ]}>
          <Icon name="plus" size={18} color={theme.color.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space(4),
          paddingBottom: theme.space(10),
          gap: theme.space(3),
        }}
        showsVerticalScrollIndicator={false}>
        <View style={{ marginTop: theme.space(2), marginBottom: theme.space(2) }}>
          <Text variant="label" tone="secondary">
            Left to get back
          </Text>
          <Text variant="display" tabular>
            {formatRupees(totals.left)}
          </Text>
          <Text variant="caption" tone="secondary">
            {summary}
          </Text>
        </View>

        {open.map((lend) => (
          <OpenLend
            key={lend.id}
            lend={lend}
            now={now}
            onPress={() => navigation.navigate('LendDetail', { id: lend.id })}
          />
        ))}

        {open.length === 0 && closed.length === 0 ? (
          <Card style={{ gap: theme.space(2) }}>
            <Text variant="bodyStrong">Nothing lent yet</Text>
            <Text variant="caption" tone="secondary">
              A payment becomes a lend when you set its category to Lend. Cash you
              hand over can be added here with the + button.
            </Text>
          </Card>
        ) : null}

        {closed.length > 0 ? (
          <>
            <Text
              variant="label"
              tone="muted"
              style={{ marginTop: theme.space(4), letterSpacing: 0.6 }}>
              CLOSED
            </Text>
            {closed.map((lend) => (
              <ClosedLend
                key={lend.id}
                lend={lend}
                onPress={() => navigation.navigate('LendDetail', { id: lend.id })}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  add: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flex: 1, gap: 2 },
  amounts: { alignItems: 'flex-end', gap: 2 },
  closedAmount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

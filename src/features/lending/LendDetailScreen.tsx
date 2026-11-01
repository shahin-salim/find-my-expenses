/**
 * Section 12.6's lend detail. `screens/Lending · lend detail@1x.png` and
 * `… (closed)@1x.png`.
 *
 * The lend and the money that has come back against it, in one list. Each
 * row is a real transaction and says so, because section 12's whole claim is
 * that a lend is not a separate kind of record — tapping through to the
 * payment itself has to land somewhere the user recognises.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatRupees } from '../../core/analytics/spending';
import { useDataVersion } from '../../core/db/changes';
import { findLend, listRepayments } from '../../core/lending/lends';
import { detachRepayment, recordCashRepayment } from '../../core/lending/repayments';
import { categoryColor, pressedDim, pressedFill, useTheme, withAlpha } from '../../design';
import { Button, Card, Icon, ProgressBar, Text } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';
import { PersonAvatar } from './components/PersonAvatar';
import { RecordRepaymentSheet } from './components/RecordRepaymentSheet';

function longDate(at: number): string {
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** `UPI to karthik.v@okaxis`, or what little is known instead. */
function how(row: {
  source: 'SMS' | 'MANUAL';
  merchant_upi_id: string | null;
  account_type: string | null;
}, direction: 'to' | 'from'): string {
  if (row.merchant_upi_id) return `UPI ${direction} ${row.merchant_upi_id}`;
  if (row.account_type === 'CASH') return 'Cash';
  return row.source === 'SMS' ? 'From a bank message' : 'Added by hand';
}

export function LendDetailScreen({ navigation, route }: ScreenProps<'LendDetail'>) {
  const theme = useTheme();
  const { db } = useApp();
  const version = useDataVersion();
  const [recording, setRecording] = useState(false);

  // `version` moves on every write, including one from an incoming message,
  // and is in the dependencies for exactly that reason — see `HomeScreen`.
  const lend = useMemo(
    () => findLend(db, route.params.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, route.params.id, version],
  );
  const repayments = useMemo(
    () => listRepayments(db, route.params.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, route.params.id, version],
  );

  if (!lend) {
    // Deleting the payment deletes the lend, and the screen can be open when
    // it happens — section 12.7.
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={['top']}>
        <View style={[styles.bar, { paddingHorizontal: theme.space(4) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.barButton, pressedDim(pressed)]}>
            <Icon name="chevron-left" size={22} color={theme.color.textPrimary} />
          </Pressable>
          <Text variant="subheading">Lend</Text>
          <View style={styles.barButton} />
        </View>
        <View style={{ padding: theme.space(5) }}>
          <Text variant="body" tone="secondary">
            This lend is no longer here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Full on a closed lend even when no repayment was ever recorded against
  // it, because the user has said the money came back and a bar sitting at
  // nothing underneath "fully paid back" contradicts them.
  const progress = lend.closed
    ? 1
    : lend.amount === 0
    ? 0
    : Math.min(1, lend.repaid / lend.amount);
  const green = categoryColor(theme, 'green');

  const unlink = (creditId: number, amount: number) => {
    Alert.alert(
      'Not for this lend?',
      `${formatRupees(
        amount,
      )} goes back to being an ordinary payment, and this lend reopens for that much.`,
      [
        { text: 'Keep it here', style: 'cancel' },
        {
          text: 'Take it off',
          style: 'destructive',
          onPress: () => detachRepayment(db, creditId),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={['top']}>
      <View style={[styles.bar, { paddingHorizontal: theme.space(4) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.barButton, pressedDim(pressed)]}>
          <Icon name="chevron-left" size={22} color={theme.color.textPrimary} />
        </Pressable>
        <Text variant="subheading">Lend</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit this lend"
          onPress={() => navigation.navigate('CashLend', { id: lend.id })}
          style={({ pressed }) => [
            styles.barButton,
            { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
            pressedFill(theme, pressed),
          ]}>
          <Icon name="edit" size={17} color={theme.color.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space(4),
          paddingBottom: theme.space(8),
          gap: theme.space(3),
        }}
        showsVerticalScrollIndicator={false}>
        <Card
          style={{
            gap: theme.space(3),
            backgroundColor: lend.closed ? withAlpha(green.solid, 0.12) : theme.color.surface,
          }}>
          <View style={styles.row}>
            <PersonAvatar name={lend.person} />
            <View style={styles.flex}>
              <Text variant="bodyStrong">
                {lend.person}
                {lend.note ? ` · ${lend.note}` : ''}
              </Text>
              <Text variant="caption" tone="secondary">
                Lent {formatRupees(lend.amount)} on {longDate(lend.occurred_at)}
              </Text>
            </View>
          </View>

          <View>
            <Text variant="label" tone="secondary">
              {lend.closed ? 'Closed · fully paid back' : 'Left to get back'}
            </Text>
            <Text variant="display" tabular>
              {formatRupees(lend.left)}
            </Text>
          </View>

          <View style={styles.row}>
            <View style={styles.flex}>
              <ProgressBar value={progress} />
            </View>
            <Text variant="caption" tone="secondary" tabular>
              {/* A lend closed by hand has no repayments behind it, and
                  claiming a figure came back would be inventing a record the
                  user never made. */}
              {lend.closed && lend.repayment_count === 0
                ? 'Marked as paid back'
                : `${formatRupees(Math.min(lend.repaid, lend.amount))} of ${formatRupees(
                    lend.amount,
                  )} back`}
            </Text>
          </View>

          {lend.surplus > 0 ? (
            <Text variant="caption" tone="secondary">
              {formatRupees(lend.surplus)} more than was lent came back. Section 12.4 keeps
              it on this lend rather than moving it to another.
            </Text>
          ) : null}
        </Card>

        <Card style={{ gap: theme.space(3) }}>
          <Text variant="label" tone="secondary">
            Transactions for this lend
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`You lent ${formatRupees(lend.amount)}. Open the payment`}
            onPress={() => navigation.navigate('TransactionDetail', { id: lend.id })}
            style={({ pressed }) => [styles.entry, pressedDim(pressed)]}>
            <View style={[styles.icon, { backgroundColor: theme.color.surfaceMuted }]}>
              <Icon name="chevron-right" size={15} color={theme.color.textSecondary} />
            </View>
            <View style={styles.flex}>
              <View style={styles.titleRow}>
                <Text variant="bodyStrong">You lent</Text>
                <View style={[styles.pill, { backgroundColor: theme.color.surfaceMuted }]}>
                  <Text variant="caption" tone="secondary">
                    LEND
                  </Text>
                </View>
              </View>
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {longDate(lend.occurred_at)} · {how(lend, 'to')}
              </Text>
            </View>
            <Text variant="bodyStrong" tabular>
              −{formatRupees(lend.amount)}
            </Text>
          </Pressable>

          {repayments.map((repayment) => (
            <Pressable
              key={repayment.id}
              accessibilityRole="button"
              accessibilityLabel={`${repayment.person} paid back ${formatRupees(
                repayment.amount,
              )}. Hold to take it off this lend`}
              onPress={() => navigation.navigate('TransactionDetail', { id: repayment.id })}
              onLongPress={() => unlink(repayment.id, repayment.amount)}
              style={({ pressed }) => [styles.entry, pressedDim(pressed)]}>
              <View style={[styles.icon, { backgroundColor: withAlpha(green.solid, 0.15) }]}>
                <Icon name="check" size={15} color={green.solid} />
              </View>
              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text variant="bodyStrong">{repayment.person} paid back</Text>
                  <View style={[styles.pill, { backgroundColor: withAlpha(green.solid, 0.15) }]}>
                    <Text variant="caption" tone="accent">
                      REPAYMENT
                    </Text>
                  </View>
                </View>
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {longDate(repayment.occurred_at)} · {how(repayment, 'from')}
                </Text>
              </View>
              <Text variant="bodyStrong" tone="accent" tabular>
                +{formatRupees(repayment.amount)}
              </Text>
            </Pressable>
          ))}
        </Card>

        <Text variant="caption" tone="secondary" style={{ paddingHorizontal: theme.space(1) }}>
          {lend.closed
            ? lend.repayment_count === 0
              ? `Marked as paid back${
                  lend.repaid_at ? ` on ${longDate(lend.repaid_at)}` : ''
                }. No repayment was recorded against it.`
              : `Closed${
                  lend.repaid_at ? ` on ${longDate(lend.repaid_at)}` : ''
                } when the full ${formatRupees(lend.amount)} came back.`
            : `When ${lend.person} sends you money by UPI it is added here automatically and the amount left goes down. When it reaches ₹0, this lend closes.`}
        </Text>
        {repayments.length > 0 ? (
          <Text variant="caption" tone="muted" style={{ paddingHorizontal: theme.space(1) }}>
            Hold a repayment to take it off this lend.
          </Text>
        ) : null}
      </ScrollView>

      {!lend.closed ? (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.color.surface,
              borderTopColor: theme.color.border,
              paddingHorizontal: theme.space(4),
              paddingTop: theme.space(3),
              paddingBottom: theme.space(5),
            },
          ]}>
          <View style={styles.footerFigure}>
            <Text variant="caption" tone="secondary">
              Left to get back
            </Text>
            <Text variant="subheading" tabular numberOfLines={1}>
              {formatRupees(lend.left)}
            </Text>
          </View>
          <Button
            label="Record repayment"
            onPress={() => setRecording(true)}
            style={styles.footerButton}
          />
        </View>
      ) : null}

      {recording ? (
        <RecordRepaymentSheet
          lend={lend}
          visible={recording}
          onClose={() => setRecording(false)}
          onSave={(paise) => {
            recordCashRepayment(db, {
              lendId: lend.id,
              amount: paise,
              occurredAt: Date.now(),
            });
            setRecording(false);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // `flex: 1` so the figure absorbs the free space and pushes the button to
  // the right edge; `flexShrink: 0` on the button so doing that cannot
  // squeeze its label to the button's own edges.
  footerFigure: { flex: 1, gap: 2 },
  footerButton: { flexShrink: 0, paddingHorizontal: 20 },
});

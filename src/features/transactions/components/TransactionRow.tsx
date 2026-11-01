/**
 * One payment in a list. Shared by the Transactions screen and anywhere else
 * a run of payments is shown.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatMoney } from '../../../core/analytics/spending';
import type { TransactionListRow } from '../../../core/transactions/query';
import { categoryColor, useTheme } from '../../../design';
import { maskedDigits, shortBankName } from '../../../design/accountLabel';
import { Text } from '../../../design/components';

/**
 * `merchant_id` is NULL when nothing identifiable could be parsed — section
 * 8.1. That is common on the credit side, where many banks name no payee at
 * all, so the row says what the transaction is rather than "Unknown".
 */
export function payeeLabel(row: TransactionListRow): string {
  if (row.display_name) {
    return row.display_name;
  }
  return row.transaction_type === 'DEBIT' ? 'Payment' : 'Money in';
}

function Badge({ label, tone }: { label: string; tone: 'neutral' | 'accent' }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor:
            tone === 'accent' ? theme.category.green.soft : theme.color.surfaceMuted,
          borderRadius: theme.radius.sm,
        },
      ]}>
      <Text
        style={[
          styles.badgeText,
          {
            color:
              tone === 'accent' ? theme.category.green.onSoft : theme.color.textSecondary,
          },
        ]}>
        {label}
      </Text>
    </View>
  );
}

interface RowProps {
  row: TransactionListRow;
  onPress: () => void;
  showDivider: boolean;
}

/**
 * Memoised, and paired with a stable `renderItem` in the list.
 *
 * Without both, every keystroke in the search box re-renders every visible
 * row — none of which changed — and that is what the typing feels like.
 */
export const TransactionRow = React.memo(TransactionRowInner, (before, after) =>
  before.row === after.row && before.showDivider === after.showDivider);

function TransactionRowInner({ row, onPress, showDivider }: RowProps) {
  const theme = useTheme();
  const palette = categoryColor(theme, row.category_color ?? 'grey');
  const debit = row.transaction_type === 'DEBIT';

  // Section 4: a refunded payment stops counting as spending. It stays in the
  // list, because the money did leave the account and the user remembers it.
  const struck = row.is_refunded === 1 || row.is_excluded === 1;

  // A transfer between the user's own accounts is not money gone, so the
  // figure is written plainly rather than in the ink spending uses.
  const countsAsSpending = debit && row.is_transfer === 0 && !struck;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${payeeLabel(row)}, ${formatMoney(row.amount, row.currency)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.border,
        },
        pressed && { backgroundColor: theme.color.surfaceMuted },
      ]}>
      <View
        style={[
          styles.avatar,
          { backgroundColor: palette.soft, borderRadius: theme.radius.md },
        ]}>
        <Text variant="label" style={{ color: palette.onSoft }}>
          {(row.display_name ?? '?').slice(0, 1).toUpperCase()}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.title}>
            {payeeLabel(row)}
          </Text>
            {row.source === 'MANUAL' ? <Badge label="MANUAL" tone="neutral" /> : null}
          {row.is_refunded === 1 ? <Badge label="REFUND" tone="accent" /> : null}
          {row.is_excluded === 1 ? <Badge label="EXCLUDED" tone="neutral" /> : null}
          {/* Section 8.4. Money moved, so the row belongs in the list, but it
              was moved between the user's own accounts and is not spending.
              Without saying so the row looks like an ordinary payment that
              the totals have quietly left out. */}
          {row.is_transfer === 1 ? <Badge label="TRANSFER" tone="neutral" /> : null}
        </View>

        <View style={styles.meta}>
          {row.category_name ? (
            <>
              <View style={[styles.dot, { backgroundColor: palette.solid }]} />
              <Text
                variant="caption"
                tone="secondary"
                numberOfLines={1}
                style={styles.metaLabel}>
                {row.category_name}
              </Text>
            </>
          ) : debit && row.is_transfer === 0 ? (
            <>
              <View
                style={[styles.dot, { backgroundColor: theme.category.orange.solid }]}
              />
              <Text
                variant="caption"
                numberOfLines={1}
                style={[styles.metaLabel, { color: theme.category.orange.onSoft }]}>
                Needs a category
              </Text>
            </>
          ) : null}
          {/* Money coming in is not spending, so a category would change
              nothing and none is asked for. Nor is one asked for on a
              transfer between the user's own accounts: section 8.4 has
              already taken it out of the figures a category would feed. */}
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {row.category_name || (debit && row.is_transfer === 0) ? '· ' : ''}
            {new Date(row.occurred_at).toLocaleTimeString('en-IN', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
        </View>
      </View>

      <View style={styles.amount}>
        <Text
          variant="bodyStrong"
          tabular
          tone={countsAsSpending ? 'primary' : debit ? 'secondary' : 'accent'}
          style={struck ? styles.struck : undefined}>
          {debit ? '−' : '+'}
          {formatMoney(row.amount, row.currency)}
        </Text>
        {/* A card used abroad has no rupee figure to convert, so it is shown
            as the bank wrote it and left out of the totals — section 8.1. */}
        {row.currency !== 'INR' ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            Not in totals
          </Text>
        ) : null}
        {row.bank_name ? (
          <Text variant="caption" tone="muted" tabular numberOfLines={1}>
            {shortBankName(row.bank_name)} {maskedDigits(row.last_four ?? '')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  avatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  // `minWidth: 0` is what lets the text inside actually shrink; without it a
  // long category name pushes the time under the amount column.
  body: { flex: 1, minWidth: 0, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1 },
  badge: { paddingHorizontal: 5, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaLabel: { flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  // Capped so a long bank name ellipsizes rather than squeezing the left side.
  amount: { alignItems: 'flex-end', gap: 3, flexShrink: 0, maxWidth: '44%' },
  struck: { textDecorationLine: 'line-through' },
});

/**
 * Section 10.5: "The biggest single payments in the selected period, highest
 * first, each showing what share of the period's total spending it accounts
 * for."
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TopTransaction } from '../../../core/analytics/breakdown';
import { formatRupees } from '../../../core/analytics/spending';
import { categoryColor, pressedDim, pressedFill, useTheme } from '../../../design';
import { Text } from '../../../design/components';

function dateLabel(occurredAt: number): string {
  return new Date(occurredAt).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function TopTransactions({
  rows,
  subtitle,
  onSeeAll,
  onOpen,
}: {
  rows: TopTransaction[];
  subtitle: string;
  onSeeAll?: () => void;
  onOpen?: (id: number) => void;
}) {
  const theme = useTheme();

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="heading">Top transactions</Text>
          <Text variant="caption" tone="secondary" style={{ marginTop: theme.space(1) }}>
            {subtitle}
          </Text>
        </View>
        {onSeeAll ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSeeAll}
            hitSlop={8}
            style={({ pressed }) => pressedDim(pressed)}>
            <Text variant="label" tone="accent">
              View all
            </Text>
          </Pressable>
        ) : null}
      </View>

      {rows.length === 0 ? (
        <Text variant="body" tone="secondary" style={{ marginTop: theme.space(4) }}>
          No payments in this period yet.
        </Text>
      ) : null}

      {rows.map((row, index) => {
        const palette = categoryColor(theme, row.category_color ?? 'grey');
        return (
          <Pressable
            key={row.id}
            accessibilityRole={onOpen ? 'button' : undefined}
            onPress={onOpen ? () => onOpen(row.id) : undefined}
            style={({ pressed }) => [
              styles.row,
              onOpen ? pressedFill(theme, pressed) : null,
              index > 0 && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.color.border,
              },
            ]}>
            <Text variant="caption" tone="muted" tabular style={styles.rank}>
              {index + 1}
            </Text>

            <View
              style={[
                styles.avatar,
                { backgroundColor: palette.soft, borderRadius: theme.radius.md },
              ]}>
              <Text variant="label" style={{ color: palette.onSoft }}>
                {row.label.slice(0, 1).toUpperCase()}
              </Text>
            </View>

            <View style={styles.body}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {row.label}
              </Text>
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {row.category_name ? `${row.category_name} · ` : ''}
                {dateLabel(row.occurred_at)}
              </Text>
              {/* The share as a bar as well as a figure: five percentages in
                  a column are hard to rank by eye, and ranking them is the
                  whole point of the section. */}
              <View
                style={[
                  styles.track,
                  { backgroundColor: theme.color.surfaceMuted, borderRadius: 2 },
                ]}>
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: palette.solid,
                      borderRadius: 2,
                      width: `${Math.max(2, Math.round(row.share * 100))}%`,
                    },
                  ]}
                />
              </View>
            </View>

            <View style={styles.amount}>
              <Text variant="bodyStrong" tabular>
                −{formatRupees(row.amount)}
              </Text>
              <Text variant="caption" tone="muted" tabular>
                {Math.round(row.share * 100)}% of total
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  rank: { width: 12, textAlign: 'center' },
  avatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 3 },
  track: { height: 4, width: '100%', overflow: 'hidden', marginTop: 2 },
  fill: { height: 4 },
  amount: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
});

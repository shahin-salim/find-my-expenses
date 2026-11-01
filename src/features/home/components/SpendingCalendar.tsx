/**
 * Section 10.4: "The month shown as a day grid, with the total spent on each
 * day. Days with no spending are left empty. Only money going out is shown
 * here."
 *
 * Tapping a day opens the panel underneath it, which is where the mockup puts
 * the day's payments.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CalendarDay, DaySummary } from '../../../core/analytics/breakdown';
import { formatRupees } from '../../../core/analytics/spending';
import { pressedDim, pressedFill, useTheme } from '../../../design';
import { Icon, Text } from '../../../design/components';

// Monday first, to agree with the week the totals above are built from.
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A compact `₹1.2k` for a cell three characters wide. */
function compact(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100_000) {
    return `₹${(rupees / 100_000).toFixed(rupees >= 1_000_000 ? 0 : 1)}L`;
  }
  if (rupees >= 1000) {
    return `₹${(rupees / 1000).toFixed(rupees >= 10_000 ? 0 : 1)}k`;
  }
  return `₹${Math.round(rupees)}`;
}

function monthTitle(from: number): string {
  return new Date(from).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function dayTitle(date: string, isToday: boolean): string {
  const [year, month, day] = date.split('-').map(Number);
  const text = new Date(year!, month! - 1, day!).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return isToday ? `${text} · Today` : text;
}

export function SpendingCalendar({
  monthStart,
  days,
  selected,
  summary,
  onSelect,
  onStep,
  onOpenDay,
  canStepForward,
}: {
  monthStart: number;
  days: CalendarDay[];
  selected: string | null;
  summary: DaySummary | null;
  onSelect: (date: string) => void;
  onStep: (months: number) => void;
  onOpenDay?: (date: string) => void;
  canStepForward: boolean;
}) {
  const theme = useTheme();

  // Monday is column 0. getDay() calls Sunday 0, so Sunday belongs last.
  const first = days[0];
  const leading = first
    ? (new Date(first.date.replace(/-/g, '/')).getDay() + 6) % 7
    : 0;

  const steps = [
    theme.color.surfaceMuted,
    theme.category.green.soft,
    theme.dark ? '#245B47' : '#BCE0D0',
    theme.dark ? '#2E7A5C' : '#8FCCB2',
    theme.color.primary,
  ];

  return (
    <View>
      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => onStep(-1)}
          hitSlop={10}
          style={({ pressed }) => [
            styles.step,
            { borderColor: theme.color.border, borderRadius: theme.radius.sm },
            pressedFill(theme, pressed),
          ]}>
          <Icon name="chevron-left" size={16} color={theme.color.textSecondary} />
        </Pressable>

        <Text variant="subheading">{monthTitle(monthStart)}</Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={!canStepForward}
          onPress={() => onStep(1)}
          hitSlop={10}
          style={({ pressed }) => [
            styles.step,
            pressedFill(theme, pressed),
            {
              borderColor: theme.color.border,
              borderRadius: theme.radius.sm,
              // A month that has not happened has nothing to show, so the
              // control is visibly unavailable rather than silently inert.
              opacity: canStepForward ? 1 : 0.35,
            },
          ]}>
          <Icon name="chevron-right" size={16} color={theme.color.textSecondary} />
        </Pressable>
      </View>

      <View style={[styles.week, { marginTop: theme.space(4) }]}>
        {WEEKDAYS.map((day, index) => (
          <Text
            key={`${day}-${index}`}
            variant="caption"
            tone="muted"
            style={styles.weekdayLabel}>
            {day}
          </Text>
        ))}
      </View>

      <View style={[styles.grid, { marginTop: theme.space(2) }]}>
        {Array.from({ length: leading }, (_, index) => (
          <View key={`pad-${index}`} style={styles.cell} />
        ))}

        {days.map((day) => {
          const isSelected = day.date === selected;
          const filled = day.intensity > 0;
          return (
            <Pressable
              key={day.date}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${day.dayOfMonth}, ${
                filled ? formatRupees(day.total) : 'nothing spent'
              }`}
              onPress={() => onSelect(day.date)}
              style={({ pressed }) => [styles.cell, pressedDim(pressed)]}>
              <View
                style={[
                  styles.cellBody,
                  {
                    backgroundColor: filled ? steps[day.intensity] : 'transparent',
                    borderRadius: theme.radius.sm,
                    borderWidth: isSelected || day.isToday ? 2 : 0,
                    // Today outranks the selection. They coincide on open,
                    // and drawing the selection there would leave the legend
                    // below claiming green for a day drawn in orange.
                    borderColor: day.isToday
                      ? theme.color.primary
                      : isSelected
                      ? theme.color.up
                      : 'transparent',
                    opacity: day.isFuture ? 0.4 : 1,
                  },
                ]}>
                <Text
                  variant="caption"
                  tabular
                  style={{
                    // The deepest two steps are dark enough that the default
                    // ink disappears into them.
                    color:
                      day.intensity >= 3
                        ? theme.color.textInverse
                        : theme.color.textPrimary,
                  }}>
                  {day.dayOfMonth}
                </Text>
                {filled ? (
                  <Text
                    tabular
                    numberOfLines={1}
                    style={[
                      styles.cellAmount,
                      {
                        color:
                          day.intensity >= 3
                            ? theme.color.textInverse
                            : theme.color.textSecondary,
                      },
                    ]}>
                    {compact(day.total)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.scale, { marginTop: theme.space(3) }]}>
        <View style={styles.scaleItem}>
          <View
            style={[
              styles.scaleSwatch,
              { borderWidth: 2, borderColor: theme.color.primary, borderRadius: 4 },
            ]}
          />
          <Text variant="caption" tone="muted">
            Today
          </Text>
        </View>
        {selected && selected !== todayKeyOf(days) ? (
          <View style={styles.scaleItem}>
            <View
              style={[
                styles.scaleSwatch,
                { borderWidth: 2, borderColor: theme.color.up, borderRadius: 4 },
              ]}
            />
            <Text variant="caption" tone="muted">
              Selected
            </Text>
          </View>
        ) : null}
        <View style={styles.scaleItem}>
          <Text variant="caption" tone="muted">
            Less
          </Text>
          {steps.map((color, index) => (
            <View
              key={index}
              style={[styles.scaleSwatch, { backgroundColor: color, borderRadius: 4 }]}
            />
          ))}
          <Text variant="caption" tone="muted">
            More
          </Text>
        </View>
      </View>

      {summary ? (
        <View
          style={[
            styles.panel,
            {
              backgroundColor: theme.color.surfaceMuted,
              borderRadius: theme.radius.lg,
              padding: theme.space(4),
              marginTop: theme.space(4),
            },
          ]}>
          <View style={styles.panelHead}>
            <Text variant="bodyStrong" style={styles.panelTitle}>
              {dayTitle(summary.date, summary.date === todayKeyOf(days))}
            </Text>
            <Text variant="amount" tabular>
              {formatRupees(summary.total)}
            </Text>
          </View>

          {summary.versusTypicalPercent === null ? null : (
            <Text
              variant="caption"
              tone={summary.versusTypicalPercent >= 0 ? 'up' : 'accent'}>
              {Math.abs(Math.round(summary.versusTypicalPercent))}%{' '}
              {summary.versusTypicalPercent >= 0 ? 'above' : 'below'} your typical day
            </Text>
          )}

          {summary.payments.length === 0 ? (
            <Text variant="body" tone="secondary" style={{ marginTop: theme.space(2) }}>
              Nothing spent on this day.
            </Text>
          ) : null}

          {summary.payments.map((payment) => (
            <View key={payment.key} style={styles.panelRow}>
              <Text variant="body" numberOfLines={1} style={styles.panelRowLabel}>
                {payment.label}
                {payment.count > 1 ? ` \u00d7${payment.count}` : ''}
              </Text>
              <Text variant="body" tabular>
                {formatRupees(payment.amount)}
              </Text>
            </View>
          ))}

          {summary.moreCount > 0 ? (
            <View style={styles.panelRow}>
              <Text variant="body" tone="secondary" style={styles.panelRowLabel}>
                {summary.moreCount} more payment{summary.moreCount === 1 ? '' : 's'}
              </Text>
              <Text variant="body" tone="secondary" tabular>
                {formatRupees(summary.moreTotal)}
              </Text>
            </View>
          ) : null}

          {onOpenDay && summary.total > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenDay(summary.date)}
              style={({ pressed }) => [
                { marginTop: theme.space(3) },
                pressedDim(pressed),
              ]}>
              <Text variant="label" tone="accent">
                View transactions for this day
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function todayKeyOf(days: CalendarDay[]): string | null {
  return days.find((day) => day.isToday)?.date ?? null;
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  week: { flexDirection: 'row' },
  weekdayLabel: { width: `${100 / 7}%`, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  cell: { width: `${100 / 7}%`, padding: 2 },
  cellBody: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 1 },
  cellAmount: { fontSize: 9, lineHeight: 11, fontWeight: '600' },
  scale: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scaleItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scaleSwatch: { width: 12, height: 12 },
  panel: { gap: 2 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  panelTitle: { flex: 1 },
  panelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 6 },
  panelRowLabel: { flex: 1 },
});

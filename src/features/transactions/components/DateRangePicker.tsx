/**
 * Picking the two dates behind the Transactions filter's `Custom range`.
 *
 * The four presets answer "what have I spent lately". They cannot answer
 * "what did I spend on the trip in March", and stepping a day at a time the
 * way the payment form does would be forty taps to get there. So this is a
 * month grid, laid out like the calendar on Home so the two read as the same
 * object, with the range drawn across it.
 *
 * Picking is deliberately stateless: there is no half-finished selection to
 * get stuck in. One tap gives a range of that one day, and a second tap on a
 * different day stretches it to cover both. Tapping again once a range spans
 * more than a day starts a new one. Every tap therefore leaves a range that
 * is complete and can be applied, and the line under the grid says which of
 * the two things the next tap will do.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  addLocalDays,
  addLocalMonths,
  startOfLocalDay,
  startOfLocalMonth,
  toLocalDateString,
} from '../../../core/time/dates';
import { useTheme } from '../../../design';
import { Icon, Text } from '../../../design/components';

// Monday first, to agree with `startOfLocalWeek` and with Home's calendar.
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function monthTitle(monthStart: number): string {
  return new Date(monthStart).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

export function DateRangePicker({
  monthStart,
  from,
  to,
  now,
  activeDays,
  canStepBack,
  onStep,
  onChange,
}: {
  /** The month on screen. The range it draws may reach outside it. */
  monthStart: number;
  /** First day of the range, inclusive. */
  from: number | null;
  /** End of the range, exclusive — the way the filter stores it. */
  to: number | null;
  now: number;
  /** Days this month that the rest of the filter would find something on. */
  activeDays: Set<string>;
  canStepBack: boolean;
  onStep: (months: number) => void;
  onChange: (from: number, to: number) => void;
}) {
  const theme = useTheme();

  const today = startOfLocalDay(now);
  const monthEnd = addLocalMonths(monthStart, 1);
  const canStepForward = monthStart < startOfLocalMonth(now);

  const days: number[] = [];
  for (let at = monthStart; at < monthEnd; at = addLocalDays(at, 1)) {
    days.push(at);
  }

  // Monday is column 0. getDay() calls Sunday 0, so Sunday belongs last.
  const leading = (new Date(monthStart).getDay() + 6) % 7;

  const lastDay = to === null ? null : addLocalDays(to, -1);
  const oneDay =
    from !== null &&
    lastDay !== null &&
    toLocalDateString(from) === toLocalDateString(lastDay);

  const pick = (day: number) => {
    // A range of one day is an invitation to say where it ends; anything
    // longer is a finished answer, and tapping into it starts again.
    if (oneDay && from !== null && toLocalDateString(day) !== toLocalDateString(from)) {
      const start = Math.min(from, day);
      const end = Math.max(from, day);
      onChange(start, addLocalDays(end, 1));
      return;
    }
    onChange(day, addLocalDays(day, 1));
  };

  return (
    <View>
      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          disabled={!canStepBack}
          onPress={() => onStep(-1)}
          hitSlop={10}
          style={({ pressed }) => [
            styles.step,
            {
              borderColor: theme.color.border,
              borderRadius: theme.radius.sm,
              backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
              // Nothing was recorded before the first payment, so the step
              // that would go looking is visibly unavailable.
              opacity: canStepBack ? 1 : 0.35,
            },
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
            {
              borderColor: theme.color.border,
              borderRadius: theme.radius.sm,
              backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
              opacity: canStepForward ? 1 : 0.35,
            },
          ]}>
          <Icon name="chevron-right" size={16} color={theme.color.textSecondary} />
        </Pressable>
      </View>

      <View style={[styles.week, { marginTop: theme.space(3) }]}>
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
          const key = toLocalDateString(day);
          const isFuture = day > today;
          const inRange =
            from !== null && to !== null && day >= from && day < to;
          const isStart = from !== null && key === toLocalDateString(from);
          const isEnd = lastDay !== null && key === toLocalDateString(lastDay);
          const isEdge = isStart || isEnd;
          const hasActivity = activeDays.has(key);

          // The cells sit flush against each other so a run of days reads as
          // one band rather than a row of separate squares. Only the ends of
          // the band are rounded, which is what says where it starts and
          // stops.
          const r = theme.radius.md;
          const corners =
            isStart && isEnd
              ? { borderRadius: r }
              : isStart
              ? { borderTopLeftRadius: r, borderBottomLeftRadius: r }
              : isEnd
              ? { borderTopRightRadius: r, borderBottomRightRadius: r }
              : null;

          const ink = isEdge
            ? theme.color.onSelected
            : isFuture
            ? theme.color.textMuted
            : theme.color.textPrimary;

          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: inRange }}
              accessibilityLabel={`${new Date(day).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'long',
              })}${hasActivity ? ', has payments' : ', nothing'}`}
              // A day that has not happened cannot hold a payment, so it is
              // unavailable rather than selectable and empty.
              disabled={isFuture}
              onPress={() => pick(day)}
              style={styles.cell}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.cellBody,
                    corners,
                    {
                      backgroundColor: isEdge
                        ? theme.color.selected
                        : inRange
                        ? theme.color.surfaceMuted
                        : pressed
                        ? theme.color.surfaceMuted
                        : 'transparent',
                      // Today is marked only when the range is not already
                      // drawing on it, so the ring never cuts the band.
                      borderWidth: !inRange && day === today ? 1 : 0,
                      borderColor: theme.color.primary,
                      borderRadius:
                        corners === null && !inRange ? theme.radius.md : undefined,
                      opacity: isFuture ? 0.4 : 1,
                    },
                  ]}>
                  <Text variant="caption" tabular style={{ color: ink }}>
                    {new Date(day).getDate()}
                  </Text>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          hasActivity && !isFuture
                            ? isEdge
                              ? theme.color.onSelected
                              : theme.color.primary
                            : 'transparent',
                      },
                    ]}
                  />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <Text
        variant="caption"
        tone="muted"
        style={[styles.hint, { marginTop: theme.space(3) }]}>
        {from === null
          ? 'Tap a day to start'
          : oneDay
          ? 'Tap another day to end the range'
          : 'Tap a day to start a new range'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  week: { flexDirection: 'row' },
  weekdayLabel: { width: `${100 / 7}%`, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  // No horizontal padding, unlike Home's calendar: the cells have to touch
  // for a selected run to draw as one continuous band.
  cell: { width: `${100 / 7}%` },
  cellBody: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  hint: { textAlign: 'center' },
});

/**
 * Picking one date from a month grid.
 *
 * The forms step a day at a time, which the range picker's own notes already
 * call out as the problem it was written to solve: "stepping a day at a time
 * the way the payment form does would be forty taps to get there." That is
 * fine for yesterday and useless for a lend made last month, so this is the
 * same grid, laid out to match Home's calendar and the Transactions filter,
 * picking a single day instead of a range.
 *
 * The time of day is kept. A payment and a lend both carry a clock time that
 * nothing on these forms shows and nothing should quietly reset to midnight,
 * so moving the date moves only the date — the same thing the day stepper
 * this replaces was careful to do.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import {
  addLocalDays,
  addLocalMonths,
  startOfLocalDay,
  startOfLocalMonth,
  toLocalDateString,
} from '../../core/time/dates';
import { useTheme } from '../index';
import { Icon } from './Icon';
import { Text } from './Text';

// Monday first, to agree with `startOfLocalWeek` and with Home's calendar.
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export interface DatePickerSheetProps {
  visible: boolean;
  /** The date currently chosen, epoch millis. */
  value: number;
  /** Nothing later than this can be picked. Defaults to now. */
  maxAt?: number;
  /** Heading above the grid. */
  title?: string;
  onClose: () => void;
  onPick: (at: number) => void;
}

export function DatePickerSheet({
  visible,
  value,
  maxAt,
  title = 'Pick a date',
  onClose,
  onPick,
}: DatePickerSheetProps) {
  const theme = useTheme();
  const ceiling = maxAt ?? Date.now();
  const [month, setMonth] = useState(() => startOfLocalMonth(value));

  // Reopening on the month the chosen date is in, rather than wherever the
  // user last browsed to and abandoned.
  useEffect(() => {
    if (visible) {
      setMonth(startOfLocalMonth(value));
    }
  }, [visible, value]);

  const today = startOfLocalDay(ceiling);
  const monthEnd = addLocalMonths(month, 1);
  const canStepForward = month < startOfLocalMonth(ceiling);

  const days: number[] = [];
  for (let at = month; at < monthEnd; at = addLocalDays(at, 1)) {
    days.push(at);
  }
  // Monday is column 0. getDay() calls Sunday 0, so Sunday belongs last.
  const leading = (new Date(month).getDay() + 6) % 7;

  // Laid out as seven rows of seven rather than one wrapping row of cells a
  // seventh wide. A seventh does not divide a pixel grid: Yoga rounds each
  // cell to whole pixels, and on a screen where it rounds up the seven no
  // longer fit the line, so the last column wraps and the month draws six
  // days wide. `flex: 1` inside a row that never wraps cannot do that,
  // whatever the screen is.
  const weeks: Array<Array<number | null>> = [];
  let week: Array<number | null> = Array.from({ length: leading }, () => null);
  for (const day of days) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) {
      week.push(null);
    }
    weeks.push(week);
  }

  const chosen = toLocalDateString(value);
  const timeOfDay = value - startOfLocalDay(value);

  const choose = (day: number) => {
    onPick(day + timeOfDay);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[styles.backdrop, { backgroundColor: theme.color.overlay }]}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.color.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            padding: theme.space(5),
          },
        ]}>
        <View style={[styles.grip, { backgroundColor: theme.color.borderStrong }]} />

        <View style={styles.header}>
          <Text variant="heading">{title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to today"
            onPress={() => choose(today)}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text variant="label" tone="accent">
              Today
            </Text>
          </Pressable>
        </View>

        <View style={[styles.monthRow, { marginTop: theme.space(4) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => setMonth((at) => addLocalMonths(at, -1))}
            hitSlop={10}
            style={({ pressed }) => [
              styles.step,
              {
                borderColor: theme.color.border,
                borderRadius: theme.radius.sm,
                backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
              },
            ]}>
            <Icon name="chevron-left" size={16} color={theme.color.textSecondary} />
          </Pressable>

          <Text variant="subheading">
            {new Date(month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            disabled={!canStepForward}
            onPress={() => setMonth((at) => addLocalMonths(at, 1))}
            hitSlop={10}
            style={({ pressed }) => [
              styles.step,
              {
                borderColor: theme.color.border,
                borderRadius: theme.radius.sm,
                backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
                // A month that has not begun holds no day that can be picked.
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
          {weeks.map((row, rowIndex) => (
            <View key={`week-${rowIndex}`} style={styles.weekRow}>
              {row.map((day, columnIndex) => {
                if (day === null) {
                  return <View key={`pad-${rowIndex}-${columnIndex}`} style={styles.cell} />;
                }

                const key = toLocalDateString(day);
                const isFuture = day > today;
                const isChosen = key === chosen;
                const isToday = day === today;

                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isChosen }}
                    accessibilityLabel={new Date(day).toLocaleDateString('en-IN', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                    // Nothing can have happened on a day that has not arrived.
                    disabled={isFuture}
                    onPress={() => choose(day)}
                    style={styles.cell}>
                    {({ pressed }) => (
                      <View
                        style={[
                          styles.cellBody,
                          {
                            borderRadius: theme.radius.md,
                            backgroundColor: isChosen
                              ? theme.color.selected
                              : pressed
                              ? theme.color.surfaceMuted
                              : 'transparent',
                            // Today is ringed only when it is not the chosen
                            // day, so the ring never sits inside the fill.
                            borderWidth: isToday && !isChosen ? 1 : 0,
                            borderColor: theme.color.primary,
                            opacity: isFuture ? 0.35 : 1,
                          },
                        ]}>
                        <Text
                          variant="caption"
                          tabular
                          style={{
                            color: isChosen
                              ? theme.color.onSelected
                              : isFuture
                              ? theme.color.textMuted
                              : theme.color.textPrimary,
                          }}>
                          {new Date(day).getDate()}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 34 },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  week: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center' },
  grid: { rowGap: 4 },
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, padding: 2 },
  cellBody: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
});

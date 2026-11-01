/**
 * The Transactions filter sheet.
 *
 * Held as a draft while it is open and applied in one go, so the list behind
 * it does not rearrange under every tap. The button carries the count the
 * draft would show, which is the only honest way to offer `Show 64
 * transactions` before anything has been applied.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { formatRupees } from '../../../core/analytics/spending';
import type { AccountRow, CategoryRow } from '../../../core/db/models';
import type { SqlDatabase } from '../../../core/db/types';
import {
  DEFAULT_FILTER,
  dateFilterLabel,
  daysWithActivity,
  filterTotals,
  filterWindow,
  transactionDateBounds,
  type CategorySelection,
  type DatePreset,
  type TransactionFilter,
  type TypeFilter,
  withType,
} from '../../../core/transactions/query';
import {
  addLocalDays,
  addLocalMonths,
  startOfLocalDay,
  startOfLocalMonth,
  toLocalDateString,
} from '../../../core/time/dates';
import { categoryColor, pressedDim, useTheme } from '../../../design';
import { accountChipLabel } from '../../../design/accountLabel';
import { Button, Icon, Text } from '../../../design/components';
import { DateRangePicker } from './DateRangePicker';

const DATES: Array<{ value: DatePreset; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'WEEK', label: 'This week' },
  { value: 'MONTH', label: 'This month' },
  { value: 'ALL', label: 'All time' },
  { value: 'CUSTOM', label: 'Custom range' },
];

/**
 * The range the calendar opens on, which is whatever window is already in
 * force rather than nothing at all.
 *
 * Clamped so it cannot reach into days that have not happened: `This month`
 * runs to the end of the month, and seeding a range half of which cannot hold
 * a payment would have the user clearing it before they could start.
 */
function seedRange(
  filter: TransactionFilter,
  now: number,
): { from: number; to: number } {
  if (
    filter.datePreset === 'CUSTOM' &&
    filter.customFrom !== null &&
    filter.customTo !== null
  ) {
    return { from: filter.customFrom, to: filter.customTo };
  }
  const tomorrow = addLocalDays(startOfLocalDay(now), 1);
  const window = filterWindow(filter, now);
  if (window === null) {
    return { from: startOfLocalDay(now), to: tomorrow };
  }
  const to = Math.min(window.to, tomorrow);
  return { from: Math.min(window.from, addLocalDays(to, -1)), to };
}

const TYPES: Array<{ value: TypeFilter; label: string }> = [
  { value: 'DEBIT', label: 'Money out' },
  { value: 'CREDIT', label: 'Money in' },
  { value: 'BOTH', label: 'Both' },
];

function Chip({
  label,
  selected,
  onPress,
  dotColor,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  dotColor?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        pressedDim(pressed),
        {
          borderRadius: theme.radius.pill,
          backgroundColor: selected ? theme.color.selected : theme.color.surface,
          borderColor: selected ? theme.color.selected : theme.color.border,
        },
      ]}>
      {selected ? (
        <Icon name="check" size={13} color={theme.color.onSelected} />
      ) : dotColor ? (
        <View style={[styles.chipDot, { backgroundColor: dotColor }]} />
      ) : null}
      <Text
        variant="label"
        style={{ color: selected ? theme.color.onSelected : theme.color.textPrimary }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A rupee bound, stored as paise. Empty means no bound on that end. */
function AmountInput({
  label,
  paise,
  onChange,
}: {
  label: string;
  paise: number | null;
  onChange: (paise: number | null) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.amountField}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View
        style={[
          styles.amountBox,
          {
            backgroundColor: theme.color.surface,
            borderColor: theme.color.border,
            borderRadius: theme.radius.md,
          },
        ]}>
        <Text variant="body" tone="muted">
          ₹
        </Text>
        <TextInput
          value={paise === null ? '' : String(Math.round(paise / 100))}
          onChangeText={(text) => {
            const digits = text.replace(/[^\d]/g, '');
            onChange(digits.length === 0 ? null : parseInt(digits, 10) * 100);
          }}
          placeholder="Any"
          placeholderTextColor={theme.color.textMuted}
          keyboardType="number-pad"
          style={[styles.amountInput, { color: theme.color.textPrimary }]}
        />
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginTop: theme.space(5) }}>
      <Text variant="label" tone="secondary">
        {title}
      </Text>
      <View style={[styles.chips, { marginTop: theme.space(2) }]}>{children}</View>
    </View>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.toggle, { borderTopColor: theme.color.border }]}>
      <Text variant="body" style={styles.toggleLabel}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: theme.color.primary, false: theme.color.borderStrong }}
        thumbColor={theme.color.surface}
      />
    </View>
  );
}

export function FiltersSheet({
  visible,
  db,
  now,
  filter,
  categories,
  accounts,
  onApply,
  onClose,
}: {
  visible: boolean;
  db: SqlDatabase;
  now: number;
  filter: TransactionFilter;
  categories: CategoryRow[];
  accounts: AccountRow[];
  onApply: (next: TransactionFilter) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(filter);
  /** The month the calendar is showing, which the range may reach outside. */
  const [month, setMonth] = useState(() => startOfLocalMonth(now));

  // Reopening shows what is actually in force, not what was abandoned last
  // time the sheet was dismissed.
  useEffect(() => {
    if (visible) {
      setDraft(filter);
      setMonth(startOfLocalMonth(seedRange(filter, now).from));
    }
  }, [visible, filter, now]);

  const preview = useMemo(
    () => (visible ? filterTotals(db, draft, now) : { count: 0, out: 0, in: 0 }),
    [visible, db, draft, now],
  );

  const bounds = useMemo(
    () => (visible ? transactionDateBounds(db) : null),
    [visible, db],
  );

  /**
   * The dots under the calendar. Everything else the user has chosen is
   * honoured, so a dot promises that picking that day shows something.
   */
  const activeDays = useMemo(
    () =>
      visible && draft.datePreset === 'CUSTOM'
        ? daysWithActivity(
            db,
            draft,
            { from: month, to: addLocalMonths(month, 1) },
            now,
          )
        : new Set<string>(),
    [visible, draft, db, month, now],
  );

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

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
            backgroundColor: theme.color.background,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
          },
        ]}>
        <View style={[styles.grip, { backgroundColor: theme.color.borderStrong }]} />

        <View style={[styles.header, { paddingHorizontal: theme.space(5) }]}>
          <Text variant="heading">Filters</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDraft({ ...DEFAULT_FILTER, search: draft.search })}
            hitSlop={8}
            style={({ pressed }) => pressedDim(pressed)}>
            <Text variant="label" tone="accent">
              Reset
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.space(5),
            paddingBottom: theme.space(4),
          }}
          showsVerticalScrollIndicator={false}>
          <Section title="Date">
            {DATES.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={draft.datePreset === option.value}
                onPress={() => {
                  if (option.value !== 'CUSTOM') {
                    setDraft({ ...draft, datePreset: option.value });
                    return;
                  }
                  const seed = seedRange(draft, now);
                  setMonth(startOfLocalMonth(seed.from));
                  setDraft({
                    ...draft,
                    datePreset: 'CUSTOM',
                    customFrom: seed.from,
                    customTo: seed.to,
                  });
                }}
              />
            ))}
          </Section>

          {draft.datePreset === 'CUSTOM' ? (
            <View style={{ marginTop: theme.space(4), gap: theme.space(4) }}>
              {/* The range in words, because it can reach outside the month
                  on screen and the grid alone would then be showing only
                  half of what is selected. */}
              <View
                style={[
                  styles.rangeSummary,
                  {
                    backgroundColor: theme.color.surface,
                    borderColor: theme.color.border,
                    borderRadius: theme.radius.md,
                  },
                ]}>
                <Icon name="calendar" size={16} color={theme.color.textSecondary} />
                <Text variant="bodyStrong">{dateFilterLabel(draft, now)}</Text>
              </View>

              <DateRangePicker
                monthStart={month}
                from={draft.customFrom}
                to={draft.customTo}
                now={now}
                activeDays={activeDays}
                canStepBack={
                  bounds === null || toLocalDateString(month) > bounds.first
                }
                onStep={(months) =>
                  setMonth((current) => addLocalMonths(current, months))
                }
                onChange={(nextFrom, nextTo) =>
                  setDraft({ ...draft, customFrom: nextFrom, customTo: nextTo })
                }
              />
            </View>
          ) : null}

          <Section title="Type">
            {TYPES.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={draft.type === option.value}
                onPress={() => setDraft(withType(draft, option.value))}
              />
            ))}
          </Section>

          <Section title="Category">
            {categories.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                dotColor={categoryColor(theme, category.color).solid}
                selected={draft.categories.includes(category.id)}
                onPress={() =>
                  setDraft({
                    ...draft,
                    categories: toggleIn<CategorySelection>(draft.categories, category.id),
                  })
                }
              />
            ))}
            <Chip
              label="Uncategorized"
              selected={draft.categories.includes('NONE')}
              onPress={() =>
                setDraft({
                  ...draft,
                  categories: toggleIn<CategorySelection>(draft.categories, 'NONE'),
                })
              }
            />
          </Section>

          <Section title="Account">
            {accounts.map((account) => (
              <Chip
                key={account.id}
                label={accountChipLabel(account)}
                selected={draft.accountIds.includes(account.id)}
                onPress={() =>
                  setDraft({
                    ...draft,
                    accountIds: toggleIn(draft.accountIds, account.id),
                  })
                }
              />
            ))}
          </Section>

          {/* The design draws a two-handle slider here. There is no slider in
              React Native and none installed, so the same bound is set by
              typing it. Blank means no limit on that end. */}
          <View style={{ marginTop: theme.space(5) }}>
            <Text variant="label" tone="secondary">
              Amount
            </Text>
            <View style={[styles.amountRow, { marginTop: theme.space(2) }]}>
              <AmountInput
                label="From"
                paise={draft.minAmount}
                onChange={(value) => setDraft({ ...draft, minAmount: value })}
              />
              <AmountInput
                label="To"
                paise={draft.maxAmount}
                onChange={(value) => setDraft({ ...draft, maxAmount: value })}
              />
            </View>
          </View>

          <View style={{ marginTop: theme.space(5) }}>
            <Toggle
              label="Only uncategorized"
              value={draft.onlyUncategorized}
              onChange={(next) => setDraft({ ...draft, onlyUncategorized: next })}
            />
            <Toggle
              label="Hide self-transfers"
              value={draft.hideSelfTransfers}
              onChange={(next) => setDraft({ ...draft, hideSelfTransfers: next })}
            />
            <Toggle
              label="Hide rent and fixed payments"
              value={draft.hideFixedCosts}
              onChange={(next) => setDraft({ ...draft, hideFixedCosts: next })}
            />
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            { padding: theme.space(5), borderTopColor: theme.color.border },
          ]}>
          <Text variant="caption" tone="secondary" style={styles.footerNote}>
            {formatRupees(preview.out)} out · {formatRupees(preview.in)} in
          </Text>
          <Button
            label={
              preview.count === 0
                ? 'No transactions match'
                : `Show ${preview.count.toLocaleString('en-IN')} transaction${
                    preview.count === 1 ? '' : 's'
                  }`
            }
            disabled={preview.count === 0}
            onPress={() => onApply(draft)}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, top: '14%' },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginVertical: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  toggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { flex: 1 },
  rangeSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
  },
  amountRow: { flexDirection: 'row', gap: 10 },
  amountField: { flex: 1, gap: 4 },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, paddingHorizontal: 12, height: 44,
  },
  amountInput: { flex: 1, fontSize: 15, padding: 0 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  footerNote: { textAlign: 'center' },
});

/**
 * The Transactions list.
 *
 * Not described in the technical document — the design in
 * `screens/transactions-page.png` is the specification. What it borrows from
 * the sections that do exist is noted where it does so.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatRupees } from '../../core/analytics/spending';
import { listAccounts } from '../../core/db/dao/accounts';
import { listCategories } from '../../core/db/dao/categories';
import type { AccountRow, CategoryRow } from '../../core/db/models';
import {
  DEFAULT_FILTER,
  activeFilterCount,
  dateFilterLabel,
  filterTotals,
  groupByDay,
  listTransactions,
  presetForSearch,
  type DayGroup,
  type FilterTotals,
  type TransactionFilter,
  type TransactionListRow,
} from '../../core/transactions/query';

/**
 * A page is sized to cover more than a screen, so reaching the end of one
 * loads the next before the user can see the list stop.
 */
const PAGE_SIZE = 120;
import { useDataVersion } from '../../core/db/changes';
import { pressedDim, useTheme } from '../../design';
import { Icon, Text } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';
import { TitleMenu } from '../navigation/TitleMenu';
import { FiltersSheet } from './components/FiltersSheet';
import { TransactionRow } from './components/TransactionRow';

const TYPE_CHIP: Record<TransactionFilter['type'], string> = {
  DEBIT: 'Money out',
  CREDIT: 'Money in',
  BOTH: 'Money in & out',
};

function dayHeading(date: string, now: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year!, month! - 1, day!);
  const written = value.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const todayKey = new Date(now).toDateString();
  if (value.toDateString() === todayKey) {
    return `Today · ${written}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (value.toDateString() === yesterday.toDateString()) {
    return `Yesterday · ${written}`;
  }
  return written;
}

/** The list is one flat array so a day heading scrolls with its rows. */
type Entry =
  | { kind: 'HEADING'; group: DayGroup }
  | { kind: 'ROW'; row: TransactionListRow; first: boolean; last: boolean };

function flatten(groups: DayGroup[]): Entry[] {
  const entries: Entry[] = [];
  for (const group of groups) {
    entries.push({ kind: 'HEADING', group });
    group.rows.forEach((row, index) => {
      entries.push({
        kind: 'ROW',
        row,
        first: index === 0,
        last: index === group.rows.length - 1,
      });
    });
  }
  return entries;
}

export function TransactionsScreen({
  navigation,
  route,
}: ScreenProps<'Transactions'>) {
  const theme = useTheme();
  const { db } = useApp();

  // Opened from a figure on Home, the list starts narrowed to what that
  // figure counted. Opened from the menu, it starts on this month.
  const opening = route.params?.filter;
  const [filter, setFilter] = useState<TransactionFilter>(() => ({
    ...DEFAULT_FILTER,
    ...opening,
  }));
  // Arriving a second time with a different figure tapped has to re-narrow
  // the list; the initial state above is only read on the first mount.
  useEffect(() => {
    if (opening) {
      setFilter({ ...DEFAULT_FILTER, ...opening });
    }
  }, [opening]);

  const [search, setSearch] = useState('');
  /** The window to put back when the search is cleared. */
  const beforeSearchRef = useRef<TransactionFilter['datePreset'] | null>(null);

  /**
   * Searching looks at everything, not at the month the list happens to be
   * showing.
   *
   * A payee paid twenty-five times over a year has one payment in the current
   * month, and a search box that answered `1` for that is worse than no
   * search box: it reads as an answer about the payee rather than about the
   * window. The date chip is moved to `All time` with it, so the widening is
   * on screen rather than silent, and the previous window comes back when the
   * search is cleared.
   */
  const changeSearch = (text: string) => {
    const next = presetForSearch(
      search,
      text,
      filter.datePreset,
      beforeSearchRef.current,
    );
    beforeSearchRef.current = next.saved;
    setSearch(text);
    if (next.preset !== filter.datePreset) {
      setFilter((current) => ({ ...current, datePreset: next.preset }));
    }
  };
  const [filtersOpen, setFiltersOpen] = useState(false);

  /** Moves on every write, including one from an incoming message. */
  const changed = useDataVersion();

  const categories = useMemo<CategoryRow[]>(() => listCategories(db), [db]);
  const accounts = useMemo<AccountRow[]>(() => listAccounts(db), [db]);

  /**
   * The box updates on every keystroke; the query waits for a pause.
   *
   * Without this, each letter rebuilds the whole list — a query, a regroup
   * and a re-render — between one keypress and the next, and the typing is
   * what feels slow.
   */
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 180);
    return () => clearTimeout(timer);
  }, [search]);

  const applied = useMemo<TransactionFilter>(
    () => ({ ...filter, search: debouncedSearch }),
    [filter, debouncedSearch],
  );

  const [rows, setRows] = useState<TransactionListRow[]>([]);
  /**
   * How many rows have been taken, tracked outside state.
   *
   * `onEndReached` fires more than once before React has re-rendered, and
   * every one of those calls would read the same stale `rows.length` and ask
   * for the same page again. The duplicate rows then collide on their keys.
   * A ref moves the moment it is written, so the second call asks for the
   * page after the one the first call took.
   */
  const takenRef = useRef(0);
  const exhaustedRef = useRef(false);
  const [totals, setTotals] = useState<FilterTotals>({ count: 0, out: 0, in: 0 });
  const [now, setNow] = useState(() => Date.now());

  // The whole list is rebuilt whenever the filter changes or something was
  // edited elsewhere. `now` is pinned at that moment so paging further down
  // cannot shift the window under the rows already on screen.
  useEffect(() => {
    const at = Date.now();
    const first = listTransactions(db, applied, at, PAGE_SIZE, 0);
    takenRef.current = first.length;
    exhaustedRef.current = first.length < PAGE_SIZE;
    setNow(at);
    setRows(first);
    setTotals(filterTotals(db, applied, at));
    // `changed` is what re-runs this after an edit on the detail screen, or
    // after a payment is read out of a message that has just arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, applied, changed]);

  const loadMore = useCallback(() => {
    if (exhaustedRef.current) {
      return;
    }
    const next = listTransactions(db, applied, now, PAGE_SIZE, takenRef.current);
    takenRef.current += next.length;
    if (next.length < PAGE_SIZE) {
      exhaustedRef.current = true;
    }
    if (next.length === 0) {
      return;
    }
    // A second guard, so a row can never be listed twice however the pages
    // arrive. Two rows with one key is a crash in the list, not a cosmetic
    // problem.
    setRows((current) => {
      const seen = new Set(current.map((row) => row.id));
      return [...current, ...next.filter((row) => !seen.has(row.id))];
    });
  }, [db, applied, now]);



  const entries = useMemo(() => flatten(groupByDay(rows)), [rows]);
  const badge = activeFilterCount(filter);

  const openDetail = useCallback(
    (id: number) => navigation.navigate('TransactionDetail', { id }),
    [navigation],
  );

  /**
   * Defined once rather than inline, so `TransactionRow`'s memoisation holds.
   * A new function here every render defeats it and re-renders every visible
   * row whenever anything in the header changes.
   */
  const renderEntry = useCallback(
    ({ item }: { item: Entry }) => {
      if (item.kind === 'HEADING') {
        return <DayHeading group={item.group} now={now} />;
      }
      return (
        <View
          style={[
            styles.block,
            {
              backgroundColor: theme.color.surface,
              borderTopLeftRadius: item.first ? theme.radius.lg : 0,
              borderTopRightRadius: item.first ? theme.radius.lg : 0,
              borderBottomLeftRadius: item.last ? theme.radius.lg : 0,
              borderBottomRightRadius: item.last ? theme.radius.lg : 0,
              paddingHorizontal: theme.space(4),
            },
          ]}>
          <TransactionRow
            row={item.row}
            showDivider={!item.first}
            onPress={() => openDetail(item.row.id)}
          />
        </View>
      );
    },
    [now, theme, openDetail],
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top']}>
      <FlatList
        data={entries}
        keyExtractor={(entry) =>
          entry.kind === 'HEADING' ? `h:${entry.group.date}` : `r:${entry.row.id}`
        }
        contentContainerStyle={{
          paddingHorizontal: theme.space(4),
          paddingBottom: theme.space(24),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          rows.length > 0 && rows.length < totals.count ? (
            <Text
              variant="caption"
              tone="muted"
              style={[styles.empty, { marginTop: theme.space(5) }]}>
              {rows.length.toLocaleString('en-IN')} of{' '}
              {totals.count.toLocaleString('en-IN')} · keep scrolling
            </Text>
          ) : (
            <View />
          )
        }
        ListHeaderComponent={
          <View>
            <TitleMenu current="Transactions" navigation={navigation} />
            <Text variant="caption" tone="secondary" style={{ marginTop: theme.space(1) }}>
              {search.trim().length > 0
                ? `“${search.trim()}” · all time`
                : route.params?.title ?? dateFilterLabel(filter, now)}{' '}
              · {totals.count.toLocaleString('en-IN')} payment
              {totals.count === 1 ? '' : 's'}
            </Text>

            <View
              style={[
                styles.search,
                {
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.lg,
                  borderColor: theme.color.border,
                  marginTop: theme.space(4),
                  paddingHorizontal: theme.space(4),
                },
              ]}>
              <Icon name="search" size={18} color={theme.color.textMuted} />
              <TextInput
                value={search}
                onChangeText={changeSearch}
                placeholder="Search merchant, UPI ID or amount"
                placeholderTextColor={theme.color.textMuted}
                style={[styles.searchInput, { color: theme.color.textPrimary }]}
                returnKeyType="search"
                autoCorrect={false}
              />
              {search.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => changeSearch('')}
                  hitSlop={8}
                  style={({ pressed }) => pressedDim(pressed)}>
                  <Icon name="close" size={16} color={theme.color.textSecondary} />
                </Pressable>
              ) : null}
            </View>

            {/* Every chip opens the same sheet. Separate menus per chip would
                be four ways to reach one set of choices. */}
            <View style={[styles.chips, { marginTop: theme.space(3) }]}>
              <FilterChip
                label={dateFilterLabel(filter, now)}
                active={filter.datePreset !== DEFAULT_FILTER.datePreset}
                onPress={() => setFiltersOpen(true)}
              />
              <FilterChip
                label={TYPE_CHIP[filter.type]}
                active={filter.type !== 'BOTH'}
                onPress={() => setFiltersOpen(true)}
              />
              <FilterChip
                label={
                  filter.categories.length === 0
                    ? 'Category'
                    : filter.categories.length === 1
                    ? '1 category'
                    : `${filter.categories.length} categories`
                }
                active={filter.categories.length > 0}
                onPress={() => setFiltersOpen(true)}
              />
              <FilterChip
                label={badge === 0 ? 'More' : `Filters · ${badge}`}
                active={badge > 0}
                onPress={() => setFiltersOpen(true)}
              />
            </View>

            <View
              style={[
                styles.summary,
                {
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.lg,
                  padding: theme.space(4),
                  marginTop: theme.space(3),
                },
              ]}>
              <SummaryFigure label="Out" value={formatRupees(totals.out)} />
              <SummaryFigure label="In" value={formatRupees(totals.in)} tone="accent" />
              <SummaryFigure
                label="Payments"
                value={totals.count.toLocaleString('en-IN')}
              />
            </View>
          </View>
        }
        renderItem={renderEntry}
        /* A screen holds about eight rows, so ten is a full first paint and
           the rest arrive while the navigation animation is still running. */
        initialNumToRender={10}
        maxToRenderPerBatch={12}
        windowSize={9}
        removeClippedSubviews
        ListEmptyComponent={
          <View style={{ marginTop: theme.space(10) }}>
            <Text variant="body" tone="secondary" style={styles.empty}>
              {search.length > 0
                ? `Nothing matches “${search}”.`
                : 'No payments in this period.'}
            </Text>
            {badge > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setFilter(DEFAULT_FILTER)}
                style={({ pressed }) => [
                  { marginTop: theme.space(3) },
                  pressedDim(pressed),
                ]}>
                <Text variant="label" tone="accent" style={styles.empty}>
                  Clear filters
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a payment"
        onPress={() => navigation.navigate('AddPayment', {})}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: pressed ? theme.color.primaryPressed : theme.color.primary,
            borderRadius: theme.radius.xl,
          },
        ]}>
        <Icon name="plus" size={26} color={theme.color.onPrimary} />
      </Pressable>

      <FiltersSheet
        visible={filtersOpen}
        db={db}
        now={now}
        filter={applied}
        categories={categories}
        accounts={accounts}
        onApply={(next) => {
          setFilter(next);
          // The heading carried over from Home — `Food & Dining · This
          // month` — describes the figure that was tapped. Once the filter
          // has been edited it describes nothing, so it is dropped and the
          // heading goes back to saying what is actually being shown.
          if (route.params?.title !== undefined) {
            navigation.setParams({ title: undefined });
          }
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
    </SafeAreaView>
  );
}

function DayHeading({ group, now }: { group: DayGroup; now: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.heading, { marginTop: theme.space(5) }]}>
      <Text variant="label" tone="secondary" style={styles.headingText}>
        {dayHeading(group.date, now)}
      </Text>
      <Text variant="caption" tone="muted" tabular>
        {group.spent > 0 ? `${formatRupees(group.spent)} spent` : ''}
        {group.spent > 0 && group.received > 0 ? ' · ' : ''}
        {group.received > 0 ? `${formatRupees(group.received)} in` : ''}
      </Text>
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        pressedDim(pressed),
        {
          borderRadius: theme.radius.pill,
          backgroundColor: active ? theme.color.selected : theme.color.surface,
          borderColor: active ? theme.color.selected : theme.color.border,
        },
      ]}>
      <Text
        variant="label"
        numberOfLines={1}
        style={{ color: active ? theme.color.onSelected : theme.color.textPrimary }}>
        {label}
      </Text>
      <Icon
        name="chevron-down"
        size={14}
        color={active ? theme.color.onSelected : theme.color.textSecondary}
      />
    </Pressable>
  );
}

function SummaryFigure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'accent';
}) {
  return (
    <View style={styles.summaryFigure}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong" tabular tone={tone} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, height: 50 },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1,
  },
  block: { overflow: 'hidden' },
  summary: { flexDirection: 'row', gap: 12 },
  summaryFigure: { flex: 1, gap: 2 },
  heading: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, marginBottom: 8,
  },
  headingText: { flexShrink: 1 },
  empty: { textAlign: 'center' },
  fab: {
    position: 'absolute', right: 20, bottom: 28, width: 58, height: 58,
    alignItems: 'center', justifyContent: 'center', elevation: 4,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
});

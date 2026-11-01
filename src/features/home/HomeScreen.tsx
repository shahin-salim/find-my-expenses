/**
 * Section 10, the Home page.
 *
 * "The home page shows where money is going out. Every figure on the page is
 * money spent." One period is selected at a time and it governs everything
 * below it — the chart, the breakdown, and the top transactions.
 *
 * "All figures are calculated from the transactions table when the page is
 * opened. There are no stored totals or precalculated tables." Every read on
 * this screen therefore happens in one place, `read()`, and re-runs whenever
 * the period, the filter or the month in view changes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  byCategory,
  byPayee,
  calendarMonth,
  daySummary,
  topTransactions,
  type CalendarDay,
  type DaySummary,
  type Slice,
  type TopTransaction,
} from '../../core/analytics/breakdown';
import { chartSeries, type ChartSeries } from '../../core/analytics/chart';
import {
  chartSummary,
  dayConcentration,
  topSliceNote,
  type Concentration,
} from '../../core/analytics/insights';
import {
  addPeriods,
  fixedCostTotal,
  formatRupees,
  movedMoneyTotal,
  periodOf,
  spendingByDay,
  startOfPeriod,
  summarise,
  type PeriodKind,
  type PeriodSummary,
  type SpendingView,
} from '../../core/analytics/spending';
import { useDataVersion } from '../../core/db/changes';
import { unreadableCount } from '../../core/db/dao/smsMessages';
import type { TransactionFilter } from '../../core/transactions/query';
import { pressedDim, pressedFill, useTheme } from '../../design';
import { Card, Icon, Text } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';
import { TitleMenu } from '../navigation/TitleMenu';
import { FilterSheet } from './components/FilterSheet';
import { SpendingCalendar } from './components/SpendingCalendar';
import { SpendingChart } from './components/SpendingChart';
import { TopTransactions } from './components/TopTransactions';
import { WhereMoneyWent, type Grouping } from './components/WhereMoneyWent';

const PERIODS: Array<{ kind: PeriodKind; label: string }> = [
  { kind: 'DAY', label: 'Today' },
  { kind: 'WEEK', label: 'This week' },
  { kind: 'MONTH', label: 'This month' },
];

const CHART_TITLE: Record<PeriodKind, string> = {
  DAY: 'Last 7 days',
  WEEK: 'Last 7 weeks',
  MONTH: 'Last 7 months',
};

const PERIOD_CAPTION: Record<PeriodKind, string> = {
  DAY: 'Today',
  WEEK: 'This week',
  MONTH: 'This month',
};

/** The period, written to sit inside a sentence. */
const PERIOD_PHRASE: Record<PeriodKind, string> = {
  DAY: 'today',
  WEEK: 'this week',
  MONTH: 'this month',
};

const VERSUS: Record<PeriodKind, string> = {
  DAY: 'vs yesterday',
  WEEK: 'vs last week',
  MONTH: 'vs last month',
};

interface HomeData {
  now: number;
  summaries: Array<{ kind: PeriodKind; label: string } & PeriodSummary>;
  series: ChartSeries;
  headline: string | null;
  concentration: Concentration | null;
  slices: Slice[];
  sliceNote: string | null;
  periodTotal: number;
  calendar: CalendarDay[];
  day: DaySummary | null;
  top: TopTransaction[];
  hiddenFixedCosts: number;
  movedMoney: number;
  unreadable: number;
}

export function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const theme = useTheme();
  const { db, profile, patchProfile } = useApp();

  // The page opens on the card the user last had open. Which period they
  // read in is a habit rather than a one-off choice — someone watching a
  // monthly budget asks the same question every time they open the app —
  // and reopening on Today puts them one tap from where they were, every
  // time, forever. A first launch has no habit to restore and opens on
  // Today: it is the period they can still act on, and the only one whose
  // figure is not already settled.
  const [selected, setSelected] = useState<PeriodKind>(profile.home_period);
  // Section 8.2's two flags are the user saying a category is not what they
  // are trying to watch, so the page opens honouring them. `EVERYTHING` is
  // the deliberate step out of that, not the resting state.
  const [view, setView] = useState<SpendingView>('EVERYDAY');
  const [grouping, setGrouping] = useState<Grouping>('CATEGORY');
  const [filterOpen, setFilterOpen] = useState(false);
  /** Months away from the current one, so the grid can be stepped back. */
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  /** True while a finger is on the chart, so the page holds still under it. */
  const [scrubbing, setScrubbing] = useState(false);

  /**
   * Moves whenever anything is written, including a payment read out of a
   * message that has just arrived. Being a dependency of `read` is what makes
   * the figures on this page follow it: section 1.2's message is recorded, and
   * the total the user is looking at changes under them rather than waiting
   * for the page to be opened again.
   */
  const changed = useDataVersion();

  const read = useCallback((): HomeData => {
    const now = Date.now();
    const period = periodOf(selected, now);
    const series = chartSeries(db, selected, now, view);

    const month = {
      from: addPeriods('MONTH', startOfPeriod('MONTH', now), monthOffset),
      to: addPeriods('MONTH', startOfPeriod('MONTH', now), monthOffset + 1),
    };
    const calendar = calendarMonth(db, month, now, view);

    // The day the panel describes: whichever was tapped, or today when the
    // grid is showing the current month, or nothing at all.
    const fallback = calendar.find((entry) => entry.isToday)?.date ?? null;
    const dayKey =
      selectedDay && calendar.some((entry) => entry.date === selectedDay)
        ? selectedDay
        : fallback;

    const slices =
      grouping === 'CATEGORY' ? byCategory(db, period, view) : byPayee(db, period, view);

    const periodTotal = slices.reduce((sum, slice) => sum + slice.total, 0);

    const summaries = PERIODS.map((entry) => ({
      ...entry,
      ...summarise(db, entry.kind, now, view),
    }));
    // The headline compares against the same previous period the selected
    // card is already showing, rather than reading it a second time.
    const previousTotal =
      summaries.find((entry) => entry.kind === selected)?.previousTotal ?? 0;

    return {
      now,
      summaries,
      series,
      headline: chartSummary(series, previousTotal, view),
      concentration: dayConcentration(
        spendingByDay(db, period, view).map((row) => ({
          date: row.occurred_on,
          total: row.total,
        })),
        selected,
      ),
      slices,
      sliceNote: topSliceNote(slices),
      periodTotal,
      calendar,
      day: dayKey
        ? daySummary(db, periodOf('DAY', dayStart(dayKey)), month, now, view)
        : null,
      top: topTransactions(db, period, view, 5),
      hiddenFixedCosts: fixedCostTotal(db, period),
      movedMoney: movedMoneyTotal(db, period),
      unreadable: unreadableCount(db),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, selected, view, grouping, monthOffset, selectedDay, changed]);

  const [data, setData] = useState<HomeData>(read);
  // The effect skips the mount it follows. `read` is around fifteen queries,
  // and running it as the lazy initial state and then again from an effect
  // that fires immediately after, on identical inputs, cost every Home open
  // thirty where fifteen would do. What the effect is actually for is the
  // changes afterwards — a period switch, a month step, a write landing —
  // and that is all it does now. Pull-to-refresh still calls `read` itself.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setData(read());
  }, [read]);



  const {
    now, summaries, series, headline, concentration, slices, sliceNote,
    periodTotal, calendar, day, top, hiddenFixedCosts, movedMoney, unreadable,
  } = data;

  const monthStart = useMemo(
    () => addPeriods('MONTH', startOfPeriod('MONTH', now), monthOffset),
    [now, monthOffset],
  );

  const changeBadge = summaries.find((entry) => entry.kind === selected)?.changePercent;

  /**
   * Opens the list showing the rows a figure on this page was counting.
   *
   * The period and the filter come across with it, and `spendingOnly` carries
   * section 10's definition, so the payments listed are the payments the
   * figure added up — not everything that happened to fall in the same week.
   */
  const openTransactions = (
    extra: Partial<TransactionFilter> = {},
    title?: string,
  ) => {
    navigation.navigate('Transactions', {
      filter: {
        datePreset:
          selected === 'DAY' ? 'TODAY' : selected === 'WEEK' ? 'WEEK' : 'MONTH',
        spendingOnly: true,
        hideFixedCosts: view === 'EVERYDAY',
        hideMovedMoney: view !== 'EVERYTHING',
        ...extra,
      },
      title: title ?? PERIOD_CAPTION[selected],
    });
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.space(4),
          paddingBottom: theme.space(12),
          gap: theme.space(4),
        }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => setData(read())}
            tintColor={theme.color.primary}
          />
        }
        // A drag across the chart would otherwise scroll the page out from
        // under the finger that is reading it.
        scrollEnabled={!scrubbing}
        showsVerticalScrollIndicator={false}>
        {/* ------------------------------------------------------ header -- */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="caption" tone="secondary">
              {new Date(now).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </Text>
            <View style={{ marginTop: theme.space(1) }}>
              <TitleMenu current="Home" navigation={navigation} />
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter what Home shows"
            onPress={() => setFilterOpen(true)}
            style={({ pressed }) => [
              styles.headerButton,
              {
                borderColor: view !== 'EVERYDAY' ? theme.color.primary : theme.color.border,
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.pill,
              },
              pressedFill(theme, pressed),
            ]}>
            <Icon
              name="filter"
              size={18}
              color={view !== 'EVERYDAY' ? theme.color.primary : theme.color.textSecondary}
            />
          </Pressable>

          {/* The avatar in the Home design. It is the way into Settings,
              which is where section 11 puts the unreadable messages count
              and section 8.2 puts the categories. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => navigation.navigate('Settings')}
            style={({ pressed }) => [
              styles.headerButton,
              pressedDim(pressed),
              {
                backgroundColor: theme.color.primary,
                borderColor: theme.color.primary,
                borderRadius: theme.radius.pill,
              },
            ]}>
            <Text variant="label" style={{ color: theme.color.onPrimary }}>
              {initials(profile.display_name)}
            </Text>
          </Pressable>
        </View>

        {/* The figure is for the selected period, so the period has to be
            named. Without it the line reads as a statement about the whole
            page, and claims nothing is hidden while the two cards beside it
            visibly drop — rent and bills land once a month, so a single day
            almost never has any. */}
        {view === 'EVERYDAY' ? (
          <Text variant="caption" tone="accent" style={styles.filterNote}>
            Everyday spending ·{' '}
            {hiddenFixedCosts > 0
              ? `${formatRupees(hiddenFixedCosts)} of fixed costs hidden ${
                  PERIOD_PHRASE[selected]
                }`
              : `no fixed costs ${PERIOD_PHRASE[selected]}`}
          </Text>
        ) : null}

        {/* ------------------------------------------- 10.1 three totals -- */}
        <View style={styles.periods}>
          {summaries.map((summary) => {
            const active = summary.kind === selected;
            return (
              <Pressable
                key={summary.kind}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setSelected(summary.kind);
                  // Written as it is tapped rather than on the way out:
                  // there is no reliable moment a phone gives an app to
                  // save on, and the row is one small write.
                  patchProfile({ home_period: summary.kind });
                }}
                style={({ pressed }) => [
                  styles.period,
                  {
                    backgroundColor: theme.color.surface,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1.5,
                    borderColor: active ? theme.color.primary : 'transparent',
                    padding: theme.space(3),
                  },
                  pressedFill(theme, pressed),
                ]}>
                <Text variant="caption" tone="secondary">
                  {summary.label}
                </Text>
                <Text
                  variant="amount"
                  tabular
                  // A month can run to six figures in a card a third of the
                  // screen wide; without this `₹85,455` wraps after the comma
                  // and reads as two numbers.
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={{ marginTop: theme.space(1) }}>
                  {formatRupees(summary.total)}
                </Text>
                {summary.changePercent === null ? (
                  <Text variant="caption" tone="muted">
                    —
                  </Text>
                ) : (
                  <Text
                    variant="caption"
                    tone={summary.changePercent >= 0 ? 'up' : 'accent'}
                    tabular>
                    {summary.changePercent >= 0 ? '▲' : '▼'}{' '}
                    {Math.abs(Math.round(summary.changePercent))}%
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        <Text variant="caption" tone="muted" style={styles.hint}>
          Tap a period to switch the chart and categories below
        </Text>

        {/* --------------------------------------------- 10.2 the chart -- */}
        <Card>
          <View style={styles.cardHead}>
            <Text variant="heading" style={styles.cardTitle}>
              {CHART_TITLE[selected]}
            </Text>
            {changeBadge === null || changeBadge === undefined ? null : (
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor:
                      changeBadge >= 0 ? theme.category.orange.soft : theme.category.green.soft,
                    borderRadius: theme.radius.pill,
                  },
                ]}>
                <Text
                  variant="caption"
                  tabular
                  style={{
                    color:
                      changeBadge >= 0
                        ? theme.category.orange.onSoft
                        : theme.category.green.onSoft,
                  }}>
                  {changeBadge >= 0 ? '+' : '−'}
                  {Math.abs(Math.round(changeBadge))}% {VERSUS[selected]}
                </Text>
              </View>
            )}
          </View>

          {headline ? (
            <Text variant="body" tone="secondary" style={{ marginTop: theme.space(3) }}>
              {headline}
            </Text>
          ) : null}

          <View style={{ marginTop: theme.space(4) }}>
            {/* Keyed on the period so switching tabs clears the crosshair
                rather than leaving it pointing at a column that now means
                something else. */}
            <SpendingChart
              key={selected}
              series={series}
              onScrubbingChange={setScrubbing}
              // The column's own window rather than the selected period, so
              // tapping May opens May and not the month being viewed. The
              // rest of the filter comes from `openTransactions`, which is
              // what keeps the rows listed equal to the figure tapped.
              onOpenPoint={(point, label) =>
                openTransactions(
                  {
                    datePreset: 'CUSTOM',
                    customFrom: point.from,
                    customTo: point.to,
                  },
                  label,
                )
              }
            />
          </View>

          {concentration ? (
            <View
              style={[
                styles.insight,
                {
                  backgroundColor: theme.color.surfaceMuted,
                  borderRadius: theme.radius.md,
                  padding: theme.space(3),
                  marginTop: theme.space(4),
                },
              ]}>
              <Text variant="body">{concentration.text}</Text>
            </View>
          ) : null}
        </Card>

        {/* ------------------------------------ 10.3 where money went --- */}
        <Card>
          <WhereMoneyWent
            periodLabel={PERIOD_CAPTION[selected]}
            total={periodTotal}
            slices={slices}
            grouping={grouping}
            onChangeGrouping={setGrouping}
            note={sliceNote}
            onSelect={(slice) => {
              // Only a slice standing for itself arrives here; the gathered
              // one opens itself out inside the card instead, because the
              // payments behind it belong to several different categories
              // and a list mixing them answers nothing.
              openTransactions(
                grouping === 'CATEGORY'
                  ? {
                      categories: [
                        slice.key === 'none' ? 'NONE' : Number(slice.key),
                      ],
                    }
                  : { payeeKeys: [slice.key] },
                slice.label,
              );
            }}
          />
        </Card>

        {/* -------------------------------------------- 10.4 calendar --- */}
        <Card>
          <SpendingCalendar
            monthStart={monthStart}
            days={calendar}
            selected={day?.date ?? null}
            summary={day}
            onSelect={setSelectedDay}
            onStep={(months) => {
              setSelectedDay(null);
              setMonthOffset((current) => Math.min(0, current + months));
            }}
            canStepForward={monthOffset < 0}
            // The panel lists a few of the day's payments; this opens the
            // rest. The window is that one day, and `spendingOnly` carries
            // section 10's definition across, so the list holds exactly the
            // payments the panel's figure added up.
            onOpenDay={(date) =>
              navigation.navigate('Transactions', {
                filter: {
                  datePreset: 'CUSTOM',
                  customFrom: dayStart(date),
                  customTo: dayStart(date) + 86_400_000,
                  spendingOnly: true,
                  hideFixedCosts: view === 'EVERYDAY',
                  hideMovedMoney: view !== 'EVERYTHING',
                },
                title: dayTitle(date),
              })
            }
          />
        </Card>

        {/* ------------------------------------ 10.5 top transactions --- */}
        <Card>
          <TopTransactions
            rows={top}
            subtitle={`Biggest payments ${
              selected === 'DAY' ? 'today' : selected === 'WEEK' ? 'this week' : 'this month'
            }`}
            onSeeAll={() => openTransactions()}
            onOpen={(id) => navigation.navigate('TransactionDetail', { id })}
          />
        </Card>

        {/* Section 11.1: the count is the only place a bank changing its
            wording ever becomes visible, so it opens the messages. */}
        {unreadable > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Read the ${unreadable} messages that could not be read`}
            onPress={() => navigation.navigate('UnreadableMessages')}
            style={({ pressed }) => [
              styles.unreadable,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                padding: theme.space(4),
              },
              pressedFill(theme, pressed),
            ]}>
            <Icon name="alert" size={16} color={theme.color.textSecondary} />
            <Text variant="caption" tone="secondary" style={styles.unreadableText}>
              {unreadable} message{unreadable === 1 ? '' : 's'} could not be read. Tap to
              see {unreadable === 1 ? 'it' : 'them'}.
            </Text>
            <Icon name="chevron-right" size={14} color={theme.color.textSecondary} />
          </Pressable>
        ) : null}

        <Text variant="caption" tone="muted" style={styles.footer}>
          {profile.transactions_found.toLocaleString('en-IN')} payments across{' '}
          {profile.accounts_found} account{profile.accounts_found === 1 ? '' : 's'}
        </Text>
      </ScrollView>

      <FilterSheet
        visible={filterOpen}
        view={view}
        fixedCostTotal={hiddenFixedCosts}
        periodPhrase={PERIOD_PHRASE[selected]}
        movedMoneyTotal={movedMoney}
        onApply={(next) => {
          setView(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </SafeAreaView>
  );
}

/**
 * Up to two letters for the avatar, or a cog-like fallback.
 *
 * The profile has no name until the user gives one, and an empty circle
 * would read as a loading state rather than a button.
 */
function initials(displayName: string | null): string {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '\u2699';
  }
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/** `Sat, 24 Oct` for a `YYYY-MM-DD` key, to title the list it opens. */
function dayTitle(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Local midnight for a `YYYY-MM-DD` key. */
function dayStart(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day!).getTime();
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  filterNote: { marginTop: -8 },
  periods: { flexDirection: 'row', gap: 8 },
  period: { flex: 1 },
  hint: { marginTop: -8 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 5 },
  insight: {},
  unreadable: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unreadableText: { flex: 1 },
  footer: { textAlign: 'center' },
});

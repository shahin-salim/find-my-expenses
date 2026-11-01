/**
 * Section 10.2 drawn: seven periods, the median across them, and the dotted
 * pace of the one still running.
 *
 * The chart is also readable by touch. A column on a phone is around forty
 * pixels wide and the y-axis carries no numbers, so without a crosshair the
 * only honest thing a person can take from the line is its shape. Dragging
 * along it names the period under the finger and gives its figure, the way a
 * trading chart does.
 *
 * The readout is itself the way into the period: tapping it opens the
 * payments the figure added up. A number a person is already looking at is
 * the natural place to ask what it is made of, and the alternative — tapping
 * the column — cannot be told apart from the taps that move the crosshair.
 */

import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { chartMarks, type ChartSeries } from '../../../core/analytics/chart';
import {
  formatCompactRupees,
  formatRupees,
} from '../../../core/analytics/spending';
import { pressedDim, useTheme } from '../../../design';
import { Text } from '../../../design/components';

const HEIGHT = 165;
// Room for the figures that now sit above the highest column and below the
// lowest one. Without it a label on a column at either extreme is drawn
// outside the canvas and simply does not appear.
const TOP = 26;
const BOTTOM = 20;
/**
 * Breathing room at each end of the plot.
 *
 * The last column used to sit exactly on `width`, so the marker drawn on it
 * was cut in half by the edge of the canvas — most visible on the hollow
 * projection ring, which is the widest thing the chart draws and sits on
 * precisely that column.
 */
const SIDE = 10;
const TOOLTIP_WIDTH = 132;

/** The short form under the axis. */
function axisLabel(
  point: ChartSeries['points'][number],
  kind: ChartSeries['kind'],
): string {
  if (point.isCurrent) {
    return 'Now';
  }
  const date = new Date(point.from);
  if (kind === 'MONTH') {
    return date.toLocaleDateString('en-IN', { month: 'short' });
  }
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * The full form in the crosshair readout, which has room to say what the
 * column actually covers. A week is a range, and `19 Oct` alone would leave
 * the reader guessing whether the figure is one day or seven.
 */
function readoutLabel(
  point: ChartSeries['points'][number],
  kind: ChartSeries['kind'],
): string {
  const from = new Date(point.from);
  if (kind === 'DAY') {
    return from.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }
  if (kind === 'MONTH') {
    return from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  const to = new Date(point.to - 1);
  const sameMonth = from.getMonth() === to.getMonth();
  return `${from.getDate()}${
    sameMonth ? '' : ' ' + from.toLocaleDateString('en-IN', { month: 'short' })
  }–${to.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export function SpendingChart({
  series,
  onScrubbingChange,
  onOpenPoint,
}: {
  series: ChartSeries;
  /** Lets the page stop scrolling while a finger is on the chart. */
  onScrubbingChange?: (scrubbing: boolean) => void;
  /**
   * Opens the payments behind the column being read. `label` is the wording
   * the readout was showing, so the list arrives headed by what was tapped
   * rather than by a date range the reader has to match up again.
   */
  onOpenPoint?: (point: ChartSeries['points'][number], label: string) => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const { points, median, onPaceFor } = series;
  const line = theme.color.primary;

  // The top of the scale has to clear the dotted projection as well as the
  // tallest column, or an on-pace marker above the highest point is drawn
  // outside the canvas and silently disappears.
  const ceiling = Math.max(
    ...points.map((point) => point.total),
    median ?? 0,
    onPaceFor ?? 0,
    1,
  );

  const plotHeight = HEIGHT - TOP - BOTTOM;
  const span = Math.max(0, width - SIDE * 2);
  const x = (index: number) =>
    points.length === 1 ? width / 2 : SIDE + (index / (points.length - 1)) * span;
  const y = (value: number) => TOP + plotHeight - (value / ceiling) * plotHeight;

  const widthRef = useRef(0);
  widthRef.current = width;

  /**
   * Only a sideways drag is taken.
   *
   * The chart is a tall block in the middle of a long page, and claiming
   * every touch on it would leave a band of the screen that cannot be
   * scrolled from. Reading the chart runs left to right and scrolling the
   * page runs up and down, so the direction of the first few pixels is enough
   * to tell which one is meant.
   *
   * It has to be a capture handler: the tap target underneath is the
   * responder by then, and a parent can only take over through capture.
   */
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          onScrubbingChange?.(true);
          setActive(nearest(event.nativeEvent.locationX));
        },
        onPanResponderMove: (event) => {
          setActive(nearest(event.nativeEvent.locationX));
        },
        onPanResponderRelease: () => onScrubbingChange?.(false),
        onPanResponderTerminate: () => onScrubbingChange?.(false),
      }),
    // `nearest` reads the current width through a ref, so the responder is
    // built once and does not need rebuilding on every layout pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points.length],
  );

  function nearest(locationX: number): number {
    const w = widthRef.current;
    if (w <= 0 || points.length < 2) {
      return 0;
    }
    const usable = Math.max(1, w - SIDE * 2);
    const ratio = Math.min(1, Math.max(0, (locationX - SIDE) / usable));
    return Math.round(ratio * (points.length - 1));
  }

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.total)}`).join(' ');
  const area = `${path} L${x(points.length - 1)},${HEIGHT - BOTTOM} L${x(0)},${
    HEIGHT - BOTTOM
  } Z`;

  const lastIndex = points.length - 1;
  const current = points[lastIndex]!;
  const selected = active === null ? null : points[active]!;

  const selectedLabel = selected === null ? '' : readoutLabel(selected, series.kind);

  // A readout showing nothing is not a button. At zero there are no payments
  // behind the figure, and the list would open carrying the filter that had
  // just found none — a dead end dressed up as a way in.
  const canOpen = selected !== null && selected.total > 0 && onOpenPoint !== undefined;

  // What the chart says in place of a scale.
  const marks = useMemo(() => chartMarks(points), [points]);
  /**
   * Whether the projection is worth drawing as a separate marker.
   *
   * Late in a period the pace and the total converge — `₹140` against
   * `₹137` with the evening nearly gone — and the hollow ring lands on
   * top of the solid dot. Two markers inside four pixels of each other read
   * as one smudged one, so below that gap the projection is left to the
   * legend and the point keeps its own shape.
   */
  const showsPace =
    onPaceFor !== null &&
    onPaceFor > current.total &&
    y(current.total) - y(onPaceFor) >= 10;

  /**
   * How far in the dashed line's own label starts.
   *
   * At the very left, as the design has it, unless the first column carries
   * a marker of its own — then the text is written straight through the
   * circle. It cannot move to the other end instead, because that end
   * always holds the running period's figure.
   */
  const usualIndent =
    marks.high?.index === 0 || marks.low?.index === 0 ? SIDE + 10 : 0;

  /**
   * A figure written against its column.
   *
   * It goes above the high and below the low, which is where there is room
   * on a line that reached either of them. The exception is the running
   * period when it is projecting: the hollow marker is already above that
   * point, so the figure moves to its left rather than stacking on top of
   * it. Near an edge the text anchors inward, so a label on the first or
   * last column is not half outside the card.
   */
  const markText = (
    mark: { index: number; total: number },
    kind: 'high' | 'low' | 'now',
  ) => {
    const cx = x(mark.index);
    const cy = y(mark.total);
    const beside = mark.index === lastIndex && showsPace;
    const anchor =
      beside || cx > width - 40 ? 'end' : cx < 40 ? 'start' : 'middle';
    return (
      <SvgText
        x={beside ? cx - 9 : cx}
        y={beside ? cy + 4 : kind === 'high' ? cy - 10 : cy + 16}
        textAnchor={anchor}
        fontSize={11}
        fontWeight="700"
        fill={kind === 'low' ? theme.color.primary : theme.color.textPrimary}>
        {kind === 'low'
          ? `low ${formatCompactRupees(mark.total)}`
          : formatCompactRupees(mark.total)}
      </SvgText>
    );
  };

  // Kept inside the card whichever column is under the finger, so the figure
  // at the far left or right is not clipped by the card edge.
  const tooltipLeft =
    active === null
      ? 0
      : Math.min(Math.max(0, x(active) - TOOLTIP_WIDTH / 2), Math.max(0, width - TOOLTIP_WIDTH));

  return (
    <View>
      <View
        style={styles.canvas}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}>
        {/* Sits under the drawing and above nothing, so a tap anywhere on
            the plot picks the nearest column. A sideways drag starting here
            is taken off it by the capture handler above. */}
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Spending chart. Drag across to read each period."
          style={StyleSheet.absoluteFill}
          onPress={(event) => setActive(nearest(event.nativeEvent.locationX))}
        />
        {width > 0 ? (
          <Svg width={width} height={HEIGHT} pointerEvents="none">
            <Defs>
              <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={line} stopOpacity={0.20} />
                <Stop offset="1" stopColor={line} stopOpacity={0.07} />
              </LinearGradient>
            </Defs>

            {/* The plot's edges, not a scale: a floor for the fill to sit
                on and a ceiling so the tallest column has something to
                reach. Neither carries a number, so neither invites the
                line to be read off against a value. */}
            {[TOP, HEIGHT - BOTTOM].map((at) => (
              <Line
                key={at}
                x1={0}
                y1={at}
                x2={width}
                y2={at}
                stroke={theme.color.border}
                strokeWidth={1}
              />
            ))}

            <Path d={area} fill="url(#fill)" />

            {median === null ? null : (
              <>
                <Line
                  x1={0}
                  y1={y(median)}
                  x2={width}
                  y2={y(median)}
                  stroke={theme.color.textMuted}
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                />
                {/* Named where the line starts, so the dashes are not a rule
                    the reader has to go to the legend to price. Dropped
                    below the line when it runs too near the top to sit
                    above it. */}
                <SvgText
                  x={usualIndent}
                  y={y(median) - 6 < TOP ? y(median) + 15 : y(median) - 6}
                  textAnchor="start"
                  fontSize={10}
                  fontWeight="600"
                  fill={theme.color.textSecondary}>
                  {`usual ${formatCompactRupees(median)}`}
                </SvgText>
              </>
            )}

            <Path
              d={path}
              fill="none"
              stroke={line}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Only the two ends of the line are marked. A dot on all seven
                columns crowds the shape, which is the thing the line is
                there to show; the invitation to touch it is in the line of
                help underneath instead. The low is hollow and the high is
                solid, so the two read apart at a glance without a label
                being needed to tell them apart. */}
            {marks.low === null || marks.low.index === lastIndex ? null : (
              <Circle
                cx={x(marks.low.index)}
                cy={y(marks.low.total)}
                r={4}
                fill={theme.color.surface}
                stroke={line}
                strokeWidth={2}
              />
            )}
            {marks.high === null || marks.high.index === lastIndex ? null : (
              <Circle
                cx={x(marks.high.index)}
                cy={y(marks.high.total)}
                r={4}
                fill={line}
              />
            )}

            {/* The period in progress: a solid dot for what has been spent,
                and a hollow one above it for where that rate ends up. */}
            {!showsPace ? null : (
              <>
                <Line
                  x1={x(lastIndex)}
                  y1={y(current.total)}
                  x2={x(lastIndex)}
                  y2={y(onPaceFor)}
                  stroke={theme.color.up}
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                />
                <Circle
                  cx={x(lastIndex)}
                  cy={y(onPaceFor)}
                  r={4}
                  fill={theme.color.surface}
                  stroke={theme.color.up}
                  strokeWidth={2}
                />
              </>
            )}

            <Circle cx={x(lastIndex)} cy={y(current.total)} r={4} fill={line} />

            {/* The two ends of the line, each carrying its own figure.
                These stay put while a finger is down. Clearing them for the
                readout meant the chart went blank of figures at the one
                moment someone was reading it; the readout is drawn over the
                top of them in any case, so it covers what it covers. */}
            {
              <>
                {marks.high === null ? null : markText(marks.high, 'high')}
                {marks.low === null ? null : markText(marks.low, 'low')}
                {/* The period in progress always says what it has reached.
                    It is the column the reader came for, and whether it
                    happens to be the highest of the seven is beside the
                    point — left to the marks alone it would be labelled on
                    the months it led and silent on the months it did not.
                    Skipped only when the high is already naming it. */}
                {marks.high !== null && marks.high.index === lastIndex
                  ? null
                  : markText({ index: lastIndex, total: current.total }, 'now')}
              </>
            }

            {active === null ? null : (
              <>
                <Line
                  x1={x(active)}
                  y1={TOP - 6}
                  x2={x(active)}
                  y2={HEIGHT - BOTTOM}
                  stroke={theme.color.textSecondary}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <Circle
                  cx={x(active)}
                  cy={y(points[active]!.total)}
                  r={7}
                  fill={line}
                  fillOpacity={0.18}
                />
                <Circle
                  cx={x(active)}
                  cy={y(points[active]!.total)}
                  r={4.5}
                  fill={line}
                  stroke={theme.color.surface}
                  strokeWidth={2}
                />
              </>
            )}
          </Svg>
        ) : null}

        {selected ? (
          <Pressable
            // A drag that starts on the readout is still a drag: the capture
            // handler on the parent takes it before this ever sees a press.
            disabled={!canOpen}
            onPress={() => onOpenPoint?.(selected, selectedLabel)}
            accessibilityRole={canOpen ? 'button' : undefined}
            accessibilityLabel={
              canOpen ? `See the payments in ${selectedLabel}` : undefined
            }
            style={({ pressed }) => [
              styles.tooltip,
              {
                left: tooltipLeft,
                backgroundColor: theme.color.selected,
                borderRadius: theme.radius.md,
                paddingVertical: theme.space(2),
                paddingHorizontal: theme.space(3),
                ...pressedDim(pressed),
              },
            ]}>
            <Text variant="caption" style={{ color: theme.color.onSelected, opacity: 0.75 }}>
              {readoutLabel(selected, series.kind)}
              {selected.isCurrent ? ' · so far' : ''}
            </Text>
            <Text variant="bodyStrong" tabular style={{ color: theme.color.onSelected }}>
              {formatRupees(selected.total)}
            </Text>
            {canOpen ? (
              <Text
                variant="caption"
                style={{ color: theme.color.onSelected, marginTop: 2 }}>
                See payments ›
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.axis}>
        {points.map((point, index) => (
          <Text
            key={point.from}
            variant="caption"
            tone={index === active ? 'primary' : point.isCurrent ? 'secondary' : 'muted'}
            style={styles.axisLabel}
            numberOfLines={1}>
            {axisLabel(point, series.kind)}
          </Text>
        ))}
      </View>

      <View style={[styles.legend, { marginTop: theme.space(3) }]}>
        <Legend color={line} label="Spending" />
        {median === null ? null : (
          <Legend color={theme.color.textMuted} label="Usual" dashed />
        )}
        {!showsPace ? null : (
          <Legend color={theme.color.up} label={`On pace for ${formatRupees(onPaceFor!)}`} dotted />
        )}
      </View>

      <Text variant="caption" tone="muted" style={{ marginTop: theme.space(2) }}>
        {active === null
          ? 'Touch and drag across the chart to read any period'
          : canOpen
          ? 'Drag to move · tap the figure for its payments'
          : 'Drag to move · lift to keep'}
      </Text>
    </View>
  );
}

function Legend({
  color,
  label,
  dashed,
  dotted,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  dotted?: boolean;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={styles.legendMark}>
        <Svg width={18} height={3}>
          <Line
            x1={0}
            y1={1.5}
            x2={18}
            y2={1.5}
            stroke={color}
            strokeWidth={dotted ? 2 : 2.5}
            strokeDasharray={dashed ? '4 3' : dotted ? '2 2.5' : undefined}
          />
        </Svg>
      </View>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { height: HEIGHT, justifyContent: 'flex-start' },
  axis: { flexDirection: 'row', marginTop: 6 },
  // Each label owns an equal slice and centres in it, so the first and last
  // sit slightly inside the plot rather than hanging off its edges.
  axisLabel: { flex: 1, textAlign: 'center', fontSize: 10 },
  tooltip: { position: 'absolute', top: 0, width: TOOLTIP_WIDTH, gap: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendMark: { width: 18, height: 3, justifyContent: 'center' },
});

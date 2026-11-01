/**
 * Section 10.3, as the Home mockup draws it: a segmented switch between
 * category and payee, a note naming the largest slice, bubbles sized by
 * spending, and chips carrying the figures.
 *
 * The bubbles are the picture; the chips are the data. Area is hard to read
 * precisely and nobody should have to, so every slice also appears as a chip
 * with its percentage written out.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Slice } from '../../../core/analytics/breakdown';
import { formatRupees } from '../../../core/analytics/spending';
import { categoryColor, pressedDim, readableInk, useTheme, withAlpha } from '../../../design';
import { packCircles } from './bubblePack';
import { Text } from '../../../design/components';

export type Grouping = 'CATEGORY' | 'PAYEE';

/**
 * How many slices the card shows before it gathers the rest.
 *
 * Six is what fits across the width at a size the figures can still be read
 * at. Past that the picture stops being a picture — which is why the rest
 * are gathered rather than drawn, and why `All` exists to draw them anyway
 * for the one question the picture cannot answer: what is in the tail.
 */
const COLLAPSED = 6;

/**
 * The largest bubble, as a fraction of the row's width.
 *
 * The cluster is scaled to fill the width, so this is the cap that stops it
 * from doing that on a wide screen where three circles would otherwise be
 * drawn the size of a fist.
 */
const MAX_DIAMETER = 168;

/**
 * The smallest, as a fraction of the largest.
 *
 * A true-to-area circle for a 1% slice beside a 42% one is seven points
 * across, which is a dot. The floor binds only down there; everything the
 * eye can compare is drawn at its real size. `screens/Home.png` does the
 * same — its 4% bubble is not a sixth the width of its 35% one.
 */
const MIN_RATIO = 0.42;

/** The largest circle in the packer's own units. Only ratios matter. */
const NOMINAL = 100;

/**
 * The air between two bubbles, as a share of the largest one.
 *
 * Packed flush, the cluster reads as one shape with lines drawn on it
 * rather than as separate amounts — which is the opposite of the point,
 * since each circle is a different category. It is in the packer's units so
 * it scales with the cluster: a gap set in points would be a hairline on a
 * tablet and a canyon on a small phone.
 */
const GAP = 4;

/**
 * The diameter below which a name no longer fits beside the figure.
 *
 * `screens/Home.png` does this too: its two smallest bubbles carry `₹1,280`
 * and `₹860` and no name. It is not a loss — every slice also appears as a
 * chip underneath in the same colour with its name and share written out.
 * The bubbles are the picture and the chips are the data.
 */
const NAMED_FROM = 64;

/**
 * Roughly how wide a character is, as a fraction of the font size.
 *
 * An estimate, because measuring text properly means rendering it and
 * reading it back, which is two frames and a re-layout for a decision about
 * whether a word fits in a circle. 0.55 is about right for the mixed case of
 * a category name in the system face, and it is used only to decide between
 * showing a name and not — the cost of being a little wrong is a name that
 * shrinks slightly or one that is left off a circle it would have squeezed
 * into.
 */
const CHARACTER_WIDTH = 0.55;

/**
 * The side of the largest square that fits in a circle, over its diameter.
 *
 * Text is centred, so it occupies a box through the middle of the circle —
 * and the width available there is nowhere near the diameter. Measuring
 * against the diameter is what had `AUTO SPARES` hanging out of both sides
 * of its bubble.
 */
const INSCRIBED = 0.707;

/** Roughly how tall a line of text is, as a multiple of the font size. */
const LINE_HEIGHT = 1.3;

/** Below this many characters a row, a name is more ellipsis than name. */
const WORTH_NAMING = 5;

/**
 * The smallest the figure is allowed to be shrunk to.
 *
 * Below this it is no longer a number anyone reads, it is a smudge saying
 * there was one — at which point the bubble would be better off bare.
 */
const SMALLEST_FIGURE = 8;

export interface BubbleText {
  /** Horizontal inset that leaves the text the inscribed square. */
  pad: number;
  labelSize: number;
  amountSize: number;
  /** Rows of name the circle has room for, after the figure has had its. */
  rows: number;
  /** Whether to show the name at all. */
  named: boolean;
}

/**
 * What text a bubble of this diameter can hold.
 *
 * Worked out rather than guessed, because `adjustsFontSizeToFit` cannot be
 * relied on to do it: on Android it does not shrink text that is wrapping
 * over more than one line, so a name too wide for its circle was simply
 * drawn too wide for its circle. What the name does when it does not fit is
 * end in an ellipsis, which is a decision the layout has to make before
 * React Native is asked to draw anything.
 */
export function bubbleText(size: number, amount: string): BubbleText {
  const box = size * INSCRIBED;

  // Sized from the figure that is actually going in, not from a ladder of
  // diameters. `\u20b91,00,000` is nine characters and `\u20b9199` is four, and the
  // ladder had the long one overflowing the small circles while the short
  // one left half the width unused.
  const amountSize = Math.max(
    SMALLEST_FIGURE,
    Math.min(
      size >= 120 ? 16 : size >= 96 ? 14 : 12,
      box / Math.max(1, amount.length * CHARACTER_WIDTH),
    ),
  );
  const labelSize = size >= 120 ? 12 : size >= 92 ? 11 : 10;

  const rows = Math.max(
    0,
    Math.min(3, Math.floor((box - amountSize * LINE_HEIGHT) / (labelSize * LINE_HEIGHT))),
  );
  const perRow = Math.floor(box / (labelSize * CHARACTER_WIDTH));

  return {
    pad: (size - box) / 2,
    labelSize,
    amountSize,
    rows: Math.max(1, rows),
    named: size >= NAMED_FROM && rows >= 1 && perRow >= WORTH_NAMING,
  };
}

export interface Placed {
  slice: Slice;
  /** Diameter, in points. */
  size: number;
  /** Top-left of the circle inside the cluster, in points. */
  left: number;
  top: number;
  /** 0 for the smallest slice shown, 1 for the largest. */
  weight: number;
}

/**
 * Where every bubble goes, and how big.
 *
 * Two steps, kept apart because they answer different questions. The radii
 * come from the money: a circle of twice the diameter covers four times the
 * area, so the diameter follows the square root of the share and the area
 * the eye reads matches what was spent. The positions come from
 * `packCircles`, which knows nothing about money and only has to make the
 * circles touch without overlapping.
 *
 * The cluster is then scaled as a whole to fill the width it has been given,
 * which is why the radii above are in nominal units: only their ratios
 * matter, and the one measurement that has to be in points is the result.
 */
export function place(
  slices: Slice[],
  available: number,
): { placed: Placed[]; height: number } {
  // Measured rather than taken from the ends of the array.
  //
  // The caller appends the gathered `N more` slice after the ones it is
  // standing in for, so the list arrives nearly sorted but not quite — and
  // `N more` is routinely not the smallest. Reading the last entry as the
  // smallest made `span` a sliver, every slice under the gathered one came
  // out with a negative weight, and a negative weight clamps the fill to
  // transparent: the circles vanished and left their labels floating in
  // the card.
  const totals = slices.map((slice) => slice.total);
  const largest = totals.length === 0 ? 0 : Math.max(...totals);
  if (largest === 0 || available === 0) {
    return { placed: [], height: 0 };
  }

  const ratio = (slice: Slice) =>
    Math.max(MIN_RATIO, Math.sqrt(slice.total / largest));

  // Biggest first, which is what `packCircles` wants: a small circle placed
  // early is stranded in the middle of the cluster where the big one goes.
  const ordered = [...slices].sort((a, b) => b.total - a.total);

  const pack = packCircles(ordered, (slice) => (NOMINAL * ratio(slice)) / 2, GAP);
  if (pack.width === 0) {
    return { placed: [], height: 0 };
  }

  const scale = Math.min(available / pack.width, MAX_DIAMETER / NOMINAL);
  // Centred when the cluster does not use the full width, which happens once
  // the cap above bites.
  const inset = (available - pack.width * scale) / 2;

  const smallest = Math.min(...ordered.map(ratio));
  const span = 1 - smallest;

  return {
    placed: pack.circles.map((circle) => ({
      slice: circle.item,
      size: circle.r * 2 * scale,
      left: (circle.x - circle.r) * scale + inset,
      top: (circle.y - circle.r) * scale,
      // Used for how heavily the circle is filled. Spread across the range
      // actually present rather than against an absolute, so a month whose
      // slices are all close still shows a gradient rather than six circles
      // of one weight.
      weight: span === 0 ? 1 : (ratio(circle.item) - smallest) / span,
    })),
    height: pack.height * scale,
  };
}

export function WhereMoneyWent({
  periodLabel,
  total,
  slices,
  grouping,
  onChangeGrouping,
  note,
  onSelect,
}: {
  periodLabel: string;
  total: number;
  slices: Slice[];
  grouping: Grouping;
  onChangeGrouping: (next: Grouping) => void;
  note: string | null;
  /** Opens the payments behind one slice. */
  onSelect?: (slice: Slice) => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Six bubbles is what fits before they stop being readable, so that is
  // where the card rests; everything past it is gathered into one slice so
  // the chips still account for the whole total. Opened out, every slice is
  // drawn — the card grows as tall as it needs to, which is the whole point
  // of the control: the gathered slice was the one figure on this page that
  // could not be broken down from this page.
  const shown = expanded ? slices : slices.slice(0, COLLAPSED);
  const rest = expanded ? [] : slices.slice(COLLAPSED);
  const others: Slice | null =
    rest.length === 0
      ? null
      : {
          key: 'others',
          label: `${rest.length} more`,
          color: 'grey',
          icon: null,
          total: rest.reduce((sum, slice) => sum + slice.total, 0),
          share: rest.reduce((sum, slice) => sum + slice.share, 0),
          // What it stands for, so the slice knows it is the gathered one
          // and can open the rest out rather than being a bubble that does
          // nothing.
          members: rest,
        };

  const all = others ? [...shown, others] : shown;
  const { placed, height } = place(all, width);

  // Nothing to open out when everything already fits, and nothing to close
  // back up when it was never opened.
  const expandable = expanded || slices.length > COLLAPSED;

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="heading">Where your money went</Text>
          <Text variant="caption" tone="secondary" style={{ marginTop: theme.space(1) }}>
            {periodLabel} · {formatRupees(total)}
          </Text>
        </View>
        {expandable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={
              expanded
                ? 'Show the largest slices only'
                : `Show all ${slices.length} slices`
            }
            onPress={() => setExpanded((open) => !open)}
            hitSlop={8}
            style={({ pressed }) => pressedDim(pressed)}>
            <Text variant="label" tone="accent">
              {expanded ? 'Less' : 'All'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View
        style={[
          styles.segments,
          {
            backgroundColor: theme.color.surfaceMuted,
            borderRadius: theme.radius.md,
            marginTop: theme.space(4),
          },
        ]}>
        {(
          [
            ['CATEGORY', 'By category'],
            ['PAYEE', 'By UPI ID'],
          ] as Array<[Grouping, string]>
        ).map(([value, label]) => {
          const active = grouping === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChangeGrouping(value)}
              style={({ pressed }) => [
                styles.segment,
                pressedDim(pressed),
                {
                  borderRadius: theme.radius.sm,
                  backgroundColor: active ? theme.color.surface : 'transparent',
                },
              ]}>
              <Text variant="label" tone={active ? 'primary' : 'secondary'}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {note ? (
        <View
          style={[
            styles.note,
            {
              backgroundColor: theme.color.dangerSoft,
              borderRadius: theme.radius.md,
              padding: theme.space(3),
              marginTop: theme.space(4),
            },
          ]}>
          <View
            style={[
              styles.noteDot,
              { backgroundColor: categoryColor(theme, all[0]?.color ?? 'grey').solid },
            ]}
          />
          <View style={styles.noteBody}>
            <Text variant="label" tone="danger">
              {note}
            </Text>
            <Text variant="caption" tone="secondary">
              {grouping === 'CATEGORY' ? 'Category' : 'Payee'} with the most spending
            </Text>
          </View>
        </View>
      ) : null}

      {all.length === 0 ? (
        <Text
          variant="body"
          tone="secondary"
          style={[styles.empty, { marginTop: theme.space(6) }]}>
          Nothing spent in this period yet.
        </Text>
      ) : null}

      {/* Absolutely positioned, because the arrangement is a cluster
          rather than a line. `place` has already worked out where every
          circle goes inside a box this tall. */}
      <View
        style={[styles.bubbles, { marginTop: theme.space(4), height }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {placed.map(({ slice, size, left, top, weight }) => {
          const palette = categoryColor(theme, slice.color);
          // How heavily the circle is painted, following `screens/Home.png`:
          // the biggest slice is the full colour and the small ones fade
          // back towards the card. Size is the measurement; this is what
          // makes the order readable at a glance before you read anything.
          const fill = 0.28 + 0.72 * weight;
          const ink = readableInk(theme, palette.solid, fill);
          const amount = formatRupees(slice.total);
          const { pad, labelSize, amountSize, rows, named } = bubbleText(
            size,
            amount,
          );
          // A slice standing for itself opens the payments behind it. The
          // gathered one cannot — the payments behind it belong to several
          // different categories, and a list mixing them answers nothing —
          // so it opens itself out instead, and the slices it was hiding
          // then open their own payments like any other.
          const gathered = slice.members !== undefined;
          const openable = gathered || Boolean(onSelect);
          return (
            <Pressable
              key={slice.key}
              accessibilityRole={openable ? 'button' : undefined}
              accessibilityLabel={`${slice.label}, ${formatRupees(slice.total)}, ${Math.round(
                slice.share * 100,
              )} percent`}
              accessibilityHint={
                gathered ? 'Shows every slice' : 'Opens these payments'
              }
              disabled={!openable}
              onPress={
                gathered ? () => setExpanded(true) : () => onSelect?.(slice)
              }
              style={({ pressed }) => [
                styles.bubble,
                {
                  left,
                  top,
                  width: size,
                  height: size,
                  paddingHorizontal: pad,
                  borderRadius: size / 2,
                  // The last word on where the text may go. The sums above
                  // are estimates of how wide a character is, and an
                  // estimate that comes out slightly short should clip
                  // rather than paint over the card.
                  overflow: 'hidden',
                  backgroundColor: withAlpha(palette.solid, fill),
                  // No ring. The fill is strong enough to draw its own edge,
                  // and an outline on top of it read as a sticker.
                  ...pressedDim(pressed),
                },
              ]}>
              {named ? (
                <Text
                  variant="caption"
                  numberOfLines={rows}
                  // Cut with an ellipsis rather than shrunk. Android does
                  // not shrink wrapped text to fit, whatever it is asked,
                  // which is how `STGEORGE AUTO SPARES` came to be drawn
                  // across the edges of its own circle.
                  ellipsizeMode="tail"
                  style={[
                    styles.bubbleLabel,
                    { color: ink, fontSize: labelSize },
                  ]}>
                  {slice.label}
                </Text>
              ) : null}
              <Text
                variant="label"
                tabular
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[
                  styles.bubbleLabel,
                  { color: ink, fontSize: amountSize },
                ]}>
                {amount}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.chips, { marginTop: theme.space(4) }]}>
        {all.map((slice) => {
          const { key, label, color, share } = slice;
          const palette = categoryColor(theme, color);
          const gathered = slice.members !== undefined;
          const openable = gathered || Boolean(onSelect);
          return (
            <Pressable
              key={key}
              accessibilityRole={openable ? 'button' : undefined}
              accessibilityHint={
                gathered ? 'Shows every slice' : 'Opens these payments'
              }
              disabled={!openable}
              onPress={
                gathered ? () => setExpanded(true) : () => onSelect?.(slice)
              }
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: palette.soft,
                  borderRadius: theme.radius.pill,
                  ...pressedDim(pressed),
                },
              ]}>
              <View style={[styles.chipDot, { backgroundColor: palette.solid }]} />
              <Text variant="caption" numberOfLines={1} style={{ color: palette.onSoft }}>
                {label}
              </Text>
              <Text variant="caption" tabular style={{ color: palette.onSoft }}>
                {Math.round(share * 100)}%
              </Text>
            </Pressable>
          );
        })}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1 },
  segments: { flexDirection: 'row', padding: 4, gap: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noteDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  noteBody: { flex: 1, gap: 2 },
  // A canvas the cluster is laid out on, not a row that lays it out.
  bubbles: { position: 'relative' },
  empty: { textAlign: 'center' },
  bubble: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
    // The horizontal padding is set per bubble, from its diameter. Only the
    // vertical one is fixed, because the text block is centred and its
    // height does not scale the same way.
    paddingVertical: 8, gap: 2,
  },
  bubbleLabel: { textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
});

/**
 * Section 10.3's card, as a card rather than as a layout.
 *
 * `whereMoneyWent.test.ts` beside this one drives `place` and `bubbleText`,
 * which answer how big a bubble is. This one answers which bubbles there
 * are — the question the gathered `N more` slice used to settle on its own,
 * with no way to look inside it from this page.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Slice } from '../../../../core/analytics/breakdown';
import { WhereMoneyWent } from '../WhereMoneyWent';

(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function slice(label: string, total: number): Slice {
  return { key: label, label, color: 'green', icon: null, total, share: 0.1 };
}

/** Three past the six the card rests at, so something is gathered. */
const NINE = Array.from({ length: 9 }, (_, index) =>
  slice(`Payee ${index + 1}`, (9 - index) * 1_000_00),
);

/** Fewer than the six, so there is nothing to open out. */
const FOUR = NINE.slice(0, 4);

function render(
  slices: Slice[],
  onSelect: (slice: Slice) => void = () => undefined,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <WhereMoneyWent
        periodLabel="This month"
        total={slices.reduce((sum, entry) => sum + entry.total, 0)}
        slices={slices}
        grouping="CATEGORY"
        onChangeGrouping={() => undefined}
        note={null}
        onSelect={onSelect}
      />,
    );
  });
  // The cluster is laid out against a measured width, so without this the
  // card has a width of zero and draws no bubbles at all.
  act(() => {
    tree.root
      .findAll(
        (node) =>
          typeof node.type === 'string' && typeof node.props.onLayout === 'function',
      )[0]!
      .props.onLayout({ nativeEvent: { layout: { width: 340, height: 0 } } });
  });
  return tree;
}

/** Host elements only, so a Pressable is not counted twice over its View. */
function hosts(tree: ReactTestRenderer, match: (props: Record<string, unknown>) => boolean) {
  return tree.root.findAll(
    (node) => typeof node.type === 'string' && match(node.props),
  );
}

/** The bubbles, by the label the screen reader reads off each one. */
const bubbles = (tree: ReactTestRenderer) =>
  hosts(tree, (props) => String(props.accessibilityLabel ?? '').endsWith('percent'));

const labels = (tree: ReactTestRenderer) =>
  bubbles(tree).map((node) => String(node.props.accessibilityLabel).split(',')[0]);

/** The `All` / `Less` control in the header, or nothing when there is none. */
const toggle = (tree: ReactTestRenderer) =>
  hosts(tree, (props) =>
    /^Show (all \d+ slices|the largest slices only)$/.test(
      String(props.accessibilityLabel ?? ''),
    ),
  )[0] ?? null;

const press = (node: { props: Record<string, any> }) =>
  act(() => {
    node.props.onClick ? node.props.onClick() : node.props.onPress();
  });

describe('the slices the card shows', () => {
  it('rests at six and gathers the rest, so the total still adds up', () => {
    const tree = render(NINE);
    // Sorted, because the bubbles come back in the order they were packed —
    // biggest first — and the gathered slice is routinely not the last of
    // them. Here it is the sum of three, which outweighs two it follows.
    expect(labels(tree).sort()).toEqual(
      [
        'Payee 1', 'Payee 2', 'Payee 3', 'Payee 4', 'Payee 5', 'Payee 6',
        '3 more',
      ].sort(),
    );
  });

  it('draws every slice once it is opened out', () => {
    const tree = render(NINE);
    press(toggle(tree)!);

    expect(labels(tree)).toHaveLength(9);
    // The whole point: nothing is standing in for anything any more.
    expect(labels(tree)).not.toContain('3 more');
    expect(labels(tree)).toContain('Payee 9');
  });

  it('closes back up again', () => {
    const tree = render(NINE);
    press(toggle(tree)!);
    press(toggle(tree)!);
    expect(labels(tree)).toContain('3 more');
    expect(labels(tree)).toHaveLength(7);
  });

  it('opens out when the gathered bubble itself is tapped', () => {
    // Which is where the user looks first: `3 more` is the thing on screen
    // that says something is missing.
    const tree = render(NINE);
    const gathered = bubbles(tree).find((node) =>
      String(node.props.accessibilityLabel).startsWith('3 more'),
    )!;
    expect(gathered.props.accessibilityRole).toBe('button');

    press(gathered);
    expect(labels(tree)).toHaveLength(9);
  });

  it('offers nothing to open when everything already fits', () => {
    const tree = render(FOUR);
    expect(toggle(tree)).toBeNull();
    expect(labels(tree)).toHaveLength(4);
  });

  it('opens the payments behind a slice standing for itself', () => {
    const opened: string[] = [];
    const tree = render(NINE, (slice) => opened.push(slice.label));

    const payee2 = bubbles(tree).find((node) =>
      String(node.props.accessibilityLabel).startsWith('Payee 2'),
    )!;
    press(payee2);

    expect(opened).toEqual(['Payee 2']);
  });

  it('opens them from the chip as well as the bubble', () => {
    // The chips are the data and are what a small bubble sends you to, so a
    // chip that did not open its payments would be the half of the card
    // that quietly does nothing.
    const opened: string[] = [];
    const tree = render(NINE, (slice) => opened.push(slice.label));

    const chip = hosts(
      tree,
      (props) => props.accessibilityHint === 'Opens these payments',
    ).at(-1)!;
    press(chip);

    expect(opened).toHaveLength(1);
  });

  it('opens the gathered slice out rather than listing what is under it', () => {
    // The payments behind `3 more` belong to three different categories, so
    // a list mixing them answers nothing. It opens out, and the slices it
    // was hiding then open their own payments like any other.
    const opened: string[] = [];
    const tree = render(NINE, (slice) => opened.push(slice.label));

    const gathered = bubbles(tree).find((node) =>
      String(node.props.accessibilityLabel).startsWith('3 more'),
    )!;
    press(gathered);

    expect(opened).toEqual([]);
    expect(labels(tree)).toHaveLength(9);

    // And now the one that was hidden opens its own payments.
    press(
      bubbles(tree).find((node) =>
        String(node.props.accessibilityLabel).startsWith('Payee 9'),
      )!,
    );
    expect(opened).toEqual(['Payee 9']);
  });
});

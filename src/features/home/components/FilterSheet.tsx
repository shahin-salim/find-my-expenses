/**
 * The Home filter sheet.
 *
 * Section 8.2 is what makes the choice meaningful: categories carry
 * `is_fixed_cost`, and "Rent, bills and SIPs recur at a size that drowns out
 * everyday spending." Hiding them is the difference between a chart about
 * habits and a chart about the first of the month.
 */

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { formatRupees, type SpendingView } from '../../../core/analytics/spending';
import { pressedDim, useTheme } from '../../../design';
import { Button, Text } from '../../../design/components';

/**
 * Two nested views, widest last. The second adds back what the first leaves
 * out, so moving down the list can only make a figure larger.
 *
 * There were three. The middle one showed everyday spending plus the rent
 * and bills, and it went when a fixed cost stopped being counted as spending
 * at all — it had become the first view under a second name.
 */
const OPTIONS: Array<{ value: SpendingView; title: string; detail: string }> = [
  {
    value: 'EVERYDAY',
    title: 'Everyday spending',
    detail: 'What you chose to spend — rent, bills and SIPs left out',
  },
  {
    value: 'EVERYTHING',
    title: 'Everything that left',
    detail: 'Adds the rent and bills back, with investments and lending',
  },
];

export function FilterSheet({
  visible,
  view,
  fixedCostTotal,
  periodPhrase,
  movedMoneyTotal,
  onApply,
  onClose,
}: {
  visible: boolean;
  view: SpendingView;
  /** What "Everyday spending" would hide in the selected period. */
  fixedCostTotal: number;
  /** That period, written to sit inside a sentence. */
  periodPhrase: string;
  /** What "Everything that left" would add back in the selected period. */
  movedMoneyTotal: number;
  onApply: (next: SpendingView) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  // Held locally so backing out of the sheet leaves Home as it was.
  const [draft, setDraft] = useState<SpendingView>(view);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={() => setDraft(view)}
      onRequestClose={onClose}>
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
          <Text variant="heading">Show on Home</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDraft('EVERYDAY')}
            hitSlop={8}
            style={({ pressed }) => pressedDim(pressed)}>
            <Text variant="label" tone="accent">
              Reset
            </Text>
          </Pressable>
        </View>

        {OPTIONS.map((option) => {
          const active = draft === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setDraft(option.value)}
              style={({ pressed }) => [
                styles.option,
                pressedDim(pressed),
                {
                  borderRadius: theme.radius.lg,
                  borderWidth: 1.5,
                  borderColor: active ? theme.color.primary : theme.color.border,
                  backgroundColor: active ? theme.category.green.soft : 'transparent',
                  padding: theme.space(4),
                  marginTop: theme.space(3),
                },
              ]}>
              <View
                style={[
                  styles.radio,
                  { borderColor: active ? theme.color.primary : theme.color.borderStrong },
                ]}>
                {active ? (
                  <View style={[styles.radioDot, { backgroundColor: theme.color.primary }]} />
                ) : null}
              </View>
              <View style={styles.optionBody}>
                <Text variant="bodyStrong">{option.title}</Text>
                <Text variant="caption" tone="secondary">
                  {option.detail}
                </Text>
                {/* Said for both outcomes. Offering a filter without saying
                    that it would change nothing is how it comes to look
                    broken: rent and bills land once a month, so on a given
                    day there is usually nothing for it to hide. */}
                {option.value === 'EVERYDAY' ? (
                  <Text variant="caption" tone={fixedCostTotal > 0 ? 'accent' : 'muted'}>
                    {fixedCostTotal > 0
                      ? `Hides ${formatRupees(fixedCostTotal)} ${periodPhrase}`
                      : `Nothing to hide ${periodPhrase}`}
                  </Text>
                ) : null}
                {/* Everything the view above leaves out, which is both
                    flags now: the rent and bills as well as the money that
                    only moved. Naming one of them would under-report what
                    the tap is about to do to the figure. */}
                {option.value === 'EVERYTHING' ? (
                  <Text
                    variant="caption"
                    tone={fixedCostTotal + movedMoneyTotal > 0 ? 'accent' : 'muted'}>
                    {fixedCostTotal + movedMoneyTotal > 0
                      ? `Adds ${formatRupees(fixedCostTotal + movedMoneyTotal)} ${periodPhrase}`
                      : `Nothing to add ${periodPhrase}`}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}

        <Button
          label={
            draft === 'EVERYDAY' ? 'Show everyday spending' : 'Show everything'
          }
          onPress={() => onApply(draft)}
          style={{ marginTop: theme.space(5) }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 34 },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  optionBody: { flex: 1, gap: 2 },
});

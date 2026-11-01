/**
 * Section 12.5's "Record repayment".
 * `screens/Lending · record repayment (part)@1x.png` and `(full)`.
 *
 * The consequence is stated before it is taken — either what will still be
 * left, or that this closes the lend — because the two outcomes look
 * identical until the money is saved and the second one cannot be undone by
 * typing a smaller number afterwards.
 */

import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { formatRupees } from '../../../core/analytics/spending';
import type { LendRow } from '../../../core/lending/lends';
import { useTheme, withAlpha } from '../../../design';
import { Button, Icon, Text } from '../../../design/components';

/** Rupees as typed, to paise — the same reading the payment form does. */
function toPaise(typed: string): number {
  const cleaned = typed.replace(/[^\d.]/g, '');
  if (cleaned.length === 0) return 0;
  const [whole, fraction = ''] = cleaned.split('.');
  const paise = (fraction + '00').slice(0, 2);
  return parseInt(whole || '0', 10) * 100 + parseInt(paise, 10);
}

function fromPaise(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export function RecordRepaymentSheet({
  lend,
  visible,
  onClose,
  onSave,
}: {
  lend: LendRow;
  visible: boolean;
  onClose: () => void;
  onSave: (paise: number) => void;
}) {
  const theme = useTheme();
  // Opens on the whole of what is left, which is what is usually handed back
  // and saves the common case any typing at all.
  const [typed, setTyped] = useState(() => fromPaise(lend.left));

  const amount = toPaise(typed);
  // Clamped rather than refused: the lend cannot take more than it is owed,
  // and a figure typed past that is a slip, not an instruction.
  const capped = Math.min(amount, lend.left);
  const remaining = Math.max(0, lend.left - capped);
  const closes = capped > 0 && remaining === 0;
  const valid = capped > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[styles.backdrop, { backgroundColor: theme.color.overlay }]}
        onPress={onClose}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.lift}
        pointerEvents="box-none">
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.color.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              padding: theme.space(5),
              gap: theme.space(3),
            },
          ]}>
          <View style={[styles.grip, { backgroundColor: theme.color.borderStrong }]} />

          <Text variant="heading">{lend.person} paid you back</Text>
          <Text variant="caption" tone="secondary">
            {lend.note ? `${lend.note} · ` : ''}
            {formatRupees(lend.left)} left
          </Text>

          <Text variant="label" tone="secondary" style={{ marginTop: theme.space(2) }}>
            Amount received in cash
          </Text>
          <View
            style={[
              styles.field,
              {
                borderColor: theme.color.primary,
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.space(4),
              },
            ]}>
            <Text variant="subheading" tone="muted">
              ₹
            </Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel="Amount received"
              placeholder="0"
              placeholderTextColor={theme.color.textMuted}
              style={[styles.input, { color: theme.color.textPrimary }]}
            />
          </View>

          {valid ? (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: closes
                    ? withAlpha(theme.color.primary, 0.12)
                    : theme.color.surfaceMuted,
                  borderRadius: theme.radius.md,
                  padding: theme.space(3),
                },
              ]}>
              {closes ? <Icon name="check" size={16} color={theme.color.primary} /> : null}
              <Text variant="caption" tone={closes ? 'accent' : 'secondary'} style={styles.flex}>
                {closes
                  ? "Matches what's left. This lend will close."
                  : `${formatRupees(remaining)} will still be left to get back.`}
              </Text>
            </View>
          ) : null}

          <Text variant="caption" tone="muted">
            Saved as a cash transaction: +{formatRupees(capped)} from {lend.person}, tagged
            as a repayment.
          </Text>

          <Button
            label={closes ? 'Save and close lend' : 'Save repayment'}
            disabled={!valid}
            onPress={() => onSave(capped)}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  lift: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: { paddingBottom: 34 },
  grip: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, paddingVertical: 10 },
  input: { flex: 1, fontSize: 28, fontWeight: '800', padding: 0 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});

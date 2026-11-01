/**
 * Section 12.5's "New lend · cash" and section 12.7's "Edit lend".
 * `screens/Lending · new cash lend@1x.png`, `screens/Lending · edit lend@1x.png`.
 *
 * One screen for both, the way the payment form does it: an edit is the
 * create form with the row already in it.
 *
 * New lends are cash only, and the screen says so rather than leaving the
 * user to find out. A UPI lend already exists in the app as a payment; typing
 * it in again would leave a second row that section 3's deduplication cannot
 * catch, because a manual entry is deliberately given a fresh key every time.
 */

import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatRupees } from '../../core/analytics/spending';
import { findLend } from '../../core/lending/lends';
import {
  createCashLend,
  updateLend,
  validateCashLend,
  type CashLend,
} from '../../core/lending/repayments';
import { pressedFill, useTheme, withAlpha } from '../../design';
import { Button, DatePickerSheet, Icon, Text } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';

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

function FieldLabel({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Text variant="label" tone="secondary" style={{ marginTop: theme.space(5) }}>
      {children}
    </Text>
  );
}

export function CashLendScreen({ navigation, route }: ScreenProps<'CashLend'>) {
  const theme = useTheme();
  const { db } = useApp();
  const editingId = route.params?.id;

  const existing = useMemo(
    () => (editingId ? findLend(db, editingId) : null),
    [db, editingId],
  );
  // Section 12.7: the payee on a lend that came from a bank message is parse
  // evidence, and rewriting it here would move the payment to another payee.
  const payeeLocked = existing !== null && existing.source === 'SMS';

  const [person, setPerson] = useState(existing?.person ?? '');
  const [amount, setAmount] = useState(existing ? fromPaise(existing.amount) : '');
  const [occurredAt, setOccurredAt] = useState(existing?.occurred_at ?? Date.now());
  const [note, setNote] = useState(existing?.note ?? '');
  const [touched, setTouched] = useState(false);
  const [pickingDate, setPickingDate] = useState(false);

  const entry: CashLend = {
    person,
    amount: toPaise(amount),
    occurredAt,
    note: note.trim().length === 0 ? null : note.trim(),
  };
  const validation = validateCashLend(entry, Date.now());
  const errors = touched ? validation : {};
  const canSave = Object.keys(validation).length === 0;

  const save = () => {
    setTouched(true);
    if (!canSave) {
      return;
    }
    if (editingId) {
      updateLend(db, editingId, entry);
    } else {
      // Section 12.4's forward match is part of creating the lend and runs
      // inside the same transaction, so there is nothing to do here.
      createCashLend(db, entry);
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={['top']}>
      <View style={[styles.bar, { paddingHorizontal: theme.space(4) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.barButton,
            { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
            pressedFill(theme, pressed),
          ]}>
          <Icon name="close" size={18} color={theme.color.textPrimary} />
        </Pressable>
        <Text variant="subheading">{editingId ? 'Edit lend' : 'New lend · cash'}</Text>
        <View style={styles.barButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.space(4),
            paddingBottom: theme.space(8),
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {editingId ? (
            existing ? (
              <View
                style={[
                  styles.banner,
                  {
                    backgroundColor: theme.color.surface,
                    borderRadius: theme.radius.lg,
                    padding: theme.space(4),
                    marginTop: theme.space(2),
                  },
                ]}>
                <View style={styles.flex}>
                  <Text variant="bodyStrong">
                    {existing.source === 'SMS' ? 'From a payment' : 'Added by hand'} · −
                    {formatRupees(existing.amount)}
                  </Text>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {new Date(existing.occurred_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                    {existing.merchant_upi_id ? ` · UPI to ${existing.merchant_upi_id}` : ''}
                  </Text>
                </View>
              </View>
            ) : null
          ) : (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: withAlpha(theme.color.primary, 0.1),
                  borderRadius: theme.radius.lg,
                  padding: theme.space(4),
                  marginTop: theme.space(2),
                },
              ]}>
              <Icon name="alert" size={16} color={theme.color.primary} />
              <Text variant="caption" tone="accent" style={styles.flex}>
                For cash only. UPI lends come from your payments: open the payment and
                set its category to Lend.
              </Text>
            </View>
          )}

          <FieldLabel>{editingId ? 'Lent to' : 'Lent to'}</FieldLabel>
          <TextInput
            value={person}
            onChangeText={setPerson}
            onBlur={() => setTouched(true)}
            editable={!payeeLocked}
            placeholder="Who you lent it to"
            placeholderTextColor={theme.color.textMuted}
            style={[
              styles.input,
              {
                marginTop: theme.space(2),
                color: payeeLocked ? theme.color.textSecondary : theme.color.textPrimary,
                backgroundColor: payeeLocked ? theme.color.surfaceMuted : theme.color.surface,
                borderColor: errors.person ? theme.color.danger : theme.color.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          />
          {payeeLocked ? (
            <Text variant="caption" tone="muted" style={{ marginTop: theme.space(2) }}>
              This lend came from a bank message, so who it was paid to is kept as the
              message wrote it.
            </Text>
          ) : null}
          {errors.person ? (
            <Text variant="caption" tone="danger" style={{ marginTop: theme.space(2) }}>
              {errors.person}
            </Text>
          ) : null}

          <FieldLabel>{editingId ? 'Amount lent' : 'Amount'}</FieldLabel>
          <View
            style={[
              styles.amountField,
              {
                marginTop: theme.space(2),
                backgroundColor: theme.color.surface,
                borderColor: errors.amount ? theme.color.danger : theme.color.border,
                borderRadius: theme.radius.lg,
              },
            ]}>
            <Text variant="subheading" tone="muted">
              ₹
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              onBlur={() => setTouched(true)}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={theme.color.textMuted}
              accessibilityLabel="Amount lent"
              style={[styles.amountInput, { color: theme.color.textPrimary }]}
            />
          </View>
          {errors.amount ? (
            <Text variant="caption" tone="danger" style={{ marginTop: theme.space(2) }}>
              {errors.amount}
            </Text>
          ) : null}

          <FieldLabel>Date</FieldLabel>
          {/* A grid rather than a day stepper. A lend is often remembered
              days or weeks after it was made, and stepping to it one tap at
              a time is the complaint the range picker already answers for
              the Transactions filter. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Date: ${new Date(occurredAt).toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}. Pick another`}
            onPress={() => setPickingDate(true)}
            style={({ pressed }) => [
              styles.dateField,
              {
                marginTop: theme.space(2),
                backgroundColor: theme.color.surface,
                borderColor: errors.occurredAt ? theme.color.danger : theme.color.border,
                borderRadius: theme.radius.lg,
              },
              pressedFill(theme, pressed),
            ]}>
            <Text variant="bodyStrong" tabular>
              {new Date(occurredAt).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
            <Icon name="calendar" size={18} color={theme.color.textSecondary} />
          </Pressable>
          {errors.occurredAt ? (
            <Text variant="caption" tone="danger" style={{ marginTop: theme.space(2) }}>
              {errors.occurredAt}
            </Text>
          ) : null}

          <FieldLabel>What for{editingId ? '' : ' (optional)'}</FieldLabel>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Dinner, trip advance…"
            placeholderTextColor={theme.color.textMuted}
            style={[
              styles.input,
              {
                marginTop: theme.space(2),
                color: theme.color.textPrimary,
                backgroundColor: theme.color.surface,
                borderColor: theme.color.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          />

          <Text variant="caption" tone="secondary" style={{ marginTop: theme.space(4) }}>
            {editingId
              ? "Changing the amount updates what's left. Repayments already received stay as they are."
              : `Saved as a cash transaction: −${formatRupees(
                  toPaise(amount),
                )} to ${person.trim() || 'them'}, tagged Lend. It won't count as spending.`}
          </Text>

          <Button
            label={editingId ? 'Save changes' : 'Save lend'}
            onPress={save}
            style={{ marginTop: theme.space(5) }}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <DatePickerSheet
        visible={pickingDate}
        value={occurredAt}
        title={editingId ? 'Date lent' : 'When did you lend it?'}
        onClose={() => setPickingDate(false)}
        onPick={setOccurredAt}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15 },
  amountField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8,
  },
  amountInput: { flex: 1, fontSize: 24, fontWeight: '700', padding: 0 },
  dateField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, paddingHorizontal: 16, paddingVertical: 15,
  },
});

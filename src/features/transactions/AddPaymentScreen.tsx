/**
 * Adding a payment by hand, and editing one that was added that way.
 *
 * Manual entry, sections 8.1 and 8.3. The same screen does both: the fields
 * are identical and an edit is the create form with the row already in it.
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
import { listAccounts } from '../../core/db/dao/accounts';
import { listCategories } from '../../core/db/dao/categories';
import {
  canSave,
  createManualTransaction,
  getTransactionDetail,
  updateManualTransaction,
  validate,
  type ManualEntry,
} from '../../core/transactions/manual';
import { categoryColor, pressedDim, pressedFill, useTheme } from '../../design';
import { accountChipLabel } from '../../design/accountLabel';
import { Button, Icon, Text } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';

/** Rupees as typed, to paise. `149` is ₹149, `149.50` is ₹149.50. */
function toPaise(typed: string): number {
  const cleaned = typed.replace(/[^\d.]/g, '');
  if (cleaned.length === 0) {
    return 0;
  }
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

export function AddPaymentScreen({ navigation, route }: ScreenProps<'AddPayment'>) {
  const theme = useTheme();
  const { db } = useApp();
  const editingId = route.params?.id;

  const categories = useMemo(() => listCategories(db), [db]);
  const accounts = useMemo(() => listAccounts(db), [db]);
  const existing = useMemo(
    () => (editingId ? getTransactionDetail(db, editingId) : null),
    [db, editingId],
  );

  const [type, setType] = useState<'DEBIT' | 'CREDIT'>(
    existing?.transaction_type ?? 'DEBIT',
  );
  const [amount, setAmount] = useState(existing ? fromPaise(existing.amount) : '');
  const [payee, setPayee] = useState(
    existing?.merchant_name ?? existing?.recipient_name ?? '',
  );
  const [upiId, setUpiId] = useState(existing?.merchant_upi_id ?? '');
  const [categoryId, setCategoryId] = useState<number | null>(
    existing?.category_id ?? null,
  );
  const [accountId, setAccountId] = useState<number | null>(
    existing?.account_id ?? accounts.find((a) => a.account_type === 'CASH')?.id ?? null,
  );
  const [occurredAt, setOccurredAt] = useState(existing?.occurred_at ?? Date.now());
  const [note, setNote] = useState(existing?.note ?? '');
  const [touched, setTouched] = useState(false);

  const entry: ManualEntry = {
    amount: toPaise(amount),
    transactionType: type,
    recipientName: payee,
    upiId: upiId.trim().length === 0 ? null : upiId.trim(),
    categoryId,
    accountId,
    occurredAt,
    note: note.trim().length === 0 ? null : note.trim(),
  };

  const validation = validate(entry, Date.now());
  const errors = touched ? validation.errors : {};

  const save = () => {
    setTouched(true);
    if (!canSave(validation)) {
      return;
    }
    if (editingId) {
      updateManualTransaction(db, editingId, entry);
    } else {
      createManualTransaction(db, entry);
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top']}>
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
        <Text variant="subheading">{editingId ? 'Edit payment' : 'Add payment'}</Text>
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
          <View
            style={[
              styles.segments,
              {
                backgroundColor: theme.color.surfaceMuted,
                borderRadius: theme.radius.lg,
                marginTop: theme.space(2),
              },
            ]}>
            {(
              [
                ['DEBIT', 'Money out'],
                ['CREDIT', 'Money in'],
              ] as Array<['DEBIT' | 'CREDIT', string]>
            ).map(([value, label]) => {
              const active = type === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setType(value)}
                  style={({ pressed }) => [
                    styles.segment,
                    {
                      borderRadius: theme.radius.md,
                      backgroundColor: active ? theme.color.surface : 'transparent',
                    },
                    pressedDim(pressed),
                  ]}>
                  <Text variant="bodyStrong" tone={active ? 'primary' : 'secondary'}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text variant="caption" tone="secondary" style={styles.amountLabel}>
            Amount
          </Text>
          <View style={styles.amountRow}>
            <Text variant="title" tone="muted">
              ₹
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              onBlur={() => setTouched(true)}
              placeholder="0"
              placeholderTextColor={theme.color.textMuted}
              keyboardType="decimal-pad"
              style={[styles.amountInput, { color: theme.color.textPrimary }]}
              autoFocus={!editingId}
            />
          </View>
          {errors.amount ? (
            <Text variant="caption" tone="danger" style={styles.center}>
              {errors.amount}
            </Text>
          ) : null}

          <FieldLabel>{type === 'DEBIT' ? 'Paid to' : 'Received from'}</FieldLabel>
          <TextInput
            value={payee}
            onChangeText={setPayee}
            onBlur={() => setTouched(true)}
            placeholder={type === 'DEBIT' ? 'Shop or person' : 'Who sent it'}
            placeholderTextColor={theme.color.textMuted}
            style={[
              styles.input,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                borderColor: errors.recipientName ? theme.color.danger : theme.color.border,
                color: theme.color.textPrimary,
                marginTop: theme.space(2),
              },
            ]}
          />
          {errors.recipientName ? (
            <Text variant="caption" tone="danger" style={{ marginTop: theme.space(1) }}>
              {errors.recipientName}
            </Text>
          ) : null}

          <FieldLabel>UPI ID (optional)</FieldLabel>
          <TextInput
            value={upiId}
            onChangeText={setUpiId}
            placeholder="name@bank"
            placeholderTextColor={theme.color.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                borderColor: theme.color.border,
                color: theme.color.textPrimary,
                marginTop: theme.space(2),
              },
            ]}
          />

          <FieldLabel>Category</FieldLabel>
          <View style={[styles.chips, { marginTop: theme.space(2) }]}>
            {categories.map((category) => {
              const palette = categoryColor(theme, category.color);
              const active = categoryId === category.id;
              return (
                <Pressable
                  key={category.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  // Tapping the chosen one again clears it, which is how a
                  // payment goes back to taking the payee's category.
                  onPress={() => setCategoryId(active ? null : category.id)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      borderRadius: theme.radius.pill,
                      backgroundColor: active ? theme.color.selected : theme.color.surface,
                      borderColor: active ? theme.color.selected : theme.color.border,
                    },
                    pressedDim(pressed),
                  ]}>
                  <View style={[styles.dot, { backgroundColor: palette.solid }]} />
                  <Text
                    variant="label"
                    style={{
                      color: active ? theme.color.onSelected : theme.color.textPrimary,
                    }}>
                    {category.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <FieldLabel>When</FieldLabel>
          {/* No date picker is installed, and pulling a native one in for
              this would be a dependency and a rebuild. Stepping a day at a
              time reaches any past date, keeps the time of day while it
              moves, and needs nothing. */}
          <View style={[styles.stepper, { marginTop: theme.space(2) }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="A day earlier"
              onPress={() => setOccurredAt(shiftDays(occurredAt, -1))}
              style={({ pressed }) => [
                styles.stepButton,
                { borderColor: theme.color.border, borderRadius: theme.radius.md },
                pressedFill(theme, pressed),
              ]}>
              <Icon name="chevron-left" size={18} color={theme.color.textPrimary} />
            </Pressable>

            <View
              style={[
                styles.stepValue,
                {
                  backgroundColor: theme.color.surface,
                  borderRadius: theme.radius.lg,
                  borderColor: theme.color.border,
                },
              ]}>
              <Text variant="bodyStrong" tabular>
                {new Date(occurredAt).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </Text>
              <Text variant="caption" tone="secondary" tabular>
                {new Date(occurredAt).toLocaleTimeString('en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="A day later"
              // A payment cannot be dated after now, so the step that would
              // do it is unavailable rather than quietly refused on save.
              disabled={shiftDays(occurredAt, 1) > Date.now()}
              onPress={() => setOccurredAt(shiftDays(occurredAt, 1))}
              style={({ pressed }) => [
                styles.stepButton,
                {
                  borderColor: theme.color.border,
                  borderRadius: theme.radius.md,
                  opacity: shiftDays(occurredAt, 1) > Date.now() ? 0.35 : 1,
                },
                pressedFill(theme, pressed),
              ]}>
              <Icon name="chevron-right" size={18} color={theme.color.textPrimary} />
            </Pressable>
          </View>

          <View style={[styles.chips, { marginTop: theme.space(2) }]}>
            {[
              { label: 'Now', at: Date.now() },
              { label: 'Morning', at: atHour(occurredAt, 9) },
              { label: 'Afternoon', at: atHour(occurredAt, 14) },
              { label: 'Evening', at: atHour(occurredAt, 20) },
            ].map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                disabled={option.at > Date.now()}
                onPress={() => setOccurredAt(option.at)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.color.surface,
                    borderColor: theme.color.border,
                    opacity: option.at > Date.now() ? 0.35 : 1,
                  },
                  pressedFill(theme, pressed),
                ]}>
                <Text variant="label">{option.label}</Text>
              </Pressable>
            ))}
          </View>
          {errors.occurredAt ? (
            <Text variant="caption" tone="danger" style={{ marginTop: theme.space(1) }}>
              {errors.occurredAt}
            </Text>
          ) : null}

          <FieldLabel>{type === 'DEBIT' ? 'Paid from' : 'Received into'}</FieldLabel>
          <View style={[styles.chips, { marginTop: theme.space(2) }]}>
            {accounts.map((account) => {
              const active = accountId === account.id;
              return (
                <Pressable
                  key={account.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setAccountId(account.id)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      borderRadius: theme.radius.pill,
                      backgroundColor: active ? theme.color.selected : theme.color.surface,
                      borderColor: active ? theme.color.selected : theme.color.border,
                    },
                    pressedDim(pressed),
                  ]}>
                  <Text
                    variant="label"
                    style={{
                      color: active ? theme.color.onSelected : theme.color.textPrimary,
                    }}>
                    {accountChipLabel(account)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <FieldLabel>Note (optional)</FieldLabel>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What was it for?"
            placeholderTextColor={theme.color.textMuted}
            style={[
              styles.input,
              {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                borderColor: theme.color.border,
                color: theme.color.textPrimary,
                marginTop: theme.space(2),
              },
            ]}
          />
        </ScrollView>

        <View style={{ padding: theme.space(4) }}>
          <Button
            label={editingId ? 'Save changes' : 'Save payment'}
            onPress={save}
            disabled={touched && !canSave(validation)}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Keeps the time of day while moving the date. */
function shiftDays(at: number, days: number): number {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** The same day at a given hour, for the rough time-of-day chips. */
function atHour(at: number, hour: number): number {
  const d = new Date(at);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', padding: 4, gap: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 11 },
  amountLabel: { textAlign: 'center', marginTop: 28 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  amountInput: {
    fontSize: 46, fontWeight: '800', letterSpacing: -1,
    minWidth: 120, textAlign: 'center', padding: 0,
  },
  center: { textAlign: 'center' },
  input: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stepper: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  stepButton: {
    width: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  stepValue: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderWidth: 1, gap: 1,
  },
});

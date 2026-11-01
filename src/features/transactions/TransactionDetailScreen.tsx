/**
 * One payment, with everything that was read from it and everything the user
 * can do to it.
 *
 * The flags come from section 8.1 and the actions from sections 4 and 8.4.
 * A payment parsed from SMS is not editable field by field: what it says is
 * what the bank said, and letting the amount be retyped would quietly break
 * the link to the message it came from. What the user owns — the category,
 * the note, whether it counts — is editable on any payment.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatMoney } from '../../core/analytics/spending';
import { listCategories } from '../../core/db/dao/categories';
import {
  clearUserCategory,
  paymentsFollowingMerchantCategory,
  setUserCategory,
} from '../../core/db/dao/merchants';
import {
  clearTransactionCategory,
  setExcluded,
  setNote,
  setRepaid,
  setTransactionCategory,
  softDelete,
} from '../../core/db/dao/transactions';
import type { CategoryRow } from '../../core/db/models';
import { getTransactionDetail, type TransactionDetail } from '../../core/transactions/manual';
import { categoryColor, pressedDim, pressedFill, useTheme } from '../../design';
import { accountTypeLabel, maskedDigits } from '../../design/accountLabel';
import { Card, Icon, Text } from '../../design/components';
import {
  matchLendToCredits,
  matchLendingForMerchant,
} from '../../core/lending/match';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';

function Field({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.field,
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.color.border,
        },
      ]}>
      <Text variant="body" tone="secondary" style={styles.fieldLabel}>
        {label}
      </Text>
      <View style={styles.fieldValue}>{children}</View>
    </View>
  );
}

export function TransactionDetailScreen({
  navigation,
  route,
}: ScreenProps<'TransactionDetail'>) {
  const theme = useTheme();
  const { db } = useApp();
  const { id } = route.params;

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [categories] = useState<CategoryRow[]>(() => listCategories(db));
  const [pickingCategory, setPickingCategory] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  /** What the note column actually holds, so a write is never repeated. */
  const savedNote = useRef('');
  /** The latest draft, readable from a cleanup that has no render to see. */
  const draftRef = useRef('');
  draftRef.current = noteDraft;

  const reload = useCallback(() => {
    const next = getTransactionDetail(db, id);
    setDetail(next);
    const stored = next?.note ?? '';
    // Changing the category reloads this screen, and a reload that adopted
    // the stored note would wipe whatever was half-typed in the box. The
    // draft is only replaced when there is nothing unsaved in it.
    if (draftRef.current.trim() === savedNote.current) {
      setNoteDraft(stored);
      draftRef.current = stored;
    }
    savedNote.current = stored;
  }, [db, id]);

  useEffect(() => navigation.addListener('focus', reload), [navigation, reload]);
  useEffect(reload, [reload]);

  /**
   * The note saves itself.
   *
   * Blur alone is not enough: leaving by the back gesture dismisses the
   * keyboard and unmounts the screen without the field ever reporting that
   * it lost focus, and the note the user typed is gone. So it is written on
   * a pause in typing, again on blur, and once more on the way out —
   * whichever happens first, and the rest then find nothing left to do.
   *
   * No reload follows a write. The row on screen already shows what was
   * typed, and re-reading it would only risk replacing the box's contents
   * with a round trip of themselves.
   */
  const commitNote = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed === savedNote.current) {
        return;
      }
      savedNote.current = trimmed;
      setNote(db, id, trimmed.length === 0 ? null : trimmed);
    },
    [db, id],
  );

  // A pause in typing.
  useEffect(() => {
    if (noteDraft.trim() === savedNote.current) {
      return;
    }
    const timer = setTimeout(() => commitNote(noteDraft), 700);
    return () => clearTimeout(timer);
  }, [noteDraft, commitNote]);

  // And leaving the screen, however it is left.
  useEffect(() => () => commitNote(draftRef.current), [commitNote]);

  if (!detail) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }}>
        <Text variant="body" tone="secondary" style={styles.missing}>
          This payment is no longer here.
        </Text>
      </SafeAreaView>
    );
  }

  const debit = detail.transaction_type === 'DEBIT';
  const palette = categoryColor(theme, detail.category_color ?? 'grey');
  const payee = detail.merchant_name ?? detail.recipient_name;

  const repaidAt = detail.repaid_at;
  const repaid = repaidAt !== null;
  // Only the category decides whether the question is worth asking — see
  // `tracks_repayment`. A payment already marked as paid back keeps the
  // switch whatever its category says now, so recategorising it cannot
  // strand a flag the user can no longer see or undo.
  const tracksRepayment = detail.category_tracks_repayment === 1 || repaid;

  const status = repaid
    ? { label: 'Came back', tone: theme.category.green }
    : detail.is_refunded
    ? { label: 'Refunded', tone: theme.category.amber }
    : detail.is_excluded
    ? { label: 'Left out of spending', tone: theme.category.grey }
    : detail.is_transfer
    ? { label: 'Self-transfer', tone: theme.category.navy }
    : { label: 'Successful', tone: theme.category.green };


  /**
   * Picking a category, and the offer to make it stick.
   *
   * Section 10.3 gives a transaction its own category or its merchant's, and
   * until now the picker only ever wrote the first. That is right for a
   * one-off and wrong for a payee: the next payment to the same shop arrives
   * uncategorised again, and the user categorises it again, forever.
   *
   * So the choice is offered rather than assumed. Setting it on the merchant
   * also reaches the payments already made to that payee which have no
   * category of their own, which is a large enough effect that the number is
   * named before the user agrees to it.
   */
  const chooseCategory = (categoryId: number, categoryName: string) => {
    setPickingCategory(false);

    const merchantId = detail.merchant_id;
    if (merchantId === null) {
      // Nothing identifiable was parsed, so there is no payee to remember it
      // against — section 8.1.
      setTransactionCategory(db, detail.id, categoryId);
      // Section 12.4 runs in both directions. A payment becoming a lend now
      // may have been paid back months ago, and that credit is already here.
      matchLendToCredits(db, detail.id);
      reload();
      return;
    }

    const others = paymentsFollowingMerchantCategory(db, merchantId, detail.id);
    const payee = detail.merchant_upi_id ?? detail.merchant_name ?? 'this payee';

    Alert.alert(
      `Always use ${categoryName} for ${payee}?`,
      others === 0
        ? 'Future payments to them will be filed here automatically.'
        : `Future payments to them will be filed here automatically, and so will ${
            others === 1
              ? 'the earlier payment that has no category of its own'
              : `the ${others} earlier payments that have no category of their own`
          }.`,
      [
        {
          text: 'Just this one',
          onPress: () => {
            setTransactionCategory(db, detail.id, categoryId);
            matchLendToCredits(db, detail.id);
            reload();
          },
        },
        {
          text: 'Always',
          onPress: () => {
            // The merchant becomes the single answer for this payee, so the
            // row is left without an override of its own and resolves
            // through it. Keeping both would leave this payment behind if
            // the payee's category were ever changed again.
            setUserCategory(db, merchantId, categoryId);
            setTransactionCategory(db, detail.id, null);
            // One write can turn every payment to this payee into a lend,
            // so every one of them is offered the credits that came back.
            matchLendingForMerchant(db, merchantId);
            reload();
          },
        },
      ],
    );
  };

  /**
   * Leaving a payment with no category, which section 10.3 had no room for.
   *
   * Clearing a payment's own category only ever meant "ask the payee", so a
   * payment to a payee that carries one could not be left blank — the answer
   * came straight back through the merchant. There are two different things
   * a user can mean by it, and which one decides whether this touches one
   * payment or every payment to that payee, so it is asked rather than
   * assumed and the number is named before they agree to it.
   */
  const clearCategory = () => {
    setPickingCategory(false);

    const merchantId = detail.merchant_id;
    if (merchantId === null || detail.merchant_category_id === null) {
      // Nothing is being inherited, so there is only one thing this can mean.
      clearTransactionCategory(db, detail.id);
      reload();
      return;
    }

    const others = paymentsFollowingMerchantCategory(db, merchantId, detail.id);
    const payee = detail.merchant_upi_id ?? detail.merchant_name ?? 'this payee';
    const name = detail.merchant_category_name ?? 'that category';

    Alert.alert(
      `${name} comes from ${payee}`,
      others === 0
        ? `Leave this one blank, or stop using ${name} for them altogether?`
        : `Leave this one blank, or stop using ${name} for them — which would also loosen ${
            others === 1
              ? 'the earlier payment that has no category of its own'
              : `the ${others} earlier payments that have no category of their own`
          }?`,
      [
        {
          text: 'Just this payment',
          onPress: () => {
            clearTransactionCategory(db, detail.id);
            reload();
          },
        },
        {
          text: 'Stop using it',
          style: 'destructive',
          onPress: () => {
            // The payment is left without an override, so once the payee
            // carries nothing it resolves to nothing — and picks the payee's
            // category back up if one is ever set again.
            clearUserCategory(db, merchantId);
            setTransactionCategory(db, detail.id, null);
            reload();
          },
        },
      ],
    );
  };

  /**
   * Section 6's fix, handed to whatever app the phone uses for maps.
   *
   * A link rather than a map drawn here: a map needs tiles, tiles need the
   * network, and the release build has no INTERNET permission at all. The
   * coordinates stay on the phone until the user taps, and then they go to
   * an app they chose.
   */
  const openMap = () => {
    const { latitude, longitude } = detail;
    if (latitude === null || longitude === null) {
      return;
    }
    const pin = `${latitude},${longitude}`;
    Linking.openURL(`geo:${pin}?q=${pin}(${encodeURIComponent(payee ?? 'Payment')})`).catch(
      () => Alert.alert('No maps app', 'Nothing on this phone offered to open a map.'),
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete this payment?',
      detail.source === 'SMS'
        ? 'It will stop counting towards your spending. The bank message it came from stays on your phone, and re-importing will not bring it back.'
        : 'It will stop counting towards your spending.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Section 8.1: deletes are soft, so a later import finds the key
            // already in use and does not recreate the row.
            softDelete(db, detail.id);
            navigation.goBack();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top']}>
      <View style={[styles.bar, { paddingHorizontal: theme.space(4) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.barButton,
            { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
            pressedFill(theme, pressed),
          ]}>
          <Icon name="chevron-left" size={20} color={theme.color.textPrimary} />
        </Pressable>

        <Text variant="subheading">Payment</Text>

        {/* Only a payment the user typed can be edited field by field. One
            parsed from a message is a record of what the bank said. */}
        {detail.source === 'MANUAL' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit this payment"
            onPress={() => navigation.navigate('AddPayment', { id: detail.id })}
            style={({ pressed }) => [
              styles.barButton,
              { backgroundColor: theme.color.surface, borderRadius: theme.radius.md },
              pressedFill(theme, pressed),
            ]}>
            <Icon name="edit" size={18} color={theme.color.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.barButton} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: theme.space(4),
          paddingBottom: theme.space(12),
          gap: theme.space(4),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View
            style={[
              styles.heroAvatar,
              { backgroundColor: palette.soft, borderRadius: theme.radius.lg },
            ]}>
            <Text variant="heading" style={{ color: palette.onSoft }}>
              {(payee ?? '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>

          <Text
            variant="display"
            tabular
            tone={debit ? 'primary' : 'accent'}
            style={{ marginTop: theme.space(3) }}>
            {debit ? '−' : '+'}
            {formatMoney(detail.amount, detail.currency, { showPaise: true })}
          </Text>

          <Text variant="body" tone="secondary" style={{ marginTop: theme.space(1) }}>
            {debit ? 'Paid to' : 'Received from'} {payee ?? 'an unnamed payee'}
          </Text>

          <View
            style={[
              styles.status,
              { backgroundColor: status.tone.soft, borderRadius: theme.radius.pill },
            ]}>
            <Icon name="check" size={13} color={status.tone.onSoft} />
            <Text variant="caption" style={{ color: status.tone.onSoft }}>
              {status.label}
            </Text>
          </View>
        </View>

        <Card padded={false} style={styles.card}>
          <Field label="Category">
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickingCategory((open) => !open)}
              style={({ pressed }) => [
                styles.categoryValue,
                pressedFill(theme, pressed),
              ]}>
              <View style={styles.categoryStack}>
                <View
                  style={[
                    styles.categoryChip,
                    { backgroundColor: palette.soft, borderRadius: theme.radius.pill },
                  ]}>
                  <View style={[styles.dot, { backgroundColor: palette.solid }]} />
                  <Text variant="label" style={{ color: palette.onSoft }}>
                    {detail.category_name ?? 'Uncategorized'}
                  </Text>
                </View>
                {/* Where it came from. Without this the two ways a payment
                    can have a category look identical, and the user cannot
                    tell whether the payee will remember it next time. */}
                {detail.category_name ? (
                  <Text variant="caption" tone="muted">
                    {detail.category_id === null
                      ? 'From this payee'
                      : 'Only this payment'}
                  </Text>
                ) : detail.category_cleared === 1 &&
                  detail.merchant_category_name !== null ? (
                  // Otherwise a payment deliberately left blank looks exactly
                  // like one nothing has reached yet, and the user cannot see
                  // that the payee's category is being held off.
                  <Text variant="caption" tone="muted">
                    Left blank · payee is {detail.merchant_category_name}
                  </Text>
                ) : null}
              </View>
              <Text variant="label" tone="accent">
                {pickingCategory ? 'Close' : 'Change'}
              </Text>
            </Pressable>
          </Field>

          {pickingCategory ? (
            <View style={[styles.picker, { padding: theme.space(4) }]}>
              {categories.map((category) => {
                const chip = categoryColor(theme, category.color);
                const active = detail.resolved_category_id === category.id;
                return (
                  <Pressable
                    key={category.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => chooseCategory(category.id, category.name)}
                    style={({ pressed }) => [
                      styles.pickerChip,
                      pressedDim(pressed),
                      {
                        borderRadius: theme.radius.pill,
                        backgroundColor: active ? theme.color.selected : chip.soft,
                      },
                    ]}>
                    <View style={[styles.dot, { backgroundColor: chip.solid }]} />
                    <Text
                      variant="label"
                      style={{ color: active ? theme.color.onSelected : chip.onSoft }}>
                      {category.name}
                    </Text>
                  </Pressable>
                );
              })}
              {detail.resolved_category_id !== null ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={clearCategory}
                  style={({ pressed }) => [
                    styles.pickerChip,
                    pressedDim(pressed),
                    {
                      borderRadius: theme.radius.pill,
                      borderWidth: 1,
                      borderColor: theme.color.border,
                    },
                  ]}>
                  <Text variant="label" tone="secondary">
                    Leave it blank
                  </Text>
                </Pressable>
              ) : null}
              {detail.category_id !== null || detail.category_cleared === 1 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setTransactionCategory(db, detail.id, null);
                    setPickingCategory(false);
                    reload();
                  }}
                  style={({ pressed }) => [
                    styles.pickerChip,
                    pressedDim(pressed),
                    {
                      borderRadius: theme.radius.pill,
                      borderWidth: 1,
                      borderColor: theme.color.border,
                    },
                  ]}>
                  <Text variant="label" tone="secondary">
                    {detail.merchant_category_id === null
                      ? 'Follow the payee'
                      : "Use the payee's category"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Field label={debit ? 'Paid to' : 'Received from'}>
            <Text variant="bodyStrong" style={styles.right}>
              {payee ?? '—'}
            </Text>
          </Field>

          {detail.merchant_upi_id ? (
            <Field label="UPI ID">
              <Text variant="bodyStrong" style={styles.right} numberOfLines={1}>
                {detail.merchant_upi_id}
              </Text>
            </Field>
          ) : null}

          <Field label={debit ? 'From account' : 'Into account'}>
            <Text variant="bodyStrong" style={styles.right}>
              {detail.bank_name
                ? `${detail.bank_name} ${maskedDigits(detail.last_four ?? '')}`.trim()
                : 'Not known'}
            </Text>
          </Field>

          <Field label="Date & time">
            <Text variant="bodyStrong" style={styles.right}>
              {new Date(detail.occurred_at).toLocaleString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          </Field>

          {/* Section 6: only ever on a payment whose message arrived while
              the app was there to see it. Historical imports have none, and
              the row is left out rather than shown empty. */}
          {detail.latitude !== null && detail.longitude !== null ? (
            <Field label="Where">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open this place in a map"
                onPress={openMap}
                style={({ pressed }) => [styles.where, pressedFill(theme, pressed)]}>
                <Icon name="location" size={14} color={theme.color.primary} />
                <Text variant="bodyStrong" tone="accent" numberOfLines={1}>
                  {detail.location_label ??
                    `${detail.latitude.toFixed(5)}, ${detail.longitude.toFixed(5)}`}
                </Text>
              </Pressable>
            </Field>
          ) : null}

          {detail.rrn ? (
            <Field label="UPI Ref">
              <Text variant="bodyStrong" tabular style={styles.right}>
                {detail.rrn}
              </Text>
            </Field>
          ) : null}

          <Field label="Source" last>
            <Text variant="bodyStrong" style={styles.right}>
              {detail.source === 'SMS'
                ? `Bank SMS · ${detail.bank_sender_id ?? 'unknown sender'}`
                : `Added by you · ${accountTypeLabel(
                    (detail.account_type as never) ?? 'BANK',
                  )}`}
            </Text>
          </Field>
        </Card>

        <Card>
          <View style={styles.noteHead}>
            <Text variant="bodyStrong" style={styles.noteTitle}>
              Note
            </Text>
            {noteDraft.trim().length > 0 &&
            noteDraft.trim() === savedNote.current ? (
              <Text variant="caption" tone="muted">
                Saved
              </Text>
            ) : null}
          </View>
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            onBlur={() => commitNote(noteDraft)}
            placeholder="Add a note, like 'team lunch'"
            placeholderTextColor={theme.color.textMuted}
            multiline
            style={[
              styles.note,
              { color: theme.color.textPrimary, marginTop: theme.space(2) },
            ]}
          />
        </Card>

        <Card>
          {/* Shown only for the categories that ask it — Lend ships that way,
              and any category the user marks the same. Money lent is money
              that has not been spent yet; money lent and returned was never
              spending at all, so saying so takes it out of every total. */}
          {tracksRepayment ? (
            <View
              style={[
                styles.toggleRow,
                styles.repaidRow,
                {
                  borderBottomColor: theme.color.border,
                  paddingBottom: theme.space(4),
                  marginBottom: theme.space(4),
                },
              ]}>
              <View style={styles.toggleBody}>
                <Text variant="bodyStrong">Did this money come back?</Text>
                <Text variant="caption" tone="secondary">
                  {repaidAt === null
                    ? 'Turn this on once it has been paid back and it stops counting.'
                    : `Paid back on ${new Date(repaidAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}.`}
                </Text>
              </View>
              <Switch
                value={repaid}
                onValueChange={(next) => {
                  setRepaid(db, detail.id, next);
                  reload();
                }}
                trackColor={{ true: theme.color.primary, false: theme.color.borderStrong }}
                thumbColor={theme.color.surface}
              />
            </View>
          ) : null}

          <View style={styles.toggleRow}>
            <View style={styles.toggleBody}>
              <Text variant="bodyStrong">Leave out of spending</Text>
              {/* No longer says "money you'll get back": that is what the
                  switch above is for, and offering the same thing twice
                  invites the user to set both and wonder which one did it. */}
              <Text variant="caption" tone="secondary">
                Use for self-transfers, or anything that should not count.
              </Text>
            </View>
            <Switch
              value={detail.is_excluded === 1}
              onValueChange={(next) => {
                setExcluded(db, detail.id, next);
                reload();
              }}
              trackColor={{ true: theme.color.primary, false: theme.color.borderStrong }}
              thumbColor={theme.color.surface}
            />
          </View>
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={confirmDelete}
          style={({ pressed }) => [
            styles.delete,
            {
              borderColor: theme.color.danger,
              borderRadius: theme.radius.lg,
              backgroundColor: pressed ? theme.color.dangerSoft : 'transparent',
            },
          ]}>
          <Text variant="bodyStrong" tone="danger">
            Delete payment
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingVertical: 12 },
  heroAvatar: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  status: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, marginTop: 12,
  },
  card: { overflow: 'hidden' },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 15,
  },
  fieldLabel: { flexShrink: 0 },
  fieldValue: { flex: 1, alignItems: 'flex-end' },
  right: { textAlign: 'right' },
  categoryValue: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  categoryStack: { alignItems: 'flex-end', gap: 3 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 0 },
  pickerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteTitle: { flex: 1 },
  note: { fontSize: 15, lineHeight: 22, minHeight: 44, padding: 0, textAlignVertical: 'top' },
  where: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  repaidRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  toggleBody: { flex: 1, gap: 2 },
  delete: { alignItems: 'center', paddingVertical: 16, borderWidth: 1 },
  missing: { textAlign: 'center', marginTop: 48 },
});

/**
 * Section 11.1, the unreadable messages screen.
 *
 * "Some bank messages cannot be read. The format may be one the app does not
 * support yet, or a bank may have changed its wording on an account that was
 * working until last month. Either way the payment never appears, and nothing
 * anywhere else in the app shows that something is missing."
 *
 * Messages are grouped by bank, the largest group first. Each group gives the
 * bank name, how many messages, and the range of dates they cover. Opening a
 * group shows the individual messages with their sender ID, when they arrived,
 * and their text.
 *
 * The text is read from the inbox, not from the database. Section 8.6 stores
 * only the id of each message, so the originals are read back from the phone
 * when a group opens. Nothing extra is kept to make this screen work.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listUnreadable } from '../../core/db/dao/smsMessages';
import { retryUnreadable } from '../../core/import/retryUnreadable';
import type { SmsMessageRow } from '../../core/db/models';
import { readMessageById } from '../../core/platform/smsReader';
import { resolveBanks } from '../../core/sms/banks';
import { pressedDim, pressedFill, useTheme } from '../../design';
import { Button, BankAvatar, Icon, Text } from '../../design/components';
import type { ScreenProps } from '../../navigation/types';
import { useApp } from '../../state/AppProvider';

/**
 * Below this many messages every group is opened on arrival, so the screen
 * answers its own question without the user tapping anything. Above it the
 * groups stay shut, because reading several hundred messages back out of the
 * inbox is not something to do before the screen has even been looked at.
 */
const AUTO_OPEN_BELOW = 26;

/** `detail` on the row holds the NoMatchReason the parser stopped at. */
const REASON_LABEL: Record<string, string> = {
  NO_AMOUNT: 'No amount could be found',
  NO_DIRECTION: 'Could not tell money in from money out',
  FOREIGN_CURRENCY: 'Paid in another currency',
  NO_PARSER_PRODUCED_A_TRANSACTION: 'This wording is not supported yet',
};

function reasonLabel(detail: string | null): string {
  return (detail && REASON_LABEL[detail]) || 'This wording is not supported yet';
}

type BodyState =
  | { status: 'LOADING' }
  | { status: 'READY'; body: string }
  /** Section 11.1: "A message the user has deleted cannot be shown." */
  | { status: 'GONE' };

interface BankGroup {
  bankKey: string;
  bankName: string;
  rows: SmsMessageRow[];
  oldestAt: number;
  newestAt: number;
}

function groupByBank(rows: SmsMessageRow[]): BankGroup[] {
  const groups = new Map<string, BankGroup>();

  for (const row of rows) {
    // Gate one means an unreadable row always came from a known sender, but a
    // bank dropped from the registry between releases would leave one behind.
    const bank = resolveBanks(row.sender_id)[0];
    const bankKey = bank?.bankKey ?? row.sender_id.toLowerCase();
    const existing = groups.get(bankKey);

    if (existing) {
      existing.rows.push(row);
      existing.oldestAt = Math.min(existing.oldestAt, row.received_at);
      existing.newestAt = Math.max(existing.newestAt, row.received_at);
    } else {
      groups.set(bankKey, {
        bankKey,
        bankName: bank?.bankName ?? row.sender_id,
        rows: [row],
        oldestAt: row.received_at,
        newestAt: row.received_at,
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatStamp(at: number): string {
  return new Date(at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRange(group: BankGroup): string {
  const oldest = formatDay(group.oldestAt);
  const newest = formatDay(group.newestAt);
  return oldest === newest ? oldest : `${oldest} – ${newest}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function UnreadableMessagesScreen({
  navigation,
}: ScreenProps<'UnreadableMessages'>) {
  const theme = useTheme();
  const { db, reloadProfile } = useApp();

  const [groups, setGroups] = useState<BankGroup[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [bodies, setBodies] = useState<Record<number, BodyState>>({});
  const [retrying, setRetrying] = useState(false);
  /** Ids already asked for, so reopening a group does not read them again. */
  const requested = useRef(new Set<number>());

  const loadBodies = useCallback((rows: SmsMessageRow[]) => {
    const pending = rows.filter((row) => !requested.current.has(row.provider_id));
    if (pending.length === 0) {
      return;
    }
    for (const row of pending) {
      requested.current.add(row.provider_id);
    }

    setBodies((previous) => {
      const next = { ...previous };
      for (const row of pending) {
        next[row.provider_id] = { status: 'LOADING' };
      }
      return next;
    });

    // One at a time, each landing on screen as it arrives, so a long list
    // fills in rather than sitting blank until the last one is back.
    (async () => {
      for (const row of pending) {
        let state: BodyState;
        try {
          const message = await readMessageById(row.provider_id);
          state = message ? { status: 'READY', body: message.body } : { status: 'GONE' };
        } catch {
          // No SMS access, or the inbox refused the read. Either way the row
          // still belongs on screen with its bank and its date.
          state = { status: 'GONE' };
        }
        setBodies((previous) => ({ ...previous, [row.provider_id]: state }));
      }
    })();
  }, []);

  const reload = useCallback(() => {
    const rows = listUnreadable(db);
    const grouped = groupByBank(rows);
    setGroups(grouped);

    if (rows.length > 0 && rows.length < AUTO_OPEN_BELOW) {
      setOpen(new Set(grouped.map((group) => group.bankKey)));
      loadBodies(rows);
    }
  }, [db, loadBodies]);

  useEffect(reload, [reload]);

  /**
   * Section 11.1: "When a later release adds the bank, those messages are read
   * again on their own and the payments appear in the user's history."
   *
   * The screen is read only about the parser — it still does not fix a format.
   * What it does is put the messages back through the one in the app now,
   * which section 3.1 would otherwise never let happen.
   */
  const checkAgain = () => {
    setRetrying(true);
    (async () => {
      const outcome = await retryUnreadable(db, readMessageById);
      requested.current.clear();
      setBodies({});
      reload();
      reloadProfile();
      setRetrying(false);

      Alert.alert(
        outcome.recovered > 0
          ? `${outcome.recovered} ${plural(outcome.recovered, 'payment', 'payments')} recovered`
          : 'Nothing new could be read',
        outcome.recovered > 0
          ? `${outcome.recovered} of ${outcome.checked} ${plural(
              outcome.checked,
              'message',
              'messages',
            )} became ${plural(outcome.recovered, 'a payment', 'payments')} in your ` +
            `history. ${
              outcome.stillUnreadable > 0
                ? `The other ${outcome.stillUnreadable} still cannot be read.`
                : ''
            }`.trim()
          : 'These formats are still not ones the app understands. Sharing them is ' +
            'what gets them added.',
      );
    })();
  };

  const toggleGroup = (group: BankGroup) => {
    const isOpen = open.has(group.bankKey);
    if (!isOpen) {
      loadBodies(group.rows);
    }
    setOpen((previous) => {
      const next = new Set(previous);
      if (isOpen) {
        next.delete(group.bankKey);
      } else {
        next.add(group.bankKey);
      }
      return next;
    });
  };

  const textFor = (row: SmsMessageRow): string => {
    const state = bodies[row.provider_id];
    const body =
      state?.status === 'READY' ? state.body : '(no longer in this phone’s inbox)';
    return `${row.sender_id} · ${formatStamp(row.received_at)}\n${reasonLabel(
      row.detail,
    )}\n\n${body}`;
  };

  /**
   * Section 11.1: "Nothing leaves the phone unless the user chooses it. A bank
   * message carries an account number and often a balance, so the screen says
   * what is being shared before it is sent."
   */
  const confirmAndShare = (count: number, title: string, message: string) => {
    Alert.alert(
      plural(count, 'Share this message?', `Share these ${count} messages?`),
      `${plural(count, 'It goes', 'They go')} out exactly as the bank wrote ` +
        `${plural(count, 'it', 'them')}, which usually means your account number ` +
        'and sometimes your balance. You choose where it is sent, and nothing ' +
        'leaves this phone until you do.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share',
          onPress: () => {
            Share.share({ title, message });
          },
        },
      ],
    );
  };

  const shareGroup = (group: BankGroup) => {
    const header =
      `${group.bankName} — ${group.rows.length} ` +
      `${plural(group.rows.length, 'message', 'messages')} Find My Expense could not read`;
    confirmAndShare(
      group.rows.length,
      header,
      [header, ...group.rows.map(textFor)].join('\n\n———\n\n'),
    );
  };

  const total = groups?.reduce((sum, group) => sum + group.rows.length, 0) ?? 0;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      edges={['top', 'bottom']}>
      <View style={[styles.header, { paddingHorizontal: theme.space(5) }]}>
        <Pressable
          onPress={navigation.goBack}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => pressedDim(pressed)}>
          <Icon name="chevron-left" size={24} />
        </Pressable>
        <Text variant="subheading">Unreadable messages</Text>
      </View>

      {groups === null ? (
        <View style={styles.centred}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : groups.length === 0 ? (
        <View style={[styles.centred, { padding: theme.space(5) }]}>
          <Text variant="heading">Every message was read.</Text>
          <Text
            variant="body"
            tone="secondary"
            style={{ marginTop: theme.space(2), textAlign: 'center' }}>
            Nothing from your banks was left unexplained.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.space(5),
            paddingBottom: theme.space(8),
          }}
          showsVerticalScrollIndicator={false}>
          <Text variant="body" tone="secondary" style={{ marginBottom: theme.space(4) }}>
            {total} {plural(total, 'message', 'messages')} came from your banks in a
            wording the app does not read yet, so {plural(total, 'its', 'their')} payment
            is missing from your history. The text below is read straight from your
            inbox each time this screen opens — none of it is stored.
          </Text>

          <Button
            label={retrying ? 'Checking…' : 'Check these again'}
            variant="secondary"
            loading={retrying}
            onPress={checkAgain}
            accessibilityHint="Reads these messages again with the parser in this version of the app"
            style={{ marginBottom: theme.space(5) }}
          />

          {groups.map((group) => {
            const isOpen = open.has(group.bankKey);
            return (
              <View
                key={group.bankKey}
                style={[
                  styles.group,
                  {
                    backgroundColor: theme.color.surface,
                    borderRadius: theme.radius.lg,
                    marginBottom: theme.space(3),
                  },
                ]}>
                <Pressable
                  onPress={() => toggleGroup(group)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${group.bankName}, ${group.rows.length} ${plural(
                    group.rows.length,
                    'message',
                    'messages',
                  )}`}
                  style={({ pressed }) => [
                    styles.groupHeader,
                    { padding: theme.space(4) },
                    pressedFill(theme, pressed),
                  ]}>
                  <BankAvatar bankKey={group.bankKey} bankName={group.bankName} />
                  <View style={styles.groupBody}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {group.bankName}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                      {group.rows.length}{' '}
                      {plural(group.rows.length, 'message', 'messages')} ·{' '}
                      {formatRange(group)}
                    </Text>
                  </View>
                  <Icon
                    name={isOpen ? 'chevron-down' : 'chevron-right'}
                    size={18}
                    color={theme.color.textSecondary}
                  />
                </Pressable>

                {isOpen ? (
                  <View style={{ paddingHorizontal: theme.space(4) }}>
                    {group.rows.map((row) => {
                      const state = bodies[row.provider_id];
                      return (
                        <View
                          key={row.id}
                          style={[
                            styles.message,
                            {
                              borderTopWidth: StyleSheet.hairlineWidth,
                              borderTopColor: theme.color.border,
                              paddingVertical: theme.space(4),
                              gap: theme.space(2),
                            },
                          ]}>
                          <View style={styles.messageMeta}>
                            <Text variant="caption" tone="secondary" numberOfLines={1}>
                              {row.sender_id}
                            </Text>
                            <Text variant="caption" tone="muted" numberOfLines={1}>
                              {formatStamp(row.received_at)}
                            </Text>
                          </View>

                          {state === undefined || state.status === 'LOADING' ? (
                            <ActivityIndicator
                              color={theme.color.textMuted}
                              style={styles.bodyLoading}
                            />
                          ) : state.status === 'GONE' ? (
                            <Text variant="body" tone="muted">
                              This message is no longer in your inbox, so its text cannot
                              be shown.
                            </Text>
                          ) : (
                            <View
                              style={[
                                styles.bodyBox,
                                {
                                  backgroundColor: theme.color.surfaceMuted,
                                  borderRadius: theme.radius.md,
                                  padding: theme.space(3),
                                },
                              ]}>
                              <Text variant="body">{state.body}</Text>
                            </View>
                          )}

                          <View style={styles.messageFooter}>
                            <View style={styles.reason}>
                              <Icon
                                name="alert"
                                size={13}
                                color={theme.color.textMuted}
                                strokeWidth={2}
                              />
                              <Text variant="caption" tone="muted" numberOfLines={2}>
                                {reasonLabel(row.detail)}
                              </Text>
                            </View>
                            {state?.status === 'READY' ? (
                              <Pressable
                                hitSlop={10}
                                accessibilityRole="button"
                                accessibilityLabel="Share this message"
                                onPress={() =>
                                  confirmAndShare(
                                    1,
                                    `A ${group.bankName} message Find My Expense could not read`,
                                    textFor(row),
                                  )
                                }
                                style={({ pressed }) => pressedDim(pressed)}>
                                <Text variant="label" tone="accent">
                                  Share
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}

                    {group.rows.length > 1 ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => shareGroup(group)}
                        style={({ pressed }) => [
                          styles.shareAll,
                          pressedFill(theme, pressed),
                          {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: theme.color.border,
                            paddingVertical: theme.space(4),
                          },
                        ]}>
                        <Icon name="copy" size={16} color={theme.color.primaryText} />
                        <Text variant="label" tone="accent">
                          Share all {group.rows.length} from {group.bankName}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}

          <Text variant="caption" tone="muted" style={{ marginTop: theme.space(3) }}>
            This screen only reports the problem. When a release adds the wording, these
            messages are read again on their own and the payments appear in your history.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  group: { overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupBody: { flex: 1, minWidth: 0, gap: 3 },
  message: {},
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  bodyBox: {},
  bodyLoading: { alignSelf: 'flex-start' },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  shareAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { AccountRow as AccountRecord } from '../../../core/db/models';
import { useTheme } from '../../../design';
import { accountTypeLabel, maskedDigits } from '../../../design/accountLabel';
import { BankAvatar, Icon, Text } from '../../../design/components';

export function AccountListRow({
  account,
  showDivider,
}: {
  account: AccountRecord;
  showDivider: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.row,
        showDivider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.border,
        },
      ]}>
      <BankAvatar bankKey={account.bank_key} bankName={account.bank_name} />
      <View style={styles.body}>
        <Text variant="bodyStrong">{account.bank_name}</Text>
        <Text variant="caption" tone="secondary" tabular>
          {[maskedDigits(account.last_four), accountTypeLabel(account.account_type)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Icon name="check" size={16} color={theme.color.primary} strokeWidth={2.4} />
    </View>
  );
}

/** The empty placeholder that sits below the list while the scan is running. */
export function AccountPlaceholderRow() {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.row,
        { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border },
      ]}>
      <View
        style={[
          styles.avatarGhost,
          { backgroundColor: theme.color.skeleton, borderRadius: theme.radius.md },
        ]}
      />
      <View style={styles.body}>
        <View
          style={[styles.lineGhost, { backgroundColor: theme.color.skeleton, width: '62%' }]}
        />
        <View
          style={[styles.lineGhost, { backgroundColor: theme.color.skeleton, width: '38%' }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  body: { flex: 1, gap: 3 },
  avatarGhost: { width: 38, height: 38 },
  lineGhost: { height: 9, borderRadius: 5 },
});

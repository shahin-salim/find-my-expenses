import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../index';
import { Text } from './Text';

/**
 * Brand colours for the banks the app ships readers for. A bank with no entry
 * gets a neutral tile rather than no tile, so the import list never has a
 * hole in it.
 */
const BANK_BRAND: Record<string, string> = {
  hdfc: '#13386B',
  icici: '#AE3B1B',
  idfc: '#8E1B36',
  sbi: '#2A5CAA',
  sbicard: '#1C3F75',
  axis: '#9B1C31',
  esaf: '#1E7A52',
  kotak: '#B3202C',
  pnb: '#9A2A2A',
  bob: '#E26A2C',
  canara: '#17539B',
  union: '#B01C2E',
  yes: '#1B3A8C',
  indusind: '#8C1B2F',
  federal: '#1C6B48',
  rbl: '#1E2F6B',
  cash: '#6B6F72',
};

export interface BankAvatarProps {
  bankKey: string;
  bankName: string;
  size?: number;
}

/** The two-letter tile the import screen shows beside each account found. */
export function BankAvatar({ bankKey, bankName, size = 38 }: BankAvatarProps) {
  const theme = useTheme();
  const background = BANK_BRAND[bankKey] ?? theme.color.borderStrong;

  // `HDFC Bank` reads as HD and `ICICI Bank` as IC, which is how the import
  // screen in `screens/` draws them. One letter per word would give HB and IB,
  // where the B says nothing — every bank here is a bank.
  const initials = (bankName.replace(/[^A-Za-z ]/g, '').trim().split(/\s+/)[0] ?? '?')
    .toUpperCase()
    .padEnd(2, '·')
    .slice(0, 2);

  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text variant="label" style={{ color: '#FFFFFF' }}>
        {initials}
      </Text>
    </View>
  );
}

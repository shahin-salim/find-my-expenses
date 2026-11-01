import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TransactionFilter } from '../core/transactions/query';

export type RootStackParamList = {
  Welcome: undefined;
  SmsDisclosure: undefined;
  PermissionDenied: { permanentlyDenied: boolean };
  ImportProgress: undefined;
  OptionalAccess: undefined;
  Home: undefined;
  UnreadableMessages: undefined;
  /**
   * `filter` opens the list already narrowed — what a figure on Home was
   * counting, so the rows shown are the rows behind the number tapped.
   */
  Transactions: { filter?: Partial<TransactionFilter>; title?: string } | undefined;
  TransactionDetail: { id: number };
  /** Section 12.6. Money lent out and what has come back. */
  Lending: undefined;
  LendDetail: { id: number };
  /** No id means a new cash lend; an id opens that lend for editing. */
  CashLend: { id?: number };
  /** No id means a new payment; an id opens that payment for editing. */
  AddPayment: { id?: number };
  Settings: undefined;
  Categories: undefined;
  /** No id means a new category; an id opens that one for editing. */
  CategoryEdit: { id?: number };
};

export type ScreenProps<Route extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, Route>;

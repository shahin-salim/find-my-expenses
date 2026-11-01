/**
 * Reading the device inbox. Section 1.1: "Scan SMS messages from the past year
 * only. Do not scan messages older than one year."
 *
 * Backed by the SmsReader native module in
 * `android/app/src/main/java/com/findmyexpense/sms/`. The import talks to the
 * `SmsSource` interface rather than to this module directly, so the two-stage
 * orchestration can be exercised against an in-memory inbox.
 */

import { DeviceEventEmitter, NativeModules } from 'react-native';
import type { RawSms } from '../sms/types';

interface NativeMessage {
  id: number;
  address: string;
  body: string;
  date: number;
}

interface SmsReaderNativeModule {
  countInbox(minDate: number, maxDate: number): Promise<number>;
  readInbox(
    minDate: number,
    maxDate: number,
    offset: number,
    limit: number,
    order: SmsPageOrder,
  ): Promise<NativeMessage[]>;
  readMessageById(providerId: number): Promise<NativeMessage | null>;
}

function nativeModule(): SmsReaderNativeModule {
  const module = (NativeModules as Record<string, unknown>).SmsReader as
    | SmsReaderNativeModule
    | undefined;
  if (!module) {
    throw new Error(
      'The SmsReader native module is unavailable. SMS import only runs on Android.',
    );
  }
  return module;
}

function toRawSms(message: NativeMessage): RawSms {
  return {
    providerId: Number(message.id),
    senderId: String(message.address ?? ''),
    body: String(message.body ?? ''),
    receivedAt: Number(message.date),
  };
}

/**
 * Which end of the date window a page is taken from.
 *
 * The historical import reads `NEWEST_FIRST`, walking backwards through the
 * year so a reversal is seen before the payment it reverses.
 *
 * The catch-up scan reads `OLDEST_FIRST`, and has to. It advances a watermark
 * over what it read, and a watermark is a single moment: it can say "every
 * message up to here has been seen" and nothing else. A run that read the
 * newest messages first and then moved the watermark to the newest of them
 * would step it straight over everything older it had not reached, and those
 * messages are then behind the watermark for good. Read from the oldest end
 * and whatever a run gets through is a contiguous block starting where the
 * watermark already was, which is the only shape a watermark can describe.
 */
export type SmsPageOrder = 'NEWEST_FIRST' | 'OLDEST_FIRST';

/** One page of the inbox. */
export interface SmsPageRequest {
  minDate: number;
  maxDate: number;
  offset: number;
  limit: number;
  /** Defaults to `NEWEST_FIRST`, which is what the import reads in. */
  order?: SmsPageOrder;
}

export interface SmsSource {
  /** How many messages fall inside the window, for the progress bar. */
  count(minDate: number, maxDate: number): Promise<number>;
  page(request: SmsPageRequest): Promise<RawSms[]>;
}

export const deviceSmsSource: SmsSource = {
  count(minDate, maxDate) {
    return nativeModule().countInbox(minDate, maxDate);
  },

  async page({ minDate, maxDate, offset, limit, order }) {
    const messages = await nativeModule().readInbox(
      minDate,
      maxDate,
      offset,
      limit,
      order ?? 'NEWEST_FIRST',
    );
    return messages.map(toRawSms);
  },
};

/**
 * Section 1.2: fires when a message arrives while the app is running.
 *
 * It carries only the sender, and nothing reads it: the event is a prompt to
 * scan, not the message itself. See `SmsReceiver.kt` for why the message does
 * not travel this way.
 *
 * Nothing fires while the app is closed, which the catch-up scan covers by
 * reading forward from a watermark rather than relying on having been told.
 */
export function onSmsReceived(listener: () => void): () => void {
  // `DeviceEventEmitter`, not `new NativeEventEmitter(SmsReader)`. The
  // receiver emits through `RCTDeviceEventEmitter`, which is the global
  // channel this listens on, and binding an emitter to a module that
  // implements no `addListener` throws — taking the whole scan down with it,
  // not merely the live update.
  const subscription = DeviceEventEmitter.addListener(
    'SmsReader:messageReceived',
    listener,
  );
  return () => subscription.remove();
}

/**
 * Reads one message back by its id, for the unreadable messages screen in
 * section 11.1. Null when the user has deleted it from the inbox: "A message
 * the user has deleted cannot be shown."
 */
export async function readMessageById(providerId: number): Promise<RawSms | null> {
  const message = await nativeModule().readMessageById(providerId);
  return message ? toRawSms(message) : null;
}

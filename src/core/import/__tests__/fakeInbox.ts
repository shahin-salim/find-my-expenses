import type { SmsPageRequest, SmsSource } from '../../platform/smsReader';
import type { RawSms } from '../../sms/types';

export interface InboxMessage {
  sender: string;
  body: string;
  /** Local epoch millis. */
  at: number;
}

/**
 * An in-memory inbox that behaves the way the device provider does: filtered
 * by a date window, paged by offset, newest first unless the request asks for
 * the other end.
 */
export function fakeInbox(messages: InboxMessage[]): SmsSource & { all: RawSms[] } {
  const all: RawSms[] = messages
    .map((message, index) => ({
      providerId: index + 1,
      senderId: message.sender,
      body: message.body,
      receivedAt: message.at,
    }))
    .sort((a, b) => b.receivedAt - a.receivedAt);

  const inWindow = (minDate: number, maxDate: number) =>
    all.filter((sms) => sms.receivedAt >= minDate && sms.receivedAt <= maxDate);

  return {
    all,
    async count(minDate: number, maxDate: number) {
      return inWindow(minDate, maxDate).length;
    },
    async page({ minDate, maxDate, offset, limit, order }: SmsPageRequest) {
      const window = inWindow(minDate, maxDate);
      const ordered = order === 'OLDEST_FIRST' ? [...window].reverse() : window;
      return ordered.slice(offset, offset + limit);
    },
  };
}

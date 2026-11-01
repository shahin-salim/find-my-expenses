/**
 * The notification that asks what a payment was for.
 *
 * Backed by the `CategoryPrompt` native module in
 * `android/app/src/main/java/com/findmyexpense/notify/`. Everything about
 * which payment gets asked about, and which categories are offered, is
 * decided in `features/notifications/needsCategory.ts`; the module is handed
 * finished wording and draws it.
 *
 * The rule here is the same one `location.ts` follows: the code that decides
 * talks to the `CategoryNotifier` interface rather than to the module, so it
 * can be tested without a phone attached.
 */

import { DeviceEventEmitter, NativeModules } from 'react-native';

export interface PromptOption {
  categoryId: number;
  label: string;
  /** The category's colour as `#RRGGBB`, which is how the theme holds it. */
  color: string;
}

export interface CategoryNotifier {
  /**
   * Whether anything posted would be seen at all.
   *
   * Separate from the POST_NOTIFICATIONS permission: a user can leave the
   * permission granted and still switch the app's notifications off in
   * system settings, and only the second question has a native answer.
   */
  enabled(): Promise<boolean>;
  show(transactionId: number, title: string, body: string, options: PromptOption[]): void;
  dismiss(transactionId: number): void;
}

interface CategoryPromptNativeModule {
  areNotificationsEnabled(): Promise<boolean>;
  show(
    transactionId: number,
    title: string,
    body: string,
    options: PromptOption[],
  ): void;
  dismiss(transactionId: number): void;
  takePendingTransaction(): Promise<number | null>;
}

const native = NativeModules.CategoryPrompt as CategoryPromptNativeModule | undefined;

/**
 * The real one. Every method is safe to call on a build without the module —
 * a notification that cannot be drawn is not a reason to lose the payment it
 * was about.
 */
export const deviceCategoryNotifier: CategoryNotifier = {
  async enabled(): Promise<boolean> {
    if (!native) {
      return false;
    }
    try {
      return await native.areNotificationsEnabled();
    } catch {
      return false;
    }
  },

  show(transactionId, title, body, options) {
    try {
      native?.show(transactionId, title, body, options);
    } catch {
      // Nothing to recover: the payment is recorded either way, and the
      // category can still be set from the app.
    }
  },

  dismiss(transactionId) {
    try {
      native?.dismiss(transactionId);
    } catch {
      // The notification auto-cancels on tap, so a failure here leaves at
      // worst a stale card the user can swipe away.
    }
  },
};

/**
 * The payment a notification tap asked for, when the tap is what opened the
 * app.
 *
 * Asked once, as the navigator mounts. The native side takes the id off the
 * activity's intent as it answers, so this returns a payment the first time
 * and null every time after — which is what stops a return from the recents
 * list reopening a payment the user has already dealt with.
 */
export async function takePendingPrompt(): Promise<number | null> {
  if (!native) {
    return null;
  }
  try {
    const transactionId = await native.takePendingTransaction();
    return typeof transactionId === 'number' && transactionId > 0
      ? transactionId
      : null;
  } catch {
    // A build without the module, or an activity that has gone away. The
    // notification is still in the shade and still opens the app.
    return null;
  }
}

/**
 * The same tap, arriving while the app is already running.
 *
 * The two cases are separate because they have to be: on a cold start
 * nothing is listening when the intent is delivered, and on a warm one
 * nothing asks the activity again. Between them they cover every tap.
 *
 * `DeviceEventEmitter` rather than a `NativeEventEmitter` over the module,
 * for the reason `smsReader.ts` gives: the native side emits on the global
 * channel, and binding an emitter to a module with no `addListener` throws.
 */
export function onPromptOpened(
  listener: (transactionId: number) => void,
): () => void {
  const subscription = DeviceEventEmitter.addListener(
    'CategoryPrompt:open',
    (transactionId: number) => {
      if (typeof transactionId === 'number' && transactionId > 0) {
        listener(transactionId);
      }
    },
  );
  return () => subscription.remove();
}

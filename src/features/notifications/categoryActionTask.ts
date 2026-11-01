/**
 * The tap on a category button in a "needs a category" notification.
 *
 * Registered in `index.js` and started by `CategoryActionService`. It runs
 * with no screen open, so everything it needs is in the two numbers Android
 * hands it.
 */

import { setTransactionCategory } from '../../core/db/dao/transactions';
import { appDatabase } from '../../core/db/instance';
import { deviceCategoryNotifier } from '../../core/platform/categoryPrompt';

export interface CategoryActionData {
  transactionId: number;
  categoryId: number;
}

export async function categoryActionTask(data: CategoryActionData): Promise<void> {
  try {
    const db = appDatabase();

    // Section 8.1's override: the category goes on the payment, not on the
    // payee. Writing it to the payee would quietly recategorise every past
    // payment to them from a notification, which is a thing the app offers
    // deliberately on the detail screen and should not do behind the user's
    // back from the lock screen.
    setTransactionCategory(db, data.transactionId, data.categoryId);

    // The service already took the card down before starting the bundle.
    // This is for the case where it is still up — a second notification for
    // the same payment, or a tap that arrived while one was being redrawn.
    deviceCategoryNotifier.dismiss(data.transactionId);
  } catch (error) {
    // Throwing here would be an unhandled rejection inside a foreground
    // service. The payment is unchanged and still uncategorised, which is
    // where it started.
    // eslint-disable-next-line no-console
    console.warn('[notify] could not file the payment', error);
  }
}

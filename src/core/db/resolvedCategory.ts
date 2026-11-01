/**
 * Section 10.3's rule, written once.
 *
 * "A transaction's category is its own when the user set one, and its
 * merchant's otherwise." That was a `COALESCE` of the two columns, repeated
 * at fourteen places across the analytics, the list and the category screen.
 *
 * It grew a third case. `NULL` on the transaction has always meant "ask the
 * payee", which leaves no way to say "this payment has none" about a payment
 * whose payee has one — the answer always fell through. So a payment can now
 * be marked as deliberately blank, and that is a different thing from having
 * said nothing.
 *
 * It lives here, rather than in any of the modules that use it, because all
 * fourteen have to agree. A figure on Home that counted a cleared payment
 * while the list below it did not would be two answers to one question.
 *
 * Every query using it must have `transactions` aliased `t` and `merchants`
 * aliased `m`, which all of them already did.
 */
export const RESOLVED_CATEGORY = `
  CASE WHEN t.category_cleared = 1
       THEN NULL
       ELSE COALESCE(t.category_id, m.category_id)
  END`;

/**
 * Whether a credit is the half of a reversal that brings the money back.
 *
 * Section 4 keeps the reversal credit as an ordinary transaction and puts the
 * flag on the debit alone: "The credit is kept as a transaction of its own so
 * the user can see the money arriving, and since credits are never counted as
 * spending it changes no total by itself." The first half of that is a
 * deliberate choice about what the user sees and it stands. The second half
 * was true of the spending figures, which are debits only, and not of the
 * `In` figure the Transactions header grew later — there the credit was being
 * added up as money received, for a payment that never actually left.
 *
 * So the credit carries nothing to recognise it by and the pair has to be
 * recognised instead. The conditions are section 4.1's own, read from the
 * credit's side: the same reference, the opposite direction, the same amount,
 * the same account, and that debit already marked refunded — which is what
 * says the two were matched rather than merely alike. `match.ts` makes a
 * deliberately looser test for lending, where any debit sharing the reference
 * is reason enough to stay out of it.
 *
 * Every query using it must alias `transactions` as `t`, as `IS_SPENDING`
 * does.
 */
export const IS_REVERSAL_CREDIT = `
  t.transaction_type = 'CREDIT'
  AND t.rrn IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM transactions r
     WHERE r.rrn              = t.rrn
       AND r.transaction_type = 'DEBIT'
       AND r.amount           = t.amount
       AND r.account_id       = t.account_id
       AND r.is_refunded      = 1
       AND r.is_deleted       = 0
  )
`;

/**
 * What counts as spending, written once.
 *
 * It was written three times: in `analytics/spending.ts`, again in
 * `analytics/breakdown.ts`, and a third time as a list of clauses in
 * `transactions/query.ts` under a comment promising they were the same
 * conditions. Three copies of one rule is three chances for a release to
 * change two of them, and the figure on Home and the figure beside the same
 * category on the Categories screen were already disagreeing — the Categories
 * screen had no copy at all and summed everything.
 *
 * `is_refunded` and `repaid_at` are here because money that came back never
 * left: counting it would make the month it went out look like a month it was
 * spent in.
 *
 * The currency check is here for the same reason. A card used abroad reports
 * its own currency and no rupee figure (section 8.1), so its amount is not
 * paise and adding it to a rupee total would be wrong by whatever the exchange
 * rate happens to be. Keeping the check in the shared clause is what stops
 * that ever reaching a figure the user reads.
 *
 * Every query using it must alias `transactions` as `t`, which all of them
 * already did.
 */
export const IS_SPENDING = `
  t.transaction_type = 'DEBIT'
  AND t.currency    = 'INR'
  AND t.is_deleted  = 0
  AND t.is_excluded = 0
  AND t.is_refunded = 0
  AND t.is_transfer = 0
  AND t.repaid_at IS NULL
`;

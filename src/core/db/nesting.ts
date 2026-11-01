/**
 * Transactions that can be opened inside one another.
 *
 * Both adapters used to issue a bare `BEGIN`, which SQLite refuses when a
 * transaction is already open — "cannot start a transaction within a
 * transaction". That was invisible for as long as every write path was a leaf.
 * It stopped being invisible when section 12.4 made one write path call
 * another: `createManualTransaction` opens a transaction, and the lend match
 * it now runs attaches a repayment, which opens its own.
 *
 * Wrapping every inner call in a flag that says "my caller already began one"
 * would spread that knowledge through modules that have no business holding
 * it, and would be wrong the first time one of them was called directly.
 * Nesting is handled here instead, once, for both adapters.
 *
 * The outermost call is a real transaction. Every call inside it is a
 * savepoint, so an inner failure rolls back exactly its own work and leaves
 * the outer transaction open and intact, which is what a caller that catches
 * the error expects to be true.
 */
export function nestableTransaction(run: (sql: string) => void) {
  let depth = 0;

  return function transaction<T>(fn: () => T): T {
    const savepoint = `fme_sp_${depth}`;
    run(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    depth += 1;

    try {
      const value = fn();
      depth -= 1;
      run(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return value;
    } catch (error) {
      depth -= 1;
      if (depth === 0) {
        run('ROLLBACK');
      } else {
        // `ROLLBACK TO` undoes the work but leaves the savepoint on the
        // stack, so it has to be released as well or the stack grows with
        // every failure.
        run(`ROLLBACK TO ${savepoint}`);
        run(`RELEASE ${savepoint}`);
      }
      throw error;
    }
  };
}

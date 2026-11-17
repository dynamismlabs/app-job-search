/**
 * The query layer's synchronous handle on the installation database.
 *
 * Job Search keeps its records in the core's own `data.sqlite` (so backups,
 * restores and the safe-change snapshot carry them), with its tables created
 * by the app's migrations. Its rules (a stage change with its event and
 * review item, an ingested page with its checkpoint) commit in one
 * read-then-write transaction: the core's `transaction(ctx, work)`, on the
 * core's own connection. Cloudflare D1 can't read inside a transaction yet,
 * so the app runs on the Node service only (`platforms` in app.config.ts, and
 * docs/parity.md).
 *
 * The query layer prepares statements anywhere, as it did in Ri. Inside a
 * transaction (`transaction` in data.ts) a statement runs on that
 * transaction's `tx`. Outside one it runs as a transaction of its own, as
 * SQLite runs a statement when no transaction is open.
 */
import { transaction as coreTransaction, type Platform, type SqlDriver, type Transaction } from "@app-builder/core";
import type { SqlDatabase, SqlValue } from "./data.js";

type Statement = ReturnType<Transaction["prepare"]>;
const handles = new WeakMap<SqlDriver, SqlDatabase>();

/** The query layer's handle on the core's connection for one installation. */
function coreDatabase(ctx: { platform: Platform }): SqlDatabase {
  let open: { tx: Transaction; statements: Map<string, Statement> } | null = null;
  const within = <T>(work: (tx: Transaction, statements: Map<string, Statement>) => T): T => {
    if (open) return work(open.tx, open.statements);
    return coreTransaction(ctx, (tx) => {
      const current = open = { tx, statements: new Map<string, Statement>() };
      try { return work(tx, current.statements); }
      finally { open = null; }
    });
  };
  const statement = (tx: Transaction, statements: Map<string, Statement>, sql: string) => {
    let prepared = statements.get(sql);
    if (!prepared) {
      prepared = tx.prepare(sql);
      statements.set(sql, prepared);
    }
    return prepared;
  };
  return {
    prepare: (sql) => ({
      run: (...params: SqlValue[]) => within((tx, statements) => statement(tx, statements, sql).run(...params)),
      get: (...params: SqlValue[]) => within((tx, statements) => statement(tx, statements, sql).get(...params)),
      all: (...params: SqlValue[]) => within((tx, statements) => statement(tx, statements, sql).all(...params)),
    }),
    transaction: (work) => within(() => work()),
  };
}

/**
 * The handle for this installation. A request may carry its own copy of the
 * core's platform, so handles are kept by the connection's driver.
 */
export function databaseFor(platform: Platform): SqlDatabase {
  let handle = handles.get(platform.driver);
  if (!handle) {
    handle = coreDatabase({ platform });
    handles.set(platform.driver, handle);
  }
  return handle;
}

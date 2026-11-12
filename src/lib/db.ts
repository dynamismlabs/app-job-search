/**
 * The query layer's synchronous handle on the installation database.
 *
 * Job Search keeps its records in the core's own `data.sqlite` (so backups,
 * restores and the safe-change snapshot carry them), with its tables created
 * by the app's migrations. Its rules (a stage change with its event and
 * review item, an ingested page with its checkpoint) commit in one
 * read-then-write transaction. The core's database interface is asynchronous
 * and offers only atomic batches, since Cloudflare D1 has no interactive
 * transactions, so the app opens its own synchronous better-sqlite3 handle on
 * the same file, in the same process that holds the data lock.
 *
 * Transactions never wait on anything (see `transaction` in data.ts), so the
 * core's connection and this one never hold the write lock across an await.
 * This is why the app runs on the Node service only (see docs/parity.md).
 */
import os from "node:os";
import path from "node:path";
import SQLite from "better-sqlite3";
import type { Platform, SqlDriver } from "@app-builder/core";
import { appConfig } from "../../app.config";
import type { SqlDatabase, SqlValue } from "./data.js";

const handles = new WeakMap<SqlDriver, SqlDatabase>();
const byFile = new Map<string, SqlDatabase>();

/** Adapt a better-sqlite3 connection to the query layer's interface. */
export function wrap(connection: SQLite.Database): SqlDatabase {
  const statements = new Map<string, SQLite.Statement>();
  const prepared = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = connection.prepare(sql);
      if (statements.size > 500) statements.clear();
      statements.set(sql, statement);
    }
    return statement;
  };
  return {
    exec: (sql) => { connection.exec(sql); },
    prepare: (sql) => {
      const statement = prepared(sql);
      return {
        run: (...params: SqlValue[]) => {
          const result = statement.run(...params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        get: (...params: SqlValue[]) => (statement.reader ? statement.get(...params) as Record<string, unknown> | undefined : (statement.run(...params), undefined)),
        all: (...params: SqlValue[]) => (statement.reader ? statement.all(...params) as Record<string, unknown>[] : (statement.run(...params), [])),
      };
    },
    get isTransaction() { return connection.inTransaction; },
  };
}

/** Tests pass the connection the core opened, so both use one handle. */
export function registerDatabase(driver: SqlDriver, connection: SQLite.Database) {
  const handle = wrap(connection);
  handles.set(driver, handle);
  return handle;
}

/** The data directory the core's Node server uses: APP_DATA_DIR, or ~/.local/share/<app id>. */
export function dataDirectory() {
  return path.resolve(process.env.APP_DATA_DIR ?? path.join(os.homedir(), ".local/share", appConfig.id));
}

/**
 * The handle for this installation. The server opens the database itself
 * (serveApp), so the app opens a second connection to the same file once.
 */
export function databaseFor(platform: Pick<Platform, "driver">): SqlDatabase {
  const known = handles.get(platform.driver);
  if (known) return known;
  const file = path.join(dataDirectory(), "data.sqlite");
  let handle = byFile.get(file);
  if (!handle) {
    const connection = new SQLite(file, { fileMustExist: true });
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    connection.pragma("busy_timeout = 5000");
    handle = wrap(connection);
    byFile.set(file, handle);
  }
  handles.set(platform.driver, handle);
  return handle;
}

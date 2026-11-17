/**
 * The app's storage for one installation: the query layer's synchronous
 * handle on the installation database (lib/db.ts), with the stores built on
 * it. Every action and job run binds it from the core's platform first
 * (`bindState`), so the query layer keeps calling `app()` as it did in Ri.
 * One process serves one installation, so there is one state at a time.
 */
import { z } from 'zod/v3';
import type { Platform } from '@app-builder/core';
import { AppError } from '../lib/contract.js';
import { createBlobStore, createJobQueue, createSettings, nowIso, scopeFingerprint, sha256, transaction, type AccessScope, type BlobStore, type JobQueue, type SqlDatabase } from '../lib/data.js';
import { createAccountStore, createMailIndex, type AccountStore, type MailIndex } from '../lib/sources.js';
import { databaseFor } from '../lib/db.js';
import { DEFAULT_ACCOUNT, type AppInvocation, type InvocationAccess } from '../lib/invocation.js';

export interface AppState {
  db: SqlDatabase;
  blobs: BlobStore;
  jobs: JobQueue;
  accounts: AccountStore;
  mail: MailIndex;
  settings: ReturnType<typeof createSettings>;
  store: { mutate<T>(invocation: AppInvocation, action: string, input: unknown, operation: () => T): T };
}

let current: AppState | null = null;
const states = new WeakMap<SqlDatabase, AppState>();
let clock: () => Date = () => new Date();

/** The current time. Tests replace it with a fixed clock. */
export const now = () => clock();
export const nowAt = () => clock().toISOString();
export function setClock(next: (() => Date) | null) {
  clock = next ?? (() => new Date());
}

export function app(): AppState {
  if (!current) throw new AppError('app_failed', 'The app storage is not open yet');
  return current;
}

function openState(db: SqlDatabase): AppState {
  const settings = createSettings(db);
  return {
    db,
    blobs: createBlobStore(db),
    jobs: createJobQueue(db),
    accounts: createAccountStore(db),
    mail: createMailIndex(db),
    settings,
    store: { mutate: (invocation, action, input, operation) => mutate(db, invocation, action, input, operation) },
  };
}

/** Bind the state for the platform a request or job run uses. */
export function bindState(platform: Pick<Platform, 'driver'>): AppState {
  const db = databaseFor(platform);
  let state = states.get(db);
  if (!state) {
    state = openState(db);
    states.set(db, state);
  }
  current = state;
  return state;
}

/**
 * A write, once per durable operation. When the caller sends an operationId,
 * a retry with it returns the first result instead of writing again. The
 * saved result holds data the caller could see when it was written, so a
 * replay by anyone but the owner is refused unless their sources are exactly
 * the same. Without an operationId the write simply runs in one transaction.
 */
function mutate<T>(db: SqlDatabase, invocation: AppInvocation, action: string, input: unknown, operation: () => T): T {
  if (!invocation.durable) return transaction(db, operation);
  const digest = sha256(JSON.stringify(input));
  return transaction(db, () => {
    const actor = JSON.stringify(invocation.principal);
    const authority = authorityOf(invocation.scope);
    const prior = db.prepare('SELECT actor, action, input_digest, result, authority FROM app_invocations WHERE id = ?').get(invocation.id);
    if (prior) {
      if (prior.actor !== actor || prior.action !== action || prior.input_digest !== digest)
        throw new AppError('conflict', 'This operation ID belongs to a different change');
      const owner = invocation.scope.kind === 'owner';
      if (!owner && prior.authority !== authority)
        throw new AppError('conflict', 'Your access changed after this change was saved. Reload to see what you can view now');
      return JSON.parse(String(prior.result)) as T;
    }
    const result = operation();
    db.prepare('INSERT INTO app_invocations (id, created_at, actor, action, input_digest, result, authority) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(invocation.id, nowIso(), actor, action, digest, JSON.stringify(result), authority);
    return result;
  });
}

/**
 * What a saved write result may hold: the sources this caller may see. In Ri,
 * deleting an account's data also removed it from every chat's scope. The
 * core does the same here: a connection's choice keeps only the sources
 * `sources.list` still returns, so a replay after the account's data was
 * deleted is refused, as before.
 */
export function authorityOf(scope: AccessScope): string {
  return scopeFingerprint(scope);
}

/**
 * The data revision: a counter bumped inside every write transaction, so a
 * screen notices any change cheaply.
 */
export function bumpRevision(): number {
  const { settings } = app();
  const next = settings.get('data.revision', z.number().int(), 0) + 1;
  settings.set('data.revision', next);
  settings.set('data.changedAt', nowIso());
  return next;
}
export function dataRevision(): string {
  return `r${app().settings.get('data.revision', z.number().int(), 0)}`;
}

// ─── What the hub allows ─────────────────────────────────────────────────────

const MAIL_TOOLS = ['gmail__search_messages', 'gmail__get_message', 'gmail__read_message', 'gmail__get_profile', 'gmail__list_history'];
const CALENDAR_TOOLS = ['google_calendar__sync_events', 'google_calendar__list_calendars', 'google_calendar__list_events'];

/** Remember the hub's tool list, read on the last successful contact. Reads use it without calling Ri. */
export function rememberHubTools(tools: Iterable<string> | null) {
  app().settings.set('hub.tools', tools ? [...tools].sort() : null);
  app().settings.set('hub.checkedAt', nowIso());
}
export function hubTools(): string[] | null {
  return app().settings.get('hub.tools', z.array(z.string()).nullable(), null);
}

/**
 * The accounts set up in Sources, each with what the hub allows for its kind.
 * In Ri this came with every call; here it's the app's own setup plus the
 * hub's tool list (Ri doesn't tell the app which accounts it granted).
 */
export function accessNow(): InvocationAccess {
  const tools = new Set(hubTools() ?? []);
  const accounts = app().accounts.list().flatMap((stored) => {
    const actions = (stored.kind === 'mail' ? MAIL_TOOLS : CALENDAR_TOOLS).filter((tool) => tools.has(tool)).map((tool) => tool.replace('__', '.'));
    const usable = stored.kind === 'mail' ? actions.includes('gmail.search_messages') : actions.includes('google_calendar.sync_events') || actions.includes('google_calendar.list_events');
    return usable ? [{ account: stored.account, binding: stored.kind, actions, automatic: stored.automatic }] : [];
  });
  return { protocol: 'app-builder-connection', actorId: '', scopeRef: null, accounts };
}

export { DEFAULT_ACCOUNT };

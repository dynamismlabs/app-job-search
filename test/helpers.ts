/**
 * Test harness: a fresh installation in a temporary data directory, opened
 * the way the App Builder core opens it, and the callers that reach it:
 *
 * - `owner()` is the person's own browser (no connection).
 * - `chat(name, scopeRef)` is an assistant connection with the access the
 *   person chose for it on the consent screen. In Ri a chat's scope came from
 *   create_scope; here `call('create_scope', ...)` records that choice for the
 *   test (the consent screen does it in the app), and `revoke_scope` stands
 *   for disconnecting it in Settings, after which the core refuses its token.
 * - `job(accounts)` is the core's job runner, with these accounts set up in
 *   Sources.
 *
 * Ri's hub is played by a hub-shaped fake (fakes.ts `hubFrom`) or the core's
 * own fixture source. Actions run through the core's action router, which
 * parses inputs, refuses writes for read-only connections and checks
 * outputs. All data is fictional.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { actionContract, createActionRouter, type ConnectorSource, type Context, type Platform } from '@app-builder/core';
import { openNodePlatform } from '@app-builder/core/node';
import { application } from '../src/app.js';
import { AppError } from '../src/lib/contract.js';
import { registerDatabase } from '../src/lib/db.js';
import { runHandler } from '../src/lib/action.js';
import { app, bindState, hubTools, rememberHubTools, setClock, DEFAULT_ACCOUNT } from '../src/server/state.js';
import { runStep, scheduledSources } from '../src/server/sync.js';
import { hubFrom, type Capability } from './fakes.js';

const temporary: string[] = [];
let opened: Awaited<ReturnType<typeof openNodePlatform>> | null = null;

export function tempDir(prefix = 'job-search-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}
afterEach(() => {
  opened?.close();
  opened = null;
  setClock(null);
  scopes.clear();
  for (const dir of temporary.splice(0)) {
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(os.tmpdir())) && !resolved.startsWith(fs.realpathSync(os.tmpdir()))) throw new Error(`Refusing to remove ${dir}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

export const contract = actionContract(application);

/** Open a fresh installation, as `serve` would, in a disposable data directory. */
export async function setup(options: { now?: string } = {}) {
  const dir = tempDir();
  if (options.now) {
    const fixed = new Date(options.now);
    setClock(() => new Date(fixed));
  }
  opened = await openNodePlatform(application, { dataDir: path.join(dir, 'data'), localOwner: true, baseURL: 'http://127.0.0.1:4310' });
  registerDatabase(opened.platform.driver, opened.connection);
  bindState(opened.platform);
  return { dir, dataDir: path.join(dir, 'data'), platform: opened.platform };
}
export function platform(): Platform {
  if (!opened) throw new Error('Call setup() first');
  return opened.platform;
}

export interface GrantedAccount { account: string; binding: 'mail' | 'calendar'; actions: string[]; automatic: boolean }
export interface CallerOptions {
  scopeRef?: string | null;
  accounts?: GrantedAccount[];
  capability?: Capability;
  /** A durable operation ID, as Ri's invocation ID was: a retry with it returns the first result. */
  id?: string;
  /** Use this hub source as is (the core's fixture source, for example). */
  hub?: ConnectorSource;
}
type Kind = 'owner' | 'chat' | 'job' | 'fixture';
export interface Caller { kind: Kind; name: string; options: CallerOptions }

export const caller = (kind: Kind, name = kind === 'owner' ? 'owner' : kind === 'chat' ? 'c-1' : kind === 'job' ? 'sync_sources' : 'preview', options: CallerOptions = {}): Caller => ({ kind, name, options });
export const owner = (options: CallerOptions = {}) => caller('owner', 'owner', options);
export const fixture = (options: CallerOptions = {}) => caller('fixture', 'preview', options);
export const chat = (name: string, scopeRef: string | null, options: CallerOptions = {}) => caller('chat', name, { ...options, scopeRef });
export const job = (accounts: GrantedAccount[], options: CallerOptions = {}) => caller('job', 'sync_sources', { ...options, accounts });
export const mailAccount = (account: string, automatic = true): GrantedAccount => ({ account, binding: 'mail', actions: ['gmail.get_profile', 'gmail.search_messages', 'gmail.get_message', 'gmail.read_message', 'gmail.list_history'], automatic });
export const calendarAccount = (account: string, automatic = true): GrantedAccount => ({ account, binding: 'calendar', actions: ['google_calendar.list_calendars', 'google_calendar.sync_events'], automatic });

/** The consent screen's choice for each test connection, by the reference `create_scope` returned. */
const scopes = new Map<string, { actorId: string; sources: string[]; write: boolean; revoked: boolean; label: string }>();

/** Accounts a caller brings are set up in Sources, as the person would add them. */
function prepare(target: Caller) {
  const accounts = target.options.accounts ?? [];
  for (const account of accounts) {
    const stored = app().accounts.get(account.account, account.binding);
    if (!stored || stored.automatic !== account.automatic)
      app().accounts.setup({ account: account.account, kind: account.binding, historyDays: stored?.historyDays ?? 90, calendars: account.binding === 'calendar' ? stored?.calendars ?? ['primary'] : [], automatic: account.automatic });
  }
  platform().connectors = target.options.hub ?? hubFrom(target.options.capability, accounts);
  // Reads use the hub's tool list from the last contact, as after a sync.
  const tools = accounts.flatMap((account) => account.actions.map((action) => action.replace('.', '__')));
  if (tools.length) rememberHubTools(new Set([...tools, ...(hubTools() ?? [])]));
}

function contextFor(target: Caller): Context {
  const base = { platform: platform(), viewer: { id: 'local-owner', name: 'You', email: 'owner@localhost' }, request: new Request('http://127.0.0.1:4310/api/trpc/run', { method: 'POST' }) };
  if (target.kind === 'chat') {
    const choice = target.options.scopeRef ? scopes.get(target.options.scopeRef) : undefined;
    if (!choice) throw new AppError('forbidden', 'This connection has no recorded choice, so the core refuses its token');
    if (choice.revoked) throw new AppError('revoked', 'This connection was disconnected in Settings, so the core refuses its token');
    if (choice.actorId !== `chat:${target.name}`) throw new AppError('forbidden', 'This access belongs to a different connection');
    return { ...base, connection: { clientId: target.name, name: target.name, sources: choice.sources, write: choice.write, collections: false } };
  }
  if (target.kind === 'job') {
    const scheduledFor = new Date().toISOString();
    return { ...base, job: { name: target.name, runId: `${target.name}@${scheduledFor}`, scheduledFor, attempt: 1, checkpoint: undefined, saveCheckpoint: async () => {} } };
  }
  return base;
}

/** The AppError a typed core error stands for, so tests read the same codes as in Ri. */
function unwrap(error: unknown): unknown {
  if (error instanceof TRPCError) {
    if (error.cause instanceof AppError || (error.cause as { name?: string })?.name === 'AppError') return error.cause;
    const code = error.code === 'FORBIDDEN' ? 'forbidden' : error.code === 'NOT_FOUND' ? 'not_found' : error.code === 'BAD_REQUEST' ? 'invalid_input' : error.code === 'CONFLICT' ? 'conflict' : 'app_failed';
    return new AppError(code, error.message);
  }
  return error;
}

/** Call an action the way a host would: through the core's action router for that caller. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(name: string, input: unknown, target: Caller = owner()): Promise<T> {
  if (!opened) throw new Error('Call setup() first');
  bindState(opened.platform);
  if (name === 'create_scope') {
    const { actorId, sources, operations, label } = input as { actorId: string; sources: string[]; operations: ('read' | 'write')[]; label?: string };
    const scopeRef = randomUUID();
    scopes.set(scopeRef, { actorId, sources: [...new Set(sources)].sort(), write: operations.includes('write'), revoked: false, label: label ?? sources.join(', ') });
    return { scopeRef, label: label ?? sources.join(', '), sources: [...new Set(sources)].sort(), operations: [...new Set(operations)].sort() } as T;
  }
  if (name === 'revoke_scope') {
    const choice = scopes.get((input as { scopeRef: string }).scopeRef);
    if (!choice) throw new AppError('not_found', 'This access record is not available');
    choice.revoked = true;
    return { scopeRef: (input as { scopeRef: string }).scopeRef, revokedAt: new Date().toISOString() } as T;
  }
  if (name === 'list_scopes') return { scopes: [...scopes.entries()].map(([id, choice]) => ({ id, actorId: choice.actorId, label: choice.label, sources: choice.sources, operations: choice.write ? ['read', 'write'] : ['read'], revokedAt: choice.revoked ? 'revoked' : null })) } as T;
  prepare(target);
  const ctx = contextFor(target);
  // Ri's schedule ran one bounded step per call. The sync_sources job runs these steps in a loop.
  if (target.kind === 'job' && (name === 'run_background_step' || name === 'sync_step' || name === 'enrich_step')) {
    const kinds = name === 'sync_step' ? ['sync_mail', 'sync_calendar'] as const : name === 'enrich_step' ? ['enrich_mail'] as const : undefined;
    const source = (input as { source?: string })?.source;
    return runHandler(ctx, async (invocation) => {
      const { sources } = await scheduledSources(invocation);
      return runStep(invocation, { sources: new Set([...sources].filter((key) => !source || key === source)), kinds: kinds ? [...kinds] : undefined });
    }) as Promise<T>;
  }
  const action = application.actions.find((item) => item.name === name);
  if (!action) throw new Error(`Unknown action ${name}`);
  const body = { ...(input as Record<string, unknown>) };
  if (target.options.id && action.effect !== 'read' && !('operationId' in body)) body.operationId = target.options.id;
  try {
    if (target.kind === 'job' && !action.audience.includes('agent')) return await action.execute(ctx, body) as T;
    const router = createActionRouter(application, target.kind === 'chat' ? 'agent' : 'user');
    const result = await router.createCaller(ctx).run({ name, input: body });
    return JSON.parse(JSON.stringify(result)) as T;
  } catch (error) {
    throw unwrap(error);
  }
}

/** Draw a show_* card as an assistant connection would, and return its summary and data. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function show<T = any>(name: string, input: Record<string, unknown>, target: Caller = owner()): Promise<{ summary: string; data: T }> {
  bindState(platform());
  prepare(target);
  const view = application.views!.find((item) => item.name === name);
  if (!view) throw new Error(`Unknown view ${name}`);
  try { return JSON.parse(JSON.stringify(await view.render(contextFor(target), input))); }
  catch (error) { throw unwrap(error); }
}

export { DEFAULT_ACCOUNT };

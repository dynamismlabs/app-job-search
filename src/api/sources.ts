import { z } from 'zod/v3';
import { AppError } from '../lib/contract.js';
import { defineAction } from '../lib/action.js';
import { accountSource } from '../lib/data.js';
import { listCalendars } from '../lib/sources.js';
import { classifyMessage } from '../domain/classify.js';
import { CLASSIFICATIONS, CLASSIFICATION_LABELS } from '../domain/model.js';
import { DEFAULT_ACCOUNT, requireOwner, type AppInvocation } from '../lib/invocation.js';
import { accessNow, app, rememberHubTools } from '../server/state.js';
import { deleteSourceData, listSources, sourceSetup } from '../server/sources.js';
import { ensureJobs, MAIL_QUERY, refreshHub, runSteps, runStep, scheduledSources } from '../server/sync.js';
import { exampleStep, stepSummarySchema } from './common.js';

const sourceSummarySchema = z.object({
  key: z.string(), account: z.string().nullable(), kind: z.enum(['mail', 'calendar', 'collection']), label: z.string(),
  granted: z.boolean(), automatic: z.boolean(), paused: z.boolean(), status: z.string(), historyDays: z.number().int().nullable(), calendars: z.array(z.string()),
  coverage: z.object({ from: z.string().nullable(), to: z.string().nullable(), partial: z.boolean() }).strict(),
  lastSuccessAt: z.string().nullable(), pending: z.number().int(), failed: z.number().int(), lastError: z.string().nullable(), records: z.number().int(),
}).strict();
const exampleSource = {
  key: 'account:conn-mail-1', account: 'conn-mail-1', kind: 'mail' as const, label: 'you@example.test', granted: true, automatic: true, paused: false, status: 'importing', historyDays: 90, calendars: [],
  coverage: { from: '2026-09-02T12:00:00.000Z', to: '2026-10-15T12:00:00.000Z', partial: true }, lastSuccessAt: '2026-10-15T12:00:00.000Z', pending: 1, failed: 0, lastError: null, records: 24,
};

/** Ri refused this account: say what to check, in the app's words. */
async function forAccount<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    const code = (error as AppError)?.code;
    if (code === 'revoked' || code === 'forbidden') throw new AppError('forbidden', `Ri doesn't let this app read that account. Check its address, and allow it on the app's page in Ri (${(error as Error).message})`);
    throw error;
  }
}

function ownerOnly(invocation: AppInvocation) {
  requireOwner(invocation, 'Only a connection that can see all of Job Search can manage its sources');
}

const hubSchema = z.object({ connected: z.boolean(), mail: z.boolean(), calendar: z.boolean(), ai: z.boolean(), tasks: z.boolean(), message: z.string().nullable() }).strict();

export const listSourcesAction = defineAction({
  name: 'list_sources',
  description: 'List this app\'s sources: the two collections the person owns and each account set up from Ri, showing whether Ri allows reading it now, whether it updates automatically, paused, its history range, coverage, last success, pending and failed steps and a redacted last error. Also says what Ri lends this app: mail, calendar, its model and tasks.',
  input: z.object({}).strict(),
  output: z.object({ sources: z.array(sourceSummarySchema), hub: hubSchema }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app',
  examples: [{ input: {}, output: { sources: [exampleSource], hub: { connected: true, mail: true, calendar: true, ai: true, tasks: true, message: null } } }],
  handler: async (_input, invocation) => {
    ownerOnly(invocation);
    const hub = await refreshHub(invocation);
    return { sources: listSources(accessNow()), hub };
  },
});

export const setSourceAction = defineAction({
  name: 'set_source',
  description: `Add or change one account read through Ri: history range (30, 90 or 365 days), the calendars to read for interviews, whether it updates automatically, or pause and resume updates. Use account "${DEFAULT_ACCOUNT}" for the one account Ri allows, or the account's address as Ri shows it when Ri allows several.`,
  input: z.object({ account: z.string().min(1).max(128), kind: z.enum(['mail', 'calendar']), historyDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(), calendars: z.array(z.string().min(1).max(1024)).max(10).optional(), paused: z.boolean().optional(), automatic: z.boolean().optional() }).strict(),
  output: z.object({ source: sourceSummarySchema }).strict(),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', viewOnly: true, visibility: 'app',
  examples: [{ input: { account: 'default', kind: 'mail', historyDays: 90 }, output: { source: exampleSource } }],
  handler: async (input, invocation) => {
    ownerOnly(invocation);
    const hub = app().accounts.get(input.account, input.kind) ? null : await refreshHub(invocation);
    const allows = (kind: 'mail' | 'calendar') => hub ? hub[kind] : accessNow().accounts.some((item) => item.binding === kind);
    return app().store.mutate(invocation, 'set_source', input, () => ({ source: sourceSetup(allows, input) }));
  },
});

export const listSourceCalendarsAction = defineAction({
  name: 'list_source_calendars',
  description: 'List the calendars of one Google Calendar account Ri lends this app, so the person can choose which ones to read for interviews.',
  input: z.object({ account: z.string().min(1).max(128) }).strict(),
  output: z.object({ calendars: z.array(z.object({ id: z.string(), summary: z.string(), primary: z.boolean(), accessRole: z.string().nullable() }).strict()) }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app', errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: { account: 'conn-cal-1' }, output: { calendars: [{ id: 'primary', summary: 'you@example.test', primary: true, accessRole: 'owner' }] } }],
  handler: async (input, invocation) => {
    ownerOnly(invocation);
    return { calendars: await forAccount(() => listCalendars(invocation, input.account, 'calendar')) };
  },
});

export const previewSourceAction = defineAction({
  name: 'preview_source',
  description: 'Show up to ten recent application, recruiter, interview and offer emails from one mailbox Ri lends this app, by subject and sender only, so the person can see what the app would import. Nothing is stored.',
  input: z.object({ account: z.string().min(1).max(128), historyDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(90) }).strict(),
  output: z.object({ matches: z.array(z.object({ subject: z.string(), from: z.string().nullable(), date: z.string().nullable(), label: z.string() }).strict()), query: z.string() }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app', errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: { account: 'conn-mail-1', historyDays: 90 }, output: { matches: [{ subject: 'Thank you for applying to Lumen', from: 'Lumen Recruiting', date: '2026-10-12', label: 'Application received' }], query: 'Application, recruiter, interview and offer mail from the last 90 days, received and sent' } }],
  handler: async (input, invocation) => {
    ownerOnly(invocation);
    const target = { binding: 'mail', account: input.account };
    const after = Math.floor((Date.now() - input.historyDays * 864e5) / 1000);
    const search = z.object({ messages: z.array(z.object({ id: z.string() }).passthrough()).max(500) }).passthrough().parse(await forAccount(() => invocation.capability('gmail.search_messages', { query: `(${MAIL_QUERY}) after:${after}`, maxResults: 10 }, target)));
    const matches = [];
    for (const message of search.messages.slice(0, 10)) {
      const meta = z.object({ snippet: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), internalDate: z.string().optional() }).passthrough().parse(await invocation.capability('gmail.get_message', { messageId: message.id, format: 'metadata' }, target));
      const subject = meta.headers?.Subject ?? '(no subject)';
      const classified = classifyMessage({ subject, text: meta.snippet ?? '', sent: false });
      const stamp = Date.parse(meta.headers?.Date ?? '') || (meta.internalDate ? Number(meta.internalDate) : NaN);
      const date = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toISOString().slice(0, 10) : null;
      matches.push({ subject: subject.slice(0, 200), from: (meta.headers?.From ?? '').replace(/<[^>]*>/, '').trim().slice(0, 120) || null, date, label: CLASSIFICATION_LABELS[CLASSIFICATIONS.includes(classified.classification) ? classified.classification : 'other'] });
    }
    return { matches, query: `Application, recruiter, interview and offer mail from the last ${input.historyDays} days, received and sent` };
  },
});

export const continueImportAction = defineAction({
  name: 'continue_import',
  description: 'Run one bounded import step for one account now, the same step the app\'s schedule runs: one provider page and at most ten new messages, or one small enrichment batch.',
  input: z.object({ source: z.string().regex(/^account:.{1,128}$/) }).strict(),
  output: stepSummarySchema,
  audience: ['user'], effect: 'app_write', retry: 'idempotent', viewOnly: true, timeoutMs: 40_000, visibility: 'app', errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: { source: 'account:conn-mail-1' }, output: exampleStep }],
  handler: async (input, invocation) => {
    ownerOnly(invocation);
    const account = input.source.slice('account:'.length);
    if (!app().accounts.list().some((item) => item.account === account)) throw new AppError('not_found', 'This account is not set up in Sources');
    await refreshHub(invocation);
    invocation.access = { ...accessNow(), actorId: invocation.access?.actorId ?? '' };
    if (!invocation.access.accounts.some((item) => item.account === account)) throw new AppError('forbidden', 'Ri doesn\'t allow this app to read this account now. Allow it on the app\'s page in Ri');
    const setups = ['mail', 'calendar'].map((kind) => app().accounts.get(account, kind as 'mail' | 'calendar')).filter(Boolean);
    if (setups.length && setups.every((setup) => setup!.paused)) throw new AppError('invalid_input', 'Updates are paused for this account. Resume them first');
    ensureJobs(invocation.access, { onlyAutomatic: false, account });
    // A person's Continue retries a step that failed earlier.
    for (const job of app().jobs.list(input.source)) if (job.sourceKey === input.source && job.state === 'failed') app().jobs.resume(input.source);
    // Importing comes first. A closer AI reading runs only when nothing is left to import.
    const synced = await runStep(invocation, { sources: new Set([input.source]), wake: true, kinds: ['sync_mail', 'sync_calendar'] });
    return synced.ran ? synced : runStep(invocation, { sources: new Set([input.source]), kinds: ['enrich_mail'] });
  },
});

export const deleteSourceDataAction = defineAction({
  name: 'delete_source_data',
  description: 'Delete everything imported from one account: messages, cached bodies, interviews from its calendar, stage changes it caused and its review items. Opportunities, notes, preparation and materials the person wrote are kept, and the account is removed from Sources. What Ri lends the app is changed in Ri.',
  input: z.object({ source: z.string().regex(/^account:.{1,128}$/), confirm: z.literal('delete') }).strict(),
  output: z.object({ removedMessages: z.number().int(), removedInterviews: z.number().int(), restoredStages: z.number().int() }).strict(),
  audience: ['user'], effect: 'app_delete', retry: 'idempotent', viewOnly: true, visibility: 'app',
  examples: [{ input: { source: 'account:conn-mail-1', confirm: 'delete' }, output: { removedMessages: 24, removedInterviews: 1, restoredStages: 2 } }],
  handler: (input, invocation) => {
    ownerOnly(invocation);
    return app().store.mutate(invocation, 'delete_source_data', input, () => deleteSourceData(input.source));
  },
});

export const runBackgroundStepAction = defineAction({
  name: 'run_background_step',
  title: 'Update from mail and calendar',
  description: 'The app\'s schedule (the sync_sources job, every five minutes): recover interrupted steps, then run bounded sync and enrichment steps for the accounts that update automatically, rotating fairly between accounts and kinds of work, for at most about 25 seconds.',
  input: z.object({}).strict(),
  output: z.object({ steps: z.array(stepSummarySchema), message: z.string() }).strict(),
  audience: ['schedule'], effect: 'app_write', retry: 'idempotent', errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: {}, output: { steps: [exampleStep], message: exampleStep.message } }],
  handler: async (_input, invocation) => {
    const { hub, sources } = await scheduledSources(invocation);
    if (!sources.size) return { steps: [], message: hub.connected ? 'No account updates automatically' : hub.message ?? 'Not connected to Ri' };
    return runSteps(invocation, { sources, budgetMs: 25_000 });
  },
});

export const sourceActions = [listSourcesAction, setSourceAction, listSourceCalendarsAction, previewSourceAction, continueImportAction, deleteSourceDataAction, runBackgroundStepAction];
export { accountSource };

/**
 * Job Search as an MCP server, the way Ri, Claude or ChatGPT reach it, and
 * Job Search reaching Ri's hub, with the core's own fixture source in Ri's
 * place (fixtures/connectors.json). Every record and message is fictional.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp, fixtureSource, jobStatus, runDueJobs, type ConnectorFixtures } from '@app-builder/core';
import { createTestConnection } from '@app-builder/core/node';
import { application } from '../src/app.js';
import { app, bindState } from '../src/server/state.js';
import { call, owner, setup, platform } from './helpers.js';

const BASE = 'http://127.0.0.1:4310';
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../fixtures/connectors.json'), 'utf8')) as ConnectorFixtures;
const viewed = { ...application, viewHTML: '<!doctype html><html data-mode="mcp"><body><div id="root"></div></body></html>' };

async function connect(token: string) {
  const server = createApp(viewed, () => platform());
  const client = new Client({ name: 'job-search-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (url, init) => server.request(String(url), init as RequestInit),
  }));
  return client;
}
const result = <T>(value: unknown) => (value as { structuredContent: { result: T } }).structuredContent.result;

describe('as an MCP server', () => {
  it('needs a token, then lists its tools, the view and open_job_search', async () => {
    await setup();
    const server = createApp(viewed, () => platform());
    const refused = await server.request(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toMatch(/resource_metadata=/);

    const { accessToken } = await createTestConnection(platform(), { name: 'Ri' });
    const client = await connect(accessToken);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['list_opportunities', 'save_opportunity', 'get_today', 'show_opportunities', 'show_today', 'open_job_search']));
    // View-only tools are listed for the view, marked for the host to keep from its model.
    const deleting = (await client.listTools()).tools.find((tool) => tool.name === 'delete_source_data');
    expect(deleting?._meta?.ui).toMatchObject({ visibility: ['app'] });
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain('ui://job-search/main');
    await client.close();
  });

  it('a connection allowed to change records saves through MCP; a read-only one is refused and sees the saved record', async () => {
    await setup();
    const writer = await connect((await createTestConnection(platform(), { name: 'Ri', write: true })).accessToken);
    const operationId = crypto.randomUUID();
    const saved = result<{ status: string; record: { id: string; company: string } }>(await writer.callTool({ name: 'save_opportunity', arguments: { company: 'Northstar', role: 'Product designer', operationId } }));
    expect(saved).toMatchObject({ status: 'saved', record: { company: 'Northstar' } });
    // A retry with the same operation ID returns the first result and adds nothing.
    const again = result<{ record: { id: string } }>(await writer.callTool({ name: 'save_opportunity', arguments: { company: 'Northstar', role: 'Product designer', operationId } }));
    expect(again.record.id).toBe(saved.record.id);
    const reader = await connect((await createTestConnection(platform(), { name: 'Ri · Family', write: false })).accessToken);
    const refused = await reader.callTool({ name: 'save_opportunity', arguments: { company: 'Cedar', role: 'Design lead' } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toMatch(/can read but not make changes/);
    const listed = result<{ items: { company: string }[]; total: number }>(await reader.callTool({ name: 'list_opportunities', arguments: {} }));
    expect(listed.total).toBe(1);
    const card = await reader.callTool({ name: 'show_opportunities', arguments: { ids: [saved.record.id] } });
    expect(card.structuredContent).toMatchObject({ view: 'show_opportunities', data: { items: [{ company: 'Northstar' }] } });
    await writer.close(); await reader.close();
  });

  it('a connection limited to saved jobs never sees materials or mail, and one disconnected in Settings is refused', async () => {
    await setup();
    await call('save_material_version', { kind: 'resume', title: 'Product design résumé', text: 'Sam Rivera\nFictional résumé' }, owner());
    const { clientId, accessToken } = await createTestConnection(platform(), { name: 'Ri · Family', sources: ['manual'] });
    const client = await connect(accessToken);
    expect(result<{ items: unknown[] }>(await client.callTool({ name: 'list_materials', arguments: {} })).items).toEqual([]);
    await client.close();
    const server = createApp(viewed, () => platform());
    // The person disconnects it in Settings (local owner, from the app's own address).
    const removed = await server.request(`${BASE}/api/connections/${clientId}`, { method: 'DELETE', headers: { origin: BASE } });
    expect(removed.status).toBeLessThan(300);
    const after = await server.request(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(after.status).toBe(401);
  });
});

describe('access after an account\'s data is deleted', () => {
  it('the core drops the account from a connection\'s choice, so a replayed write is refused and the account doesn\'t come back', async () => {
    await setup();
    const PRIVATE = 'acct-private';
    app().accounts.setup({ account: PRIVATE, kind: 'mail', historyDays: 90, label: 'Private Gmail' });
    const { accessToken } = await createTestConnection(platform(), { name: 'Ri · Search', sources: ['manual', `account:${PRIVATE}`], write: true });
    const client = await connect(accessToken);
    const record = result<{ record: { id: string; revision: number } }>(await client.callTool({ name: 'save_opportunity', arguments: { company: 'Lumen', role: 'Staff designer' } })).record;
    const keys = async () => result<{ coverage: { sources: { key: string }[] } }>(await client.callTool({ name: 'get_opportunity', arguments: { id: record.id } })).coverage.sources.map((source) => source.key);
    expect(await keys()).toEqual(['manual', `account:${PRIVATE}`]);
    const operationId = crypto.randomUUID();
    const input = { id: record.id, expectedRevision: record.revision, notes: 'Ask about the team', operationId };
    expect((await client.callTool({ name: 'save_opportunity', arguments: input })).isError).toBeFalsy();

    // The person deletes that account's data in Sources.
    await call('delete_source_data', { source: `account:${PRIVATE}`, confirm: 'delete' }, owner());
    const replay = await client.callTool({ name: 'save_opportunity', arguments: input });
    expect(replay.isError).toBe(true);
    expect(JSON.stringify(replay.content)).toMatch(/Your access changed/);
    expect(await keys()).toEqual(['manual']);
    // Adding the same account again doesn't hand it back to a connection that had chosen it.
    app().accounts.setup({ account: PRIVATE, kind: 'mail', historyDays: 90, label: 'Private Gmail' });
    expect(await keys()).toEqual(['manual']);
    await client.close();
  });
});

describe('opening at a record and the @ menu', () => {
  it('offers records under each connection\'s access, reads one as text, and opens the app at its path', async () => {
    await setup();
    const lumen = (await call('save_opportunity', { company: 'Lumen', role: 'Staff designer', description: 'Staff designer at Lumen\n\nRequirements\n- Lead design critiques.' }, owner())).record;
    const material = (await call('save_material_version', { kind: 'resume', title: 'Product design résumé', text: 'Sam Rivera\nFictional résumé' }, owner())).record.material;
    const everything = await connect((await createTestConnection(platform(), { name: 'Ri' })).accessToken);
    const found = await everything.callTool({ name: 'search_mentions', arguments: { query: 'lum' } });
    const items = (found.structuredContent as { items: { uri: string; title: string }[] }).items;
    expect(items.map((item) => item.uri)).toContain(`app://job-search/opportunities/${lumen.id}`);
    const read = await everything.readResource({ uri: `app://job-search/opportunities/${lumen.id}` });
    const text = (read.contents[0] as { text: string }).text;
    expect(text).toContain('Lumen');
    expect(text).toContain('Lead design critiques');
    expect(text).toContain(`/opportunities/${lumen.id}`);
    const opened = await everything.callTool({ name: 'open_job_search', arguments: { path: `/opportunities/${lumen.id}` } });
    expect(opened.structuredContent).toEqual({ view: 'open_job_search', path: `/opportunities/${lumen.id}` });
    // A connection given only saved jobs finds no materials, and can't read one by its address.
    const limited = await connect((await createTestConnection(platform(), { name: 'Ri · Family', sources: ['manual'] })).accessToken);
    const none = await limited.callTool({ name: 'search_mentions', arguments: { query: 'résumé' } });
    expect((none.structuredContent as { items: unknown[] }).items).toEqual([]);
    await expect(limited.readResource({ uri: `app://job-search/materials/${material.id}` })).rejects.toThrow(/isn't available/);
    await everything.close(); await limited.close();
  });
});

describe('with the core\'s fixture source in Ri\'s place', () => {
  const at = (iso: string) => () => Date.parse(iso);

  it('the scheduled job imports job mail and calendar interviews once, and a duplicate wake-up adds nothing', async () => {
    await setup();
    let hub = fixtureSource(fixtures);
    platform().connectors = hub;
    await call('save_opportunity', { company: 'Lumen', role: 'Staff designer' }, owner({ hub }));
    await call('save_opportunity', { company: 'Northstar', role: 'Product designer' }, owner({ hub }));
    await call('save_opportunity', { company: 'Cedar', role: 'Design lead' }, owner({ hub }));
    // The person adds the one Gmail and calendar account Ri lends the app.
    await call('set_source', { sourceAccount: 'default', kind: 'mail', historyDays: 30 }, owner({ hub }));
    await call('set_source', { sourceAccount: 'default', kind: 'calendar' }, owner({ hub }));

    for (let minute = 0; minute < 30; minute += 5) await runDueJobs(application, platform(), { now: at(`2026-11-12T12:${String(minute).padStart(2, '0')}:00.000Z`), runner: 'test' });
    bindState(platform());
    const list = await call('list_opportunities', { limit: 50, view: 'active' }, owner({ hub }));
    const stages = Object.fromEntries(list.items.map((item: { company: string; stage: string }) => [item.company, item.stage]));
    expect(stages).toEqual({ Lumen: 'applied', Northstar: 'interviewing', Cedar: 'offer' });
    const count = () => Number(app().db.prepare('SELECT COUNT(*) AS count FROM correspondence').get()?.count);
    expect(count()).toBe(3);
    expect(app().db.prepare("SELECT 1 FROM correspondence WHERE message_id = 'fx-newsletter'").get()).toBeUndefined();
    const interviews = await call('list_interviews', { limit: 10 }, owner({ hub }));
    expect(interviews.items.map((item: { company: string; status: string }) => `${item.company}:${item.status}`)).toContain('Northstar:scheduled');
    // The same run again (a duplicate wake-up) and a later run read nothing twice.
    await runDueJobs(application, platform(), { now: at('2026-11-12T12:25:00.000Z'), runner: 'test-2' });
    await runDueJobs(application, platform(), { now: at('2026-11-12T13:00:00.000Z'), runner: 'test-2' });
    bindState(platform());
    expect(count()).toBe(3);
    const status = await jobStatus(application, platform(), { now: at('2026-11-12T13:00:30.000Z') });
    expect(status.jobs.find((job) => job.name === 'sync_sources')).toBeTruthy();
  });

  it('an unreachable hub keeps the checkpoint and retries; a revoked one shows the setup state', async () => {
    await setup();
    let hub = fixtureSource(fixtures);
    platform().connectors = hub;
    await call('set_source', { sourceAccount: 'default', kind: 'mail', historyDays: 30 }, owner({ hub }));
    hub = fixtureSource({ ...fixtures, unavailable: true });
    platform().connectors = hub;
    await runDueJobs(application, platform(), { now: at('2026-11-12T12:00:00.000Z'), runner: 'test' });
    let run = (await jobStatus(application, platform(), { now: at('2026-11-12T12:00:30.000Z') })).jobs.find((job) => job.name === 'sync_sources')!;
    expect(JSON.stringify(run)).toMatch(/retrying|isn't answering/);
    bindState(platform());
    expect(app().accounts.get('default', 'mail')?.checkpoint).toBeNull();

    hub = fixtureSource({ ...fixtures, revoked: true });
    platform().connectors = hub;
    await runDueJobs(application, platform(), { now: at('2026-11-12T14:00:00.000Z'), runner: 'test' });
    run = (await jobStatus(application, platform(), { now: at('2026-11-12T14:00:30.000Z') })).jobs.find((job) => job.name === 'sync_sources')!;
    expect(JSON.stringify(run)).toMatch(/connect this app again|Not connected/);
  });

  it('a follow-up waits for the person\'s approval in Ri, and is added once Ri allows the identical call', async () => {
    await setup();
    let hub = fixtureSource(fixtures);
    platform().connectors = hub;
    const record = (await call('save_opportunity', { company: 'Lumen', role: 'Staff designer' }, owner({ hub }))).record;
    const operationId = crypto.randomUUID();
    const created = await call('create_follow_up', { subject: { type: 'opportunity', id: record.id }, title: 'Follow up with Lumen', dueAt: '2026-11-19', operationId }, owner({ hub }));
    expect(created.followUp).toMatchObject({ state: 'pending', taskId: null, lastError: expect.stringMatching(/Waiting for your approval in Ri/) });
    // The follow_up_tasks job asks again and waits with Ri.
    await runDueJobs(application, platform(), { now: at('2026-11-12T12:00:00.000Z'), runner: 'test' });
    const waiting = (await jobStatus(application, platform(), { now: at('2026-11-12T12:00:30.000Z') })).jobs.find((job) => job.name === 'follow_up_tasks')!;
    expect(JSON.stringify(waiting)).toMatch(/waiting|approval/i);
    // The person approves in Ri: the identical call now returns the task.
    hub = fixtureSource({ ...fixtures, tools: { ...fixtures.tools, ri__create_task: { result: { id: '0192f0aa-0000-7000-8000-00000000e001', title: 'Follow up with Lumen' } } } });
    platform().connectors = hub;
    await runDueJobs(application, platform(), { now: at('2026-11-12T12:06:00.000Z'), runner: 'test' });
    bindState(platform());
    const listed = await call('list_follow_ups', { opportunityId: record.id }, owner({ hub }));
    expect(listed.items[0].followUp).toMatchObject({ state: 'created', taskId: '0192f0aa-0000-7000-8000-00000000e001' });
    expect(listed.items[0].task).toMatchObject({ available: true, status: 'todo' });
  });

  it('Ri\'s error codes reach the app: a deleted Ri task by its code, and a reconnect answer as a setup state', async () => {
    await setup();
    const taskId = '0192f0aa-0000-7000-8000-00000000e002';
    let hub = fixtureSource({ ...fixtures, tools: { ...fixtures.tools, ri__create_task: { result: { id: taskId, title: 'Follow up with Lumen' } } } });
    platform().connectors = hub;
    const record = (await call('save_opportunity', { company: 'Lumen', role: 'Staff designer' }, owner({ hub }))).record;
    await call('create_follow_up', { subject: { type: 'opportunity', id: record.id }, title: 'Follow up with Lumen', operationId: crypto.randomUUID() }, owner({ hub }));
    // Ri answers not_found with a message that doesn't say so: the app reads the code.
    hub = fixtureSource({ ...fixtures, tools: { ...fixtures.tools, ri__get_task: { error: { code: 'not_found', message: 'ri__get_task failed.' } } } });
    platform().connectors = hub;
    const listed = await call('list_follow_ups', { opportunityId: record.id }, owner({ hub }));
    expect(listed.items[0].task).toMatchObject({ available: false, reason: 'This Ri task was deleted' });
    // Ri asks the person to reconnect Google as an ordinary answer. The core makes it a setup state, with Ri's code.
    hub = fixtureSource({ ...fixtures, tools: { ...fixtures.tools, google_calendar__list_calendars: { result: { status: 'authorization_required', provider: 'google' } } } });
    platform().connectors = hub;
    await call('set_source', { sourceAccount: 'default', kind: 'calendar' }, owner({ hub }));
    await expect(call('list_source_calendars', { sourceAccount: 'default' }, owner({ hub }))).rejects.toMatchObject({ code: 'revoked', message: expect.stringMatching(/Reconnect your Google account in Ri/) });
  });

  it('Sources lists the accounts Ri lent, and adding one marks it added', async () => {
    await setup();
    const accounts = [
      { id: 'acc_personal', name: 'sam.rivera@example.test', provider: 'google', tools: ['gmail__search_messages', 'gmail__get_message', 'google_calendar__list_events'] },
      { id: 'acc_work', name: 'sam@work.example', provider: 'google', tools: ['google_calendar__list_events'] },
    ];
    const hub = fixtureSource({ ...fixtures, accounts });
    platform().connectors = hub;
    let sources = await call('list_sources', {}, owner({ hub }));
    expect(sources.hub.accounts).toEqual([
      { account: 'sam.rivera@example.test', label: 'sam.rivera@example.test', mail: true, calendar: true, added: { mail: false, calendar: false } },
      { account: 'sam@work.example', label: 'sam@work.example', mail: false, calendar: true, added: { mail: false, calendar: false } },
    ]);
    await call('set_source', { sourceAccount: 'sam.rivera@example.test', kind: 'mail', historyDays: 30 }, owner({ hub }));
    sources = await call('list_sources', {}, owner({ hub }));
    expect(sources.hub.accounts[0].added).toEqual({ mail: true, calendar: false });
    expect(sources.sources.map((source: { account?: string; kind: string }) => `${source.account}:${source.kind}`)).toContain('sam.rivera@example.test:mail');
    // A hub without the account list: the names come from the tools, and one account lent alone has none.
    const plain = fixtureSource(fixtures);
    platform().connectors = plain;
    sources = await call('list_sources', {}, owner({ hub: plain }));
    expect(sources.hub.accounts).toEqual([{ account: 'default', label: 'The account Ri lends', mail: true, calendar: true, added: { mail: false, calendar: false } }]);
  });

  it('a follow-up the person declines in Ri is left failed, saying so, and the job moves on', async () => {
    await setup();
    let hub = fixtureSource({ ...fixtures, tools: { ...fixtures.tools, ri__create_task: { approval: 'denied' } } });
    platform().connectors = hub;
    const record = (await call('save_opportunity', { company: 'Cedar', role: 'Design lead' }, owner({ hub }))).record;
    await expect(call('create_follow_up', { subject: { type: 'opportunity', id: record.id }, title: 'Review the offer', operationId: crypto.randomUUID() }, owner({ hub }))).rejects.toThrow(/declined this task in Ri/);
    const listed = await call('list_follow_ups', { opportunityId: record.id }, owner({ hub }));
    expect(listed.items[0].followUp).toMatchObject({ state: 'failed', lastError: expect.stringMatching(/declined/) });
    void hub;
  });

  it('a PDF is read through Ri\'s extract_text, and preparation suggestions say when Ri\'s model is unavailable', async () => {
    await setup();
    let hub = fixtureSource(fixtures);
    platform().connectors = hub;
    const file = { name: 'pinecrest.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4 fictional').toString('base64') };
    const preview = await call('preview_import', { kind: 'posting', file }, owner({ hub }));
    expect(preview.posting).toMatchObject({ company: 'Pinecrest', role: 'Platform designer', fileName: 'pinecrest.pdf' });
    const applied = await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, owner({ hub }));
    expect(applied.opportunityIds).toHaveLength(1);
    // Without ri__ai_text in Ri's grant, suggestions report that and preparation stays usable by hand.
    hub = fixtureSource({ ...fixtures, tools: { ri__extract_text: fixtures.tools!.ri__extract_text } });
    platform().connectors = hub;
    const prep = await call('get_preparation', { opportunityId: applied.opportunityIds[0] }, owner({ hub }));
    const saved = await call('save_preparation', { opportunityId: applied.opportunityIds[0], expectedRevision: 0, postingSnapshotId: prep.postingSnapshotId, requirements: prep.requirements, examples: [{ id: 'e1', text: 'Built the internal design system at Harbor.', requirementIds: [] }], questions: [], notes: '' }, owner({ hub }));
    const suggested = await call('suggest_preparation', { preparationId: saved.record.id }, owner({ hub }));
    expect(suggested).toMatchObject({ outcome: 'unavailable', message: expect.stringMatching(/Extraction unavailable/) });
  });
});

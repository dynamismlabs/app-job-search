/**
 * The app's multi-step writes commit with the core's transaction(), on the
 * core's own connection. Each test makes SQLite refuse the last step of one
 * write, as a full disk or a bug would, and checks that nothing the write had
 * already done was kept. Then it lets the step through and checks that the
 * retry writes everything exactly once. All records are fictional.
 */
import { describe, it, expect } from 'vitest';
import { parseGmailMessage } from '../src/lib/sources.js';
import { transaction } from '../src/lib/data.js';
import { ingestMessage } from '../src/server/ingest.js';
import { app, dataRevision } from '../src/server/state.js';
import { setup, call, owner, job, mailAccount } from './helpers.js';
import { fakeProvider, rawMessage } from './fakes.js';

const NOW = '2026-10-15T15:00:00Z';

/** SQLite refuses this write until `allow` drops the trigger. A TEMP trigger lives on the connection only. */
function refuse(name: string, event: string) {
  app().db.prepare(`CREATE TEMP TRIGGER ${name} ${event} BEGIN SELECT RAISE(ABORT, 'Simulated failure in ${name}'); END`).run();
}
/** The last write of most changes: the data revision's time, after the revision itself. */
const refuseRevisionBump = () => refuse('refuse_revision_bump', "BEFORE INSERT ON app_settings WHEN NEW.key = 'data.changedAt'");
const allow = (name: string) => app().db.prepare(`DROP TRIGGER ${name}`).run();
const count = (table: string) => Number(app().db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
const opportunity = (id: string) => app().db.prepare('SELECT stage, revision, stage_lock FROM opportunities WHERE id = ?').get(id);
const save = async (fields: Record<string, unknown>) => (await call('save_opportunity', fields, owner())).record as { id: string; revision: number };
const setting = (key: string) => app().db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value;
const put = (key: string, value: string) => app().db.prepare('INSERT INTO app_settings (key, created_at, updated_at, value) VALUES (?, ?, ?, ?)').run(key, NOW, NOW, JSON.stringify(value));

describe('transaction() on the core connection', () => {
  it('commits a transaction, rolls one back when it throws, and joins an open one with no savepoint', async () => {
    await setup({ now: NOW });
    const { db } = app();
    transaction(db, () => put('test.committed', 'yes'));
    expect(setting('test.committed')).toBe('"yes"');

    expect(() => transaction(db, () => { put('test.thrown', 'no'); throw new Error('Stop here'); })).toThrow('Stop here');
    expect(setting('test.thrown')).toBeUndefined();

    // An inner transaction joins the outer one: its writes go with the outer one's, even when the outer one catches its error.
    transaction(db, () => {
      put('test.outer', 'kept');
      try { transaction(db, () => { put('test.inner', 'kept too'); throw new Error('Inner'); }); } catch { /* the outer one carries on */ }
    });
    expect([setting('test.outer'), setting('test.inner')]).toEqual(['"kept"', '"kept too"']);
    expect(() => transaction(db, () => { put('test.outer-then-inner', 'no'); transaction(db, () => put('test.inner-only', 'no')); throw new Error('Outer'); })).toThrow('Outer');
    expect([setting('test.outer-then-inner'), setting('test.inner-only')]).toEqual([undefined, undefined]);
  });

  it('refuses work that waits on something, and keeps none of its writes', async () => {
    await setup({ now: NOW });
    expect(() => transaction(app().db, () => { put('test.waited', 'no'); return Promise.resolve(); })).toThrow(/must be synchronous/);
    expect(setting('test.waited')).toBeUndefined();
  });
});

describe('a failed step rolls back the whole write', () => {
  it('a stage change keeps neither the new stage nor its history event', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    const before = { row: opportunity(record.id), events: count('stage_events'), revision: dataRevision() };
    refuseRevisionBump();
    await expect(call('change_stage', { id: record.id, expectedRevision: record.revision, stage: 'applied' }, owner())).rejects.toThrow();
    expect({ row: opportunity(record.id), events: count('stage_events'), revision: dataRevision() }).toEqual(before);

    allow('refuse_revision_bump');
    const moved = await call('change_stage', { id: record.id, expectedRevision: record.revision, stage: 'applied' }, owner());
    expect(moved.status).toBe('saved');
    expect(opportunity(record.id)).toMatchObject({ stage: 'applied', revision: record.revision + 1 });
    expect(count('stage_events')).toBe(before.events + 1);
  });

  it('a submission keeps neither itself, its materials nor the stage it set, and a submitted version stays immutable', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    const material = await call('save_material_version', { kind: 'resume', title: 'Résumé', text: 'Sam Rivera\nProduct designer' }, owner());
    const versionId = material.record.version.id as string;
    const input = { opportunityId: record.id, expectedRevision: record.revision, appliedOn: '2026-10-12', channel: 'company_site', materialVersionIds: [versionId], confirmed: true };
    const before = { row: opportunity(record.id), revision: dataRevision() };
    // The stage change is the submission's last step, after the submission and its materials are written.
    refuse('refuse_stage_event', 'BEFORE INSERT ON stage_events');
    await expect(call('record_submission', input, owner())).rejects.toThrow();
    expect({ submissions: count('submissions'), materials: count('submission_materials'), row: opportunity(record.id), revision: dataRevision() })
      .toEqual({ submissions: 0, materials: 0, ...before });

    allow('refuse_stage_event');
    const saved = await call('record_submission', input, owner());
    expect(saved.status).toBe('saved');
    expect({ submissions: count('submissions'), materials: count('submission_materials') }).toEqual({ submissions: 1, materials: 1 });
    expect(opportunity(record.id)).toMatchObject({ stage: 'applied' });
    expect(() => app().db.prepare("UPDATE material_versions SET title = 'Edited' WHERE id = ?").run(versionId)).toThrow(/immutable/);
    expect(() => app().db.prepare('UPDATE submission_materials SET version_id = version_id').run()).toThrow(/keeps the exact versions/);
  });

  it('a review decision keeps neither the decision nor the stage it accepted', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Atlas Studio', role: 'Senior product designer' });
    ingestMessage(parseGmailMessage(rawMessage({ id: 'ack-2', threadId: 't-2', from: 'Atlas Studio <careers@atlasstudio.example>', subject: 'Thanks for applying to Atlas Studio', text: 'Thanks for applying to Atlas Studio.', date: '2026-10-14T17:45:00Z' })), { account: 'acct-mail', ownAddress: 'you@example.test' });
    const pending = async () => (await call('list_review', { limit: 50 }, owner())).items as { id: string; kind: string; revision: number }[];
    const suggestion = (await pending()).find((item) => item.kind === 'stage')!;
    const before = { row: opportunity(record.id), events: count('stage_events'), review: await pending(), revision: dataRevision() };
    refuseRevisionBump();
    await expect(call('resolve_match', { reviewId: suggestion.id, expectedRevision: suggestion.revision, decision: 'accept_stage' }, owner())).rejects.toThrow();
    expect({ row: opportunity(record.id), events: count('stage_events'), review: await pending(), revision: dataRevision() }).toEqual(before);

    allow('refuse_revision_bump');
    const accepted = await call('resolve_match', { reviewId: suggestion.id, expectedRevision: suggestion.revision, decision: 'accept_stage' }, owner());
    expect(accepted.status).toBe('saved');
    expect(opportunity(record.id)).toMatchObject({ stage: 'applied', stage_lock: expect.any(String) });
    expect((await pending()).some((item) => item.id === suggestion.id)).toBe(false);
  });

  it('an import keeps none of its rows, and its saved result is written with them under the same operation ID', async () => {
    await setup({ now: NOW });
    const csv = 'Company,Title,Status,Date Applied\nLumen,Staff designer,Applied,2026-10-12\nCedar,Design lead,Interviewing,2026-10-01\n';
    const preview = await call('preview_import', { kind: 'opportunities', file: { name: 'applications.csv', mimeType: 'text/csv', base64: Buffer.from(csv).toString('base64') } }, owner());
    const apply = { previewId: preview.previewId, digest: preview.digest };
    const operationId = crypto.randomUUID();
    const applied = () => app().db.prepare('SELECT applied_at FROM import_previews WHERE id = ?').get(preview.previewId)?.applied_at ?? null;
    const before = { opportunities: count('opportunities'), events: count('stage_events'), receipts: count('app_invocations'), revision: dataRevision() };

    // The second row fails after the first was written.
    refuse('refuse_second_row', "BEFORE INSERT ON opportunities WHEN NEW.company = 'Cedar'");
    await expect(call('apply_import', apply, owner({ id: operationId }))).rejects.toThrow();
    expect({ opportunities: count('opportunities'), events: count('stage_events'), receipts: count('app_invocations'), revision: dataRevision(), applied: applied() }).toEqual({ ...before, applied: null });
    allow('refuse_second_row');

    // The saved result is the last write, after every row: refusing it keeps no rows either.
    refuse('refuse_receipt', 'BEFORE INSERT ON app_invocations');
    await expect(call('apply_import', apply, owner({ id: operationId }))).rejects.toThrow();
    expect({ opportunities: count('opportunities'), events: count('stage_events'), receipts: count('app_invocations'), revision: dataRevision(), applied: applied() }).toEqual({ ...before, applied: null });
    allow('refuse_receipt');

    const first = await call('apply_import', apply, owner({ id: operationId }));
    expect(first).toMatchObject({ status: 'applied', created: 2 });
    const retry = await call('apply_import', apply, owner({ id: operationId }));
    expect(retry).toEqual(first);
    expect({ opportunities: count('opportunities'), receipts: count('app_invocations') }).toEqual({ opportunities: before.opportunities + 2, receipts: before.receipts + 1 });
  });

  it('a sync page keeps none of its messages when its checkpoint fails to save, and the next run reads them once', async () => {
    await setup({ now: NOW });
    const lumen = await save({ company: 'Lumen', role: 'Staff designer' });
    const provider = fakeProvider({ mailbox: {
      // The message arrives in a history page, which the step after the mailbox position reads.
      'acct-personal': { emailAddress: 'you@example.test', pages: [['sent-1']], history: [[{ messagesAdded: [{ message: { id: 'sent-1', threadId: 't-sent' } }] }]], messages: {
        'sent-1': { id: 'sent-1', threadId: 't-sent', from: 'Sam Rivera <you@example.test>', subject: 'Application for the Staff designer role', text: 'Hello, attached is my résumé for the Staff designer role at Lumen.', date: '2026-10-12T09:00:00Z', to: 'Lumen Jobs <jobs@lumen.example>', labels: ['SENT'] },
      } },
    } });
    const accounts = [mailAccount('acct-personal')];
    const later = () => app().db.prepare("UPDATE app_jobs SET next_eligible_at = '2000-01-01T00:00:00.000Z' WHERE state = 'pending'").run();
    const step = () => call('sync_step', {}, job(accounts, { capability: provider.capability }));
    const checkpoint = () => app().db.prepare("SELECT checkpoint FROM app_source_accounts WHERE account = 'acct-personal' AND kind = 'mail'").get()?.checkpoint ?? null;

    // The first step finds the mailbox position. The next one reads the history page.
    await step();
    const before = { checkpoint: checkpoint(), correspondence: count('correspondence'), seen: count('app_mail_messages') };
    expect(before.checkpoint).not.toBeNull();
    refuse('refuse_checkpoint', 'BEFORE UPDATE OF checkpoint ON app_source_accounts');
    const fetched = provider.calls.length;
    later();
    await step().catch(() => null);
    expect(provider.calls.slice(fetched).some((item) => item.name === 'gmail.read_message' || item.name === 'gmail.get_message')).toBe(true);
    expect({ checkpoint: checkpoint(), correspondence: count('correspondence'), seen: count('app_mail_messages') }).toEqual(before);

    allow('refuse_checkpoint');
    for (let index = 0; index < 10 && count('correspondence') === 0; index++) { later(); await step(); }
    expect(count('correspondence')).toBe(1);
    expect(app().db.prepare("SELECT COUNT(*) AS count FROM app_mail_messages WHERE message_id = 'sent-1'").get()?.count).toBe(1);
    expect((await call('get_opportunity', { id: lumen.id }, owner())).correspondence).toHaveLength(1);
  });
});

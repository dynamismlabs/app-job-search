import { z } from 'zod/v3';
import { AppError } from '../lib/contract.js';
import { defineAction } from '../lib/action.js';
import { requireOwner } from '../lib/invocation.js';
import { allows } from '../lib/data.js';
import { followUpSchema, MANUAL_SOURCE, MATERIALS_SOURCE, reviewItemSchema } from '../domain/model.js';
import { app, dataRevision } from '../server/state.js';
import { exportRecords, landingSection, today } from '../server/view.js';
import { clearFixtures, seedFixtures } from '../server/fixtures.js';
import { EX, examplePreparation, exampleReview, readScope } from './common.js';
import { num } from '../server/util.js';

const sectionSchema = z.enum(['today', 'opportunities', 'opportunity', 'preparation', 'materials', 'sources']);
const viewStateSchema = z.object({
  landing: z.enum(['today', 'opportunities']),
  revision: z.string(),
  owner: z.boolean(),
  fictional: z.boolean(),
  /** Every record is a fictional preview record, so it can be cleared in one step. */
  onlyFictional: z.boolean(),
  setup: z.object({ opportunities: z.number().int(), materials: z.number().int(), mailConnected: z.boolean(), calendarConnected: z.boolean(), review: z.number().int() }).strict(),
}).strict();
export type ViewState = z.infer<typeof viewStateSchema>;

export const getViewStateAction = defineAction({
  name: 'get_view_state',
  title: 'Job Search setup',
  description: 'The small setup state the Job Search screens open with: where to land, counts, whether mail and calendar are set up, open review items and whether the records are a fictional preview. Opening never starts a sync or any AI.',
  input: z.object({}).strict(),
  output: viewStateSchema,
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', visibility: 'app', errors: ['forbidden', 'invalid_input', 'revoked'],
  handler: (_input, invocation) => {
    const scope = readScope(invocation);
    const db = app().db;
    const owner = scope.kind === 'owner';
    const opportunities = allows(scope, MANUAL_SOURCE) ? num(db.prepare('SELECT COUNT(*) AS count FROM opportunities').get()?.count) : 0;
    const materials = allows(scope, MATERIALS_SOURCE) ? num(db.prepare('SELECT COUNT(*) AS count FROM material_families').get()?.count) : 0;
    const accounts = app().accounts.list();
    const granted = invocation.access?.accounts ?? [];
    const fictional = !!db.prepare('SELECT 1 FROM opportunities WHERE fictional = 1 LIMIT 1').get();
    const onlyFictional = fictional && !db.prepare('SELECT 1 FROM opportunities WHERE fictional = 0 LIMIT 1').get() && !db.prepare('SELECT 1 FROM material_families WHERE fictional = 0 LIMIT 1').get();
    const review = db.prepare("SELECT source_key FROM review_items WHERE status = 'open'").all().filter((row) => allows(scope, String(row.source_key))).length;
    return {
      landing: landingSection(scope), revision: dataRevision(), owner, fictional, onlyFictional,
      setup: {
        opportunities, materials,
        mailConnected: granted.some((item) => item.binding === 'mail') || accounts.some((item) => item.kind === 'mail'),
        calendarConnected: granted.some((item) => item.binding === 'calendar') || accounts.some((item) => item.kind === 'calendar'),
        review,
      },
    };
  },
});

export const todaySchema = z.object({
  date: z.string(),
  zone: z.string(),
  interviews: z.array(z.object({ interviewId: z.string(), opportunityId: z.string(), company: z.string(), role: z.string(), title: z.string(), startAt: z.string(), endAt: z.string().nullable(), zone: z.string().nullable(), format: z.string(), meetingLink: z.string().nullable(), participants: z.array(z.string()), prepared: z.boolean() }).strict()),
  scheduling: z.array(z.object({ interviewId: z.string(), opportunityId: z.string(), company: z.string(), role: z.string(), title: z.string(), since: z.string() }).strict()),
  deadlines: z.array(z.object({ opportunityId: z.string(), company: z.string(), role: z.string(), date: z.string(), label: z.string(), kind: z.enum(['deadline', 'action']), overdue: z.boolean() }).strict()),
  responses: z.array(reviewItemSchema),
  followUps: z.array(followUpSchema),
  suggestions: z.array(z.object({ opportunityId: z.string(), company: z.string(), role: z.string(), appliedOn: z.string(), quietDays: z.number().int() }).strict()),
  counts: z.object({ opportunities: z.number().int(), review: z.number().int() }).strict(),
}).strict();

export const getTodayAction = defineAction({
  name: 'get_today',
  description: 'What needs attention today: upcoming interviews with their zones, invitations to choose times, explicit deadlines and chosen next actions, responses waiting for review, linked Ri follow-ups and clearly labeled follow-up suggestions. No scores, and silence never becomes a rejection or a deadline.',
  input: z.object({ zone: z.string().max(100).optional() }).strict(),
  output: todaySchema,
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: ['forbidden', 'revoked'],
  examples: [{
    input: { zone: 'America/Denver' },
    output: {
      date: '2026-10-15', zone: 'America/Denver',
      interviews: [{ interviewId: EX.interview, opportunityId: EX.opportunity, company: 'Northstar', role: 'Product designer', title: 'Portfolio discussion', startAt: '2026-10-16T16:00:00.000Z', endAt: '2026-10-16T16:45:00.000Z', zone: 'America/Denver', format: 'video', meetingLink: 'https://meet.example.test/northstar-portfolio', participants: ['Maya Chen'], prepared: examplePreparation.examples.length > 0 }],
      scheduling: [], deadlines: [{ opportunityId: EX.opportunity2, company: 'Cedar', role: 'Design lead', date: '2026-10-21', label: 'Reply to the offer by', kind: 'deadline', overdue: false }],
      responses: [exampleReview], followUps: [], suggestions: [], counts: { opportunities: 5, review: 1 },
    },
  }],
  handler: (input, invocation) => today(readScope(invocation), input.zone),
});

export const exportRecordsAction = defineAction({
  name: 'export_records',
  description: 'Export the person\'s own Job Search records as a JSON file to download: opportunities with stage history, posting snapshots, interviews, submissions, preparation, materials and follow-ups. Message bodies are not included.',
  input: z.object({}).strict(),
  output: z.object({ fileName: z.string(), mimeType: z.literal('application/json'), text: z.string(), opportunities: z.number().int(), materials: z.number().int() }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', viewOnly: true, visibility: 'app', errors: ['forbidden', 'invalid_input'],
  examples: [{ input: {}, output: { fileName: 'job-search-export-2026-10-15.json', mimeType: 'application/json', text: '{"format":"ri-job-search-export","version":1}', opportunities: 5, materials: 2 } }],
  handler: (_input, invocation) => {
    requireOwner(invocation, 'Only the person who owns this app can export its records');
    return exportRecords(readScope(invocation));
  },
});

// ─── The fictional preview ───────────────────────────────────────────────────

const previewResult = z.object({ seeded: z.boolean(), removed: z.number().int(), message: z.string() }).strict();

export const loadPreviewAction = defineAction({
  name: 'load_preview',
  title: 'Try with fictional records',
  description: 'Fill an empty Job Search with a fictional preview: invented companies, people, mail and calendar events, marked as fictional everywhere. It does nothing once any record exists.',
  input: z.object({}).strict(),
  output: previewResult,
  audience: ['user'], effect: 'app_write', retry: 'idempotent', viewOnly: true, visibility: 'app',
  handler: (_input, invocation) => {
    requireOwner(invocation, 'Only the person who owns this app can load the preview');
    const seeded = seedFixtures();
    return { seeded, removed: 0, message: seeded ? 'Loaded the fictional preview. Every record in it is invented' : 'The preview loads only into an empty Job Search' };
  },
});

export const clearPreviewAction = defineAction({
  name: 'clear_preview',
  title: 'Remove the fictional records',
  description: 'Remove every fictional preview record: its opportunities, materials, mailbox, calendar, review items and follow-up links. Records the person added stay.',
  input: z.object({}).strict(),
  output: previewResult,
  audience: ['user'], effect: 'app_delete', retry: 'idempotent', viewOnly: true, visibility: 'app',
  handler: (_input, invocation) => {
    requireOwner(invocation, 'Only the person who owns this app can remove the preview');
    const removed = clearFixtures();
    return { seeded: false, removed, message: removed ? `Removed ${removed} fictional record${removed === 1 ? '' : 's'}` : 'There are no fictional records' };
  },
});

export const viewActions = [getViewStateAction, getTodayAction, exportRecordsAction, loadPreviewAction, clearPreviewAction];
export { reviewItemSchema };

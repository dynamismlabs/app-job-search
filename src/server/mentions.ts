/**
 * Records a host can open the app at and offer in its @ menu (the core's
 * `records`). Both run under the caller's access, like any read: a record
 * from a source this connection wasn't given isn't found. A mentioned
 * record's text is what Ri's chat context said about it (describeContext).
 */
import { allows, type AccessScope } from '../lib/data.js';
import type { InvocationAccess } from '../lib/invocation.js';
import { MANUAL_SOURCE, MATERIALS_SOURCE, stageLabel } from '../domain/model.js';
import { app } from './state.js';
import { loadBundles, summarize } from './project.js';
import { describeContext } from './view.js';
import { likePattern, str } from './util.js';

export const RECORD_PATHS = '/opportunities/<id> opens an opportunity, /interviews/<id> opens the preparation for an interview, and /materials/<id> opens a résumé or other material. /today, /opportunities, /materials and /sources open those sections.';

const ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const OPPORTUNITY = new RegExp(`^/opportunities/${ID}$`), INTERVIEW = new RegExp(`^/interviews/${ID}$`), MATERIAL = new RegExp(`^/materials/${ID}$`);

export function searchRecords(scope: AccessScope, query: string) {
  const db = app().db;
  const words = query.trim();
  const results: { path: string; title: string; description?: string }[] = [];
  if (allows(scope, MANUAL_SOURCE)) {
    const rows = words
      ? db.prepare("SELECT * FROM opportunities WHERE company LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\' ORDER BY archived_at IS NOT NULL, updated_at DESC LIMIT 20").all(likePattern(words), likePattern(words))
      : db.prepare('SELECT * FROM opportunities WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 12').all();
    for (const summary of loadBundles(rows, scope).map((bundle) => summarize(bundle, scope)))
      results.push({ path: `/opportunities/${summary.id}`, title: `${summary.company} · ${summary.role}`, description: stageLabel(summary.stage, summary.outcome) });
    const interviews = db.prepare(`SELECT interviews.id, interviews.title, interviews.source_key, interviews.start_at, opportunities.company FROM interviews JOIN opportunities ON opportunities.id = interviews.opportunity_id
      WHERE interviews.status IN ('scheduled','scheduling_needed') ${words ? "AND (interviews.title LIKE ? ESCAPE '\\' OR opportunities.company LIKE ? ESCAPE '\\')" : ''} ORDER BY interviews.start_at LIMIT 10`).all(...(words ? [likePattern(words), likePattern(words)] : []));
    for (const row of interviews.filter((item) => allows(scope, str(item.source_key))))
      results.push({ path: `/interviews/${str(row.id)}`, title: `Prepare: ${str(row.title)}`, description: `${str(row.company)}${row.start_at ? `, ${str(row.start_at).slice(0, 10)}` : ''}` });
  }
  if (allows(scope, MATERIALS_SOURCE)) {
    const rows = words
      ? db.prepare("SELECT id, title, kind FROM material_families WHERE archived_at IS NULL AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 10").all(likePattern(words))
      : db.prepare('SELECT id, title, kind FROM material_families WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 5').all();
    for (const row of rows) results.push({ path: `/materials/${str(row.id)}`, title: str(row.title), description: str(row.kind).replace('_', ' ') });
  }
  return results.slice(0, 20);
}

export function readRecord(scope: AccessScope, access: InvocationAccess | null, path: string): { title: string; text: string } | null {
  const db = app().db;
  let selected: { type: 'opportunity' | 'interview' | 'material'; id: string } | null = null, title = '';
  const opportunity = OPPORTUNITY.exec(path)?.[1], interview = INTERVIEW.exec(path)?.[1], material = MATERIAL.exec(path)?.[1];
  if (opportunity && allows(scope, MANUAL_SOURCE)) {
    const row = db.prepare('SELECT company, role FROM opportunities WHERE id = ?').get(opportunity);
    if (row) { selected = { type: 'opportunity', id: opportunity }; title = `${str(row.company)} · ${str(row.role)}`; }
  } else if (interview && allows(scope, MANUAL_SOURCE)) {
    const row = db.prepare('SELECT interviews.title, interviews.source_key, opportunities.company FROM interviews JOIN opportunities ON opportunities.id = interviews.opportunity_id WHERE interviews.id = ?').get(interview);
    if (row && allows(scope, str(row.source_key))) { selected = { type: 'interview', id: interview }; title = `${str(row.title)} at ${str(row.company)}`; }
  } else if (material && allows(scope, MATERIALS_SOURCE)) {
    const row = db.prepare('SELECT title FROM material_families WHERE id = ?').get(material);
    if (row) { selected = { type: 'material', id: material }; title = str(row.title); }
  }
  if (!selected) return null;
  return { title, text: describeContext(scope, access, { selected: [selected] }, path).modelContent };
}

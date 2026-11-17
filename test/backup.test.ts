/**
 * Backups keep the rules the database itself enforces. Job Search's triggers
 * keep a submitted material version, a posting snapshot and a submission's
 * materials exactly as they were. Backups from cores before kit PR #10 left
 * out every trigger, so a restored app would quietly let them change.
 * All data is fictional.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import SQLite from 'better-sqlite3';
import { coreMigrations } from '@app-builder/core';
import { backupNode, restoreNode } from '@app-builder/core/node';
import { application } from '../src/app.js';
import { call, owner, platform, setup } from './helpers.js';

const TRIGGERS = ['material_versions_immutable', 'posting_snapshots_immutable', 'submission_materials_immutable'];

/** A saved posting and a résumé version used in a recorded submission. */
async function submitted() {
  const saved = (await call('save_opportunity', { company: 'Northstar', role: 'Product designer', description: 'Product designer at Northstar\n\nRequirements\n- Partner with research.' }, owner())).record;
  const material = (await call('save_material_version', { kind: 'resume', title: 'Product design résumé', text: 'Sam Rivera\nProduct designer' }, owner())).record;
  await call('record_submission', { opportunityId: saved.id, expectedRevision: saved.revision, appliedOn: '2026-10-09', channel: 'company_site', materialVersionIds: [material.version.id], confirmed: true }, owner());
  return { opportunityId: saved.id, versionId: material.version.id as string };
}

/** Open a restored data directory's database directly, as nothing else holds it. */
function restoredDatabase(dataDir: string) {
  return new SQLite(path.join(dataDir, 'data.sqlite'));
}

function expectRulesKept(database: SQLite.Database, ids: { opportunityId: string; versionId: string }) {
  const triggers = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").all().map((row) => (row as { name: string }).name);
  expect(triggers).toEqual(expect.arrayContaining(TRIGGERS));
  // The submitted version and the submission came back as they were.
  expect(database.prepare('SELECT title, number FROM material_versions WHERE id = ?').get(ids.versionId)).toEqual({ title: 'Product design résumé', number: 1 });
  expect(database.prepare('SELECT COUNT(*) AS count FROM submission_materials WHERE version_id = ?').get(ids.versionId)).toEqual({ count: 1 });
  // And they still refuse an edit in place.
  expect(() => database.prepare("UPDATE material_versions SET title = 'Edited after the restore' WHERE id = ?").run(ids.versionId)).toThrow(/immutable/);
  expect(() => database.prepare("UPDATE posting_snapshots SET extracted = '{}' WHERE opportunity_id = ?").run(ids.opportunityId)).toThrow(/immutable/);
  expect(() => database.prepare("UPDATE submission_materials SET version_id = version_id WHERE version_id = ?").run(ids.versionId)).toThrow(/exact versions/);
}

describe('backups', () => {
  it('a restored backup keeps the triggers that keep a submitted material from being edited', async () => {
    const { dir } = await setup();
    const ids = await submitted();
    await backupNode(platform(), application.config.id, path.join(dir, 'backup'));
    const restoredDir = path.join(dir, 'restored');
    await restoreNode(path.join(dir, 'backup'), restoredDir, application.config.id);
    const database = restoredDatabase(restoredDir);
    try { expectRulesKept(database, ids); }
    finally { database.close(); }
  });

  it('a backup an older core made, without its triggers, gets them back from the app\'s migrations', async () => {
    const { dir } = await setup();
    const ids = await submitted();
    await backupNode(platform(), application.config.id, path.join(dir, 'backup'));
    // Cores before kit PR #10 (0.2.2 and earlier) wrote no views or triggers into the snapshot.
    const file = path.join(dir, 'backup', 'snapshot.json');
    const { views: _views, triggers: _triggers, ...older } = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(file, JSON.stringify(older));
    const restoredDir = path.join(dir, 'restored');
    // `app-builder restore` passes the core's migrations and the app's, as here.
    await restoreNode(path.join(dir, 'backup'), restoredDir, application.config.id, [...coreMigrations, ...application.migrations!]);
    const database = restoredDatabase(restoredDir);
    try { expectRulesKept(database, ids); }
    finally { database.close(); }
  });
});

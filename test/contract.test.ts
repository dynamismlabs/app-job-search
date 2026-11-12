/**
 * The app's public contract on App Builder: the actions every host can call,
 * the MCP tools an assistant lists, the `show_*` views and `open_job_search`,
 * the jobs it runs on its own and what it borrows from Ri's hub.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { actionContract } from '@app-builder/core';
import { application } from '../src/app.js';

const root = path.resolve(import.meta.dirname, '..');
// The contract as built, with the view resource the build attaches.
const contract = actionContract({ ...application, viewHTML: '<!doctype html><div id="root"></div>' });
const by = (name: string) => contract.actions.find((action) => action.name === name)!;
const tools = contract.mcp.tools as { name: string; title?: string; inputSchema: unknown; outputSchema?: unknown; _meta?: Record<string, unknown> }[];

describe('contract', () => {
  it('names every action the old app had, with the Ri-only ones replaced', () => {
    const names = contract.actions.map((action) => action.name);
    for (const name of ['list_opportunities', 'get_opportunity', 'save_opportunity', 'change_stage', 'set_stage_tracking', 'get_posting', 'record_submission', 'list_interviews', 'save_interview',
      'list_materials', 'get_material', 'save_material_version', 'compare_material_versions', 'archive_material', 'get_preparation', 'save_preparation', 'suggest_preparation', 'list_review', 'resolve_match',
      'get_correspondence', 'get_today', 'list_sources', 'set_source', 'list_source_calendars', 'preview_source', 'continue_import', 'delete_source_data', 'run_background_step', 'preview_import',
      'apply_import', 'list_imports', 'delete_import', 'create_follow_up', 'list_follow_ups', 'export_records', 'get_view_state', 'load_preview', 'clear_preview', 'create_waiting_follow_ups'])
      expect(names).toContain(name);
    // Ri's view opener, chat context and per-chat scopes are the core's now: open_job_search, the
    // bounded selection and the consent screen. Ri's three schedule entry points are one job.
    for (const name of ['open_view', 'describe_view_context', 'create_scope', 'list_scopes', 'revoke_scope', 'sync_step', 'enrich_step']) expect(names).not.toContain(name);
  });

  it('lists assistant tools with output schemas, and keeps browser-only and job actions off MCP', () => {
    const names = tools.map((tool) => tool.name);
    for (const name of ['export_records', 'delete_source_data', 'delete_import', 'load_preview', 'clear_preview', 'run_background_step', 'create_waiting_follow_ups']) {
      expect(names).not.toContain(name);
      expect(by(name).audience).toEqual(['user']);
    }
    for (const name of ['list_opportunities', 'save_opportunity', 'change_stage', 'list_sources', 'set_source', 'continue_import', 'preview_import', 'apply_import', 'get_view_state', 'show_opportunities', 'show_today', 'open_job_search'])
      expect(names).toContain(name);
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeTruthy();
      expect(tool.name).not.toMatch(/__|\.\.|\._|_\./);
      expect((tool.title ?? '').length, tool.name).toBeLessThanOrEqual(60);
    }
    const open = tools.find((tool) => tool.name === 'open_job_search')!;
    expect(open._meta?.['openai/ui']).toEqual({ entrypoints: [{ type: 'global' }] });
    expect((tools.find((tool) => tool.name === 'show_opportunities')!._meta?.ui as { resourceUri: string }).resourceUri).toBe('ui://job-search/main');
  });

  it('marks reads and writes honestly, and every write takes an operation ID for a safe retry', () => {
    for (const action of contract.actions) {
      if (action.effect === 'read') continue;
      const input = action.inputSchema as { properties: Record<string, unknown> };
      expect(input.properties.operationId, action.name).toBeTruthy();
    }
    for (const name of ['delete_source_data', 'clear_preview']) expect(by(name).effect).toBe('delete');
    for (const name of ['list_opportunities', 'list_interviews', 'list_materials', 'list_review']) {
      const input = by(name).inputSchema as { properties: Record<string, { default?: number; maximum?: number }> };
      expect(input.properties.limit).toMatchObject({ default: 50, maximum: 100 });
      expect(input.properties.cursor).toBeTruthy();
    }
  });

  it('declares its jobs and what it borrows from the hub, with no outside writes but a Ri task', () => {
    expect(contract.jobs).toEqual([
      { name: 'sync_sources', title: 'Mail and calendar updates', schedule: 'every 5 minutes', action: 'run_background_step' },
      { name: 'follow_up_tasks', title: 'Follow-ups waiting for Ri', schedule: 'every 5 minutes', action: 'create_waiting_follow_ups' },
    ]);
    expect(contract.connectors?.capabilities).toEqual(['mail.read', 'calendar.read']);
    expect(contract.connectors?.tools?.filter((tool) => !/^(gmail__(get|read|list)|google_calendar__(list|sync)|ri__(ai_text|extract_text|get_task))/.test(tool))).toEqual(['ri__create_task']);
  });

  it('keeps user-visible and model-facing copy free of long dashes and semicolons', () => {
    for (const action of contract.actions) {
      expect(action.description).not.toMatch(/[—–]/);
      expect(action.description).not.toContain(';');
    }
    const files: string[] = [];
    const walk = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) entry.isDirectory() ? walk(path.join(dir, entry.name)) : files.push(path.join(dir, entry.name)); };
    for (const dir of ['src/api', 'src/server', 'src/domain', 'src/view', 'skills']) walk(path.join(root, dir));
    const isPattern = (literal: string) => literal.includes('(?:') || literal.includes('\\') || /=>|[{}]|\(\)/.test(literal);
    for (const file of [...files, path.join(root, 'README.md'), path.join(root, 'AGENTS.md'), path.join(root, 'docs/parity.md')]) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (/\.md$/.test(file)) expect(text, file).not.toMatch(/[—–]/);
      const literals = [...(text.match(/'[^'\n]{8,}'|`[^`\n]{8,}`|"[^"\n]{8,}"/g) ?? []), ...(file.endsWith('.tsx') ? text.match(/>[^<>{}\n]{8,}</g) ?? [] : [])];
      for (const literal of literals) {
        if (isPattern(literal) || !/[a-z] [a-z]/i.test(literal)) continue;
        expect(literal, file).not.toMatch(/[—–]/);
        expect(literal, file).not.toMatch(/[a-z]; [a-z]/i);
      }
      if (file.includes(`${path.sep}src${path.sep}`)) expect(text, file).not.toMatch(/Sparkle|Wand|✨/);
    }
  });
});

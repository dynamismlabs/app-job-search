/**
 * Ri follow-ups. The link row and its operation ID are saved first, then Ri's
 * create_task runs through the hub with that operation ID, so a retry or a
 * second click always returns the same task. There is no task engine in this
 * app.
 *
 * Ri asks the person before an app adds a task. Until they approve, the link
 * stays pending with a note, and the follow_up_tasks job retries the identical
 * call; the core's job runner keeps that run waiting and retries every two
 * minutes, inside Ri's five-minute window after approval.
 */
import { AppError } from '../lib/contract.js';
import { allows, newId, redact, transaction, type AccessScope } from '../lib/data.js';
import type { AppInvocation } from '../lib/invocation.js';
import { z } from 'zod/v3';
import { MANUAL_SOURCE, type FollowUp } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { opt, str, type Row } from './util.js';

export function followUpRecord(row: Row): FollowUp {
  return {
    id: str(row.id), operationId: str(row.operation_id), opportunityId: opt(row.opportunity_id), interviewId: opt(row.interview_id), title: str(row.title), dueAt: opt(row.due_at),
    taskId: opt(row.task_id), state: str(row.state) as FollowUp['state'], lastError: opt(row.last_error), createdAt: str(row.created_at),
  };
}

export interface FollowUpInput {
  subject: { type: 'opportunity' | 'interview'; id: string };
  title: string;
  dueAt?: string | null;
  description?: string | null;
  operationId: string;
}

/** Step one, inside the invocation's write: the durable link with its operation ID. */
export function reserveFollowUp(input: FollowUpInput, author: string): Row {
  const { db } = app();
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM follow_up_links WHERE operation_id = ?').get(input.operationId);
    if (existing) return existing;
    let opportunityId: string, interviewId: string | null = null;
    if (input.subject.type === 'interview') {
      const interview = db.prepare('SELECT id, opportunity_id FROM interviews WHERE id = ?').get(input.subject.id);
      if (!interview) throw new AppError('not_found', 'This interview is not available');
      interviewId = str(interview.id);
      opportunityId = str(interview.opportunity_id);
    } else {
      if (!db.prepare('SELECT 1 FROM opportunities WHERE id = ?').get(input.subject.id)) throw new AppError('not_found', 'This opportunity is not available');
      opportunityId = input.subject.id;
    }
    const id = newId(), time = nowAt();
    db.prepare(`INSERT INTO follow_up_links (id, created_at, updated_at, operation_id, opportunity_id, interview_id, title, due_at, task_id, state, last_error, created_by, source_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, ?, ?)`).run(id, time, time, input.operationId, opportunityId, interviewId, input.title.trim().slice(0, 500), input.dueAt ?? null, author, MANUAL_SOURCE);
    bumpRevision();
    return db.prepare('SELECT * FROM follow_up_links WHERE id = ?').get(id)!;
  });
}

const taskResult = z.object({ id: z.string().min(1).max(128) }).passthrough();

/** Step two: ask Ri for the task with the saved operation ID, then remember its ID. */
export const WAITING_FOR_APPROVAL = 'Waiting for your approval in Ri. The task is added once you approve it';

/** The exact arguments for Ri's create_task, from the saved link: a retry is the identical call. */
function taskArguments(link: Row) {
  return {
    title: str(link.title),
    ...(link.description ? { description: str(link.description).slice(0, 4000) } : {}),
    ...(link.due_at ? { dueAt: str(link.due_at) } : {}),
    operationId: str(link.operation_id),
  };
}

export async function createLinkedTask(invocation: AppInvocation, link: Row, description: string | null, options: { wait?: boolean } = {}): Promise<Row> {
  const { db } = app();
  if (link.task_id) return link;
  if (description && !link.description) {
    db.prepare('UPDATE follow_up_links SET description = ? WHERE id = ?').run(description.slice(0, 4000), str(link.id));
    link = { ...link, description: description.slice(0, 4000) };
  }
  try {
    const task = taskResult.parse(await invocation.capability('create_task', taskArguments(link)));
    db.prepare("UPDATE follow_up_links SET task_id = ?, state = 'created', last_error = NULL, updated_at = ? WHERE id = ?").run(task.id, nowAt(), str(link.id));
  } catch (error) {
    const code = (error as AppError)?.code;
    if (code === 'approval_required') {
      db.prepare("UPDATE follow_up_links SET state = 'pending', last_error = ?, updated_at = ? WHERE id = ?").run(WAITING_FOR_APPROVAL, nowAt(), str(link.id));
      bumpRevision();
      // In a job run, the core's runner waits for the approval and retries this identical call.
      if (options.wait) throw (error as { cause?: unknown }).cause ?? error;
      return db.prepare('SELECT * FROM follow_up_links WHERE id = ?').get(str(link.id))!;
    }
    const message = code === 'forbidden' || code === 'unsupported' ? 'Ri tasks are not allowed for this app yet. Allow "Add tasks" on the app\'s page in Ri, then try again' : redact(error);
    db.prepare("UPDATE follow_up_links SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(message, nowAt(), str(link.id));
    bumpRevision();
    throw new AppError(code === 'forbidden' || code === 'unsupported' ? 'forbidden' : code ?? 'app_failed', message);
  }
  bumpRevision();
  return db.prepare('SELECT * FROM follow_up_links WHERE id = ?').get(str(link.id))!;
}

export function followUpRows(scope: AccessScope, filter: { opportunityId?: string; interviewId?: string }): Row[] {
  if (!allows(scope, MANUAL_SOURCE)) return [];
  const db = app().db;
  if (filter.interviewId) return db.prepare('SELECT * FROM follow_up_links WHERE interview_id = ? ORDER BY created_at DESC LIMIT 50').all(filter.interviewId);
  if (filter.opportunityId) return db.prepare('SELECT * FROM follow_up_links WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 50').all(filter.opportunityId);
  return db.prepare('SELECT * FROM follow_up_links ORDER BY created_at DESC LIMIT 50').all();
}

const taskStatus = z.object({ id: z.string(), title: z.string().optional(), status: z.string().optional() }).passthrough();
/** Whether each linked Ri task still exists, checked live and never cached. */
export async function taskAvailability(invocation: AppInvocation, rows: Row[]): Promise<Map<string, { available: boolean; status: string | null; title: string | null; reason: string | null }>> {
  const result = new Map<string, { available: boolean; status: string | null; title: string | null; reason: string | null }>();
  for (const row of rows.slice(0, 20)) {
    const taskId = opt(row.task_id);
    if (!taskId) continue;
    try {
      const task = taskStatus.parse(await invocation.capability('get_task', { id: taskId }));
      result.set(str(row.id), { available: true, status: task.status ?? null, title: task.title ?? null, reason: null });
    } catch (error) {
      const code = (error as AppError)?.code;
      result.set(str(row.id), { available: false, status: null, title: null, reason: code === 'not_found' ? 'This Ri task was deleted' : code === 'forbidden' || code === 'unsupported' ? 'Allow Ri tasks in Sources to check this task' : 'Ri could not check this task right now' });
    }
  }
  return result;
}

/** Links still waiting for their Ri task, oldest first. The follow_up_tasks job works through them. */
export function waitingFollowUps(): Row[] {
  return app().db.prepare("SELECT * FROM follow_up_links WHERE state = 'pending' AND task_id IS NULL ORDER BY created_at, id LIMIT 20").all();
}

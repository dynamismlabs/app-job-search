/**
 * Job Search on App Builder: the actions (data tools), the `show_*` views,
 * the jobs it runs on its own, what a connection may be limited to, and what
 * it borrows from the person's hub (Ri).
 *
 * Importing this module opens nothing: the build imports it to write the
 * contract. Storage is bound per request and job run (server/state.ts).
 */
import { defineJob, type Application } from "@app-builder/core";
import { appConfig } from "../app.config";
import { toAction, runHandler } from "./lib/action.js";
import { requireOwner } from "./lib/invocation.js";
import { opportunityActions } from "./api/opportunities.js";
import { interviewActions } from "./api/interviews.js";
import { materialActions } from "./api/materials.js";
import { preparationActions } from "./api/preparation.js";
import { reviewActions } from "./api/review.js";
import { sourceActions } from "./api/sources.js";
import { importActions } from "./api/imports.js";
import { followUpActions } from "./api/followups.js";
import { viewActions } from "./api/view.js";
import { MANUAL_SOURCE, MATERIALS_SOURCE } from "./domain/model.js";
import { accountLabel, COLLECTION_LABELS } from "./server/project.js";
import { accessNow, app } from "./server/state.js";
import { exportRecords } from "./server/view.js";
import { MIGRATIONS } from "./server/migrations.js";
import { views } from "./views.js";
import { prompts } from "./prompts.js";
import { RECORD_PATHS, readRecord, searchRecords } from "./server/mentions.js";

const definitions = [...viewActions, ...opportunityActions, ...interviewActions, ...materialActions, ...preparationActions, ...reviewActions, ...followUpActions, ...importActions, ...sourceActions];

export const application: Application = {
  config: appConfig,
  actions: definitions.map(toAction),
  views,
  /** Ri's two Job Search skills, as requests the person starts from an assistant (prompts.ts). */
  prompts,
  migrations: MIGRATIONS,
  /**
   * What an assistant connection can be limited to on the consent screen:
   * the two collections the person keeps, and each account read through Ri.
   * Every read filters by it before anything is assembled (server/project.ts).
   * The label is a plural noun: the core says "All your …, including new ones".
   */
  sources: {
    label: "collections and accounts",
    list: (ctx) => runHandler(ctx, () => [
      { id: MANUAL_SOURCE, name: COLLECTION_LABELS[MANUAL_SOURCE], detail: "Opportunities, postings, stage history, interviews you added, preparation and follow-ups" },
      { id: MATERIALS_SOURCE, name: COLLECTION_LABELS[MATERIALS_SOURCE], detail: "Résumé, cover letter and other material versions" },
      ...[...new Map(app().accounts.list().map((account) => [account.account, account])).values()].map((account) => ({
        id: `account:${account.account}`,
        name: accountLabel(account.account, account.kind, accessNow()),
        detail: "Job email and calendar interviews read from this account through Ri",
      })),
    ]),
  },
  /**
   * Records a host can open the app at (`open_job_search`'s path) and offer in
   * its @ menu. Read under the connection's access, like any read.
   */
  records: {
    paths: RECORD_PATHS,
    search: (ctx, query) => runHandler(ctx, (invocation) => searchRecords(invocation.scope, query)),
    read: (ctx, path) => runHandler(ctx, (invocation) => readRecord(invocation.scope, invocation.access, path)),
  },
  /** Ri's schedule in the old app; the app's own durable runner now. */
  jobs: [
    defineJob({ name: "sync_sources", title: "Mail and calendar updates", schedule: "every 5 minutes", action: "run_background_step" }),
    defineJob({ name: "follow_up_tasks", title: "Follow-ups waiting for Ri", schedule: "every 5 minutes", action: "create_waiting_follow_ups" }),
  ],
  /** What Job Search reads through the person's hub (Ri). Nothing is ever sent, booked or written to a calendar. */
  connectors: {
    purpose: "to find your job application, recruiter, interview and offer emails and the interviews on your calendar, and to add follow-up tasks you ask for",
    capabilities: ["mail.read", "calendar.read"],
    tools: [
      "gmail__get_profile", "gmail__read_message", "gmail__list_history",
      "google_calendar__list_calendars", "google_calendar__sync_events",
      "ri__ai_text", "ri__extract_text", "ri__create_task", "ri__get_task",
    ],
  },
  async exportData(ctx) {
    return runHandler(ctx, (invocation) => {
      requireOwner(invocation, "Only the person who owns this app can export its records");
      const exported = exportRecords(invocation.scope);
      return { records: JSON.parse(exported.text) as unknown };
    });
  },
};

/**
 * Render tools for assistants (`show_*`). The model reads with the data
 * actions (list_opportunities, get_opportunity, get_today) and calls these
 * when the person should see records: each draws a card of the app's view in
 * the chat, under the connection's own access. The core adds
 * `open_job_search`, the whole app full screen.
 */
import { z } from "zod/v3";
import { defineView, type View } from "@app-builder/core";
import { runHandler } from "./lib/action.js";
import { opportunitySummarySchema, outcomeSchema, stageLabel, stageSchema, type OpportunitySummary } from "./domain/model.js";
import { listOpportunities, opportunityRowFor } from "./server/reads.js";
import { loadBundles, summarize } from "./server/project.js";
import { today } from "./server/view.js";
import { todaySchema } from "./api/view.js";

const line = (item: OpportunitySummary) => `${item.company}, ${item.role} (${stageLabel(item.stage, item.outcome)})`;

export const views: View[] = [
  defineView({
    name: "show_opportunities",
    title: "Show job opportunities",
    description: "Show the person job opportunities from Job Search in a card, with each one's stage and what's next. Pass ids to show particular opportunities (ones you just saved, found or changed), or filter by view, stage or search. Use it when seeing the roles helps the person. To read them yourself, use list_opportunities or get_opportunity.",
    input: z.object({
      title: z.string().max(80).optional().describe('A short heading, such as "Interviewing now" or "Saved this week".'),
      ids: z.array(z.string().uuid()).max(50).optional().describe("Show exactly these opportunities, in this order."),
      view: z.enum(["active", "closed", "archived", "all"]).default("active").describe("Without ids: active (the default), closed, archived or all."),
      stage: stageSchema.optional(),
      outcome: outcomeSchema.optional(),
      search: z.string().max(200).optional().describe("Without ids: company or role words."),
      limit: z.number().int().min(1).max(50).default(12),
    }),
    output: z.object({ title: z.string(), items: z.array(opportunitySummarySchema), more: z.boolean(), total: z.number().int() }),
    invoking: "Getting your opportunities", invoked: "Your opportunities",
    handler: (ctx, input) => runHandler(ctx, (invocation) => {
      const scope = invocation.scope;
      let items: OpportunitySummary[], total: number, more: boolean;
      if (input.ids?.length) {
        const rows = input.ids.flatMap((id) => { try { return [opportunityRowFor(scope, id)]; } catch { return []; } });
        items = loadBundles(rows, scope).map((bundle) => summarize(bundle, scope));
        items.sort((a, b) => input.ids!.indexOf(a.id) - input.ids!.indexOf(b.id));
        total = items.length; more = false;
      } else {
        const page = listOpportunities(scope, invocation.access, { limit: input.limit, view: input.view, stage: input.stage, outcome: input.outcome, search: input.search });
        items = page.items; total = page.total; more = !!page.nextCursor;
      }
      const title = input.title ?? (input.stage ? stageLabel(input.stage, input.outcome ?? null) : input.view === "closed" ? "Closed opportunities" : input.view === "archived" ? "Archived opportunities" : "Your opportunities");
      const listed = items.slice(0, 10).map(line).join("; ");
      return {
        summary: items.length ? `Showed ${items.length}${more ? ` of ${total}` : ""} ${items.length === 1 ? "opportunity" : "opportunities"}: ${listed}${items.length > 10 ? "; …" : ""}.` : "No opportunities match, so the card says so.",
        data: { title, items, more, total },
      };
    }),
  }),
  defineView({
    name: "show_today",
    title: "Show today in Job Search",
    description: "Show the person what needs attention in their job search today in a card: upcoming interviews in their own time zones, invitations to choose times, deadlines and next actions, responses waiting for review and follow-ups. To read it yourself, use get_today.",
    input: z.object({ zone: z.string().max(100).optional().describe("The person's time zone, such as America/Denver.") }),
    output: todaySchema,
    invoking: "Checking your job search", invoked: "Today in your job search",
    handler: (ctx, input) => runHandler(ctx, (invocation) => {
      const data = today(invocation.scope, input.zone);
      const parts = [
        data.interviews.length && `${data.interviews.length} upcoming interview${data.interviews.length === 1 ? "" : "s"}`,
        data.scheduling.length && `${data.scheduling.length} waiting for a time`,
        data.deadlines.length && `${data.deadlines.length} deadline${data.deadlines.length === 1 ? "" : "s"} or next action${data.deadlines.length === 1 ? "" : "s"}`,
        data.responses.length && `${data.responses.length} response${data.responses.length === 1 ? "" : "s"} to review`,
      ].filter(Boolean);
      return { summary: parts.length ? `Showed today: ${parts.join(", ")}.` : "Nothing needs attention today, and the card says so.", data };
    }),
  }),
];

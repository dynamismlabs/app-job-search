/**
 * Job Search's actions keep the shape they had in Ri (`defineAction` with a
 * handler taking the input and an invocation), and `toAction` turns each into
 * an App Builder core action: the same action router serves the browser over
 * tRPC, the assistant view and every MCP client.
 *
 * What changed on the way:
 * - Audience. Every action the screens call is an MCP tool, since a view in an
 *   assistant reaches the app only through the host. The person's own
 *   decisions (review, deleting, importing, source setup) are view-only
 *   (`viewOnly`, MCP Apps' `visibility: ["app"]`): a host that follows MCP Apps,
 *   as Ri does, keeps them from the model. That's the host's rule, so each
 *   still checks the caller's access and needs a connection that may write.
 * - Retries. Ri gave every call a durable invocation ID. MCP has none, so a
 *   write takes an optional `operationId`: a retry with the same one returns
 *   the first result without writing again.
 * - Access. The invocation's scope is the connection's choice on the app's
 *   consent screen (lib/data.ts `scopeFor`); the core refuses writes for a
 *   read-only connection before the handler runs.
 */
import { z } from "zod/v3";
import { defineAction as coreAction, type Action, type Context } from "@app-builder/core";
import { toActionError } from "./contract.js";
import { invocationFor, type AppInvocation } from "./invocation.js";
import { accessNow, bindState } from "../server/state.js";

export interface ActionDefinition<I = unknown, O = unknown> {
  name: string;
  /** A short title for tool lists. Derived from the name when left out. */
  title?: string;
  description: string;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  /** Who may call it in Ri. `schedule` actions now run from the core's job runner. */
  audience: ("user" | "agent" | "schedule")[];
  effect: "read" | "app_write" | "app_delete";
  retry: "read_safe" | "idempotent" | "unsafe";
  /** Ri's view-only marker, which said the view called it. `viewOnly` is what hosts enforce now. */
  visibility?: "app" | "both";
  /** Ri's per-call time limit. The core has none; kept for the record. */
  timeoutMs?: number;
  /** The person's own decision: the view calls it, and a host that follows MCP Apps keeps it from the model. */
  viewOnly?: boolean;
  errors?: readonly string[];
  examples?: { input: unknown; output: unknown }[];
  handler(input: I, invocation: AppInvocation): Promise<O> | O;
}

/** Keep the definition as written (typed by its schemas). */
export function defineAction<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  definition: Omit<ActionDefinition<z.infer<I>, z.infer<O>>, "input" | "output"> & { input: I; output: O },
): ActionDefinition<z.infer<I>, z.infer<O>> {
  return definition as ActionDefinition<z.infer<I>, z.infer<O>>;
}

const operationId = z.string().uuid().optional().describe("Send the same ID when retrying this change: the retry returns the first result and changes nothing.");

function titleOf(name: string) {
  const words = name.replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}

/** Run an old-style handler with the state and invocation bound from the core's context. */
export async function runHandler<T>(ctx: Context, run: (invocation: AppInvocation) => Promise<T> | T, options: { operationId?: string; fixture?: boolean } = {}): Promise<T> {
  bindState(ctx.platform);
  const invocation = invocationFor(ctx, { operationId: options.operationId, access: accessNow(), fixture: options.fixture });
  try {
    return await run(invocation);
  } catch (error) {
    throw toActionError(error);
  } finally {
    await invocation.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAction(definition: ActionDefinition<any, any>): Action {
  const write = definition.effect !== "read";
  const base = definition.input as z.AnyZodObject;
  const ownsOperation = "operationId" in (base.shape ?? {});
  const input = write && !ownsOperation ? base.extend({ operationId }) : base;
  const audience: ("user" | "agent")[] = definition.audience.includes("schedule") ? ["user"] : ["user", "agent"];
  return coreAction({
    name: definition.name,
    title: definition.title ?? titleOf(definition.name),
    description: definition.description + (write && !ownsOperation ? " Pass operationId to make a retry safe." : ""),
    input,
    output: definition.output,
    audience,
    effect: definition.effect === "read" ? "read" : definition.effect === "app_delete" ? "delete" : "write",
    retry: definition.retry === "unsafe" ? "unsafe" : "safe",
    ...(definition.viewOnly ? { visibility: ["app"] as ("model" | "app")[] } : {}),
    handler: async (ctx, parsed) => {
      const { operationId: id, ...rest } = parsed as Record<string, unknown> & { operationId?: string };
      const handlerInput = ownsOperation ? parsed : rest;
      return runHandler(ctx, (invocation) => definition.handler(handlerInput, invocation), { operationId: id });
    },
  });
}

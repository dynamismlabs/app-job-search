/**
 * Who is calling and what they may reach, for the query layer.
 *
 * In Ri, each call arrived with an invocation: a principal (the owner's view,
 * a chat, the schedule or a preview), the chat's data scope, a durable
 * invocation ID and `capability()` to reach Gmail, Calendar and Ri's own
 * services. Here the same shape is built from the core's request context:
 *
 * - The principal comes from the connection (an assistant using its OAuth
 *   token), the job runner, or the person's own browser.
 * - The scope is the connection's choice on the app's consent screen.
 * - `capability()` reaches the person's hub (Ri) through the core's connector
 *   client, calling Ri's tools by name, so the app never holds a Google token.
 * - The durable invocation ID is the caller's `operationId`, when it sends one.
 */
import { randomUUID } from "node:crypto";
import { ApprovalPending, SetupRequired, SourceUnavailable, connectors, type Context } from "@app-builder/core";
import { AppError } from "./contract.js";
import { scopeFor, type AccessScope } from "./data.js";

export type PrincipalKind = "owner-ui" | "chat" | "job" | "fixture";
export interface AppPrincipal { kind: PrincipalKind; id: string }
/** An account the person set up in Sources, with what the hub currently allows for it. */
export interface GrantedAccount {
  account: string;
  binding: "mail" | "calendar";
  actions: string[];
  automatic: boolean;
}
export interface InvocationAccess {
  protocol: "app-builder-connection";
  actorId: string;
  scopeRef: string | null;
  accounts: GrantedAccount[];
}
export type CapabilityTarget = string | { binding?: string; account?: string };
export interface AppInvocation {
  /** The caller's operation ID for a retry-safe write, or a fresh one. */
  id: string;
  /** True when `id` came from the caller, so a retry with it replays the first result. */
  durable: boolean;
  principal: AppPrincipal;
  audience: "user" | "agent" | "schedule";
  deadline: number;
  signal: AbortSignal;
  scope: AccessScope;
  access: InvocationAccess | null;
  /** The core's context, for anything the shim doesn't cover. */
  context: Context | null;
  capability(name: string, input: unknown, target?: CapabilityTarget): Promise<unknown>;
  /** The hub's tool names, read once per invocation. */
  hubTools(): Promise<Set<string>>;
  /** Close the hub connection this invocation opened, if any. */
  close(): Promise<void>;
}

/** The default account: the one account the person allowed in Ri, called without an `account` argument. */
export const DEFAULT_ACCOUNT = "default";

/** Ri's hub tool for an old capability name: gmail.read_message → gmail__read_message, ai_text → ri__ai_text. */
export function hubTool(name: string) {
  if (name.includes(".")) return name.replace(".", "__");
  return `ri__${name}`;
}

const NOT_FOUND = /not.?found|\b404\b|\b410\b|\bgone\b|expired|no longer (exists|available)|invalid (sync|history|page) ?token/i;
const NEEDS_CONNECTING = new Set(["authorization_required", "additional_permission_required", "choose_connection_method", "choose_account"]);

/** Map the connector client's failures to the query layer's error codes. */
export function capabilityError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof ApprovalPending) return Object.assign(new AppError("approval_required", "Waiting for your approval in Ri"), { cause: error });
  if (error instanceof SourceUnavailable) return Object.assign(new AppError("busy", error.message), { cause: error });
  if (error instanceof SetupRequired) {
    const code = /hasn't been allowed|no longer allowed|doesn't allow/i.test(error.message) ? "forbidden" : "revoked";
    return Object.assign(new AppError(code, error.message), { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  // The connector client keeps only the hub's message, not its error code, so a provider's
  // "not found" (an expired Gmail history checkpoint, a deleted message) is read from the text.
  if (NOT_FOUND.test(message)) return Object.assign(new AppError("not_found", message), { cause: error });
  return error;
}

/**
 * Calls Ri's tools for one request or job run. The tool listing is read once
 * per invocation: a tool the hub doesn't list (not granted, or no hub) is
 * refused before anything is sent.
 */
export function hubCapability(ctx: Context | null) {
  let client: ReturnType<typeof connectors> | null = null;
  let listed: Promise<Set<string>> | null = null;
  return {
    async tools(): Promise<Set<string>> {
      if (!ctx) throw new AppError("unsupported", "No hub is available here");
      client ??= connectors(ctx);
      listed ??= client.tools().then((names) => new Set(names)).catch((error) => { listed = null; throw capabilityError(error); });
      return listed;
    },
    async call(name: string, input: unknown, target?: CapabilityTarget): Promise<unknown> {
      const tool = hubTool(name);
      const tools = await this.tools();
      if (!tools.has(tool)) {
        if (tool.startsWith("ri__")) throw new AppError("unsupported", `Ri hasn't allowed this app to use ${name.replace(/_/g, " ")}. Allow it on the app's page in Ri.`);
        throw new AppError("forbidden", "Ri hasn't allowed this app to read this account. Allow it on the app's page in Ri.");
      }
      const account = typeof target === "object" ? target.account : undefined;
      const args = { ...(input as Record<string, unknown> ?? {}), ...(account && account !== DEFAULT_ACCOUNT ? { account } : {}) };
      let result: unknown;
      try { result = await client!.call(tool, args); }
      catch (error) { throw capabilityError(error); }
      const status = result && typeof result === "object" ? (result as { status?: unknown }).status : undefined;
      // Ri answers some setup states as ordinary results, which the connector client passes through.
      if (typeof status === "string" && NEEDS_CONNECTING.has(status))
        throw new AppError("revoked", String((result as { message?: unknown }).message ?? "Reconnect this account in Ri."));
      return result;
    },
    async close() { await client?.close(); },
  };
}

/** The invocation for a request or job run. */
export function invocationFor(ctx: Context, options: { operationId?: string; access: InvocationAccess | null; audience?: AppInvocation["audience"]; fixture?: boolean }): AppInvocation {
  const principal: AppPrincipal = options.fixture ? { kind: "fixture", id: "preview" }
    : ctx.job ? { kind: "job", id: ctx.job.name }
    : ctx.connection ? { kind: "chat", id: ctx.connection.name.slice(0, 120) || ctx.connection.clientId }
    : { kind: "owner-ui", id: ctx.viewer.id };
  const actorId = `${principal.kind}:${principal.id}`;
  const hub = hubCapability(ctx);
  return {
    id: options.operationId ?? randomUUID(),
    durable: !!options.operationId,
    principal,
    audience: options.audience ?? (ctx.job ? "schedule" : ctx.connection ? "agent" : "user"),
    deadline: Date.now() + (ctx.job ? 50_000 : 40_000),
    signal: ctx.request?.signal ?? new AbortController().signal,
    scope: scopeFor(actorId, ctx.connection),
    access: options.access ? { ...options.access, actorId } : null,
    context: ctx,
    capability: (name, input, target) => hub.call(name, input, target),
    hubTools: () => hub.tools(),
    close: () => hub.close(),
  };
}

/** The caller as stored with authored records and decisions. */
export function actorOf(invocation: Pick<AppInvocation, "principal">): string {
  return `${invocation.principal.kind}:${invocation.principal.id}`;
}

/**
 * In Ri, "the owner's view" was its own kind of caller. Here the person's
 * browser, the job runner and any connection the person allowed to see all of
 * Job Search (Ri's own view uses one) are the owner for management actions.
 */
export function requireOwner(invocation: Pick<AppInvocation, "scope">, message = "Only a connection that can see all of Job Search can do this") {
  if (invocation.scope.kind !== "owner") throw new AppError("forbidden", message);
}

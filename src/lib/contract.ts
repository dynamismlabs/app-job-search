/**
 * Error codes and limits the query layer uses. These came from Ri's app kit,
 * which this app no longer depends on. `toActionError` turns them into the
 * errors the App Builder core returns over tRPC and MCP.
 */
import { TRPCError } from "@trpc/server";

export const LIMITS = Object.freeze({
  modelContextBytes: 16_384,
  selections: 50,
});

export type AppErrorCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "revoked"
  | "unsupported"
  | "conflict"
  | "busy"
  | "timeout"
  | "approval_required"
  | "approval_denied"
  | "interrupted"
  | "app_failed";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const TRPC_CODES: Record<AppErrorCode, TRPCError["code"]> = {
  invalid_input: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  forbidden: "FORBIDDEN",
  revoked: "UNAUTHORIZED",
  unsupported: "PRECONDITION_FAILED",
  conflict: "CONFLICT",
  busy: "TOO_MANY_REQUESTS",
  timeout: "TIMEOUT",
  approval_required: "PRECONDITION_FAILED",
  approval_denied: "FORBIDDEN",
  interrupted: "CLIENT_CLOSED_REQUEST",
  app_failed: "INTERNAL_SERVER_ERROR",
};

/** An AppError becomes the core's typed error with the same message. Anything else passes through. */
export function toActionError(error: unknown): unknown {
  if (error instanceof AppError || (error as { name?: string })?.name === "AppError") {
    const typed = error as AppError;
    return new TRPCError({ code: TRPC_CODES[typed.code] ?? "INTERNAL_SERVER_ERROR", message: typed.message, cause: typed });
  }
  return error;
}

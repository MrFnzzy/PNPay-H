/** Errors whose message is safe to show to end users. Anything else is shown as a generic message. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    public readonly code: string = "error",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Returns a message safe for the UI; logs the internal error without sensitive data. */
export function toSafeMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  console.error("[pnpay] unexpected error:", err instanceof Error ? err.name : "unknown");
  return GENERIC_ERROR;
}

export function pgErrorInfo(err: unknown): { code?: string; constraint?: string } {
  if (typeof err === "object" && err !== null) {
    // Drizzle wraps driver errors; the pg error may be in `cause`.
    const e = err as { code?: string; constraint?: string; cause?: unknown };
    if (e.code) return { code: e.code, constraint: e.constraint };
    if (e.cause) return pgErrorInfo(e.cause);
  }
  return {};
}

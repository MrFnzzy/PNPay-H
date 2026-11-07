import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    APP_BASE_URL: z.string().url("APP_BASE_URL must be a full URL").transform((v) => v.replace(/\/+$/, "")),
    EMAIL_PROVIDER: z.enum(["resend", "smtp", "file", "memory"]).default("file"),
    EMAIL_FROM: z.string().min(3).default("PNPay-H <no-reply@example.com>"),
    RESEND_API_KEY: z.string().optional(),
    /** EMAIL_PROVIDER=smtp (Nodemailer): e.g. Gmail smtp.gmail.com:465 with an APP PASSWORD (not the normal password). */
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
    /** true = implicit TLS (port 465). false = STARTTLS upgrade (port 587). */
    SMTP_SECURE: z.enum(["true", "false"]).default("true"),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    /** Override only for tests (mock provider). Defaults to the real Resend API. */
    RESEND_API_URL: z.string().url().default("https://api.resend.com/emails"),
    /** Private receipt storage. vercel-blob in production; local (dev only) and memory (tests). */
    RECEIPT_STORAGE: z.enum(["vercel-blob", "postgres", "local", "memory"]).default("local"),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
    /** Folder for the local provider (development only). Defaults to ./.dev-receipts */
    RECEIPT_LOCAL_DIR: z.string().optional(),
    /** TEST ONLY: lets the production build run the E2E suite with non-Blob storage. Ignored when VERCEL_ENV=production. */
    ALLOW_NON_PRODUCTION_STORAGE: z.enum(["1"]).optional(),
    /** Phase 4: shared secret for the scheduled-job routes (Vercel sends it as `Authorization: Bearer <CRON_SECRET>`). Jobs refuse to run without it. */
    CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters").optional(),
    /** LLD 11.4 default: remind 5 days before the due date. Needs Miss Jean's confirmation (OPEN-9). */
    REMINDER_DAYS_BEFORE: z.coerce.number().int().min(1).max(30).default(5),
    /** Overdue reminders are OFF until Miss Jean approves them (OPEN-15). */
    OVERDUE_REMINDERS_ENABLED: z.enum(["0", "1"]).default("0"),
    /** Max receipt size in bytes (D-013: 10 MB). */
    RECEIPT_MAX_BYTES: z.coerce.number().int().min(100_000).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_PROVIDER === "resend" && !v.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend" });
    }
    if (v.EMAIL_PROVIDER === "smtp") {
      for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"] as const) {
        if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: `${k} is required when EMAIL_PROVIDER=smtp` });
      }
    }
    if (v.RECEIPT_STORAGE === "vercel-blob" && !v.BLOB_READ_WRITE_TOKEN) {
      ctx.addIssue({ code: "custom", path: ["BLOB_READ_WRITE_TOKEN"], message: "BLOB_READ_WRITE_TOKEN is required when RECEIPT_STORAGE=vercel-blob" });
    }
    const storageBypass = v.ALLOW_NON_PRODUCTION_STORAGE === "1" && process.env.VERCEL_ENV !== "production";
    if (v.NODE_ENV === "production" && v.RECEIPT_STORAGE !== "vercel-blob" && v.RECEIPT_STORAGE !== "postgres" && !storageBypass) {
      ctx.addIssue({ code: "custom", path: ["RECEIPT_STORAGE"], message: "RECEIPT_STORAGE must be 'vercel-blob' or 'postgres' in production" });
    }
    if (v.NODE_ENV === "production" && v.EMAIL_PROVIDER !== "resend" && v.EMAIL_PROVIDER !== "smtp") {
      ctx.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "EMAIL_PROVIDER must be 'resend' or 'smtp' in production" });
    }
    if (v.NODE_ENV === "production" && !v.APP_BASE_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["APP_BASE_URL"], message: "APP_BASE_URL must use https in production" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validates lazily (first use at runtime) so `next build` does not require secrets. Server-only. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    // Names/messages only - never values.
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCacheForTests() {
  cached = undefined;
}

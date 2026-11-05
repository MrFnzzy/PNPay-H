import { eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { pgErrorInfo } from "@/lib/errors";

/**
 * Runs a scheduled job and records the run (name, times, counts, error CODE only) in job_runs so the administrator can
 * see whether the cron jobs are actually firing. Never throws: a failing job reports ok=false.
 */
export async function runJob<T extends object>(job: string, fn: () => Promise<T>): Promise<{ ok: boolean; summary?: T; error?: string }> {
  const db = getDb();
  const [run] = await db.insert(schema.jobRuns).values({ job }).returning({ id: schema.jobRuns.runId });
  try {
    const summary = await fn();
    await db.update(schema.jobRuns).set({ finishedAt: new Date(), ok: true, summary }).where(eq(schema.jobRuns.runId, run.id));
    if (Math.random() < 0.05) await db.delete(schema.jobRuns).where(lt(schema.jobRuns.startedAt, new Date(Date.now() - 90 * 86_400_000)));
    return { ok: true, summary };
  } catch (err) {
    const code = pgErrorInfo(err).code;
    const error = `${err instanceof Error ? err.name : "Error"}${code ? ` ${code}` : ""}`.slice(0, 300);
    console.error(`[pnpay] job ${job} failed: ${error}`);
    await db.update(schema.jobRuns).set({ finishedAt: new Date(), ok: false, error }).where(eq(schema.jobRuns.runId, run.id)).catch(() => {});
    return { ok: false, error };
  }
}

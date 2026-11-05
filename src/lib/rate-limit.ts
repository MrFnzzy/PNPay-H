import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimitEvents } from "@/db/schema";

/** Counts events for `key` in the window. */
export async function countEvents(key: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(rateLimitEvents)
    .where(and(eq(rateLimitEvents.key, key), gte(rateLimitEvents.createdAt, since)));
  return row?.n ?? 0;
}

export async function recordEvent(key: string): Promise<void> {
  await getDb().insert(rateLimitEvents).values({ key });
  if (Math.random() < 0.02) {
    // Opportunistic cleanup of old rows.
    await getDb()
      .delete(rateLimitEvents)
      .where(lt(rateLimitEvents.createdAt, new Date(Date.now() - 24 * 3600_000)));
  }
}

export async function clearEvents(key: string): Promise<void> {
  await getDb().delete(rateLimitEvents).where(eq(rateLimitEvents.key, key));
}

/** Records an attempt and returns true if it is still within the limit. */
export async function hit(key: string, max: number, windowMs: number): Promise<boolean> {
  await recordEvent(key);
  return (await countEvents(key, windowMs)) <= max;
}

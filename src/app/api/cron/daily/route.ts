import { authorizeCron, jobResponse, jobs } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The single job in vercel.json (works on every Vercel plan, including Hobby's once-a-day limit):
 * payment reminders -> email delivery/retry -> receipt-upload cleanup. Each step is independent: one failing step
 * does not stop the others. Protected by CRON_SECRET.
 */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const reminders = await jobs.reminders();
  const email = await jobs.email();
  const cleanup = await jobs.cleanup();
  return jobResponse({ job: "daily", reminders, email, cleanup }, reminders.ok && email.ok && cleanup.ok);
}

import { authorizeCron, jobResponse, jobs } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scheduled job (cleanup). GET only (Vercel Cron). Protected by CRON_SECRET. Returns counts only. */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const r = await jobs.cleanup();
  return jobResponse({ job: "cleanup", ...r }, r.ok);
}

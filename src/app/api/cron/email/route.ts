import { authorizeCron, jobResponse, jobs } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scheduled job (email). GET only (Vercel Cron). Protected by CRON_SECRET. Returns counts only. */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const r = await jobs.email();
  return jobResponse({ job: "email", ...r }, r.ok);
}

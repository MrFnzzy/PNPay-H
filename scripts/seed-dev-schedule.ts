/**
 * DEVELOPMENT ONLY. Creates monthly installments for one existing student so the Phase 2 portal can be tried
 * for quick local testing. Since Phase 3 the administrator creates real installments at /admin/schedules; this script remains a development convenience only. Refuses to run in production.
 *   npm run seed:dev -- --email juan@example.com --amount 500 --months 10 --start 2026-08-15 --year 2026-2027
 * Nothing here is hardcoded product data: the amount, count, start date and academic year are all arguments.
 */
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/db";
import { loadLocalEnv } from "./_env";

loadLocalEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") throw new Error("Refusing to seed in production.");
  const email = arg("email");
  const amount = Number(arg("amount"));
  const months = Number(arg("months"));
  const start = arg("start");
  const year = arg("year") ?? "2026-2027";
  if (!email || !(amount > 0) || !Number.isInteger(months) || months < 1 || months > 24 || !start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new Error("Usage: --email <student email> --amount <pesos> --months <1-24> --start <YYYY-MM-DD> [--year 2026-2027]");
  }
  const db = getDb();
  const [student] = await db.select({ userId: schema.users.userId }).from(schema.users).where(eq(schema.users.email, email.toLowerCase()));
  if (!student) throw new Error("No student with that email.");
  const rows = Array.from({ length: months }, (_, n) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    const label = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
    return { studentId: student.userId, academicYear: year, periodLabel: label, amountDue: amount.toFixed(2), dueDate: d.toISOString().slice(0, 10) };
  });
  const res = await db.insert(schema.paymentObligations).values(rows).onConflictDoNothing().returning({ id: schema.paymentObligations.obligationId });
  console.log(`Created ${res.length} installment(s) (existing ones were left unchanged).`);
  await closeDb();
}
main().catch(async (e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});

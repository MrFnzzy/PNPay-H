import type { ReactNode } from "react";
import PortalShell from "@/components/PortalShell";
import { requireRole } from "@/lib/auth/session";
import { ensureBatchRolloverProposals } from "@/lib/admin/batches";
import { getUnreadCount } from "@/lib/payments/queries";

/** Every admin page: server-side role guard (in addition to the layout guard), then admin-only data. */
/**
 * The rollover check used to run (3+ sequential queries) on EVERY admin page view. It only matters when a cohort reaches its
 * 30-month date, so it now runs at most once every few minutes per server instance (the daily cron also runs it), and in
 * parallel with the unread-count query instead of before it.
 */
const ROLLOVER_CHECK_EVERY_MS = 5 * 60 * 1000;
const g = globalThis as unknown as { __pnpayRolloverCheckedAt?: number };

async function maybeCheckRollovers() {
  const last = g.__pnpayRolloverCheckedAt ?? 0;
  if (Date.now() - last < ROLLOVER_CHECK_EVERY_MS) return;
  g.__pnpayRolloverCheckedAt = Date.now();
  try {
    await ensureBatchRolloverProposals();
  } catch {
    g.__pnpayRolloverCheckedAt = 0; // retry on the next view; a failed check must never break the page
  }
}

export async function loadAdmin() {
  const user = await requireRole("admin");
  const [unread] = await Promise.all([getUnreadCount(user.userId), maybeCheckRollovers()]);
  return { user, unread };
}

export default function AdminPage({ name, unread, children }: { name: string; unread: number; children: ReactNode }) {
  return (
    <PortalShell portal="admin" name={name} unread={unread}>
      {children}
    </PortalShell>
  );
}

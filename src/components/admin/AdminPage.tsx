import type { ReactNode } from "react";
import PortalShell from "@/components/PortalShell";
import { requireRole } from "@/lib/auth/session";
import { getUnreadCount } from "@/lib/payments/queries";

/** Every admin page: server-side role guard (in addition to the layout guard), then admin-only data. */
export async function loadAdmin() {
  const user = await requireRole("admin");
  return { user, unread: await getUnreadCount(user.userId) };
}

export default function AdminPage({ name, unread, children }: { name: string; unread: number; children: ReactNode }) {
  return (
    <PortalShell portal="admin" name={name} unread={unread}>
      {children}
    </PortalShell>
  );
}

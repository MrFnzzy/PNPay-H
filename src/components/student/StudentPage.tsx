import type { ReactNode } from "react";
import PortalShell from "@/components/PortalShell";
import { requireRole } from "@/lib/auth/session";
import { getUnreadCount } from "@/lib/payments/queries";

/** Every student page: server-side role guard, then data scoped to the session user. Never takes a student id from the URL. */
export async function loadStudent(options: { includeUnread?: boolean } = {}) {
  const user = await requireRole("student");
  const unread = options.includeUnread === false ? 0 : await getUnreadCount(user.userId);
  return { user, unread };
}

export default function StudentPage({ name, unread, children }: { name: string; unread: number; children: ReactNode }) {
  return (
    <PortalShell portal="student" name={name} unread={unread}>
      {children}
    </PortalShell>
  );
}
